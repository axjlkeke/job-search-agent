import type {
  CapabilityLevel,
  DegreeLevel,
  ProductCategory,
} from "../career/types.ts";

export const ZHIDA_BRIDGE_COOKIE = "job_agent_zhida";
export const ZHIDA_BRIDGE_FLOW_COOKIE = "job_agent_zhida_flow";
export const ZHIDA_BRIDGE_SOURCE = "zhida-main-site-readonly";
export const ZHIDA_BRIDGE_SCHEMA_VERSION = "2026-07-17.2";
export const ZHIDA_BRIDGE_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const ZHIDA_BRIDGE_FLOW_SECONDS = 5 * 60;

const FORBIDDEN_SNAPSHOT_KEYS = new Set([
  "idCard",
  "phone",
  "email",
  "wechat",
  "avatar",
  "resumeUrl",
  "resumeFileName",
  "resumeParsedData",
  "pushEmail",
  "orderNo",
  "amount",
  "paymentMethod",
  "sourceOrderId",
  "internalUserId",
  "openId",
]);

type JsonRecord = Record<string, unknown>;

export type ZhidaBridgeProfile = {
  id: "zhida-connected-profile";
  name: "同学";
  school: string;
  schoolTier: string;
  degreeLevel: DegreeLevel;
  major: string;
  graduationYear: number;
  city: string;
  preferredCities: string;
  targetSector: string;
  availableHoursPerWeek: number;
  capabilityLevels: Partial<Record<string, CapabilityLevel>>;
};

export type ZhidaCapabilityEntitlement = {
  code: string;
  name: string;
  category: ProductCategory;
  routePath: string;
  dailyLimit: number | null;
};

export type ZhidaBridgeSessionPayload = {
  version: 1;
  source: typeof ZHIDA_BRIDGE_SOURCE;
  schemaVersion: typeof ZHIDA_BRIDGE_SCHEMA_VERSION;
  connectedAt: number;
  expiresAt: number;
  profile: ZhidaBridgeProfile | null;
  entitlements: ZhidaCapabilityEntitlement[];
  membership: {
    effectiveTier: string;
    status: "active" | "expired" | "inactive" | "none";
    expiresAt: string | null;
  };
};

export type ZhidaAuthorizationFlow = {
  version: 1;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordList(value: unknown, maximum = 30): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter((item): item is JsonRecord => Boolean(item))
    .slice(0, maximum);
}

function stringList(value: unknown, maximum = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 160))
    .filter((item): item is string => Boolean(item))
    .slice(0, maximum);
}

