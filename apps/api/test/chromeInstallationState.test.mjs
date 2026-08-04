import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chromePreflightVersionSupported,
  chromeStatusDependencyFailure,
  parseChromePreflightEvidence,
} from "../src/chromeInstallationState.ts";

const NOW = Date.parse("2026-08-03T12:00:00.000Z");

test("status dependency failures are explicit and fail closed", () => {
  assert.equal(chromeStatusDependencyFailure({
    policyError: new Error("database unavailable"),
    policy: null,
    entitlementError: null,
    entitlement: null,
  }), "INSTALLATION_POLICY_UNAVAILABLE");
  assert.equal(chromeStatusDependencyFailure({
    policyError: null,
    policy: { allowed_platforms: ["chrome_meet"] },
    entitlementError: new Error("database unavailable"),
    entitlement: null,
  }), "INSTALLATION_ENTITLEMENT_UNAVAILABLE");
  assert.equal(chromeStatusDependencyFailure({
    policyError: null,
    policy: null,
    entitlementError: null,
    entitlement: { status: "pending" },
  }), "INSTALLATION_POLICY_UNAVAILABLE", "a missing policy row never becomes an implicit allow");
  assert.equal(chromeStatusDependencyFailure({
    policyError: null,
    policy: { allowed_platforms: ["chrome_meet"] },
    entitlementError: null,
    entitlement: null,
  }), "INSTALLATION_ENTITLEMENT_UNAVAILABLE", "a missing entitlement row never rotates a credential");
  assert.equal(chromeStatusDependencyFailure({
    policyError: null,
    policy: { allowed_platforms: ["chrome_meet"] },
    entitlementError: null,
    entitlement: { status: "pending" },
  }), null);
});

test("preflight accepts only fresh positive composite and post-attach sender evidence", () => {
  const valid = {
    senderAttached: true,
    framesComposited: 4,
    framesEncoded: 3,
    bytesSent: 2048,
    lastCompositeAt: NOW - 500,
    lastVerifiedAt: NOW - 250,
    meetingSessionId: "meeting-session-1",
    extensionVersion: "0.8.0",
  };
  assert.deepEqual(parseChromePreflightEvidence(valid, NOW), {
    ok: true,
    value: {
      framesComposited: 4,
      framesEncoded: 3,
      bytesSent: 2048,
      lastCompositeAt: NOW - 500,
      lastVerifiedAt: NOW - 250,
      meetingSessionId: "meeting-session-1",
      extensionVersion: "0.8.0",
    },
  });

  for (const invalid of [
    { ...valid, senderAttached: false },
    { ...valid, framesComposited: 0 },
    { ...valid, framesEncoded: 0 },
    { ...valid, bytesSent: 0 },
    { ...valid, lastCompositeAt: NOW - 15_001 },
    { ...valid, lastVerifiedAt: NOW + 5_001 },
    { ...valid, lastCompositeAt: NOW - 100, lastVerifiedAt: NOW - 200 },
    { ...valid, meetingSessionId: "short" },
    { ...valid, extensionVersion: "" },
  ]) {
    assert.deepEqual(parseChromePreflightEvidence(invalid, NOW), {
      ok: false,
      error: "VERIFIED_OUTBOUND_COMPOSITE_REQUIRED",
    });
  }
});

test("preflight accepts the current and overlap extension versions but rejects unknown builds", () => {
  const deploymentWindow = ["0.8.0", "0.7.9"];
  assert.equal(chromePreflightVersionSupported("0.8.0", deploymentWindow), true);
  assert.equal(chromePreflightVersionSupported("0.7.9", deploymentWindow), true);
  assert.equal(chromePreflightVersionSupported("0.7.8", deploymentWindow), false);
});

