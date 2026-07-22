import { getServerIntegrationConfig } from "./config.ts";

const ALLOWED_COMPANY_TYPES = new Set(["央企", "国企"]);
const ALLOWED_JOB_TYPES = new Set(["校招", "实习"]);
const SAFE_MAJOR_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;
const JOB_REQUEST_TIMEOUT_MS = 20_000;
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
  jobDescription: string | null;
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
  salaryMin: number | null;
  salaryMax: number | null;
  salaryUnit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ZhidaJobsResult = {
  jobs: NormalizedZhidaJob[];
  total: number;
  fetchedAt: string;
};

export type ZhidaDecisionPoolResult = {
  jobs: NormalizedZhidaJob[];
  strictProfileJobIds: string[];
  fetchedAt: string;
  sampleLimit: number;
  sampleLimited: boolean;
  querySummaries: Array<{
    label: string;
    total: number;
    returned: number;
  }>;
};

export type ZhidaHistoricalSampleResult = {
  jobs: NormalizedZhidaJob[];
  fetchedAt: string;
  since: string;
  sampleLimit: number;
  sampleLimited: boolean;
};

export type ZhidaJobMarketLayers = {
  keyword: string;
  fullMarketTotal: number;
  stateOwnedTotal: number;
  stateOwnedCampusInternTotal: number;
  strictProfileTotal: number;
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

function normalizePositiveNumber(value: unknown, maximum = 10_000): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum
    ? number
    : null;
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
    jobDescription: normalizeText(job.jobDescription, 12_000),
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
    salaryMin: normalizePositiveNumber(job.salaryMin),
    salaryMax: normalizePositiveNumber(job.salaryMax),
    salaryUnit: normalizeText(job.salaryUnit, 40),
    createdAt: normalizeDate(job.createdAt),
    updatedAt: normalizeDate(job.updatedAt),
  };
}

