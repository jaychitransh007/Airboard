import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_PREVIEW_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_REDIRECTS = 3;

const INTERACTIVE_PREVIEW_HOSTS = new Set([
  "airtable.com", "coda.io", "codepen.io", "figma.com", "framer.com",
  "loom.com", "miro.com", "mural.co", "music.apple.com", "pitch.com",
  "spotify.com", "tidal.com", "vimeo.com", "youtube.com", "youtu.be",
]);

export type BoardLinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  interactive: boolean;
  embedUrl: string | null;
};

export async function resolveBoardLinkPreview(
  rawUrl: string,
  dependencies: { fetch?: typeof fetch; resolveHost?: typeof resolveHost } = {},
): Promise<BoardLinkPreview> {
  const fetcher = dependencies.fetch ?? fetch;
  const hostResolver = dependencies.resolveHost ?? resolveHost;
  let url = parseHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_PREVIEW_REDIRECTS; redirects += 1) {
    await assertSafePreviewUrl(url, hostResolver);
    const response = await fetcher(url, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Airboard-Link-Preview/1.0",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_PREVIEW_REDIRECTS) {
        throw new Error("LINK_PREVIEW_REDIRECT_FAILED");
      }
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("LINK_PREVIEW_FETCH_FAILED");
    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      throw new Error("LINK_PREVIEW_NOT_HTML");
    }
    const html = await boundedResponseText(response, MAX_PREVIEW_RESPONSE_BYTES);
    return previewFromHtml(url, html);
  }
  throw new Error("LINK_PREVIEW_REDIRECT_FAILED");
}

export async function assertSafePreviewUrl(
  url: URL,
  hostResolver: typeof resolveHost = resolveHost,
): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("UNSAFE_LINK_PREVIEW_URL");
  }
  if (url.port && !(
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  )) {
    throw new Error("UNSAFE_LINK_PREVIEW_URL");
  }
  const host = normalizedHostname(url.hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("UNSAFE_LINK_PREVIEW_URL");
  }
  const addresses = isIP(host) ? [host] : await hostResolver(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("UNSAFE_LINK_PREVIEW_URL");
  }
}

export function previewFromHtml(url: URL, html: string): BoardLinkPreview {
  const title = metaContent(html, "property", "og:title") ??
    metaContent(html, "name", "twitter:title") ??
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ??
    url.hostname;
  const description = metaContent(html, "property", "og:description") ??
    metaContent(html, "name", "description") ??
    metaContent(html, "name", "twitter:description");
  const image = metaContent(html, "property", "og:image") ??
    metaContent(html, "name", "twitter:image");
  const siteName = metaContent(html, "property", "og:site_name");
  const interactive = interactivePreviewHost(url.hostname);
  return {
    url: url.toString(),
    title: truncateText(title || url.hostname, 240),
    description: description ? truncateText(description, 500) : null,
    imageUrl: resolvePublicPreviewUrl(image, url),
    siteName: siteName ? truncateText(siteName, 120) : null,
    interactive,
    embedUrl: interactive ? url.toString() : null,
  };
}

function interactivePreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return [...INTERACTIVE_PREVIEW_HOSTS].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

async function resolveHost(host: string): Promise<string[]> {
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map(({ address }) => address);
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  const kind = isIP(normalized);
  if (kind === 6) return isNonPublicIpv6(normalized);
  if (kind !== 4) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("LINK_PREVIEW_RESPONSE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("LINK_PREVIEW_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function metaContent(html: string, attribute: "name" | "property", value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const decoded = decodeEntities(pattern.exec(html)?.[1] ?? "");
    if (decoded) return decoded;
  }
  return null;
}

function decodeEntities(input: string): string | null {
  const value = input
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
  return value || null;
}

function resolvePublicPreviewUrl(candidate: string | null, base: URL): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = normalizedHostname(url.hostname);
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      return null;
    }
    if (isIP(host) && isPrivateAddress(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseHttpUrl(raw: string): URL {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url;
  } catch {
    throw new Error("UNSAFE_LINK_PREVIEW_URL");
  }
}

function truncateText(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

function normalizedHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isNonPublicIpv6(address: string): boolean {
  const value = ipv6Value(address);
  if (value === null) return true;
  if (!ipv6InPrefix(value, "2000::", 3)) return true;
  return ipv6InPrefix(value, "2001:2::", 48) ||
    ipv6InPrefix(value, "2001:10::", 28) ||
    ipv6InPrefix(value, "2001:20::", 28) ||
    ipv6InPrefix(value, "2001:db8::", 32);
}

function ipv6InPrefix(value: bigint, prefixAddress: string, bits: number): boolean {
  const prefix = ipv6Value(prefixAddress);
  if (prefix === null) return false;
  const shift = BigInt(128 - bits);
  return value >> shift === prefix >> shift;
}

function ipv6Value(address: string): bigint | null {
  let source = address;
  const ipv4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(source)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) return null;
    source = `${source.slice(0, -ipv4Tail.length)}${[
      ((octets[0]! << 8) | octets[1]!).toString(16),
      ((octets[2]! << 8) | octets[3]!).toString(16),
    ].join(":")}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  return words.reduce((total, word) => (total << 16n) | BigInt(`0x${word}`), 0n);
}
