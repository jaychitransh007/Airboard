const CHROME_WEB_STORE_HOST = "chromewebstore.google.com";
const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function normalizeChromeWebStoreUrl(
  value: string | undefined,
  expectedExtensionId: string | undefined,
): string | null {
  const candidate = value?.trim();
  const extensionId = expectedExtensionId?.trim() ?? "";
  if (!candidate || !CHROME_EXTENSION_ID_PATTERN.test(extensionId)) return null;
  try {
    const url = new URL(candidate);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const listedExtensionId = pathSegments.at(-1) ?? "";
    if (
      url.protocol !== "https:" ||
      url.hostname !== CHROME_WEB_STORE_HOST ||
      url.origin !== `https://${CHROME_WEB_STORE_HOST}` ||
      url.username ||
      url.password ||
      pathSegments[0] !== "detail" ||
      (pathSegments.length !== 2 && pathSegments.length !== 3) ||
      !CHROME_EXTENSION_ID_PATTERN.test(listedExtensionId) ||
      listedExtensionId !== extensionId
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export const CHROME_WEB_STORE_URL = normalizeChromeWebStoreUrl(
  process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL,
  process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID,
);

export const CHROME_EXTENSION_VERSION =
  process.env.NEXT_PUBLIC_CHROME_EXTENSION_VERSION?.trim() || "0.8.0";

export const CHROME_EXTENSION_PUBLICLY_INSTALLABLE = Boolean(CHROME_WEB_STORE_URL);