test("database state functions preserve retry credentials and lock preflight before trial effects", async () => {
  const migration = await readFile(
    new URL("../../../supabase/migrations/20260803120000_chrome_installation_state_rpcs.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /for update;[\s\S]*if v_current_token_hash = p_presented_token_hash/);
  assert.match(
    migration,
    /if v_previous_token_hash = p_presented_token_hash[\s\S]*token_hash = p_presented_token_hash[\s\S]*previous_token_hash = v_current_token_hash/,
    "a lost-response retry promotes the browser-owned token and retains the unknown current token as grace",
  );
  assert.match(
    migration,
    /installation\.organization_id = p_organization_id[\s\S]*installation\.status <> 'revoked'[\s\S]*for update;[\s\S]*update public\.platform_installations[\s\S]*select trial\.id/,
    "tenant, revoke, credential, installation update, and trial activation share one locked transaction",
  );
  assert.match(migration, /grant execute on function public\.rotate_chrome_installation_credential[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.complete_chrome_installation_preflight[\s\S]*to service_role/);
  assert.match(
    migration,
    /create or replace function public\.commit_chrome_installation_consent[\s\S]*installation\.organization_id = p_organization_id[\s\S]*installation\.status <> 'revoked'[\s\S]*installation\.token_hash = p_presented_token_hash[\s\S]*for update;/,
    "consent authenticates and locks the live tenant installation before writing",
  );
  assert.match(
    migration,
    /update public\.platform_installations[\s\S]*insert into public\.consent_records[\s\S]*return query select v_installed_by, v_consented_at/,
    "the installation consent marker and typed consent records share one transaction",
  );
  assert.match(migration, /grant execute on function public\.commit_chrome_installation_consent[\s\S]*to service_role/);
});

test("Chrome installation security-definer RPCs are executable only by the service role", async () => {
  const migration = await readFile(
    new URL("../../../supabase/migrations/20260804100000_chrome_installation_rpc_acl.sql", import.meta.url),
    "utf8",
  );
  const lowerMigration = migration.toLowerCase();
  const functionNames = [
    "rotate_chrome_installation_credential",
    "commit_chrome_installation_consent",
    "complete_chrome_installation_preflight",
  ];

  for (const functionName of functionNames) {
    const revokeStart = lowerMigration.indexOf(`revoke all on function public.${functionName}(`);
    const grantStart = lowerMigration.indexOf(`grant execute on function public.${functionName}(`);
    assert.ok(revokeStart >= 0, `${functionName} must have an explicit revoke`);
    assert.ok(grantStart > revokeStart, `${functionName} must be re-granted only after its revoke`);

    const revokeStatement = lowerMigration.slice(revokeStart, grantStart);
    assert.match(
      revokeStatement,
      /from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/,
      `${functionName} must revoke Supabase's direct client-role defaults as well as PUBLIC`,
    );

    const nextRevoke = lowerMigration.indexOf("revoke all on function public.", grantStart);
    const grantStatement = lowerMigration.slice(
      grantStart,
      nextRevoke >= 0 ? nextRevoke : lowerMigration.length,
    );
    assert.match(grantStatement, /to\s+service_role\s*;/);
    assert.doesNotMatch(grantStatement, /to\s+(?:public|anon|authenticated)\b/);
  }
});

test("status reads dependencies before calling the rotation RPC", async () => {
  const routes = await readFile(new URL("../src/controlPlaneRoutes.ts", import.meta.url), "utf8");
  const reads = routes.indexOf("const [installationResult, policyResult, entitlementResult]");
  const dependencyGate = routes.indexOf("if (dependencyFailure)", reads);
  const rotation = routes.indexOf('.rpc("rotate_chrome_installation_credential"', reads);
  assert.ok(reads >= 0 && dependencyGate > reads && rotation > dependencyGate);
  const failClosedBranch = routes.slice(dependencyGate, rotation);
  assert.doesNotMatch(failClosedBranch, /installationToken:/);
  assert.match(failClosedBranch, /entitlement: null/);
  assert.match(routes.slice(reads, dependencyGate), /entitlement: entitlementResult\.data/);
});

test("consent route commits through the credential-bound RPC and never performs split writes", async () => {
  const routes = await readFile(new URL("../src/controlPlaneRoutes.ts", import.meta.url), "utf8");
  const consentStart = routes.indexOf('server.post<{ Body: unknown }>("/integrations/extension/consent"');
  const preflightStart = routes.indexOf('"/integrations/extension/preflight-complete"', consentStart);
  const consentRoute = routes.slice(consentStart, preflightStart);
  assert.match(consentRoute, /\.rpc\("commit_chrome_installation_consent"/);
  assert.match(consentRoute, /p_presented_token_hash: installation\.presentedTokenHash/);
  assert.match(consentRoute, /INSTALLATION_CONSENT_COMMIT_FAILED/);
  assert.match(consentRoute, /INSTALLATION_CONSENT_CONFLICT/);
  assert.doesNotMatch(consentRoute, /\.from\("consent_records"\)/);
  assert.doesNotMatch(consentRoute, /\.from\("platform_installations"\)/);
});

test("link preparation never clears a live credential before exchange", async () => {
  const routes = await readFile(new URL("../src/controlPlaneRoutes.ts", import.meta.url), "utf8");
  const linkStart = routes.indexOf('server.post<{ Body: unknown }>("/integrations/extension-link"');
  const exchangeStart = routes.indexOf('server.post<{ Body: unknown }>("/integrations/extension-exchange"');
  const linkRoute = routes.slice(linkStart, exchangeStart);
  assert.match(linkRoute, /const revivingRevoked = existingInstallation\.status === "revoked"/);
  assert.match(linkRoute, /existingInstallation\.link_token_hash[\s\S]*\.is\("link_token_hash", null\)/);
  assert.doesNotMatch(linkRoute, /\.upsert\(/);
  const destructiveCredentialLine = /^\s+token_hash:\s*null/gm.exec(linkRoute);
  assert.ok(destructiveCredentialLine);
  assert.ok(
    destructiveCredentialLine.index > linkRoute.indexOf("...(revivingRevoked"),
    "credential clearing is confined to explicit revival of an already-revoked row",
  );
});
