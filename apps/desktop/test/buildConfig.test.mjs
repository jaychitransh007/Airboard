import assert from "node:assert/strict";
import test from "node:test";
import {
  desktopBuildConfig,
  PILOT_WEB_URL,
  signingPlan,
  signingSummary,
} from "../electron-builder.config.mjs";

const AZURE = {
  AZURE_TENANT_ID: "tenant",
  AZURE_CLIENT_ID: "client",
  AZURE_CLIENT_SECRET: "secret",
  AZURE_TRUSTED_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
  AZURE_TRUSTED_SIGNING_ACCOUNT: "airboard",
  AZURE_TRUSTED_SIGNING_PROFILE: "public",
  AZURE_TRUSTED_SIGNING_PUBLISHER: "Airboard",
};

test("with no secrets the build is unsigned and says so", () => {
  const plan = signingPlan({});
  assert.deepEqual(plan, { macSigning: false, notarization: false, windowsSigning: null });
  assert.match(signingSummary(plan), /macOS: UNSIGNED.*not notarized; Windows: UNSIGNED/);
  const config = desktopBuildConfig({});
  assert.equal(config.mac.identity, null);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.win.azureSignOptions, undefined);
});

test("empty CI secrets count as missing", () => {
  assert.deepEqual(signingPlan({ CSC_LINK: "", APPLE_ID: " ", WIN_CSC_LINK: "" }), {
    macSigning: false,
    notarization: false,
    windowsSigning: null,
  });
});

test("a certificate signs macOS, and Apple credentials add notarization", () => {
  const signedOnly = desktopBuildConfig({ CSC_LINK: "base64-p12" });
  assert.equal("identity" in signedOnly.mac, false);
  assert.equal(signedOnly.mac.notarize, false);
  const notarized = signingPlan({
    CSC_LINK: "base64-p12",
    APPLE_ID: "dev@example.com",
    APPLE_APP_SPECIFIC_PASSWORD: "app-password",
    APPLE_TEAM_ID: "TEAM123456",
  });
  assert.equal(notarized.notarization, true);
  // Apple credentials alone can't notarize an unsigned app.
  assert.equal(signingPlan({ APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "b", APPLE_TEAM_ID: "c" }).notarization, false);
});

test("Windows signs with Azure Trusted Signing when every setting is present", () => {
  const config = desktopBuildConfig(AZURE);
  assert.deepEqual(config.win.azureSignOptions, {
    publisherName: "Airboard",
    endpoint: "https://eus.codesigning.azure.net",
    codeSigningAccountName: "airboard",
    certificateProfileName: "public",
  });
  const { AZURE_CLIENT_SECRET: _missing, ...partial } = AZURE;
  assert.equal(signingPlan(partial).windowsSigning, null);
  assert.equal(signingPlan({ WIN_CSC_LINK: "base64-pfx" }).windowsSigning, "certificate");
});

test("the package is hardened, asks for camera and microphone, and updates from GitHub", () => {
  const config = desktopBuildConfig({});
  assert.equal(config.mac.hardenedRuntime, true);
  assert.match(config.mac.extendInfo.NSCameraUsageDescription, /camera/);
  assert.match(config.mac.extendInfo.NSMicrophoneUsageDescription, /microphone/);
  assert.deepEqual(
    config.mac.target.map(({ target }) => target),
    ["dmg", "zip"],
    "the zip is the update payload on macOS",
  );
  assert.deepEqual(config.win.target.map(({ target }) => target), ["nsis"]);
  assert.deepEqual(config.publish, [{
    provider: "github",
    owner: "jaychitransh007",
    repo: "Airboard",
    releaseType: "draft",
    tagNamePrefix: "desktop-v",
  }]);
  assert.deepEqual(config.files, ["package.json", "src/**/*", "assets/**/*"]);
});

test("the installed build opens the pilot web app unless the build names another", () => {
  assert.equal(desktopBuildConfig({}).extraMetadata.airboardDesktop.webUrl, PILOT_WEB_URL);
  assert.equal(desktopBuildConfig({}).extraMetadata.productName, "Airboard", "settings live in an Airboard folder");
  assert.equal(
    desktopBuildConfig({ AIRBOARD_DESKTOP_WEB_URL: "https://airboard.example" }).extraMetadata.airboardDesktop.webUrl,
    "https://airboard.example",
  );
});
