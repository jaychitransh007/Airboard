const CHROME_WEB_STORE_HOST = "chromewebstore.google.com";

export function normalizeChromeWebStoreUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.hostname !== CHROME_WEB_STORE_HOST ||
      !url.pathname.startsWith("/detail/")
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
);

export const CHROME_EXTENSION_VERSION =
  process.env.NEXT_PUBLIC_CHROME_EXTENSION_VERSION?.trim() || "0.8.0";

export const CHROME_EXTENSION_PUBLICLY_INSTALLABLE = Boolean(CHROME_WEB_STORE_URL);
