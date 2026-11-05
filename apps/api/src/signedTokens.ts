import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type AirboardTokenPurpose =
  | "development_access"
  | "realtime"
  | "join"
  | "installation_link"
  | "installation";

export type AirboardSignedToken = {
  v: 1;
  purpose: AirboardTokenPurpose;
  sub: string;
  exp: number;
  iat: number;
  jti: string;
  organizationId?: string;
  sessionId?: string;
  participantId?: string;
  installationId?: string;
};

export function issueSignedToken(
  secret: string,
  input: Omit<AirboardSignedToken, "v" | "iat" | "exp" | "jti"> & { ttlSeconds: number },
): string {
  const now = Math.floor(Date.now() / 1_000);
  const { ttlSeconds, ...claims } = input;
  // Browser installations are revocable server-side and need a sliding
  // credential that survives ordinary use. Other signed capabilities remain
  // deliberately short-lived.
  const maxTtlSeconds = input.purpose === "installation"
    ? 90 * 24 * 60 * 60
    : 7 * 24 * 60 * 60;
  const payload: AirboardSignedToken = {
    v: 1,
    ...claims,
    iat: now,
    exp: now + Math.max(30, Math.min(ttlSeconds, maxTtlSeconds)),
    jti: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(secret, encoded)}`;
}

export function verifySignedToken(
  secret: string,
  token: string,
  expectedPurpose?: AirboardTokenPurpose,
): AirboardSignedToken | null {
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) {
    return null;
  }
  const expectedSignature = signature(secret, encoded);
  const expectedBytes = Buffer.from(expectedSignature);
  const providedBytes = Buffer.from(providedSignature);
  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AirboardSignedToken>;
    const now = Math.floor(Date.now() / 1_000);
    if (
      parsed.v !== 1 ||
      typeof parsed.purpose !== "string" ||
      typeof parsed.sub !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.jti !== "string" ||
      parsed.exp <= now ||
      parsed.iat > now + 60 ||
      (expectedPurpose && parsed.purpose !== expectedPurpose)
    ) {
      return null;
    }
    return parsed as AirboardSignedToken;
  } catch {
    return null;
  }
}

export function bearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const value = headers.authorization;
  if (typeof value !== "string") {
    return null;
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

function signature(secret: string, encoded: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}
