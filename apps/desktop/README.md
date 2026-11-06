# Airboard desktop overlay

A transparent, always-on-top Airboard window that sits above other apps and
lets clicks pass through. It lives in the menu bar (macOS) or the system tray
(Windows).

## Run it while developing

```bash
pnpm dev:web
pnpm dev:desktop
```

Development runs open the local web app at `http://127.0.0.1:3000`. Set
`AIRBOARD_DESKTOP_URL` to open another Airboard address.

## Build the installers on your own computer

```bash
pnpm --filter @airboard/desktop run package:mac   # on a Mac
pnpm --filter @airboard/desktop run package:win   # on Windows
```

The installers land in `apps/desktop/dist`:

- **macOS:** a `.dmg` to install and a `.zip` for updates, each for Apple
  silicon (`arm64`) and Intel (`x64`).
- **Windows:** an `.exe` installer for 64-bit Windows.

The first line of the build says whether it was signed. Without the accounts
below, the build is unsigned. That is fine for trying it yourself, but other
people can't easily install it: macOS refuses to open an unsigned app
downloaded from the internet, and Windows shows a SmartScreen warning.

## What an installed copy does

- **Opens the pilot web app**
  (`https://airboard-pilot-web-634900453473.asia-south1.run.app`). To package
  for another address, set `AIRBOARD_DESKTOP_WEB_URL` when you build.
  `AIRBOARD_DESKTOP_URL` still overrides it when the app starts.
- **Updates itself.** It checks for a new version when it starts and every 4
  hours, downloads it in the background, and installs it when you quit. A failed
  check is written to the update log and tried again later. It never shows up
  as a crash.
  - Turn updates off by starting the app with `AIRBOARD_DESKTOP_AUTO_UPDATE=off`.
  - The update log is `~/Library/Logs/Airboard/updates.log` on macOS and
    `%APPDATA%\Airboard\logs\updates.log` on Windows.
  - Development runs and `--smoke-test` never update.
- **Asks for the camera and microphone** the first time you turn on hands or
  Airo voice.

## Release a new version

1. Raise `version` in `apps/desktop/package.json` (for example to `0.2.0`), and
   commit it.
2. Tag that commit `desktop-v0.2.0` and push the tag.
3. The **Desktop app** workflow builds on macOS and Windows. It puts the
   installers on a **draft** release named after the tag. The build fails if
   the tag doesn't match the version.
4. Download the installers from the draft and try them.
5. Publish the draft and leave **Set as the latest release** ticked. Installed
   apps update from the repository's latest release.

Any other kind of release on this repository must be published with **Set as
the latest release** unticked. Otherwise installed apps look there for an
update and find none.

To build without releasing, run the **Desktop app** workflow by hand from the
Actions tab. The installers are kept as workflow artifacts for 14 days.

## Accounts and secrets you need to add

Add each secret under the repository's **Settings → Secrets and variables →
Actions**. The workflow signs a platform only when all of that platform's
secrets are present.

### macOS: Apple Developer Program

Join the [Apple Developer Program](https://developer.apple.com/programs/)
(US$99 a year). Enrol as an organisation, so the app shows your company's name.

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | Your **Developer ID Application** certificate, exported from Keychain Access as a `.p12` file and base64-encoded (`base64 -i cert.p12 \| pbcopy`). |
| `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_ID` | The email address of the Apple account in the developer team. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that account, made at [account.apple.com](https://account.apple.com) under **Sign-In and Security**. |
| `APPLE_TEAM_ID` | The 10-character Team ID shown under **Membership** in your developer account. |

With these, the build is signed with the hardened runtime and notarized by
Apple. Then macOS opens it without warnings, and automatic updates work:
macOS only installs updates for a signed app.

### Windows: Azure Trusted Signing

Windows signing uses Microsoft's Azure Trusted Signing rather than a
certificate file. Since June 2023, new code-signing certificates must stay on a
hardware token, which a build server can't hold. Trusted Signing signs in the cloud, costs about US$10 a
month, and electron-builder supports it directly.

Check eligibility before you pay. Microsoft currently offers it to organisations
in the US, Canada, the EU and the UK, and to individual developers in the US
and Canada.

Set up a Trusted Signing account and a **Public Trust** certificate profile in
Azure. Then create an app registration with the **Trusted Signing Certificate
Profile Signer** role on that profile, and add:

| Secret | What it is |
| --- | --- |
| `AZURE_TENANT_ID` | The app registration's directory (tenant) ID. |
| `AZURE_CLIENT_ID` | The app registration's application (client) ID. |
| `AZURE_CLIENT_SECRET` | A client secret for that app registration. |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | The account's region endpoint, such as `https://eus.codesigning.azure.net`. |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | The Trusted Signing account name. |
| `AZURE_TRUSTED_SIGNING_PROFILE` | The certificate profile name. |
| `AZURE_TRUSTED_SIGNING_PUBLISHER` | The publisher name exactly as it appears on the certificate (usually your legal company name). |

If you already have a certificate as a `.pfx` file, add `WIN_CSC_LINK` (the
base64-encoded file) and `WIN_CSC_KEY_PASSWORD` instead. When both kinds are
present, Trusted Signing is used.

## Decide before the first public release

- **App identifier:** the app is `app.airboard.desktop`. macOS ties camera and
  microphone permissions, and updates, to it, so it can't change once people
  install the app.
- **Copyright holder:** the installer says "Airboard". Change `copyright` in
  `electron-builder.config.mjs` to your legal entity's name.
