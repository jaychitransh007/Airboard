import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthService, type AuthContext } from "./auth";
import {
  BoardAssetLifecycleError,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  assetKind,
  inspectAndNormalizeBoardImage,
  runtimeCanAcceptImage,
  staleAssetCutoff,
  verifyStoredObject,
  verifyVideoSignature,
  type PendingBoardAsset,
} from "./boardAssetLifecycle";
import { resolveBoardLinkPreview } from "./boardLinkPreview";

const ASSET_BUCKET = "board-assets";
const STALE_ASSET_CLEANUP_LIMIT = 25;

type JsonRecord = Record<string, unknown>;

/**
 * Authenticated rich-board routes. Binary data goes directly to the private
 * Supabase bucket using a one-shot signed upload URL; board events retain only
 * the resulting AssetReference metadata.
 */
export function registerBoardContentRoutes(
  server: FastifyInstance,
  auth: AuthService,
): void {
  server.post<{ Params: { boardId: string }; Body: unknown }>(
    "/boards/:boardId/assets/uploads",
    async (request, reply) => {
      const context = await requireAuth(auth, request, reply);
      if (!context) return;
      if (!auth.client || !(await canAccessBoard(auth, context, request.params.boardId))) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      await cleanupStaleBoardAssets(auth.client, context.organizationId, request);

      const body = record(request.body);
      const parsedMimeType = boundedString(body.mimeType, 3, 120);
      const mimeType = parsedMimeType ? parsedMimeType.toLowerCase() : null;
      const fileName = safeFileName(body.fileName);
      const sizeBytes = finiteInteger(body.sizeBytes);
      const kind = assetKind(mimeType);
      if (!mimeType || !fileName || !sizeBytes || !kind) {
        return reply.code(400).send({ error: "INVALID_BOARD_ASSET" });
      }
      if (kind === "image" && !runtimeCanAcceptImage(mimeType)) {
        return reply.code(415).send({ error: "BOARD_ASSET_NORMALIZATION_UNAVAILABLE" });
      }
      const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (sizeBytes > maxBytes) {
        return reply.code(413).send({ error: "BOARD_ASSET_TOO_LARGE", maxBytes });
      }

      const assetId = crypto.randomUUID();
      const storagePath = `${context.organizationId}/${request.params.boardId}/${assetId}/${fileName}`;
      const { data: row, error: insertError } = await auth.client
        .from("board_assets")
        .insert({
          id: assetId,
          board_id: request.params.boardId,
          organization_id: context.organizationId,
          created_by: context.profileId,
          kind,
          mime_type: mimeType,
          byte_size: sizeBytes,
          original_name: fileName,
          storage_path: storagePath,
          status: "pending",
        })
        .select("id,kind,mime_type,byte_size,original_name,status,metadata")
        .single();
      if (insertError || !row) {
        request.log.error({ err: insertError }, "board asset row creation failed");
        return reply.code(500).send({ error: "BOARD_ASSET_CREATE_FAILED" });
      }
      const { data: upload, error: uploadError } = await auth.client.storage
        .from(ASSET_BUCKET)
        .createSignedUploadUrl(storagePath);
      if (uploadError || !upload) {
        await auth.client.from("board_assets").delete().eq("id", assetId);
        request.log.error({ err: uploadError }, "board asset upload signing failed");
        return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      }
      return reply.code(201).send({
        asset: boardAssetResponse(request.params.boardId, row),
        upload: { url: upload.signedUrl, token: upload.token },
      });
    },
  );

  server.post<{ Params: { boardId: string; assetId: string } }>(
    "/boards/:boardId/assets/:assetId/finalize",
    async (request, reply) => {
      const context = await requireAuth(auth, request, reply);
      if (!context) return;
      if (!auth.client || !(await canAccessBoard(auth, context, request.params.boardId))) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const client = auth.client;
      const { data: asset, error } = await client
        .from("board_assets")
        .select("id,kind,mime_type,byte_size,original_name,storage_path,status,metadata")
        .eq("id", request.params.assetId)
        .eq("board_id", request.params.boardId)
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      if (error || !asset) return reply.code(404).send({ error: "BOARD_ASSET_NOT_FOUND" });
      if (asset.status === "ready") {
        return { asset: boardAssetResponse(request.params.boardId, asset) };
      }
      if (asset.status === "failed") {
        return reply.code(409).send({ error: "BOARD_ASSET_UPLOAD_FAILED" });
      }

      const pending = asset as PendingBoardAsset;
      const bucket = client.storage.from(ASSET_BUCKET);
      const { data: objectInfo, error: objectInfoError } = await bucket.info(pending.storage_path);
      if (objectInfoError) {
        if (storageErrorStatus(objectInfoError) === 404) {
          await markAssetFailed(client, pending, "BOARD_ASSET_UPLOAD_INCOMPLETE", false);
          return reply.code(409).send({ error: "BOARD_ASSET_UPLOAD_INCOMPLETE" });
        }
        request.log.error({ err: objectInfoError }, "board asset storage verification failed");
        return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      }
      if (!objectInfo) {
        await markAssetFailed(client, pending, "BOARD_ASSET_UPLOAD_INCOMPLETE", false);
        return reply.code(409).send({ error: "BOARD_ASSET_UPLOAD_INCOMPLETE" });
      }

      let normalizedPath: string | null = null;
      let normalizedUploaded = false;
      let originalPathToRemove: string | null = null;
      try {
        verifyStoredObject(pending, objectInfo);
        const patch: JsonRecord = {
          status: "ready",
          updated_at: new Date().toISOString(),
          metadata: pending.metadata ?? {},
        };

        if (pending.kind === "image") {
          const { data: source, error: downloadError } = await bucket.download(pending.storage_path);
          if (downloadError || !source) {
            throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
          }
          const inspected = await inspectAndNormalizeBoardImage(
            Buffer.from(await source.arrayBuffer()),
            pending.mime_type,
            pending.storage_path,
          );
          patch.metadata = { ...(pending.metadata ?? {}), ...inspected.metadata };
          if (inspected.normalized) {
            normalizedPath = inspected.normalized.storagePath;
            const { error: normalizedUploadError } = await bucket.upload(
              normalizedPath,
              inspected.normalized.bytes,
              {
                contentType: inspected.normalized.mimeType,
                cacheControl: "31536000",
                upsert: false,
              },
            );
            if (normalizedUploadError) {
              request.log.error({ err: normalizedUploadError }, "board asset normalization upload failed");
              throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
            }
            normalizedUploaded = true;
            patch.storage_path = normalizedPath;
            patch.mime_type = inspected.normalized.mimeType;
            patch.byte_size = inspected.normalized.bytes.byteLength;
            originalPathToRemove = pending.storage_path;
          }
        } else {
          verifyVideoSignature(
            await loadStoredObjectPrefix(client, pending.storage_path),
            pending.mime_type,
          );
        }

        const { data: ready, error: updateError } = await client
          .from("board_assets")
          .update(patch)
          .eq("id", pending.id)
          .eq("board_id", request.params.boardId)
          .eq("organization_id", context.organizationId)
          .eq("status", "pending")
          .select("id,kind,mime_type,byte_size,original_name,status,metadata")
          .maybeSingle();
        if (updateError || !ready) {
          if (normalizedPath && normalizedUploaded) await bucket.remove([normalizedPath]);
          request.log.error({ err: updateError }, "board asset finalization update failed");
          return reply.code(409).send({ error: "BOARD_ASSET_FINALIZE_CONFLICT" });
        }
        if (originalPathToRemove) {
          const { error: cleanupError } = await bucket.remove([originalPathToRemove]);
          if (cleanupError) {
            request.log.warn({ err: cleanupError, path: originalPathToRemove }, "normalized source cleanup failed");
          }
        }
        return { asset: boardAssetResponse(request.params.boardId, ready) };
      } catch (caught) {
        const lifecycleError = caught instanceof BoardAssetLifecycleError
          ? caught
          : new BoardAssetLifecycleError("BOARD_ASSET_FINALIZE_FAILED", 422);
        if (normalizedPath && normalizedUploaded) await bucket.remove([normalizedPath]);
        if (lifecycleError.statusCode < 500) {
          await markAssetFailed(client, pending, lifecycleError.code, true);
        }
        return reply.code(lifecycleError.statusCode).send({ error: lifecycleError.code });
      }
    },
  );

  server.get<{ Params: { boardId: string; assetId: string } }>(
    "/boards/:boardId/assets/:assetId/content",
    async (request, reply) => {
      const context = await requireAuth(auth, request, reply);
      if (!context) return;
      if (!auth.client || !(await canAccessBoard(auth, context, request.params.boardId))) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const { data: asset } = await auth.client
        .from("board_assets")
        .select("storage_path")
        .eq("id", request.params.assetId)
        .eq("board_id", request.params.boardId)
        .eq("organization_id", context.organizationId)
        .eq("status", "ready")
        .maybeSingle();
      if (!asset) return reply.code(404).send({ error: "BOARD_ASSET_NOT_FOUND" });
      const { data: signed } = await auth.client.storage
        .from(ASSET_BUCKET)
        .createSignedUrl(asset.storage_path, 60);
      if (!signed?.signedUrl) {
        return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      }
      return reply.redirect(signed.signedUrl);
    },
  );

  server.delete<{ Params: { boardId: string; assetId: string } }>(
    "/boards/:boardId/assets/:assetId",
    async (request, reply) => {
      const context = await requireAuth(auth, request, reply);
      if (!context) return;
      if (!auth.client || !(await canAccessBoard(auth, context, request.params.boardId))) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const { data: asset } = await auth.client
        .from("board_assets")
        .select("id,storage_path")
        .eq("id", request.params.assetId)
        .eq("board_id", request.params.boardId)
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      if (!asset) return reply.code(404).send({ error: "BOARD_ASSET_NOT_FOUND" });
      const { error: storageError } = await auth.client.storage
        .from(ASSET_BUCKET)
        .remove([asset.storage_path]);
      if (storageError) {
        request.log.error({ err: storageError }, "board asset storage deletion failed");
        return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      }
      const { error: deleteError } = await auth.client
        .from("board_assets")
        .delete()
        .eq("id", asset.id);
      if (deleteError) {
        request.log.error({ err: deleteError }, "board asset row deletion failed");
        return reply.code(500).send({ error: "BOARD_ASSET_DELETE_FAILED" });
      }
      return reply.code(204).send();
    },
  );

  server.post<{ Body: unknown }>("/link-previews", async (request, reply) => {
    const context = await requireAuth(auth, request, reply);
    if (!context) return;
    const url = boundedString(record(request.body).url, 8, 2_048);
    if (!url) return reply.code(400).send({ error: "INVALID_LINK_PREVIEW_URL" });
    try {
      return { preview: await resolveBoardLinkPreview(url) };
    } catch (error) {
      const code = linkPreviewErrorCode(error);
      const status = code === "UNSAFE_LINK_PREVIEW_URL" ? 400 : 422;
      return reply.code(status).send({ error: code });
    }
  });
}

