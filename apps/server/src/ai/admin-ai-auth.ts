import { createHash, timingSafeEqual } from "node:crypto";

export interface AiAdminRequestIdentity {
  directAddress: string;
  proxyClientAddress?: string | string[];
  origin?: string;
  referer?: string;
  authorization?: string;
}

export function isAuthorizedAiAdmin(
  request: AiAdminRequestIdentity,
  expectedHostSession: string
): boolean {
  const browserAddress = getBrowserAddress(
    request.directAddress,
    request.proxyClientAddress
  );
  if (!isLoopbackAddress(browserAddress)) return false;
  if (!isLoopbackBrowserSource(request.origin ?? request.referer)) return false;

  const token = readBearerToken(request.authorization);
  return token !== null && secretsEqual(token, expectedHostSession);
}

export function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1";
}

export function isLoopbackBrowserSource(source: string | undefined): boolean {
  if (!source) return false;
  try {
    const hostname = new URL(source).hostname;
    return hostname === "127.0.0.1"
      || hostname === "localhost"
      || hostname === "[::1]";
  } catch {
    return false;
  }
}

function getBrowserAddress(
  directAddress: string,
  proxyClientAddress: string | string[] | undefined
): string {
  if (!isLoopbackAddress(directAddress) || typeof proxyClientAddress !== "string") {
    return directAddress;
  }
  return proxyClientAddress;
}

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token.length > 0 ? token : null;
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
