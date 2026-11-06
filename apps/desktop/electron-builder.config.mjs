// Packaging for the Airboard desktop overlay (electron-builder).
//
// Signing comes only from environment variables (CI secrets). With none set
// the build still succeeds, unsigned, and says so; see README.md.

export const PILOT_WEB_URL = "https://airboard-pilot-web-634900453473.asia-south1.run.app";

const AZURE_SIGNING_ENV = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT",
  "AZURE_TRUSTED_SIGNING_PROFILE",
  "AZURE_TRUSTED_SIGNING_PUBLISHER",
];

const set = (env, name) => Boolean(env[name]?.trim());

/** Which signing steps this environment can run. */
export function signingPlan(env = process.env) {
  const macSigning = set(env, "CSC_LINK") || set(env, "CSC_NAME");
  const notarization =
    macSigning &&
    ((set(env, "APPLE_ID") && set(env, "APPLE_APP_SPECIFIC_PASSWORD") && set(env, "APPLE_TEAM_ID")) ||
      (set(env, "APPLE_API_KEY") && set(env, "APPLE_API_KEY_ID") && set(env, "APPLE_API_ISSUER")));
  const azure = AZURE_SIGNING_ENV.every((name) => set(env, name));
  const certificate = !azure && set(env, "WIN_CSC_LINK");
  return {
    macSigning,
    notarization,
    windowsSigning: azure ? "azure-trusted-signing" : certificate ? "certificate" : null,
  };
}

export function signingSummary(plan) {
  return [
    `macOS: ${plan.macSigning ? "signed" : "UNSIGNED (no CSC_LINK)"}, ${plan.notarization ? "notarized" : "not notarized"}`,
    `Windows: ${
      plan.windowsSigning === "azure-trusted-signing"
        ? "signed with Azure Trusted Signing"
        : plan.windowsSigning === "certificate"
          ? "signed with WIN_CSC_LINK"
          : "UNSIGNED (no Azure Trusted Signing settings or WIN_CSC_LINK)"
    }`,
  ].join("; ");
}

export function desktopBuildConfig(env = process.env) {
  const plan = signingPlan(env);
  return {
    // Fixed for good once a build ships: macOS ties permissions and updates to it.
    appId: "app.airboard.desktop",
    productName: "Airboard",
    copyright: "Copyright © 2026 Airboard",
    artifactName: "Airboard-${version}-${os}-${arch}.${ext}",
    directories: { output: "dist", buildResources: "build" },
    files: ["package.json", "src/**/*", "assets/**/*"],
    extraMetadata: {
      // Electron names the settings folder after this; development runs keep
      // their own folder under the package name.
      productName: "Airboard",
      // Read by src/main.mjs: the web address an installed build opens.
      airboardDesktop: { webUrl: env.AIRBOARD_DESKTOP_WEB_URL?.trim() || PILOT_WEB_URL },
    },
    asar: true,
    publish: [
      {
        provider: "github",
        owner: "jaychitransh007",
        repo: "Airboard",
        releaseType: "draft",
        tagNamePrefix: "desktop-v",
      },
    ],
    mac: {
      category: "public.app-category.productivity",
      target: [
        { target: "dmg", arch: ["arm64", "x64"] },
        // The zip is what automatic updates download.
        { target: "zip", arch: ["arm64", "x64"] },
      ],
      icon: "build/icon.png",
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.plist",
      // null skips signing; electron-builder otherwise reads CSC_LINK or CSC_NAME.
      ...(plan.macSigning ? {} : { identity: null }),
      notarize: plan.notarization,
      extendInfo: {
        // The overlay lives in the menu bar, not the Dock.
        LSUIElement: true,
        NSCameraUsageDescription: "Airboard uses the camera to follow your hand gestures.",
        NSMicrophoneUsageDescription: "Airboard uses the microphone when you talk to Airo.",
      },
    },
    dmg: { sign: false },
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      icon: "build/icon.png",
      ...(plan.windowsSigning === "azure-trusted-signing"
        ? {
            azureSignOptions: {
              publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER.trim(),
              endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT.trim(),
              codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT.trim(),
              certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE.trim(),
            },
          }
        : {}),
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      shortcutName: "Airboard",
      uninstallDisplayName: "Airboard",
    },
  };
}

// electron-builder calls a default-exported function to get the config.
export default function config() {
  console.log(`[airboard desktop] ${signingSummary(signingPlan(process.env))}`);
  return desktopBuildConfig(process.env);
}
