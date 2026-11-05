import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeChromeWebStoreUrlForExtension } from "./lib/chrome-deployment-compatibility.mjs";
import { loadDeployedEnvironment } from "./lib/deployed-env.mjs";

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
const argumentValue = (name, fallback) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
// --deployed checks the live Cloud Run services instead of this machine's
// environment, which is what the configuration gates are really about.
const deployed = process.argv.includes("--deployed");
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

let env = process.env;
let configurationSource = "this machine's environment (.env)";
if (deployed) {
  const project = argumentValue("project", process.env.AIRBOARD_GCP_PROJECT);
  if (!project) {
    console.error("--deployed needs --project=<Google Cloud project ID>.");
    process.exit(2);
  }
  try {
    const live = loadDeployedEnvironment({
      project,
      region: argumentValue("region", "asia-south1"),
      apiService: argumentValue("api-service", "airboard-pilot-api"),
      webService: argumentValue("web-service", "airboard-pilot-web"),
      root: process.cwd(),
    });
    env = live.env;
    configurationSource = live.source;
  } catch (error) {
    console.error(`Deployed configuration could not be read: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
const present = (name) => Boolean(env[name]?.trim());
const isHttps = (name) => {
  try {
    return new URL(env[name] ?? "").protocol === "https:";
  } catch {
    return false;
  }
};
// The web opens its board socket on the API's own host (boardSync.ts turns
// https into wss), so the socket URL follows NEXT_PUBLIC_AIRBOARD_API_URL
// unless AIRBOARD_WS_URL overrides it.
const websocketUrl = () => {
  if (env.AIRBOARD_WS_URL?.trim()) return env.AIRBOARD_WS_URL.trim();
  try {
    const url = new URL("/ws", env.NEXT_PUBLIC_AIRBOARD_API_URL ?? "");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return "";
  }
};
const nonLocal = (value) => {
  try {
    return !["localhost", "127.0.0.1", "::1"].includes(new URL(value ?? "").hostname);
  } catch {
    return false;
  }
};
const nonLocalUrl = (name) => nonLocal(env[name]);
const isWssUrl = (value) => {
  try {
    return new URL(value).protocol === "wss:";
  } catch {
    return false;
  }
};
const hasStrongValue = (name) => {
  const value = env[name]?.trim() ?? "";
  return value.length >= 32 && !/replace|development|example|changeme/i.test(value);
};
const chromeExtensionVersionPattern = /^\d+\.\d+\.\d+$/;
const chromeCompatibleVersions = (name) => {
  const currentVersion = env.NEXT_PUBLIC_CHROME_EXTENSION_VERSION?.trim() ?? "";
  if (!chromeExtensionVersionPattern.test(currentVersion)) return null;
  const configured = env[name]?.trim();
  const candidates = configured
    ? env[name].split(",").map((version) => version.trim())
    : [currentVersion];
  const versions = [...new Set(candidates)];
  return candidates.some((version) => !chromeExtensionVersionPattern.test(version)) ||
    versions.length === 0 ||
    versions.length > 8 ||
    !versions.includes(currentVersion)
    ? null
    : versions;
};
const sameVersionSet = (left, right) =>
  Boolean(
    left &&
    right &&
    left.length === right.length &&
    left.every((version) => right.includes(version)),
  );
const allowedOriginsIncludeApp = () => {
  try {
    const appOrigin = new URL(env.AIRBOARD_APP_URL ?? "").origin;
    const allowedOrigins = (env.AIRBOARD_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return allowedOrigins.includes(appOrigin) &&
      allowedOrigins.every((value) => {
        const url = new URL(value);
        return value === url.origin &&
          url.protocol === "https:" &&
          !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      });
  } catch {
    return false;
  }
};
const isChromeWebStoreDetailUrl = () => {
  return Boolean(normalizeChromeWebStoreUrlForExtension(
    env.NEXT_PUBLIC_CHROME_WEB_STORE_URL,
    env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID,
  ));
};

const baseConfiguration = [
  ["node-production", "NODE_ENV is production", () => env.NODE_ENV === "production"],
  ["app-url", "AIRBOARD_APP_URL is a non-local HTTPS URL", () => isHttps("AIRBOARD_APP_URL") && nonLocalUrl("AIRBOARD_APP_URL")],
  ["api-url", "NEXT_PUBLIC_AIRBOARD_API_URL is a non-local HTTPS URL", () => isHttps("NEXT_PUBLIC_AIRBOARD_API_URL") && nonLocalUrl("NEXT_PUBLIC_AIRBOARD_API_URL")],
  ["websocket-url", "The board socket URL (from NEXT_PUBLIC_AIRBOARD_API_URL, or AIRBOARD_WS_URL) is a non-local WSS URL", () => {
    const url = websocketUrl();
    return isWssUrl(url) && nonLocal(url);
  }],
  ["cors", "AIRBOARD_ALLOWED_ORIGINS explicitly includes AIRBOARD_APP_URL without local origins or wildcard", () => present("AIRBOARD_ALLOWED_ORIGINS") && allowedOriginsIncludeApp()],
  ["supabase-server", "Supabase server URL and service role key are production values", () => nonLocalUrl("SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY")],
  ["supabase-browser", "Supabase browser URL and anonymous key are production values", () => nonLocalUrl("NEXT_PUBLIC_SUPABASE_URL") && present("NEXT_PUBLIC_SUPABASE_ANON_KEY")],
  ["signing-secret", "AIRBOARD_SESSION_SIGNING_SECRET is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_SESSION_SIGNING_SECRET")],
  ["api-token", "AIRBOARD_API_TOKEN is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_API_TOKEN")],
  ["cron-secret", "AIRBOARD_CRON_SECRET is a non-placeholder value of at least 32 characters", () => hasStrongValue("AIRBOARD_CRON_SECRET")],
  ["local-entitlements", "AIRBOARD_LOCAL_ENTITLEMENTS is disabled", () => env.AIRBOARD_LOCAL_ENTITLEMENTS === "false"],
  ["transcription", "Deepgram transcription is configured", () => present("DEEPGRAM_API_KEY")],
  ["semantic-intent", "OpenAI semantic fallback is configured", () => present("AIRBOARD_INTENT_API_KEY") || present("OPENAI_API_KEY")],
];

// The controlled pilot signs people in with Google and sends no lifecycle
// email (decided 2026-11-05); every wider release needs an email sender.
const emailConfiguration = [
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
  ["chrome-store-url", "The public Chrome Web Store detail URL belongs to the configured extension ID", isChromeWebStoreDetailUrl],
  ["chrome-extension-version", "The packaged Chrome extension version is a semantic version", () => chromeExtensionVersionPattern.test(env.NEXT_PUBLIC_CHROME_EXTENSION_VERSION?.trim() ?? "")],
  ["chrome-renderer-overlap", "The renderer compatibility window is bounded and contains the current extension version", () => Boolean(chromeCompatibleVersions("NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS"))],
  ["chrome-api-overlap", "The API compatibility window is bounded and contains the current extension version", () => Boolean(chromeCompatibleVersions("AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS"))],
  ["chrome-overlap-parity", "The renderer and API advertise the same Chrome compatibility window", () => sameVersionSet(chromeCompatibleVersions("NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS"), chromeCompatibleVersions("AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS"))],
  ["chrome-extension-id", "The exact Chrome Web Store extension ID is configured", () => /^[a-p]{32}$/.test(env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID ?? "")],
  ["chrome-api-extension-id", "The API is restricted to the same Chrome Web Store extension ID", () => env.AIRBOARD_CHROME_EXTENSION_ID === env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID && /^[a-p]{32}$/.test(env.AIRBOARD_CHROME_EXTENSION_ID ?? "")],
  ["chrome-kill-switch", "The Chrome extension release switch is explicitly enabled", () => env.AIRBOARD_CHROME_EXTENSION_ENABLED === "true"],
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
    "chrome-deployment-compatibility",
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
  ...(scope === "controlled-pilot" ? [] : emailConfiguration),
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
  configurationSource,
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
  console.log(`Configuration: ${configurationSource}`);
  console.log(`Result: ${report.ready ? "READY" : "NOT READY"} (${report.summary.passed}/${report.summary.total} checks passed)`);
  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "BLOCK"} [${check.type}] ${check.id} — ${check.description}`);
    if (!check.passed && check.owner) console.log(`  owner: ${check.owner}`);
    if (!check.passed && check.notes) console.log(`  next: ${check.notes}`);
  }
  console.log(`Evidence file: ${evidencePath}`);
}

process.exitCode = report.ready ? 0 : 1;
