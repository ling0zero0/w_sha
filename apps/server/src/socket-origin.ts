export interface SocketOriginPolicyOptions {
  publicAddress: string;
  publicPort: number;
  additionalOrigins?: readonly string[];
}

export interface SocketOriginPolicy {
  allowedOrigins: ReadonlySet<string>;
  isAllowed(origin: string | undefined): boolean;
}

const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"] as const;

export function createSocketOriginPolicy(
  options: SocketOriginPolicyOptions
): SocketOriginPolicy {
  const allowedOrigins = new Set<string>();
  const port = String(options.publicPort);

  addOrigin(allowedOrigins, `http://${formatHost(options.publicAddress)}:${port}`);
  for (const host of loopbackHosts) {
    addOrigin(allowedOrigins, `http://${host}:${port}`);
  }
  for (const origin of options.additionalOrigins ?? []) {
    addOrigin(allowedOrigins, origin);
  }

  return {
    allowedOrigins,
    isAllowed(origin) {
      // Non-browser clients normally do not send Origin. Socket actions still
      // require their own room/host credentials, so this is not an auth bypass.
      if (origin === undefined) return true;
      const normalized = normalizeOrigin(origin);
      return normalized !== null && allowedOrigins.has(normalized);
    }
  };
}

function addOrigin(target: Set<string>, origin: string): void {
  const normalized = normalizeOrigin(origin);
  if (normalized !== null) target.add(normalized);
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function formatHost(address: string): string {
  return address.includes(":") && !address.startsWith("[")
    ? `[${address}]`
    : address;
}
