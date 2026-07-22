import type { MarketReportJob } from "../career/market-report.ts";

const DEFAULT_CAREER_INTELLIGENCE_URL = "http://127.0.0.1:18080";
const HEALTH_TIMEOUT_MS = 5_000;
const MARKET_REPORT_TIMEOUT_MS = 12_000;

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

export type CareerIntelligenceMarketPool = {
  jobs: MarketReportJob[];
  relevantTotal: number;
  broadTotal: number;
  fetchedAt: string;
  sampleLimit: number;
};

export class CareerIntelligenceUnavailableError extends Error {
  readonly code = "CAREER_INTELLIGENCE_UNAVAILABLE";

  constructor() {
    super("职业情报库暂时不可用，请稍后重试。");
    this.name = "CareerIntelligenceUnavailableError";
  }
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeMarketJob(value: unknown): MarketReportJob | null {
  const job = asRecord(value);
  if (!job) return null;
  const id = boundedText(job.externalJobId, 64);
  const companyName = boundedText(job.companyName, 200);
  const jobTitle = boundedText(job.jobTitle, 200);
  if (!id || !companyName || !jobTitle) return null;

  return {
    id,
    companyName,
    jobTitle,
    workLocation: boundedText(job.workLocation, 240),
    applyEndDate: boundedText(job.applicationEndAt, 80),
    source: boundedText(job.sourceName, 160),
    companyType: boundedText(job.companyType, 30),
    jobType: boundedText(job.jobType, 30),
    educationLevel: boundedText(job.educationLevelRaw, 80),
    graduationYear: boundedText(job.graduationYearRaw, 120),
    majorRequirements: boundedText(job.majorRequirementsRaw, 2_000),
  };
}

function safeCount(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export async function fetchCareerIntelligenceMarketPool(
  input: {
    keywords: string[];
    educationLevel?: string;
    graduationYear: number;
    limit?: number;
  },
  options: HealthProbeOptions = {},
): Promise<CareerIntelligenceMarketPool> {
  const baseUrl = readApiUrl(options.apiUrl);
  if (!baseUrl) throw new CareerIntelligenceUnavailableError();

  try {
    const endpoint = new URL("/v1/reports/market", baseUrl);
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keywords: input.keywords,
        educationLevel: input.educationLevel ?? null,
        graduationYear: input.graduationYear,
        limit: Math.max(1, Math.min(50, input.limit ?? 50)),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(MARKET_REPORT_TIMEOUT_MS),
    });
    if (!response.ok) throw new CareerIntelligenceUnavailableError();

    const payload = asRecord(await response.json());
    const meta = asRecord(payload?.meta);
    if (
      !payload
      || !meta
      || !Array.isArray(payload.items)
      || meta.accessMode !== "read-only"
      || meta.containsStudentPii !== false
      || meta.sourceFieldsVerifiedAsHardGates !== false
    ) {
      throw new CareerIntelligenceUnavailableError();
    }

    const relevantTotal = safeCount(meta.relevantTotal);
    const broadTotal = safeCount(meta.broadTotal);
    const sampleLimit = safeCount(meta.sampleLimit);
    if (relevantTotal === null || broadTotal === null || sampleLimit === null) {
      throw new CareerIntelligenceUnavailableError();
    }

    const jobs = payload.items
      .map(normalizeMarketJob)
      .filter((job): job is MarketReportJob => job !== null)
      .slice(0, 50);
    return {
      jobs,
      relevantTotal,
      broadTotal,
      fetchedAt: boundedText(meta.checkedAt, 80) ?? new Date().toISOString(),
      sampleLimit,
    };
  } catch (error) {
    if (error instanceof CareerIntelligenceUnavailableError) throw error;
    throw new CareerIntelligenceUnavailableError();
  }
}
