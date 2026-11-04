import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalHostRedirect } from "../src/platform/canonicalHost.ts";

const CANONICAL = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const ALIAS = "airboard-pilot-web-efs77okmmq-el.a.run.app";

test("alias hosts redirect to the canonical origin with path and query intact", () => {
  assert.equal(
    canonicalHostRedirect(ALIAS, "/login?next=%2Fapp%2Fboards", CANONICAL, ALIAS),
    `${CANONICAL}/login?next=%2Fapp%2Fboards`,
  );
  assert.equal(
    canonicalHostRedirect(ALIAS.toUpperCase(), "/", CANONICAL, ` other.example , ${ALIAS} `),
    `${CANONICAL}/`,
  );
});

test("canonical, tagged-revision and unlisted hosts are served in place", () => {
  assert.equal(canonicalHostRedirect(new URL(CANONICAL).host, "/login", CANONICAL, ALIAS), null);
  assert.equal(
    canonicalHostRedirect("launch-ab43907-web---airboard-pilot-web-efs77okmmq-el.a.run.app", "/login", CANONICAL, ALIAS),
    null,
  );
  assert.equal(canonicalHostRedirect("localhost:3000", "/login", CANONICAL, ALIAS), null);
});

test("missing or invalid configuration disables the redirect", () => {
  assert.equal(canonicalHostRedirect(ALIAS, "/", undefined, ALIAS), null);
  assert.equal(canonicalHostRedirect(ALIAS, "/", CANONICAL, undefined), null);
  assert.equal(canonicalHostRedirect(ALIAS, "/", "not a url", ALIAS), null);
  assert.equal(canonicalHostRedirect(ALIAS, "/", "javascript:alert(1)", ALIAS), null);
  assert.equal(canonicalHostRedirect(null, "/", CANONICAL, ALIAS), null);
});