function buildJobListInput(
  filters: ZhidaJobFilters,
  pageSize: number,
  page = 1,
  options: {
    status?: "active" | "all";
    sortField?: "applyEndDate" | "createdAt" | "viewCount";
    sortOrder?: "asc" | "desc";
  } = {},
): Record<string, unknown> {
  return {
    status: options.status ?? "active",
    page,
    pageSize,
    includeTotal: true,
    sortField: options.sortField ?? "applyEndDate",
    sortOrder: options.sortOrder ?? "asc",
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

function buildMarketCountInput(
  keyword: string,
  scope: {
    companyTypes?: string[];
    jobTypes?: string[];
    educationLevel?: string;
    graduationYear?: string;
  },
): Record<string, unknown> {
  return {
    status: "active",
    page: 1,
    pageSize: 1,
    includeTotal: true,
    sortField: "applyEndDate",
    sortOrder: "asc",
    keyword,
    ...(scope.companyTypes ? { companyTypes: scope.companyTypes } : {}),
    ...(scope.jobTypes ? { jobTypes: scope.jobTypes } : {}),
    ...(scope.educationLevel
      ? { educationLevels: [scope.educationLevel] }
      : {}),
    ...(scope.graduationYear
      ? { graduateYears: [scope.graduationYear] }
      : {}),
  };
}

async function fetchZhidaJobTotal(
  trpcUrl: string,
  input: Record<string, unknown>,
): Promise<number> {
  const endpoint = new URL(`${trpcUrl.replace(/\/$/, "")}/job.list`);
  endpoint.searchParams.set("input", JSON.stringify({ json: input }));
  const response = await fetch(endpoint, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(JOB_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new ZhidaJobsUnavailableError();

  const payload: unknown = await response.json();
  const data = extractTrpcData(payload);
  const total = data?.total;
  if (!Number.isSafeInteger(total) || (total as number) < 0) {
    throw new ZhidaJobsUnavailableError();
  }
  return total as number;
}

/**
 * Read four comparable totals from the main-site catalog. The first three
 * layers use the same literal keyword and only narrow company/recruitment
 * scope. The final layer additionally applies the profile fields that the
 * public catalog can verify directly.
 */
export async function fetchZhidaJobMarketLayers(input: {
  keyword: string;
  educationLevel?: string;
  graduationYear: number;
}): Promise<ZhidaJobMarketLayers> {
  const config = getServerIntegrationConfig();
  if (!config.zhidaTrpcUrl) throw new ZhidaJobsUnavailableError();

  const keyword = input.keyword.trim();
  if (!keyword) throw new ZhidaJobsUnavailableError();
  const stateOwnedScope = { companyTypes: ["央企", "国企"] };
  const campusInternScope = {
    ...stateOwnedScope,
    jobTypes: ["校招", "实习"],
  };

  try {
    const [
      fullMarketTotal,
      stateOwnedTotal,
      stateOwnedCampusInternTotal,
      strictProfileTotal,
    ] = await Promise.all([
      fetchZhidaJobTotal(
        config.zhidaTrpcUrl,
        buildMarketCountInput(keyword, {}),
      ),
      fetchZhidaJobTotal(
        config.zhidaTrpcUrl,
        buildMarketCountInput(keyword, stateOwnedScope),
      ),
      fetchZhidaJobTotal(
        config.zhidaTrpcUrl,
        buildMarketCountInput(keyword, campusInternScope),
      ),
      fetchZhidaJobTotal(
        config.zhidaTrpcUrl,
        buildMarketCountInput(keyword, {
          ...campusInternScope,
          educationLevel: input.educationLevel,
          graduationYear: String(input.graduationYear),
        }),
      ),
    ]);

    return {
      keyword,
      fullMarketTotal,
      stateOwnedTotal,
      stateOwnedCampusInternTotal,
      strictProfileTotal,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ZhidaJobsUnavailableError) throw error;
    throw new ZhidaJobsUnavailableError();
  }
}

function normalizeTotal(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

export async function fetchZhidaJobs(
  filters: ZhidaJobFilters = {},
  options: {
    pageSize?: number;
    page?: number;
    status?: "active" | "all";
    sortField?: "applyEndDate" | "createdAt" | "viewCount";
    sortOrder?: "asc" | "desc";
  } = {},
): Promise<ZhidaJobsResult> {
  const config = getServerIntegrationConfig();
  if (!config.zhidaTrpcUrl) throw new ZhidaJobsUnavailableError();

  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 50));
  const page = Math.max(1, Math.min(1_000, options.page ?? 1));
  const input = buildJobListInput(filters, pageSize, page, options);
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
    ).slice(0, pageSize);

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

function historicalReferenceDate(job: NormalizedZhidaJob): Date | null {
  for (const value of [job.createdAt, job.applyStartDate, job.updatedAt]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Read a bounded recent sample from the main-site catalogue. The public list
 * API has no date-range aggregate, so callers must label this as a sample.
 */
export async function fetchZhidaHistoricalSample(input: {
  keyword: string;
  since: Date | string;
  limit?: number;
}): Promise<ZhidaHistoricalSampleResult> {
  const keyword = input.keyword.trim();
  const since = input.since instanceof Date ? input.since : new Date(input.since);
  if (!keyword || Number.isNaN(since.getTime())) {
    throw new ZhidaJobsUnavailableError();
  }

  const sampleLimit = Math.max(50, Math.min(300, input.limit ?? 300));
  const pageSize = 100;
  const pageCount = Math.ceil(sampleLimit / pageSize);
  const seen = new Set<string>();
  const jobs: NormalizedZhidaJob[] = [];
  let sampleLimited = false;
  let fetchedAt = new Date().toISOString();

  for (let page = 1; page <= pageCount; page += 1) {
    const result = await fetchZhidaJobs(
      { keyword },
      {
        page,
        pageSize,
        status: "all",
        sortField: "createdAt",
        sortOrder: "desc",
      },
    );
    fetchedAt = result.fetchedAt;
    if (result.total > page * pageSize) sampleLimited = true;

    let pageHasRecentRecord = false;
    for (const job of result.jobs) {
      const reference = historicalReferenceDate(job);
      if (!reference || reference.getTime() < since.getTime()) continue;
      pageHasRecentRecord = true;
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
      if (jobs.length >= sampleLimit) break;
    }

    if (
      jobs.length >= sampleLimit
      || result.jobs.length < pageSize
      || !pageHasRecentRecord
    ) {
      break;
    }
  }

  return {
    jobs: jobs.slice(0, sampleLimit),
    fetchedAt,
    since: since.toISOString(),
    sampleLimit,
    sampleLimited,
  };
}

function decisionPoolCompany(value: string): string {
  return value
    .replace(/^(?:Moka|北森|猎聘|智联招聘)\s*/iu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function decisionPoolSemanticKey(job: NormalizedZhidaJob): string {
  return [
    decisionPoolCompany(job.companyName),
    job.jobTitle.replace(/\s+/gu, "").trim(),
    (job.workLocation ?? "").replace(/\s+/gu, "").trim(),
    job.applyEndDate ?? "",
  ].join("|");
}

async function fetchDecisionQueries(
  queries: Array<{ label: string; filters: ZhidaJobFilters }>,
  pageSize: number,
): Promise<Array<{ label: string; result: ZhidaJobsResult }>> {
  const output: Array<{ label: string; result: ZhidaJobsResult }> = [];
  const concurrency = 3;
  for (let index = 0; index < queries.length; index += concurrency) {
    const batch = queries.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map(async (query) => ({
        label: query.label,
        result: await fetchZhidaJobs(query.filters, { pageSize }),
      })),
    );
    output.push(...results);
  }
  return output;
}

/**
 * Build a bounded, read-only decision candidate pool from the continuously
 * updated main-site catalogue. Totals from overlapping keywords are reported
 * separately and are never added together as a fake market total.
 */
export async function fetchZhidaDecisionPool(input: {
  keywords: string[];
  majorCode?: string;
  educationLevel?: string;
  graduationYear?: number;
  limit?: number;
  perQuery?: number;
}): Promise<ZhidaDecisionPoolResult> {
  const keywords = Array.from(new Set(
    input.keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword && keyword.length <= 80),
  )).slice(0, 6);
  const queries: Array<{ label: string; filters: ZhidaJobFilters }> = [];
  const exactKeyword = keywords[0];
  if (
    exactKeyword
    && (input.educationLevel || Number.isSafeInteger(input.graduationYear))
  ) {
    queries.push({
      label: `资料严格匹配 ${exactKeyword}`,
      filters: {
        keyword: exactKeyword,
        educationLevel: input.educationLevel,
        graduationYear: Number.isSafeInteger(input.graduationYear)
          ? String(input.graduationYear)
          : undefined,
      },
    });
  }
  if (input.majorCode && SAFE_MAJOR_CODE.test(input.majorCode)) {
    queries.push({
      label: `专业分类 ${input.majorCode}`,
      filters: { majorCode: input.majorCode },
    });
  }
  for (const keyword of keywords) {
    queries.push({ label: `关键词 ${keyword}`, filters: { keyword } });
  }
  if (queries.length === 0) throw new ZhidaJobsUnavailableError();

  const limit = Math.max(1, Math.min(200, input.limit ?? 200));
  const perQuery = Math.max(1, Math.min(100, input.perQuery ?? 100));
  const results = await fetchDecisionQueries(queries, perQuery);
  const seenIds = new Set<string>();
  const seenSemantic = new Set<string>();
  const jobs: NormalizedZhidaJob[] = [];
  const strictProfileJobIds = new Set<string>();

  for (const { label, result } of results) {
    const strictProfileQuery = label.startsWith("资料严格匹配 ");
    for (const job of result.jobs) {
      const semanticKey = decisionPoolSemanticKey(job);
      if (seenIds.has(job.id) || seenSemantic.has(semanticKey)) continue;
      seenIds.add(job.id);
      seenSemantic.add(semanticKey);
      jobs.push(job);
      if (strictProfileQuery) strictProfileJobIds.add(job.id);
    }
  }

  const fetchedAt = results
    .map(({ result }) => result.fetchedAt)
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
    jobs: jobs.slice(0, limit),
    strictProfileJobIds: jobs
      .slice(0, limit)
      .map((job) => job.id)
      .filter((id) => strictProfileJobIds.has(id)),
    fetchedAt,
    sampleLimit: limit,
    sampleLimited: jobs.length > limit || results.some(
      ({ result }) => result.total > result.jobs.length,
    ),
    querySummaries: results.map(({ label, result }) => ({
      label,
      total: result.total,
      returned: result.jobs.length,
    })),
  };
}

export async function isZhidaJobsLive(): Promise<boolean> {
  try {
    await fetchZhidaJobs({}, { pageSize: 1 });
    return true;
  } catch {
    return false;
  }
}
