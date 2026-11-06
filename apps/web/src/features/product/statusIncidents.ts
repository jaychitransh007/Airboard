/**
 * Public incident updates live in GitHub issues labelled `incident` on the
 * Airboard repository, so they can be posted from a phone and stay readable on
 * GitHub when Airboard itself is down. Docs/Status and Incident Updates.md has
 * the process.
 */
export const STATUS_REPOSITORY = "jaychitransh007/Airboard";
export const INCIDENT_LABEL = "incident";
export const INCIDENTS_ON_GITHUB = `https://github.com/${STATUS_REPOSITORY}/issues?q=label%3A${INCIDENT_LABEL}`;

/** Resolved incidents stay on the page this long. */
export const RESOLVED_WINDOW_DAYS = 90;
const SUMMARY_LIMIT = 600;
// Anyone can open an issue on a public repository; only maintainers post incidents.
const MAINTAINERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export type IncidentUpdate = { body: string; postedAt: string };

export type Incident = {
  number: number;
  title: string;
  summary: string;
  url: string;
  startedAt: string;
  resolvedAt: string | null;
  latestUpdate: IncidentUpdate | null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const GITHUB_HEADERS = { Accept: "application/vnd.github+json" };

/** Ongoing incidents first, then those resolved in the last 90 days, newest first. */
export async function fetchIncidents(fetcher: Fetcher = fetch, now = Date.now()): Promise<Incident[]> {
  const response = await fetcher(
    `https://api.github.com/repos/${STATUS_REPOSITORY}/issues?labels=${INCIDENT_LABEL}&state=all&sort=created&direction=desc&per_page=30`,
    { headers: GITHUB_HEADERS, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`INCIDENTS_UNAVAILABLE_${response.status}`);
  const issues = await response.json();
  const incidents = parseIncidents(issues, now);
  // Each ongoing incident shows its newest update; a failed lookup leaves just the summary.
  await Promise.all(
    incidents.map(async (incident) => {
      const issue = (issues as RawIssue[]).find((candidate) => candidate.number === incident.number);
      if (incident.resolvedAt || !issue?.comments || !issue.comments_url) return;
      const comments = await fetcher(`${issue.comments_url}?per_page=100`, { headers: GITHUB_HEADERS, cache: "no-store" })
        .then((reply) => (reply.ok ? reply.json() : []))
        .catch(() => []);
      incident.latestUpdate = latestMaintainerUpdate(comments);
    }),
  );
  return incidents;
}

export function parseIncidents(value: unknown, now = Date.now()): Incident[] {
  if (!Array.isArray(value)) return [];
  const oldestResolved = now - RESOLVED_WINDOW_DAYS * 86_400_000;
  const incidents = (value as RawIssue[])
    .filter((issue) =>
      !issue.pull_request &&
      MAINTAINERS.has(String(issue.author_association)) &&
      issue.labels?.some((label) => (typeof label === "string" ? label : label?.name) === INCIDENT_LABEL) &&
      typeof issue.title === "string" &&
      typeof issue.created_at === "string" &&
      typeof issue.html_url === "string" &&
      (issue.state === "open" || (typeof issue.closed_at === "string" && Date.parse(issue.closed_at) >= oldestResolved)),
    )
    .map((issue): Incident => ({
      number: Number(issue.number),
      title: issue.title as string,
      summary: plainSummary(issue.body),
      url: issue.html_url as string,
      startedAt: issue.created_at as string,
      resolvedAt: issue.state === "open" ? null : (issue.closed_at as string),
      latestUpdate: null,
    }));
  return [
    ...incidents.filter((incident) => !incident.resolvedAt),
    ...incidents.filter((incident) => incident.resolvedAt),
  ];
}

export function latestMaintainerUpdate(value: unknown): IncidentUpdate | null {
  if (!Array.isArray(value)) return null;
  const updates = (value as RawComment[]).filter(
    (comment) => MAINTAINERS.has(String(comment.author_association)) && typeof comment.created_at === "string",
  );
  const latest = updates.sort((left, right) => Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)))[0];
  return latest ? { body: plainSummary(latest.body), postedAt: latest.created_at as string } : null;
}

/** The text as written, shortened; the page shows it as plain text, never HTML. */
function plainSummary(body: unknown): string {
  const text = typeof body === "string" ? body.replace(/\r\n/gu, "\n").trim() : "";
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : text;
}

type RawIssue = {
  number?: number;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  closed_at?: unknown;
  author_association?: unknown;
  labels?: Array<string | { name?: string }>;
  comments?: number;
  comments_url?: string;
  pull_request?: unknown;
};

type RawComment = { body?: unknown; created_at?: unknown; author_association?: unknown };
