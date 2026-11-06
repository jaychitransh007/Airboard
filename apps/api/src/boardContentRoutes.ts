import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthService, type AuthContext } from "./auth";
import {
  BoardAssetLifecycleError,
  DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  UPLOAD_STARTS_PER_MINUTE,
  assetKind,
  inspectAndNormalizeBoardImage,
  runtimeCanAcceptImage,
  staleAssetCutoff,
  verifyStoredObject,
  verifyVideoSignature,
  type PendingBoardAsset,
} from "./boardAssetLifecycle";
import { resolveBoardLinkPreview } from "./boardLinkPreview";
import { boardAccessFilter, canEditBoards } from "./boardAccess";
import { clientKey } from "./security";
import { createSharedRateLimiter } from "./sharedRateLimit";

export const ASSET_BUCKET = "board-assets";
const STALE_ASSET_CLEANUP_LIMIT = 25;
const STALE_SWEEP_BATCH_SIZE = 100;
const STALE_SWEEP_MAX_BATCHES = 20;
const STALE_ASSET_STATUSES = ["pending", "failed"];
const ASSET_ERASURE_PAGE_SIZE = 500;
const ASSET_ERASURE_BOARD_CHUNK = 100;
const STORAGE_REMOVE_CHUNK = 100;

type JsonRecord = Record<string, unknown>;

export type BoardContentRouteOptions = {
  /** Bytes of board assets one organization may keep (default 2 GiB). */
  organizationAssetQuotaBytes?: number;
  /** Upload starts one person may make per minute on each instance (default 30). */
  uploadStartsPerMinute?: number;
};

/**
 * Authenticated rich-board routes. Binary data goes directly to the private
 * Supabase bucket using a one-shot signed upload URL; board events retain only
 * the resulting AssetReference metadata.
 */
