import { getServerIntegrationConfig } from "./config.ts";

const ALLOWED_COMPANY_TYPES = new Set(["央企", "国企"]);
const ALLOWED_JOB_TYPES = new Set(["校招", "实习"]);
const SAFE_MAJOR_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;
const JOB_REQUEST_TIMEOUT_MS = 8_000;
const MAJOR_TEXT_RULES: Record<string, RegExp> = {
  "0809": /计算机|软件|人工智能|数据科学|大数据|网络工程|信息安全|物联网|数字媒体/u,
  "0807": /电子信息|通信工程|电子科学|微电子/u,
  "0806": /电气工程|智能电网|电力系统/u,
  "0808": /自动化|机器人工程|控制工程/u,
  "0201": /经济学|经济统计|国民经济|资源与环境经济/u,
  "0203": /金融|保险|投资学/u,
  "1202": /工商管理|市场营销|会计|财务管理|人力资源|审计/u,
  "0301": /法学|法律|知识产权/u,
  "0501": /汉语言|中文|中国语言文学|秘书学/u,
};

export type ZhidaJobFilters = {
  keyword?: string;
  company?: string;
  majorCode?: string;
  educationLevel?: string;
  graduationYear?: string;
  city?: string;
};

export type NormalizedZhidaJob = {
  id: string;
  companyName: string;
  companyType: "央企" | "国企";
  jobTitle: string;
  jobType: "校招" | "实习";
  educationLevel: string | null;
  graduateYear: string | null;
  workLocation: string | null;
  majorRequirements: string | null;
  majorCategoryIds: string[];
  applyStartDate: string | null;
  applyEndDate: string | null;
  announcementUrl: string | null;
  applyUrl: string | null;
  source: string | null;
  updatedAt: string | null;
};

export type ZhidaJobsResult = {
  jobs: NormalizedZhidaJob[];
  total: number;
  fetchedAt: string;
};

export class ZhidaJobsUnavailableError extends Error {
  readonly code = "ZHIDA_JOBS_UNAVAILABLE";

  constructor() {
    super("实时岗位服务暂时不可用，请稍后重试。");
    this.name = "ZhidaJobsUnavailableError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value, 2_048);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeDate(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeMajorCategoryIds(value: unknown): string[] {
  let candidates: unknown[] = [];

  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];

    try {
      const parsed: unknown = JSON.parse(text);
      candidates = Array.isArray(parsed) ? parsed : [];
    } catch {
      candidates = text.split(/[,，\s]+/);
    }
  }

  const normalized = candidates
    .map((candidate) => normalizeText(candidate, 32))
    .filter((candidate): candidate is string =>
      Boolean(candidate && SAFE_MAJOR_CODE.test(candidate)),
    );

  return Array.from(new Set(normalized)).slice(0, 200);
}

export function normalizeWorkLocation(value: unknown): string | null {
  const text = normalizeText(value, 1_000);
  if (!text) return null;

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const values: string[] = [];
      const visit = (entry: unknown): void => {
        if (Array.isArray(entry)) {
          entry.forEach(visit);
          return;
        }
        const normalized = normalizeText(entry, 120);
        if (normalized) values.push(normalized);
      };
      visit(parsed);
      const unique = Array.from(new Set(values));
      if (unique.length > 0) return unique.slice(0, 12).join(" / ");
    } catch {
      // Keep the bounded plain-text value when an upstream location is not valid JSON.
    }
  }

  return text.slice(0, 200);
}

export function matchesMajorTextFilter(
  job: NormalizedZhidaJob,
  majorCode: string,
): boolean {
  const text = job.majorRequirements?.replace(/\s+/g, "").trim();
  if (!text) return true;
  if (/不限专业|专业不限|不限|理工科|工科类/u.test(text)) return true;
  const rule = MAJOR_TEXT_RULES[majorCode];
  return rule ? rule.test(text) : true;
}

