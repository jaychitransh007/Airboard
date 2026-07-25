import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supportedScopes = new Set([
  "controlled-pilot",
  "standalone-ga",
  "paid-ga",
  "chrome-public",
  "desktop-public",
]);
const scopeArgument = process.argv.find((argument) => argument.startsWith("--scope="));
const evidencePathArgument = process.argv.find((argument) => argument.startsWith("--evidence="));
const jsonOutput = process.argv.includes("--json");
const evidencePath = resolve(
  process.cwd(),
  evidencePathArgument?.slice("--evidence=".length) || "ops/launch-evidence.json",
);

let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
} catch (error) {
  console.error(`Launch evidence could not be read from ${evidencePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const scope = scopeArgument?.slice("--scope=".length) || evidence.releaseTarget || "controlled-pilot";
if (!supportedScopes.has(scope)) {
  console.error(`Unsupported launch scope "${scope}". Expected one of: ${[...supportedScopes].join(", ")}`);
  process.exit(2);
}

const env = process.env;
const present = (name) => Boolean(env[name]?.trim());
const isHttps = (name) => {
  try {
    return new URL(env[name] ?? "").protocol === "https:";
  } catch {
    return false;
  }
};
const isWss = (name) => {
  try {
    return new URL(env[name] ?? "").protocol === "wss:";
  } catch {
    return false;
  }
};
const nonLocalUrl = (name) => {
  try {
    const hostname = new URL(env[name] ?? "").hostname;
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
};
const hasStrongValue = (name) => {
  const value = env[name]?.trim() ?? "";
  return value.length >= 32 && !/replace|development|example|changeme/i.test(value);
};

const baseConfiguration = [
  ["node-production", "NODE_ENV is production", () => env.NODE_ENV === "production"],
  ["app-url", "AIRBOARD_APP_URL is a non-local HTTPS URL", () => isHttps("AIRBOARD_APP_URL") && nonLocalUrl("AIRBOARD_APP_URL")],
  ["api-url", "NEXT_PUBLIC_AIRBOARD_API_URL is a non-local HTTPS URL", () => isHttps("NEXT_PUBLIC_AIRBOARD_API_URL") && nonLocalUrl("NEXT_PUBLIC_AIRBOARD_API_URL")],
  ["websocket-url", "AIRBOARD_WS_URL is a non-local WSS URL", () => isWss("AIRBOARD_WS_URL") && nonLocalUrl("AIRBOARD_WS_URL")],
  ["cors", "AIRBOARD_ALLOWED_ORIGINS is configured without local origins or wildcard", () => present("AIRBOARD_ALLOWED_ORIGINS") && !/localhost|127\\.0\\.0\\.1|\\*/.test(env.AIRBOARD_ALLOWED_ORIGINS ?? "")],
  ["supabase-server", "Supabase server URL and service role key are production values", () => nonLocalUrl("SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY")],
  ["supabase-browser", "Supabase browser URL and anonymous key are production values", () => nonLocalUrl("NEXT_PUBLIC_SUPABASE_URL") && present("NEXT_PUBLIC_SUPABASE_ANON_KEY")],
  ["signing-secret", "AIRBOARD_SESSION_SIGNING_SECRET is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_SESSION_SIGNING_SECRET")],
  ["api-token", "AIRBOARD_API_TOKEN is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_API_TOKEN")],
  ["cron-secret", "AIRBOARD_CRON_SECRET is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_CRON_SECRET")],
  ["local-entitlements", "AIRBOARD_LOCAL_ENTITLEMENTS is disabled", () => env.AIRBOARD_LOCAL_ENTITLEMENTS === "false"],
  ["transcription", "Deepgram transcription is configured", () => present("DEEPGRAM_API_KEY")],
  ["semantic-intent", "OpenAI semantic fallback is configured", () => present("AIRBOARD_INTENT_API_KEY") || present("OPENAI_API_KEY")],
  ["lifecycle-email", "Resend lifecycle email delivery and sender are configured", () => present("RESEND_API_KEY") && present("AIRBOARD_EMAIL_FROM")],
];

const paidConfiguration = [
  ["billing-enabled", "The explicit production billing release switch is enabled", () => env.AIRBOARD_BILLING_ENABLED === "true"],
  ["stripe-secret", "Stripe secret key is configured", () => /^sk_live_/.test(env.STRIPE_SECRET_KEY ?? "")],
  ["stripe-webhook", "Stripe webhook signing secret is configured", () => /^whsec_/.test(env.STRIPE_WEBHOOK_SECRET ?? "")],
  ["stripe-personal", "Stripe Personal price is configured", () => /^price_/.test(env.STRIPE_PERSONAL_PRICE_ID ?? "")],
  ["stripe-team", "Stripe Team price is configured", () => /^price_/.test(env.STRIPE_TEAM_PRICE_ID ?? "")],
];

const chromeConfiguration = [
  ["chrome-store-url", "A public Chrome Web Store detail URL is configured", () => isHttps("NEXT_PUBLIC_CHROME_WEB_STORE_URL") && /chromewebstore\\.google\\.com/.test(env.NEXT_PUBLIC_CHROME_WEB_STORE_URL ?? "")],
];

const evidenceByScope = {
  "controlled-pilot": [
    "release-owner",
    "support-path",
    "public-claims",
    "privacy-retention",
    "database-migrations",
    "automated-regression",
    "commercial-smoke",
    "deployment-smoke",
    "lifecycle-schedule",
  ],
  "standalone-ga": [
    "legal-approval",
    "subprocessor-review",
    "threat-model",
    "independent-security-test",
    "backup-restore",
    "incident-exercise",
    "browser-matrix",
    "accessibility-audit",
    "monitoring-alerts",
    "public-status-process",
    "support-sla",
    "email-domain",
    "auth-production",
  ],
  "paid-ga": [
    "paid-offer-approval",
    "tax-refund-policy",
    "stripe-live-journey",
    "billing-reconciliation",
  ],
  "chrome-public": [
    "chrome-store-approval",
    "meet-receiver-matrix",
    "chrome-permission-review",
    "chrome-rollback",
  ],
  "desktop-public": [
    "desktop-signing",
    "desktop-notarization",
    "desktop-updater",
    "desktop-os-matrix",
    "desktop-rollback",
  ],
};

const inheritedScopes = {
  "controlled-pilot": ["controlled-pilot"],
  "standalone-ga": ["controlled-pilot", "standalone-ga"],
  "paid-ga": ["controlled-pilot", "standalone-ga", "paid-ga"],
  "chrome-public": ["controlled-pilot", "standalone-ga", "chrome-public"],
  "desktop-public": ["controlled-pilot", "standalone-ga", "desktop-public"],
};

const configurationChecks = [
  ...baseConfiguration,
  ...(scope === "paid-ga" ? paidConfiguration : []),
  ...(scope === "chrome-public" ? chromeConfiguration : []),
].map(([id, description, evaluate]) => ({
  type: "configuration",
  id,
  description,
  passed: evaluate(),
}));

const evidenceChecks = inheritedScopes[scope]
  .flatMap((requiredScope) => evidenceByScope[requiredScope])
  .map((id) => {
    const gate = evidence.gates?.[id];
    const passed = gate?.status === "verified" && typeof gate.evidence === "string" && gate.evidence.trim().length > 0;
    return {
      type: "evidence",
      id,
      description: gate?.description || id,
      passed,
      owner: gate?.owner || "",
      evidence: gate?.evidence || "",
      notes: gate?.notes || "",
    };
  });

const checks = [...configurationChecks, ...evidenceChecks];
const blockers = checks.filter((check) => !check.passed);
const report = {
  scope,
  evidencePath,
  ready: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  summary: {
    passed: checks.length - blockers.length,
    total: checks.length,
    blockers: blockers.length,
  },
  checks,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Airboard launch gate: ${scope}`);
  console.log(`Result: ${report.ready ? "READY" : "NOT READY"} (${report.summary.passed}/${report.summary.total} checks passed)`);
  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "BLOCK"} [${check.type}] ${check.id} — ${check.description}`);
    if (!check.passed && check.owner) console.log(`  owner: ${check.owner}`);
    if (!check.passed && check.notes) console.log(`  next: ${check.notes}`);
  }
  console.log(`Evidence file: ${evidencePath}`);
}

process.exitCode = report.ready ? 0 : 1;
