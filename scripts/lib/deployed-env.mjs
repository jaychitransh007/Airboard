import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The web image bakes its public settings in at build time from these Cloud
 * Build substitutions (infra/cloud-run/cloudbuild-web.yaml), so the deployed
 * values live on the build that produced the serving image.
 */
const WEB_BUILD_SUBSTITUTIONS = {
  _AIRBOARD_API_URL: "NEXT_PUBLIC_AIRBOARD_API_URL",
  _SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
  _SUPABASE_ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
};

/**
 * Builds the launch check's environment from what is actually deployed: the
 * serving API revision's settings (secret-backed ones resolved through
 * `readSecret`), the web image's build substitutions, and NODE_ENV from the
 * API image's Dockerfile when the revision does not set it.
 */
export function environmentFromDeployment({ apiEnv, webSubstitutions, apiDockerfile, readSecret }) {
  const env = {};
  for (const entry of apiEnv ?? []) {
    if (entry.valueFrom?.secretKeyRef) {
      const { name, key } = entry.valueFrom.secretKeyRef;
      env[entry.name] = readSecret(name, key) ?? "";
    } else if (typeof entry.value === "string") {
      env[entry.name] = entry.value;
    }
  }
  if (!env.NODE_ENV && /^ENV NODE_ENV=production$/m.test(runtimeStage(apiDockerfile ?? ""))) {
    env.NODE_ENV = "production";
  }
  for (const [substitution, name] of Object.entries(WEB_BUILD_SUBSTITUTIONS)) {
    const value = webSubstitutions?.[substitution];
    if (typeof value === "string" && value.trim()) env[name] = value;
  }
  return env;
}

/** The Dockerfile's last stage, which is what the running container gets. */
function runtimeStage(dockerfile) {
  const stages = dockerfile.split(/^FROM /m);
  return stages[stages.length - 1] ?? "";
}

function gcloudJson(args) {
  return JSON.parse(execFileSync("gcloud", [...args, "--format=json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function servingRevision(service, project, region) {
  const described = gcloudJson(["run", "services", "describe", service, `--project=${project}`, `--region=${region}`]);
  const serving = [...(described.status?.traffic ?? [])]
    .filter((target) => target.percent)
    .sort((left, right) => right.percent - left.percent)[0];
  if (!serving?.revisionName) throw new Error(`${service} has no revision serving traffic`);
  return gcloudJson(["run", "revisions", "describe", serving.revisionName, `--project=${project}`, `--region=${region}`]);
}

/**
 * Reads the live configuration with gcloud. Secret values are only held in
 * memory for the length checks and never printed.
 */
export function loadDeployedEnvironment({ project, region, apiService, webService, root }) {
  const apiRevision = servingRevision(apiService, project, region);
  const webRevision = servingRevision(webService, project, region);
  const webImage = webRevision.spec?.containers?.[0]?.image;
  // Cloud Run may record the image by digest; Cloud Build lists it by tag
  // under `images` and by digest under `results.images`.
  const digest = webImage?.split("@")[1];
  const filter = digest ? `results.images.digest=${digest}` : `images=${webImage}`;
  const builds = webImage
    ? gcloudJson(["builds", "list", `--project=${project}`, `--filter=${filter}`, "--limit=1"])
    : [];
  const env = environmentFromDeployment({
    apiEnv: apiRevision.spec?.containers?.[0]?.env,
    webSubstitutions: builds[0]?.substitutions,
    apiDockerfile: readFileSync(resolve(root, "infra/cloud-run/api.Dockerfile"), "utf8"),
    readSecret: (name, key) =>
      execFileSync("gcloud", ["secrets", "versions", "access", key || "latest", `--secret=${name}`, `--project=${project}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  });
  return {
    env,
    source: `deployed: ${apiRevision.metadata?.name} and ${webRevision.metadata?.name} (${webImage ?? "unknown image"})`,
  };
}