async function requireAuth(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const context = await auth.authenticate(request);
  if (!context) reply.code(401).send({ error: "AUTH_REQUIRED" });
  return context;
}

async function canAccessBoard(auth: AuthService, context: AuthContext, boardId: string): Promise<boolean> {
  if (!auth.client || !uuid(boardId)) return false;
  const { data } = await auth.client
    .from("boards")
    .select("id")
    .eq("id", boardId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  return Boolean(data);
}

async function markAssetFailed(
  client: SupabaseClient,
  asset: PendingBoardAsset,
  code: string,
  removeObject: boolean,
): Promise<void> {
  if (removeObject) {
    await client.storage.from(ASSET_BUCKET).remove([asset.storage_path]);
  }
  await client
    .from("board_assets")
    .update({
      status: "failed",
      metadata: {
        ...(asset.metadata ?? {}),
        failureCode: code,
        failedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", asset.id)
    .eq("status", "pending");
}

/**
 * Signed uploads that are abandoned never receive a finalize request. A small,
 * organization-scoped sweep on future upload creation removes pending/failed
 * objects after 24 hours without needing a globally privileged cron worker.
 */
async function cleanupStaleBoardAssets(
  client: SupabaseClient,
  organizationId: string,
  request: FastifyRequest,
): Promise<void> {
  const { data: stale, error } = await client
    .from("board_assets")
    .select("id,storage_path")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "failed"])
    .lt("updated_at", staleAssetCutoff())
    .limit(STALE_ASSET_CLEANUP_LIMIT);
  if (error) {
    request.log.warn({ err: error }, "stale board asset lookup failed");
    return;
  }
  const rows = stale ?? [];
  if (rows.length === 0) return;
  const paths = rows
    .map((row) => typeof row.storage_path === "string" ? row.storage_path : null)
    .filter((path): path is string => Boolean(path));
  if (paths.length > 0) {
    const { error: storageError } = await client.storage.from(ASSET_BUCKET).remove(paths);
    if (storageError) {
      request.log.warn({ err: storageError }, "stale board asset storage cleanup failed");
      return;
    }
  }
  const ids = rows
    .map((row) => typeof row.id === "string" ? row.id : null)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const { error: deleteError } = await client.from("board_assets").delete().in("id", ids);
  if (deleteError) {
    request.log.warn({ err: deleteError }, "stale board asset row cleanup failed");
  }
}

async function loadStoredObjectPrefix(
  client: SupabaseClient,
  storagePath: string,
  maximumBytes = 64 * 1024,
): Promise<Uint8Array> {
  const { data: signed, error } = await client.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !signed?.signedUrl) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
  }
  let response: Response;
  try {
    response = await fetch(signed.signedUrl, {
      headers: { range: `bytes=0-${maximumBytes - 1}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
  }
  if (!response.ok || !response.body) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const accepted = value.slice(0, maximumBytes - total);
      chunks.push(accepted);
      total += accepted.byteLength;
      if (accepted.byteLength < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function boardAssetResponse(boardId: string, row: JsonRecord): JsonRecord {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.byte_size,
    fileName: row.original_name,
    status: row.status,
    metadata: row.metadata ?? {},
    contentUrl: `/boards/${boardId}/assets/${String(row.id)}/content`,
  };
}

function safeFileName(value: unknown): string | null {
  const input = boundedString(value, 1, 240);
  if (!input) return null;
  const name = input.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name && !name.startsWith(".") ? name.slice(0, 180) : null;
}

function finiteInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function boundedString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const string = value.trim();
  return string.length >= min && string.length <= max ? string : null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function linkPreviewErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return new Set([
    "UNSAFE_LINK_PREVIEW_URL",
    "LINK_PREVIEW_REDIRECT_FAILED",
    "LINK_PREVIEW_FETCH_FAILED",
    "LINK_PREVIEW_NOT_HTML",
    "LINK_PREVIEW_RESPONSE_TOO_LARGE",
  ]).has(message) ? message : "LINK_PREVIEW_FAILED";
}

function storageErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const value = Number(record.statusCode ?? record.status);
  return Number.isInteger(value) ? value : null;
}