/** Pure, defensive conversion of one untrusted upstream job. */
export function normalizeZhidaJob(value: unknown): NormalizedZhidaJob | null {
  const job = asRecord(value);
  if (!job) return null;

  const id = normalizeText(job.id, 64);
  const companyName = normalizeText(job.companyName, 200);
  const companyType = normalizeText(job.companyType, 20);
  const jobTitle = normalizeText(job.jobTitle, 200);
  const jobType = normalizeText(job.jobType, 20);

  if (
    !id ||
    !companyName ||
    !jobTitle ||
    !companyType ||
    !ALLOWED_COMPANY_TYPES.has(companyType) ||
    !jobType ||
    !ALLOWED_JOB_TYPES.has(jobType)
  ) {
    return null;
  }

  return {
    id,
    companyName,
    companyType: companyType as "央企" | "国企",
    jobTitle,
    jobType: jobType as "校招" | "实习",
    educationLevel: normalizeText(job.educationLevel, 50),
    graduateYear: normalizeText(job.graduateYear, 80),
    workLocation: normalizeWorkLocation(job.workLocation),
    majorRequirements: normalizeText(job.majorRequirements, 4_000),
    majorCategoryIds: normalizeMajorCategoryIds(job.majorCategoryIds),
    applyStartDate: normalizeDate(job.applyStartDate),
    applyEndDate: normalizeDate(job.applyEndDate),
    announcementUrl: normalizeUrl(job.announcementUrl),
    applyUrl: normalizeUrl(job.applyUrl),
    source: normalizeText(job.source, 160),
    updatedAt: normalizeDate(job.updatedAt),
  };
}

function buildJobListInput(
  filters: ZhidaJobFilters,
  pageSize: number,
): Record<string, unknown> {
  return {
    status: "active",
    page: 1,
    pageSize,
    includeTotal: true,
    sortField: "applyEndDate",
    sortOrder: "asc",
    companyTypes: ["央企", "国企"],
    jobTypes: ["校招", "实习"],
    ...(filters.keyword ? { keyword: filters.keyword } : {}),
    ...(filters.company ? { companyFilter: filters.company } : {}),
    ...(filters.majorCode
      ? { majorCategoryIds: [filters.majorCode], strictMajorMatch: true }
      : {}),
    ...(filters.educationLevel
      ? { educationLevels: [filters.educationLevel] }
      : {}),
    ...(filters.graduationYear
      ? { graduateYears: [filters.graduationYear] }
      : {}),
    ...(filters.city ? { workLocations: [filters.city] } : {}),
  };
}

function extractTrpcData(payload: unknown): Record<string, unknown> | null {
  const envelope = Array.isArray(payload) ? payload[0] : payload;
  const root = asRecord(envelope);
  if (!root || root.error) return null;

  const result = asRecord(root.result);
  const data = result?.data;
  const dataRecord = asRecord(data);
  const json = dataRecord && "json" in dataRecord ? dataRecord.json : data;
  return asRecord(json);
}

function normalizeTotal(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

export async function fetchZhidaJobs(
  filters: ZhidaJobFilters = {},
  options: { pageSize?: number } = {},
): Promise<ZhidaJobsResult> {
  const config = getServerIntegrationConfig();
  if (!config.zhidaTrpcUrl) throw new ZhidaJobsUnavailableError();

  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 50));
  const input = buildJobListInput(filters, pageSize);
  const endpoint = new URL(
    `${config.zhidaTrpcUrl.replace(/\/$/, "")}/job.list`,
  );
  endpoint.searchParams.set("input", JSON.stringify({ json: input }));

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(JOB_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) throw new ZhidaJobsUnavailableError();

    const payload: unknown = await response.json();
    const data = extractTrpcData(payload);
    if (!data || !Array.isArray(data.jobs)) {
      throw new ZhidaJobsUnavailableError();
    }

    const normalizedJobs = data.jobs
      .map(normalizeZhidaJob)
      .filter((job): job is NormalizedZhidaJob => job !== null);
    const jobs = (
      filters.majorCode
        ? normalizedJobs.filter((job) =>
            matchesMajorTextFilter(job, filters.majorCode!),
          )
        : normalizedJobs
    ).slice(0, 50);

    return {
      jobs,
      total: normalizeTotal(data.total, jobs.length),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ZhidaJobsUnavailableError) throw error;
    throw new ZhidaJobsUnavailableError();
  }
}

export async function isZhidaJobsLive(): Promise<boolean> {
  try {
    await fetchZhidaJobs({}, { pageSize: 1 });
    return true;
  } catch {
    return false;
  }
}