export function registerBoardContentRoutes(
  server: FastifyInstance,
  auth: AuthService,
  options: BoardContentRouteOptions = {},
): void {
  const quotaBytes = options.organizationAssetQuotaBytes ?? DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES;
  const uploadStartLimiter = createSharedRateLimiter({
    bucket: "upload_start",
    windowMs: 60_000,
    max: options.uploadStartsPerMinute ?? UPLOAD_STARTS_PER_MINUTE,
    client: auth.client,
    onError: (error) => server.log.warn({ err: error }, "shared upload rate limit could not be counted"),
  });

  server.post<{ Params: { boardId: string }; Body: unknown }>(
    "/boards/:boardId/assets/uploads",
    async (request, reply) => {
      const context = await requireBoardEditor(auth, request, reply);
      if (!context) return;
      if (!(await uploadStartLimiter.allow(clientKey(request, { profileId: context.profileId })))) {
        return reply.code(429).send({ error: "RATE_LIMITED" });
      }
      if (!auth.client || !(await canAccessBoard(auth, context, request.params.boardId))) {
        return reply.code(404).send({ error: "BOARD_NOT_FOUND" });
      }
      const client = auth.client;
      // Frees the organization's abandoned uploads before they count against its quota.
      await cleanupStaleBoardAssets(client, context.organizationId, request);

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

      const usedBytes = await organizationAssetBytes(client, context.organizationId);
      if (usedBytes === null) {
        request.log.error("board asset quota lookup failed");
        return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      }
      if (usedBytes + sizeBytes > quotaBytes) {
        return reply.code(413).send({ error: "ASSET_QUOTA_EXCEEDED", quotaBytes, usedBytes });
      }

      const assetId = crypto.randomUUID();
      const storagePath = `${context.organizationId}/${request.params.boardId}/${assetId}/${fileName}`;
      const { data: row, error: insertError } = await client
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
      // Concurrent starts can each pass the check above. The pending row now
      // reserves its bytes, so a recount that includes it settles the race:
      // whichever start recounts last sees every reservation and backs out.
      const reservedBytes = await organizationAssetBytes(client, context.organizationId);
      if (reservedBytes === null || reservedBytes > quotaBytes) {
        await client.from("board_assets").delete().eq("id", assetId);
        if (reservedBytes === null) {
          request.log.error("board asset quota recount failed");
          return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
        }
        return reply.code(413).send({
          error: "ASSET_QUOTA_EXCEEDED",
          quotaBytes,
          usedBytes: reservedBytes - sizeBytes,
        });
      }
      const { data: upload, error: uploadError } = await client.storage
        .from(ASSET_BUCKET)
        .createSignedUploadUrl(storagePath);
      if (uploadError || !upload) {
        await client.from("board_assets").delete().eq("id", assetId);
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
      const context = await requireBoardEditor(auth, request, reply);
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
          );
          // The re-encoded copy replaces the uploaded object at the same path,
          // so the photo's metadata is gone and the object keeps existing:
          // the signed upload URL (valid for two hours, no upsert) cannot
          // then put a second, uncounted object there.
          const { error: replaceError } = await bucket.upload(
            pending.storage_path,
            inspected.stored.bytes,
            {
              contentType: inspected.stored.mimeType,
              cacheControl: "31536000",
              upsert: true,
            },
          );
          if (replaceError) {
            request.log.error({ err: replaceError }, "board asset re-encoded upload failed");
            throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_UNAVAILABLE", 503);
          }
          patch.metadata = { ...(pending.metadata ?? {}), ...inspected.metadata };
          patch.mime_type = inspected.stored.mimeType;
          patch.byte_size = inspected.stored.bytes.byteLength;
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
          // The object stays: a concurrent finalize may have made it ready.
          // A row still pending fails its next finalize and is swept.
          request.log.error({ err: updateError }, "board asset finalization update failed");
          return reply.code(409).send({ error: "BOARD_ASSET_FINALIZE_CONFLICT" });
        }
        return { asset: boardAssetResponse(request.params.boardId, ready) };
      } catch (caught) {
        const lifecycleError = caught instanceof BoardAssetLifecycleError
          ? caught
          : new BoardAssetLifecycleError("BOARD_ASSET_FINALIZE_FAILED", 422);
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
      const context = await requireBoardEditor(auth, request, reply);
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

/** Uploads change boards, so Viewer and Billing members are refused. */
async function requireBoardEditor(
  auth: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const context = await requireAuth(auth, request, reply);
  if (!context) return null;
  if (!canEditBoards(context.role)) {
    reply.code(403).send({ error: "BOARD_READ_ONLY_ROLE" });
    return null;
  }
  return context;
}

/**
 * Bytes the organization holds in pending and ready board assets, from
 * public.organization_board_asset_bytes (service role only). Null when the
 * count is unavailable: callers refuse the upload rather than guess.
 */
async function organizationAssetBytes(
  client: SupabaseClient,
  organizationId: string,
): Promise<number | null> {
  const { data, error } = await client.rpc("organization_board_asset_bytes", {
    p_organization_id: organizationId,
  });
  if (error) return null;
  const bytes = Number(data ?? 0);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

async function canAccessBoard(auth: AuthService, context: AuthContext, boardId: string): Promise<boolean> {
  if (!auth.client || !uuid(boardId)) return false;
  const { data } = await auth.client
    .from("boards")
    .select("id")
    .eq("id", boardId)
    .eq("organization_id", context.organizationId)
    .or(boardAccessFilter(context.profileId))
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
  const { data: failed, error } = await client
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
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  // Only the request that failed the row removes its object: a concurrent
  // finalize may already have replaced it and made the asset ready. A failed
  // row keeps its path, so the stale sweep removes the object if this does not.
  if (removeObject && !error && failed) {
    await client.storage.from(ASSET_BUCKET).remove([asset.storage_path]);
  }
}

/**
 * Signed uploads that are abandoned never receive a finalize request. Each
 * upload start sweeps its own organization's stale rows (so they stop
 * counting against its quota) and the hourly lifecycle job sweeps everyone's
 * with sweepStaleBoardUploads.
 */
async function cleanupStaleBoardAssets(
  client: SupabaseClient,
  organizationId: string,
  request: FastifyRequest,
): Promise<void> {
  const outcome = await removeStaleBoardAssets(client, {
    cutoff: staleAssetCutoff(),
    limit: STALE_ASSET_CLEANUP_LIMIT,
    organizationId,
  });
  if (outcome.failure) {
    request.log.warn({ step: outcome.failure }, "stale board asset cleanup failed");
  }
}

export type StaleBoardUploadSweep = {
  /** Stale pending or failed rows deleted, each after its storage object. */
  removed: number;
  /** 1 when a lookup, storage removal or row deletion failed; the rest waits for the next run. */
  failures: number;
};

/**
 * Removes board uploads that stayed pending or failed for 24 hours, across
 * every organization, oldest first: storage objects first, then their rows.
 * Works in batches of 100, at most 20 batches (2,000 rows) a run; whatever is
 * left is picked up by the next run. Never throws.
 */
export async function sweepStaleBoardUploads(
  client: SupabaseClient,
  now: number = Date.now(),
): Promise<StaleBoardUploadSweep> {
  const cutoff = staleAssetCutoff(now);
  let removed = 0;
  for (let batch = 0; batch < STALE_SWEEP_MAX_BATCHES; batch += 1) {
    const outcome = await removeStaleBoardAssets(client, { cutoff, limit: STALE_SWEEP_BATCH_SIZE });
    removed += outcome.removed;
    if (outcome.failure) return { removed, failures: 1 };
    if (outcome.selected < STALE_SWEEP_BATCH_SIZE) break;
  }
  return { removed, failures: 0 };
}

/**
 * One bounded batch of stale pending/failed rows, optionally within one
 * organization. Objects are deleted before rows, so a failure leaves rows
 * pointing at what still has to be erased.
 */
async function removeStaleBoardAssets(
  client: SupabaseClient,
  scope: { cutoff: string; limit: number; organizationId?: string },
): Promise<{ selected: number; removed: number; failure: "lookup" | "storage" | "delete" | null }> {
  let query = client
    .from("board_assets")
    .select("id,storage_path")
    .in("status", STALE_ASSET_STATUSES)
    .lt("updated_at", scope.cutoff);
  if (scope.organizationId) query = query.eq("organization_id", scope.organizationId);
  const { data, error } = await query
    .order("updated_at", { ascending: true })
    .limit(scope.limit);
  if (error) return { selected: 0, removed: 0, failure: "lookup" };
  const rows = (data ?? []) as Array<{ id?: unknown; storage_path?: unknown }>;
  if (rows.length === 0) return { selected: 0, removed: 0, failure: null };
  const paths = rows
    .map((row) => typeof row.storage_path === "string" ? row.storage_path : null)
    .filter((path): path is string => Boolean(path));
  for (const batch of chunk(paths, STORAGE_REMOVE_CHUNK)) {
    const { error: storageError } = await client.storage.from(ASSET_BUCKET).remove(batch);
    // Absent objects are not errors; a 404 means the bucket itself is gone.
    if (storageError && storageErrorStatus(storageError) !== 404) {
      return { selected: rows.length, removed: 0, failure: "storage" };
    }
  }
  const ids = rows
    .map((row) => typeof row.id === "string" ? row.id : null)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { selected: rows.length, removed: 0, failure: null };
  // Re-check the state so a row finalized meanwhile is never deleted.
  const { error: deleteError } = await client
    .from("board_assets")
    .delete()
    .in("id", ids)
    .in("status", STALE_ASSET_STATUSES)
    .lt("updated_at", scope.cutoff);
  if (deleteError) return { selected: rows.length, removed: 0, failure: "delete" };
  return { selected: rows.length, removed: ids.length, failure: null };
}

/**
 * Erases the bucket objects behind every board_assets row of the given
 * organization (optionally narrowed to some boards). Rows cascade when their
 * board or organization is deleted but storage objects do not, so purge and
 * account/workspace deletion must call this before deleting rows. Missing
 * objects are not errors, which makes a retry after partial failure safe.
 * Throws BOARD_ASSET_STORAGE_DELETE_FAILED (or _LOOKUP_FAILED); callers must
 * then keep the rows so the next lifecycle run retries. Returns the number of
 * object paths submitted for removal.
 */
export async function removeBoardAssetObjects(
  client: SupabaseClient,
  scope: { organizationId: string; boardIds?: string[] },
): Promise<number> {
  const boardChunks = scope.boardIds
    ? chunk(scope.boardIds, ASSET_ERASURE_BOARD_CHUNK)
    : [null];
  let removed = 0;
  for (const boardIds of boardChunks) {
    // Keyset pagination: PostgREST caps unbounded selects at its max-rows.
    let after: string | null = null;
    for (;;) {
      let query = client
        .from("board_assets")
        .select("id,storage_path")
        .eq("organization_id", scope.organizationId);
      if (boardIds) query = query.in("board_id", boardIds);
      if (after) query = query.gt("id", after);
      const { data, error } = await query
        .order("id", { ascending: true })
        .limit(ASSET_ERASURE_PAGE_SIZE);
      if (error) {
        throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_LOOKUP_FAILED", 503);
      }
      const rows = (data ?? []) as Array<{ id?: unknown; storage_path?: unknown }>;
      const paths = rows
        .map((row) => typeof row.storage_path === "string" ? row.storage_path : null)
        .filter((path): path is string => Boolean(path));
      for (const batch of chunk(paths, STORAGE_REMOVE_CHUNK)) {
        const { error: storageError } = await client.storage.from(ASSET_BUCKET).remove(batch);
        // Storage answers success for absent objects; a 404 here means the
        // bucket itself is gone, so there is nothing left to erase either.
        if (storageError && storageErrorStatus(storageError) !== 404) {
          throw new BoardAssetLifecycleError("BOARD_ASSET_STORAGE_DELETE_FAILED", 503);
        }
        removed += batch.length;
      }
      if (rows.length < ASSET_ERASURE_PAGE_SIZE) break;
      const last = rows[rows.length - 1]?.id;
      if (typeof last !== "string") break;
      after = last;
    }
  }
  return removed;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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
