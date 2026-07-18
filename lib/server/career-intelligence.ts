const DEFAULT_CAREER_INTELLIGENCE_URL = "http://127.0.0.1:18080";
const HEALTH_TIMEOUT_MS = 5_000;

const PUBLIC_COUNT_KEYS = [
  "enterprises",
  "schools",
  "jobMappings",
  "currentJobSnapshots",
  "officialEvidenceSnapshots",
  "verifiedOfficialJobPages",
] as const;

type PublicCountKey = (typeof PUBLIC_COUNT_KEYS)[number];

export type CareerIntelligenceCounts = Partial<Record<PublicCountKey, number>>;

export type CareerIntelligenceHealth = {
  live: boolean;
  counts: CareerIntelligenceCounts | null;
};

type HealthProbeOptions = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readApiUrl(override?: string): URL | null {
  const raw = override?.trim()
    || process.env.CAREER_INTELLIGENCE_API_URL?.trim()
    || DEFAULT_CAREER_INTELLIGENCE_URL;

  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function sanitizeCounts(value: unknown): CareerIntelligenceCounts {
  const source = asRecord(value);
  if (!source) return {};

  const counts: CareerIntelligenceCounts = {};
  for (const key of PUBLIC_COUNT_KEYS) {
    const count = source[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      counts[key] = count;
    }
  }
  return counts;
}

/**
 * Probe only the loopback service's public health endpoint. A service is
 * considered usable only when it explicitly confirms the read-only/PII-free
 * contract. No database credentials or student data are sent by this probe.
 */
export async function probeCareerIntelligenceHealth(
  options: HealthProbeOptions = {},
): Promise<CareerIntelligenceHealth> {
  const baseUrl = readApiUrl(options.apiUrl);
  if (!baseUrl) return { live: false, counts: null };

  try {
    const healthUrl = new URL("/health", baseUrl);
    const response = await (options.fetchImpl ?? fetch)(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return { live: false, counts: null };

    const payload = asRecord(await response.json());
    const constraints = asRecord(payload?.constraints);
    const containsStudentPii =
      constraints?.containsStudentPii ?? payload?.containsStudentPii;
    if (
      payload?.status !== "ok" ||
      payload?.accessMode !== "read-only" ||
      containsStudentPii !== false
    ) {
      return { live: false, counts: null };
    }

    return {
      live: true,
      counts: sanitizeCounts(payload.counts),
    };
  } catch {
    return { live: false, counts: null };
  }
}