function collectForbiddenKeys(
  value: unknown,
  path = "root",
  found: string[] = [],
): string[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectForbiddenKeys(item, `${path}[${index}]`, found),
    );
    return found;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_SNAPSHOT_KEYS.has(key)) found.push(`${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, found);
  }
  return found;
}

function degreeLevel(value: unknown): DegreeLevel {
  const label = text(value, 40) ?? "";
  if (/博士/u.test(label)) return "doctorate";
  if (/硕士|研究生/u.test(label)) return "master";
  if (/本科|学士/u.test(label)) return "bachelor";
  if (/大专|专科|高职/u.test(label)) return "associate";
  if (/中专|职高|技校/u.test(label)) return "vocational";
  if (/高中/u.test(label)) return "secondary";
  return "unknown";
}

function schoolTier(value: unknown): string {
  const label = text(value, 60) ?? "";
  if (/985|211/u.test(label)) return "985 / 211";
  if (/双一流/u.test(label)) return "双一流";
  if (/海外|境外/u.test(label)) return "海外院校";
  if (/高职|专科/u.test(label)) return "高职高专";
  return "普通本科";
}

function graduationYear(value: unknown): number | null {
  const match = text(value, 24)?.match(/20\d{2}/u);
  const year = match ? Number(match[0]) : numberValue(value);
  return Number.isSafeInteger(year) && year! >= 2000 && year! <= 2100
    ? year
    : null;
}

function safeFeatureRoute(value: unknown): string | null {
  const route = text(value, 160);
  if (!route || !route.startsWith("/") || route.startsWith("//")) return null;
  if (route.includes("://") || route.includes("\\")) return null;
  return route;
}

function featureCategory(value: string): ProductCategory | null {
  if (/resume|简历/iu.test(value)) return "resume";
  if (/interview|面试/iu.test(value)) return "interview";
  if (
    /application|apply|matching|match|job_push|投递|网申|岗位匹配|岗位推送/iu.test(
      value,
    )
  ) {
    return "application";
  }
  return null;
}

function capabilityLevels(profile: JsonRecord): ZhidaBridgeProfile["capabilityLevels"] {
  const experience = asRecord(profile.experience) ?? {};
  const capabilities = asRecord(profile.capabilities) ?? {};
  const resume = asRecord(profile.resume) ?? {};
  return {
    resume: resume.available === true ? "ready" : "missing",
    application: "missing",
    interview: "missing",
    project_evidence:
      recordList(experience.projects, 1).length > 0 ? "developing" : "missing",
    internship:
      recordList(experience.internships, 1).length > 0
        ? "developing"
        : "missing",
    competition:
      stringList(capabilities.awards, 1).length > 0 ? "developing" : "missing",
    qualification:
      recordList(capabilities.certificates, 1).length > 0
        ? "developing"
        : "missing",
  };
}

function normalizedProfile(snapshotProfile: JsonRecord | null): ZhidaBridgeProfile | null {
  if (!snapshotProfile) return null;
  const education = asRecord(snapshotProfile.education) ?? {};
  const targets = asRecord(snapshotProfile.targets) ?? {};
  const school = text(education.university, 100);
  const major = text(education.major, 100);
  const year = graduationYear(education.graduateYear);
  if (!school || !major || !year) return null;

  const locations = stringList(targets.locations, 12);
  const sectors = [
    ...stringList(targets.industries, 6),
    ...stringList(targets.positions, 6),
  ];
  return {
    id: "zhida-connected-profile",
    name: "同学",
    school,
    schoolTier: schoolTier(education.universityTier),
    degreeLevel: degreeLevel(education.educationLevel ?? education.degree),
    major,
    graduationYear: year,
    city: "",
    preferredCities: locations.join("、").slice(0, 240),
    targetSector: (sectors.join("、") || "央企 / 国企校招").slice(0, 240),
    availableHoursPerWeek: 10,
    capabilityLevels: capabilityLevels(snapshotProfile),
  };
}

function normalizedEntitlements(access: JsonRecord): ZhidaCapabilityEntitlement[] {
  const seen = new Set<string>();
  const entitlements: ZhidaCapabilityEntitlement[] = [];
  for (const item of recordList(access.features, 80)) {
    if (item.allowed !== true) continue;
    const code = text(item.code, 64);
    const name = text(item.name, 80);
    const routePath = safeFeatureRoute(item.routePath);
    if (!code || !/^[a-z0-9_.-]{2,80}$/iu.test(code) || !name || !routePath) {
      continue;
    }
    const category = featureCategory(`${code} ${name} ${routePath}`);
    if (!category || seen.has(code)) continue;
    seen.add(code);
    const rawLimit = numberValue(item.dailyLimit);
    entitlements.push({
      code,
      name,
      category,
      routePath,
      dailyLimit:
        rawLimit !== null && Number.isSafeInteger(rawLimit) && rawLimit >= -1
          ? Math.min(rawLimit, 100_000)
          : null,
    });
    if (entitlements.length >= 8) break;
  }
  return entitlements;
}

function membership(access: JsonRecord): ZhidaBridgeSessionPayload["membership"] {
  const legacy = asRecord(access.legacyMembership) ?? {};
  const status = text(legacy.status, 20);
  return {
    effectiveTier: text(legacy.effectiveTier, 40) ?? "free",
    status:
      status === "active" ||
      status === "expired" ||
      status === "inactive" ||
      status === "none"
        ? status
        : "none",
    expiresAt: text(legacy.expiryDate, 80),
  };
}

export class ZhidaBridgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZhidaBridgeValidationError";
  }
}

/** Validate and reduce the main-site response before it is stored anywhere. */
export function buildZhidaBridgeSession(
  snapshot: unknown,
  now = Date.now(),
): ZhidaBridgeSessionPayload {
  const root = asRecord(snapshot);
  if (!root) throw new ZhidaBridgeValidationError("主站快照格式不正确");
  if (collectForbiddenKeys(root).length > 0) {
    throw new ZhidaBridgeValidationError("主站快照包含禁止字段");
  }
  if (root.source !== ZHIDA_BRIDGE_SOURCE) {
    throw new ZhidaBridgeValidationError("主站快照来源不匹配");
  }
  if (root.schemaVersion !== ZHIDA_BRIDGE_SCHEMA_VERSION) {
    throw new ZhidaBridgeValidationError("主站快照版本不受支持");
  }
  const privacy = asRecord(root.privacy);
  if (
    privacy?.mode !== "explicit-user-handoff" ||
    privacy.persistence !== "none-at-source"
  ) {
    throw new ZhidaBridgeValidationError("主站快照隐私合同不匹配");
  }
  const access = asRecord(root.access);
  if (!access) throw new ZhidaBridgeValidationError("主站权益快照缺失");
  return {
    version: 1,
    source: ZHIDA_BRIDGE_SOURCE,
    schemaVersion: ZHIDA_BRIDGE_SCHEMA_VERSION,
    connectedAt: now,
    expiresAt: now + ZHIDA_BRIDGE_SESSION_SECONDS * 1_000,
    profile: normalizedProfile(asRecord(root.profile)),
    entitlements: normalizedEntitlements(access),
    membership: membership(access),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealZhidaBridgeValue(
  value: unknown,
  secret: string,
  purpose: "flow" | "session",
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`zhida-bridge:${purpose}:v1`),
    },
    await encryptionKey(secret),
    plaintext,
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;
}

export async function openZhidaBridgeValue(
  token: string,
  secret: string,
  purpose: "flow" | "session",
): Promise<unknown | null> {
  const [version, rawIv, rawCiphertext, extra] = token.split(".");
  if (version !== "v1" || !rawIv || !rawCiphertext || extra) return null;
  const iv = base64UrlToBytes(rawIv);
  const ciphertext = base64UrlToBytes(rawCiphertext);
  if (!iv || iv.length !== 12 || !ciphertext) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(iv),
        additionalData: new TextEncoder().encode(`zhida-bridge:${purpose}:v1`),
      },
      await encryptionKey(secret),
      bytesToArrayBuffer(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } catch {
    return null;
  }
}

function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function safeBridgeReturnTo(value: unknown): string {
  const route = text(value, 300);
  if (!route || !route.startsWith("/") || route.startsWith("//")) return "/v2";
  if (route.includes("\\") || /[\r\n]/u.test(route)) return "/v2";
  return route;
}

export async function createZhidaAuthorizationFlow(input: {
  authorizeUrl: string;
  audience: string;
  redirectUri: string;
  returnTo?: unknown;
  now?: number;
}): Promise<{ flow: ZhidaAuthorizationFlow; authorizeUrl: string }> {
  const now = input.now ?? Date.now();
  const state = randomToken();
  const codeVerifier = randomToken();
  const flow: ZhidaAuthorizationFlow = {
    version: 1,
    state,
    codeVerifier,
    redirectUri: input.redirectUri,
    returnTo: safeBridgeReturnTo(input.returnTo),
    createdAt: now,
    expiresAt: now + ZHIDA_BRIDGE_FLOW_SECONDS * 1_000,
  };
  const url = new URL(input.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("audience", input.audience);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { flow, authorizeUrl: url.toString() };
}

export function isZhidaAuthorizationFlow(
  value: unknown,
  now = Date.now(),
): value is ZhidaAuthorizationFlow {
  const flow = asRecord(value);
  return Boolean(
    flow?.version === 1 &&
      typeof flow.state === "string" &&
      /^[A-Za-z0-9_-]{40,100}$/u.test(flow.state) &&
      typeof flow.codeVerifier === "string" &&
      /^[A-Za-z0-9_-]{40,100}$/u.test(flow.codeVerifier) &&
      typeof flow.redirectUri === "string" &&
      typeof flow.returnTo === "string" &&
      typeof flow.createdAt === "number" &&
      typeof flow.expiresAt === "number" &&
      flow.createdAt <= now + 30_000 &&
      flow.expiresAt >= now &&
      flow.expiresAt - flow.createdAt <= ZHIDA_BRIDGE_FLOW_SECONDS * 1_000,
  );
}

export function isZhidaBridgeSessionPayload(
  value: unknown,
  now = Date.now(),
): value is ZhidaBridgeSessionPayload {
  const session = asRecord(value);
  return Boolean(
    session?.version === 1 &&
      session.source === ZHIDA_BRIDGE_SOURCE &&
      session.schemaVersion === ZHIDA_BRIDGE_SCHEMA_VERSION &&
      typeof session.connectedAt === "number" &&
      typeof session.expiresAt === "number" &&
      session.connectedAt <= now + 30_000 &&
      session.expiresAt >= now &&
      session.expiresAt - session.connectedAt <=
        ZHIDA_BRIDGE_SESSION_SECONDS * 1_000 &&
      (session.profile === null || asRecord(session.profile)) &&
      Array.isArray(session.entitlements) &&
      asRecord(session.membership),
  );
}

export function readCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
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

export function bridgeCookie(
  name: string,
  value: string,
  requestUrl: string,
  maximumAge: number,
  path = "/",
): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maximumAge}${secure}`;
}

export function clearBridgeCookie(
  name: string,
  requestUrl: string,
  path = "/",
): string {
  return bridgeCookie(name, "", requestUrl, 0, path);
}
