import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchIncidents,
  latestMaintainerUpdate,
  parseIncidents,
} from "../src/features/product/statusIncidents.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const issue = (overrides) => ({
  number: 1,
  title: "Saving boards is failing",
  body: "Boards can't be saved. Your changes stay in the open tab.",
  state: "open",
  html_url: "https://github.com/jaychitransh007/Airboard/issues/1",
  created_at: "2026-11-06T10:00:00Z",
  closed_at: null,
  author_association: "OWNER",
  labels: [{ name: "incident" }],
  comments: 0,
  comments_url: "https://api.github.com/repos/jaychitransh007/Airboard/issues/1/comments",
  ...overrides,
});

test("only maintainers' incident issues count, ongoing first, resolved for 90 days", () => {
  const incidents = parseIncidents([
    issue({ number: 1, state: "closed", closed_at: "2026-10-01T00:00:00Z", title: "Resolved recently" }),
    issue({ number: 2, title: "Ongoing" }),
    issue({ number: 3, author_association: "NONE", title: "A stranger's issue" }),
    issue({ number: 4, labels: [{ name: "bug" }], title: "Not an incident" }),
    issue({ number: 5, pull_request: {}, title: "A pull request" }),
    issue({ number: 6, state: "closed", closed_at: "2026-07-01T00:00:00Z", title: "Too old" }),
  ], NOW);
  assert.deepEqual(incidents.map((incident) => incident.title), ["Ongoing", "Resolved recently"]);
  assert.equal(incidents[0].resolvedAt, null);
  assert.equal(incidents[1].resolvedAt, "2026-10-01T00:00:00Z");
});

test("long text is shortened and never treated as HTML", () => {
  const [incident] = parseIncidents([issue({ body: `<img src=x onerror=alert(1)> ${"x".repeat(900)}` })], NOW);
  assert.ok(incident.summary.startsWith("<img"));
  assert.ok(incident.summary.length <= 600);
  assert.ok(incident.summary.endsWith("…"));
  assert.deepEqual(parseIncidents({ message: "API rate limit exceeded" }, NOW), []);
});

test("the latest update is the newest maintainer comment", () => {
  assert.deepEqual(
    latestMaintainerUpdate([
      { body: "Investigating.", created_at: "2026-11-06T10:05:00Z", author_association: "OWNER" },
      { body: "Spam", created_at: "2026-11-06T10:30:00Z", author_association: "NONE" },
      { body: "Fix deployed; watching.", created_at: "2026-11-06T10:20:00Z", author_association: "OWNER" },
    ]),
    { body: "Fix deployed; watching.", postedAt: "2026-11-06T10:20:00Z" },
  );
  assert.equal(latestMaintainerUpdate([]), null);
});

test("fetching reads the issues and each ongoing incident's comments", async () => {
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    if (url.includes("/comments")) {
      return Response.json([{ body: "Rolled back.", created_at: "2026-11-06T10:40:00Z", author_association: "OWNER" }]);
    }
    return Response.json([
      issue({ number: 7, comments: 1, comments_url: "https://api.github.com/x/7/comments" }),
      issue({ number: 8, state: "closed", closed_at: "2026-11-05T00:00:00Z", comments: 3, comments_url: "https://api.github.com/x/8/comments" }),
    ]);
  };
  const incidents = await fetchIncidents(fetcher, NOW);
  assert.equal(incidents[0].latestUpdate?.body, "Rolled back.");
  assert.equal(incidents[1].latestUpdate, null);
  assert.equal(requested.filter((url) => url.includes("/comments")).length, 1);
  assert.match(requested[0], /labels=incident&state=all/);
  await assert.rejects(() => fetchIncidents(async () => new Response("", { status: 403 }), NOW), /INCIDENTS_UNAVAILABLE_403/);
});
