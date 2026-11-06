import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext, AuthService } from "./auth";
import { ASSET_BUCKET } from "./boardContentRoutes";
import { canEditBoards } from "./boardAccess";
import type { ApiConfig } from "./config";
import { activeMembership, organizationPolicy } from "./organizationPolicy";
import { clientKey, createRateLimiter } from "./security";

/** How long a new view-only link lasts; null keeps it until it is turned off. */
export const SHARE_LINK_LIFETIMES_DAYS = [7, 30, null] as const;
const MAX_ACTIVE_LINKS_PER_BOARD = 20;
/** Boards scanned for the admin list, and how many go in one `in` filter. */
const ADMIN_LINK_BOARD_LIMIT = 5_000;
const BOARD_ID_CHUNK = 100;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Audit = (
  context: AuthContext,
  request: FastifyRequest,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

type ShareRow = { id: string; created_at: string; expires_at: string | null; revoked_at: string | null };

/**
 * View-only links to a saved board. The board's owner creates and turns them
 * off, and the organization's admins can list and turn off every link; anyone
 * holding one can read the board without an account. A link stops working
 * when its creator leaves the organization, is suspended or loses the right
 * to edit boards, and while the organization does not allow external guests.
 * Only a hash of each token is stored, so a link is shown once, when it is made.
 */
export function registerBoardShareRoutes(
  server: FastifyInstance,
  config: Pick<ApiConfig, "appUrl" | "trustedProxyHops">,
  auth: AuthService,
  audit: Audit,
): void {
  // Anyone can call the public routes, so they are limited per caller.
  const publicLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

  server.get<{ Params: { boardId: string } }>("/boards/:boardId/share-links", async (request, reply) => {
    const owned = await ownedBoard(auth, request, reply);
    if (!owned) return;
    const { data, error } = await owned.client
      .from("board_shares")
      .select("id,created_at,expires_at,revoked_at")
      .eq("board_id", owned.boardId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) return reply.code(500).send({ error: "SHARE_LINK_LIST_FAILED" });
    return { links: activeLinks(data ?? []).map(publicLink) };
  });

  server.post<{ Params: { boardId: string }; Body: unknown }>("/boards/:boardId/share-links", async (request, reply) => {
    const owned = await ownedBoard(auth, request, reply);
    if (!owned) return;
    if (!canEditBoards(owned.context.role)) return reply.code(403).send({ error: "BOARD_READ_ONLY_ROLE" });
    const policy = await organizationPolicy(owned.client, owned.context.organizationId).catch(() => null);
    if (!policy) return reply.code(503).send({ error: "POLICY_UNAVAILABLE" });
    if (!policy.externalGuestsAllowed) return reply.code(403).send({ error: "EXTERNAL_GUESTS_DISABLED" });
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const days = body.expiresInDays === undefined ? 7 : body.expiresInDays;
    if (!SHARE_LINK_LIFETIMES_DAYS.includes(days as 7)) {
      return reply.code(400).send({ error: "INVALID_SHARE_LINK_LIFETIME" });
    }
    const { data: existing, error: countError } = await owned.client
      .from("board_shares")
      .select("id,created_at,expires_at,revoked_at")
      .eq("board_id", owned.boardId)
      .is("revoked_at", null);
    if (countError) return reply.code(500).send({ error: "SHARE_LINK_CREATE_FAILED" });
    if (activeLinks(existing ?? []).length >= MAX_ACTIVE_LINKS_PER_BOARD) {
      return reply.code(409).send({ error: "SHARE_LINK_LIMIT" });
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = days === null ? null : new Date(Date.now() + Number(days) * 86_400_000).toISOString();
    const { data, error } = await owned.client
      .from("board_shares")
      .insert({
        board_id: owned.boardId,
        token_hash: sha256(token),
        role: "viewer",
        expires_at: expiresAt,
        created_by: owned.context.profileId,
        created_at: new Date().toISOString(),
      })
      .select("id,created_at,expires_at,revoked_at")
      .single();
    if (error || !data) return reply.code(500).send({ error: "SHARE_LINK_CREATE_FAILED" });
    await audit(owned.context, request, "board.share_link_created", "board", owned.boardId, { expiresInDays: days });
    return reply.code(201).send({ link: publicLink(data as ShareRow), url: `${config.appUrl}/s/${token}` });
  });

  server.delete<{ Params: { boardId: string; linkId: string } }>(
    "/boards/:boardId/share-links/:linkId",
    async (request, reply) => {
      const owned = await ownedBoard(auth, request, reply);
      if (!owned) return;
      if (!UUID_PATTERN.test(request.params.linkId)) return reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
      const { data } = await owned.client
        .from("board_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", request.params.linkId)
        .eq("board_id", owned.boardId)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (!data) return reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
      await audit(owned.context, request, "board.share_link_revoked", "board", owned.boardId);
      return reply.code(204).send();
    },
  );

  server.get("/organization/share-links", async (request, reply) => {
    const admin = await organizationAdmin(auth, request, reply);
    if (!admin) return;
    const { data: boards, error: boardError } = await admin.client
      .from("boards")
      .select("id,title")
      .eq("organization_id", admin.context.organizationId)
      .is("deleted_at", null)
      .limit(ADMIN_LINK_BOARD_LIMIT);
    if (boardError) return reply.code(500).send({ error: "SHARE_LINK_LIST_FAILED" });
    const titles = new Map((boards ?? []).map((board) => [String(board.id), String(board.title ?? "")]));
    const ids = [...titles.keys()];
    const chunks = Array.from({ length: Math.ceil(ids.length / BOARD_ID_CHUNK) }, (_, index) =>
      ids.slice(index * BOARD_ID_CHUNK, (index + 1) * BOARD_ID_CHUNK));
    const results = await Promise.all(chunks.map((chunk) => admin.client
      .from("board_shares")
      .select("id,board_id,created_by,created_at,expires_at,revoked_at")
      .in("board_id", chunk)
      .is("revoked_at", null)));
    if (results.some((result) => result.error)) return reply.code(500).send({ error: "SHARE_LINK_LIST_FAILED" });
    const links = activeLinks(results.flatMap((result) => (result.data ?? []) as Array<ShareRow & { board_id: string; created_by: string | null }>))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const creatorIds = [...new Set(links.map((link) => link.created_by).filter((id): id is string => Boolean(id)))];
    const { data: creators } = creatorIds.length
      ? await admin.client.from("profiles").select("id,display_name,email").in("id", creatorIds)
      : { data: [] };
    const names = new Map((creators ?? []).map((profile) => [String(profile.id), String(profile.display_name || profile.email || "")]));
    return {
      links: links.map((link) => ({
        ...publicLink(link),
        boardId: link.board_id,
        boardTitle: titles.get(link.board_id) || "Untitled board",
        createdBy: (link.created_by && names.get(link.created_by)) || "Former member",
      })),
    };
  });

  server.delete<{ Params: { linkId: string } }>("/organization/share-links/:linkId", async (request, reply) => {
    const admin = await organizationAdmin(auth, request, reply);
    if (!admin) return;
    if (!UUID_PATTERN.test(request.params.linkId)) return reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
    const { data: link } = await admin.client
      .from("board_shares")
      .select("id,board_id")
      .eq("id", request.params.linkId)
      .is("revoked_at", null)
      .maybeSingle();
    const { data: board } = link
      ? await admin.client
        .from("boards")
        .select("id")
        .eq("id", link.board_id)
        .eq("organization_id", admin.context.organizationId)
        .maybeSingle()
      : { data: null };
    if (!link || !board) return reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
    const { data } = await admin.client
      .from("board_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", request.params.linkId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
    await audit(admin.context, request, "board.share_link_revoked", "board", String(link.board_id), { byAdmin: true });
    return reply.code(204).send();
  });

  server.get<{ Params: { token: string } }>("/shared-boards/:token", async (request, reply) => {
    noStore(reply);
    if (!publicLimiter.allow(clientKey(request, { trustedProxyHops: config.trustedProxyHops }))) {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    const shared = await sharedBoard(auth, request.params.token);
    if (!shared) return reply.code(404).send({ error: "SHARE_LINK_UNAVAILABLE" });
    return {
      title: shared.board.title,
      updatedAt: shared.board.updated_at,
      expiresAt: shared.share.expires_at,
      state: viewerState(shared.board.latest_state),
    };
  });

  server.get<{ Params: { token: string; assetId: string } }>(
    "/shared-boards/:token/assets/:assetId/content",
    async (request, reply) => {
      noStore(reply);
      if (!publicLimiter.allow(clientKey(request, { trustedProxyHops: config.trustedProxyHops }))) {
        return reply.code(429).send({ error: "RATE_LIMITED" });
      }
      if (!UUID_PATTERN.test(request.params.assetId)) return reply.code(404).send({ error: "BOARD_ASSET_NOT_FOUND" });
      const shared = await sharedBoard(auth, request.params.token);
      if (!shared || !auth.client) return reply.code(404).send({ error: "SHARE_LINK_UNAVAILABLE" });
      const { data: asset } = await auth.client
        .from("board_assets")
        .select("storage_path")
        .eq("id", request.params.assetId)
        .eq("board_id", shared.board.id)
        .eq("status", "ready")
        .maybeSingle();
      if (!asset) return reply.code(404).send({ error: "BOARD_ASSET_NOT_FOUND" });
      const { data: signed } = await auth.client.storage.from(ASSET_BUCKET).createSignedUrl(asset.storage_path, 60);
      if (!signed?.signedUrl) return reply.code(503).send({ error: "BOARD_ASSET_STORAGE_UNAVAILABLE" });
      return reply.redirect(signed.signedUrl);
    },
  );
}

async function ownedBoard(auth: AuthService, request: FastifyRequest<{ Params: { boardId: string } }>, reply: FastifyReply) {
  const context = await auth.authenticate(request);
  if (!context) {
    reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  const { boardId } = request.params;
  if (!auth.client || !UUID_PATTERN.test(boardId)) {
    reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    return null;
  }
  // Only the board's owner decides who can view it, as with its visibility.
  const { data } = await auth.client
    .from("boards")
    .select("id")
    .eq("id", boardId)
    .eq("organization_id", context.organizationId)
    .eq("owner_profile_id", context.profileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) {
    reply.code(404).send({ error: "BOARD_NOT_FOUND" });
    return null;
  }
  return { client: auth.client, context, boardId };
}

async function organizationAdmin(auth: AuthService, request: FastifyRequest, reply: FastifyReply) {
  const context = await auth.authenticate(request);
  if (!context) {
    reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  if (!auth.hasRole(context, ["owner", "admin"])) {
    reply.code(403).send({ error: "ROLE_REQUIRED" });
    return null;
  }
  if (!auth.client) {
    reply.code(404).send({ error: "SHARE_LINK_NOT_FOUND" });
    return null;
  }
  return { client: auth.client, context };
}

/**
 * The board behind a link, or null when the link should not work: unknown,
 * expired or turned off; the board trashed; the link's creator no longer an
 * active editing member who can open the board; or external guests turned off.
 * Lookup failures count as "not working", so a link never opens by accident.
 */
async function sharedBoard(auth: AuthService, token: string) {
  if (!auth.client || !TOKEN_PATTERN.test(token)) return null;
  const { data: share } = await auth.client
    .from("board_shares")
    .select("id,board_id,expires_at,revoked_at,created_at,created_by")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!share || activeLinks([share as ShareRow]).length === 0 || !share.created_by) return null;
  const { data: board } = await auth.client
    .from("boards")
    .select("id,title,latest_state,updated_at,organization_id,owner_profile_id,visibility")
    .eq("id", share.board_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!board) return null;
  if (board.visibility === "private" && board.owner_profile_id !== share.created_by) return null;
  try {
    const [creator, policy] = await Promise.all([
      activeMembership(auth.client, board.organization_id, share.created_by),
      organizationPolicy(auth.client, board.organization_id),
    ]);
    if (!creator || !canEditBoards(creator.role) || !policy.externalGuestsAllowed) return null;
  } catch {
    return null;
  }
  return { share: share as ShareRow & { board_id: string }, board };
}

function activeLinks<T extends ShareRow>(rows: readonly T[], now = Date.now()): T[] {
  return rows.filter((row) => !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > now));
}

function publicLink(row: ShareRow) {
  return { id: row.id, createdAt: row.created_at, expiresAt: row.expires_at };
}

/**
 * The board as a viewer sees it. Live-session participants (their names),
 * cursors and half-drawn strokes stay with the board's members.
 */
function viewerState(state: unknown): Record<string, unknown> {
  const source = state && typeof state === "object" ? state as Record<string, unknown> : {};
  const { participants: _participants, cursors: _cursors, activeStrokes: _activeStrokes, ...content } = source;
  return { ...content, participants: {}, cursors: {}, activeStrokes: {} };
}

function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  reply.header("X-Robots-Tag", "noindex, nofollow");
  reply.header("Referrer-Policy", "no-referrer");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
