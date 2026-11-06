import { randomBytes, randomUUID } from "node:crypto";
import { boardPreview } from "@airboard/core";
import type { Page, Route } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:4600";
const APP_ORIGIN = "http://127.0.0.1:3100";

export type SavedBoardSeed = {
  title: string;
  state: unknown;
  /** Boards default to the signed-in person's; "teammate" makes them someone else's. */
  owner?: "me" | "teammate";
};

type StoredBoard = {
  id: string;
  title: string;
  ownerProfileId: string;
  state: unknown;
  version: number;
  visibility: "private" | "organization";
  updatedAt: string;
};

type StoredLink = { id: string; boardId: string; token: string; createdAt: string; expiresAt: string | null; revoked: boolean };
type StoredInvitation = { id: string; email: string; role: string; createdAt: string; expiresAt: string; revoked: boolean };

/**
 * Signs the browser in for real and answers, inside the browser, the API
 * routes that need the database.
 *
 * The E2E API has no database, so it signs people in with its loopback
 * development identity and runs live sessions in memory, but it answers board
 * storage, share links and team management with empty stubs. This stands in
 * for those routes with the response shapes of apps/api/src/controlPlaneRoutes.ts
 * and boardShareRoutes.ts; sign-in, the account and live sessions still reach
 * the real API. The routes' own behaviour is covered by the API's tests.
 */
