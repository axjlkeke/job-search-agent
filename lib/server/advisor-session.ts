const COOKIE_NAME = "job_agent_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RATE_WINDOW_MS = 60_000;
const SESSION_REQUESTS_PER_WINDOW = 6;
const SESSION_CONCURRENT_REQUESTS = 2;
const IP_REQUESTS_PER_WINDOW = 20;

type Bucket = {
  windowStartedAt: number;
  count: number;
  inFlight: number;
  lastSeenAt: number;
};

const buckets = new Map<string, Bucket>();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signSessionId(id: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(id),
  );
  return bytesToHex(new Uint8Array(signature));
}

async function verifySessionId(
  id: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const bytes = hexToBytes(signature);
  if (!bytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    bytes.buffer as ArrayBuffer,
    new TextEncoder().encode(id),
  );
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export type AdvisorSession = {
  id: string;
  clientId: string;
  setCookie: string | null;
};

export async function getOrCreateAdvisorSession(
  request: Request,
  secret: string,
): Promise<AdvisorSession> {
  const raw = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (raw) {
    const separator = raw.indexOf(".");
    const id = separator > 0 ? raw.slice(0, separator) : "";
    const signature = separator > 0 ? raw.slice(separator + 1) : "";
    if (
      /^[0-9a-f-]{36}$/i.test(id) &&
      (await verifySessionId(id, signature, secret))
    ) {
      return { id, clientId: `job-agent-${id}`, setCookie: null };
    }
  }

  const id = crypto.randomUUID();
  const signature = await signSessionId(id, secret);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    id,
    clientId: `job-agent-${id}`,
    setCookie: `${COOKIE_NAME}=${id}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  };
}

export async function advisorIpKey(
  request: Request,
  secret: string,
): Promise<string> {
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "local";
  const signature = await signSessionId(address.slice(0, 120), secret);
  return `ip:${signature.slice(0, 24)}`;
}

function currentBucket(key: string, now: number): Bucket {
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartedAt >= RATE_WINDOW_MS) {
    const fresh = {
      windowStartedAt: now,
      count: 0,
      inFlight: 0,
      lastSeenAt: now,
    };
    buckets.set(key, fresh);
    return fresh;
  }
  existing.lastSeenAt = now;
  return existing;
}

function pruneBuckets(now: number): void {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.inFlight === 0 && now - bucket.lastSeenAt > RATE_WINDOW_MS * 5) {
      buckets.delete(key);
    }
  }
}

/**
 * Lightweight per-instance guard for the local beta. Public deployment still
 * needs a shared gateway/Redis/Durable Object rate limiter across instances.
 */
export function beginAdvisorRequest(
  sessionKey: string,
  ipKey: string,
  now = Date.now(),
): (() => void) | null {
  pruneBuckets(now);
  const session = currentBucket(`session:${sessionKey}`, now);
  const ip = currentBucket(ipKey, now);
  if (
    session.count >= SESSION_REQUESTS_PER_WINDOW ||
    session.inFlight >= SESSION_CONCURRENT_REQUESTS ||
    ip.count >= IP_REQUESTS_PER_WINDOW
  ) return null;

  session.count += 1;
  session.inFlight += 1;
  ip.count += 1;
  ip.inFlight += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    session.inFlight = Math.max(0, session.inFlight - 1);
    ip.inFlight = Math.max(0, ip.inFlight - 1);
  };
}