export async function signIn(
  page: Page,
  options: { workspace?: "personal" | "team"; role?: "owner" | "admin" | "member" | "viewer" | "billing"; boards?: SavedBoardSeed[] } = {},
) {
  const development = await page.request.post(`${API_ORIGIN}/auth/development`);
  const { accessToken } = (await development.json()) as { accessToken: string };
  const account = await page.request.get(`${API_ORIGIN}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const { profile } = (await account.json()) as { profile: { id: string; email: string | null } };
  const api = new StandInControlPlane(profile.id, options.boards ?? []);
  await page.context().route(`${API_ORIGIN}/**`, (route) => api.handle(route, options.workspace ?? "personal", options.role ?? "owner"));
  return api;
}

export class StandInControlPlane {
  readonly boards = new Map<string, StoredBoard>();
  readonly links: StoredLink[] = [];
  readonly invitations: StoredInvitation[] = [];
  /** Every saved board state, in order, as the page sent it. */
  readonly saves: Array<{ boardId: string; version: number; state: unknown }> = [];

  constructor(readonly profileId: string, seeds: SavedBoardSeed[]) {
    for (const seed of seeds) {
      const id = randomUUID();
      this.boards.set(id, {
        id,
        title: seed.title,
        ownerProfileId: seed.owner === "teammate" ? randomUUID() : profileId,
        state: seed.state,
        version: 1,
        visibility: "private",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  boardId(title: string): string {
    const board = [...this.boards.values()].find((candidate) => candidate.title === title);
    if (!board) throw new Error(`No saved board titled ${title}`);
    return board.id;
  }

  /** Another tab or device saves the board, so the page's next save conflicts. */
  saveElsewhere(boardId: string) {
    const board = this.boards.get(boardId);
    if (!board) throw new Error(`No saved board ${boardId}`);
    board.version += 1;
    board.updatedAt = new Date().toISOString();
  }

  /** Gives the board active view-only links until it has `count`. */
  addLinks(boardId: string, count: number) {
    while (this.activeLinks(boardId).length < count) {
      this.links.push({
        id: randomUUID(),
        boardId,
        token: randomBytes(32).toString("base64url"),
        createdAt: new Date().toISOString(),
        expiresAt: null,
        revoked: false,
      });
    }
  }

  activeLinks(boardId: string) {
    const now = Date.now();
    return this.links.filter(
      (link) => link.boardId === boardId && !link.revoked && (!link.expiresAt || Date.parse(link.expiresAt) > now),
    );
  }

  async handle(route: Route, workspace: "personal" | "team", role: string) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.split("/").filter(Boolean);
    const body = () => (request.postData() ? (JSON.parse(request.postData() as string) as Record<string, unknown>) : {});

    if (method === "OPTIONS") return route.fallback();
    if (url.pathname === "/me" && method === "GET" && workspace === "team") {
      const response = await route.fetch();
      const account = (await response.json()) as { organization: Record<string, unknown> };
      account.organization = { ...account.organization, name: "Acme Product", slug: "acme-product", kind: "team", role };
      return route.fulfill({ response, json: account });
    }
    if (path[0] === "boards") return this.boardRoute(route, method, path, url, body);
    if (path[0] === "shared-boards" && path.length === 2 && method === "GET") return this.sharedBoard(route, path[1] as string);
    if (url.pathname === "/organization/members" && method === "GET") {
      return json(route, 200, {
        members: [
          {
            id: randomUUID(),
            role: "owner",
            status: "active",
            joined_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            profiles: { id: this.profileId, email: "owner@acme.test", display_name: "Acme Owner", avatar_url: null },
          },
        ],
      });
    }
    if (path[0] === "organization" && path[1] === "invitations") return this.invitationRoute(route, method, path, body);
    if (path[0] === "organization" && path[1] === "share-links") return this.organizationLinkRoute(route, method, path);
    return route.fallback();
  }

  private boardRoute(route: Route, method: string, path: string[], url: URL, body: () => Record<string, unknown>) {
    if (path.length === 1 && method === "GET") {
      const withPreview = url.searchParams.get("preview") === "1";
      const boards = [...this.boards.values()]
        .filter((board) => board.ownerProfileId === this.profileId || board.visibility === "organization")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((board) => ({
          ...this.boardRow(board),
          ...(withPreview ? { preview: boardPreview(board.state) } : {}),
        }));
      return json(route, 200, { boards });
    }
    const board = path[1] ? this.boards.get(path[1]) : undefined;
    if (!board) return json(route, 404, { error: "BOARD_NOT_FOUND" });
    if (path.length === 2 && method === "GET") {
      return json(route, 200, { board: { ...this.boardRow(board), owner_profile_id: board.ownerProfileId, latest_state: board.state } });
    }
    if (path.length === 2 && method === "PATCH") {
      const change = body();
      if (change.state !== undefined) {
        if (change.version !== board.version + 1) {
          return json(route, 409, { error: "BOARD_VERSION_CONFLICT", latestVersion: board.version });
        }
        board.state = change.state;
        board.version = change.version;
        this.saves.push({ boardId: board.id, version: board.version, state: change.state });
      }
      if (typeof change.title === "string") board.title = change.title;
      if (change.visibility === "private" || change.visibility === "organization") board.visibility = change.visibility;
      board.updatedAt = new Date().toISOString();
      const { id, title, latest_version, visibility, updated_at } = this.boardRow(board);
      return json(route, 200, { board: { id, title, latest_version, visibility, updated_at } });
    }
    if (path[2] === "share-links") return this.shareLinkRoute(route, method, path, board, body);
    return route.fallback();
  }

  private shareLinkRoute(route: Route, method: string, path: string[], board: StoredBoard, body: () => Record<string, unknown>) {
    // Only the board's owner manages its links; anyone else gets "not found".
    if (board.ownerProfileId !== this.profileId) return json(route, 404, { error: "BOARD_NOT_FOUND" });
    const publicLink = (link: StoredLink) => ({ id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt });
    if (path.length === 3 && method === "GET") {
      return json(route, 200, { links: this.activeLinks(board.id).reverse().map(publicLink) });
    }
    if (path.length === 3 && method === "POST") {
      const days = body().expiresInDays ?? 7;
      if (days !== 7 && days !== 30 && days !== null) return json(route, 400, { error: "INVALID_SHARE_LINK_LIFETIME" });
      if (this.activeLinks(board.id).length >= 20) return json(route, 409, { error: "SHARE_LINK_LIMIT" });
      const link: StoredLink = {
        id: randomUUID(),
        boardId: board.id,
        token: randomBytes(32).toString("base64url"),
        createdAt: new Date().toISOString(),
        expiresAt: days === null ? null : new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        revoked: false,
      };
      this.links.push(link);
      return json(route, 201, { link: publicLink(link), url: `${APP_ORIGIN}/s/${link.token}` });
    }
    if (path.length === 4 && method === "DELETE") {
      const link = this.activeLinks(board.id).find((candidate) => candidate.id === path[3]);
      if (!link) return json(route, 404, { error: "SHARE_LINK_NOT_FOUND" });
      link.revoked = true;
      return route.fulfill({ status: 204, headers: corsHeaders(route) });
    }
    return route.fallback();
  }

  /** Admin → Policy's list of every working view-only link, and its Turn off. */
  private organizationLinkRoute(route: Route, method: string, path: string[]) {
    if (path.length === 2 && method === "GET") {
      const links = [...this.boards.values()].flatMap((board) => this.activeLinks(board.id).map((link) => ({
        id: link.id,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        boardId: board.id,
        boardTitle: board.title,
        createdBy: "Acme Owner",
      })));
      return json(route, 200, { links });
    }
    if (path.length === 3 && method === "DELETE") {
      const link = this.links.find((candidate) => candidate.id === path[2] && !candidate.revoked);
      if (!link) return json(route, 404, { error: "SHARE_LINK_NOT_FOUND" });
      link.revoked = true;
      return route.fulfill({ status: 204, headers: corsHeaders(route) });
    }
    return route.fallback();
  }

  private sharedBoard(route: Route, token: string) {
    const link = this.links.find((candidate) => candidate.token === token);
    const board = link ? this.boards.get(link.boardId) : undefined;
    if (!link || !board || !this.activeLinks(board.id).includes(link)) {
      return json(route, 404, { error: "SHARE_LINK_UNAVAILABLE" });
    }
    const { participants: _participants, cursors: _cursors, activeStrokes: _activeStrokes, ...content } =
      (board.state ?? {}) as Record<string, unknown>;
    return json(route, 200, { title: board.title, updatedAt: board.updatedAt, expiresAt: link.expiresAt, state: content });
  }

  private invitationRoute(route: Route, method: string, path: string[], body: () => Record<string, unknown>) {
    if (path.length === 2 && method === "GET") {
      return json(route, 200, {
        invitations: this.invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expiresAt,
          accepted_at: null,
          revoked_at: invitation.revoked ? new Date().toISOString() : null,
          created_at: invitation.createdAt,
        })),
      });
    }
    if (path.length === 2 && method === "POST") {
      const { email, role } = body();
      if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
        return json(route, 400, { error: "VALID_EMAIL_REQUIRED" });
      }
      const invitation: StoredInvitation = {
        id: randomUUID(),
        email: email.toLowerCase(),
        role: typeof role === "string" ? role : "member",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        revoked: false,
      };
      this.invitations.push(invitation);
      return json(route, 201, {
        invitationId: invitation.id,
        expiresAt: invitation.expiresAt,
        inviteUrl: `${APP_ORIGIN}/invite/${randomBytes(32).toString("base64url")}`,
      });
    }
    if (path.length === 3 && method === "DELETE") {
      const invitation = this.invitations.find((candidate) => candidate.id === path[2]);
      if (!invitation) return json(route, 404, { error: "INVITATION_NOT_FOUND" });
      invitation.revoked = true;
      return json(route, 200, { revoked: true });
    }
    return route.fallback();
  }

  private boardRow(board: StoredBoard) {
    return {
      id: board.id,
      workspace_id: "local-workspace",
      title: board.title,
      description: null,
      latest_version: board.version,
      visibility: board.visibility,
      created_at: board.updatedAt,
      updated_at: board.updatedAt,
      archived_at: null,
    };
  }
}

function corsHeaders(route: Route): Record<string, string> {
  const origin = route.request().headers().origin;
  return origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", headers: corsHeaders(route), body: JSON.stringify(body) });
}
