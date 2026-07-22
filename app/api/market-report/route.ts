import {
  buildMarketReport,
  inferMarketReportMajorCode,
  marketReportDegreeForApi,
  marketReportKeywords,
  type MarketReportProfile,
} from "../../../lib/career/market-report.ts";
import {
  fetchZhidaDecisionPool,
  fetchZhidaHistoricalSample,
  fetchZhidaJobMarketLayers,
  ZhidaJobsUnavailableError,
} from "../../../lib/server/zhida-jobs.ts";
import type {
  CapabilityKey,
  CapabilityLevel,
  DegreeLevel,
} from "../../../lib/career/types.ts";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const DEGREE_LEVELS = new Set<DegreeLevel>([
  "secondary",
  "vocational",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "unknown",
]);
const CAPABILITY_LEVELS = new Set<CapabilityLevel>([
  "missing",
  "developing",
  "ready",
]);
const CAPABILITY_KEYS = new Set<CapabilityKey>([
  "resume",
  "application",
  "interview",
  "target_research",
  "project_evidence",
  "qualification",
  "internship",
  "competition",
  "academic",
]);

class InvalidProfileError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidProfileError();
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new InvalidProfileError();
  const text = value.trim();
  if (
    !text
    || text.length > maxLength
    || /[\u0000-\u001F\u007F]/u.test(text)
  ) {
    throw new InvalidProfileError();
  }
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, maxLength);
}

function readCapabilities(
  value: unknown,
): MarketReportProfile["capabilityLevels"] {
  if (value === undefined || value === null) return undefined;
  const input = asRecord(value);
  const result: Partial<Record<CapabilityKey, CapabilityLevel>> = {};
  for (const [key, level] of Object.entries(input)) {
    if (
      CAPABILITY_KEYS.has(key as CapabilityKey)
      && typeof level === "string"
      && CAPABILITY_LEVELS.has(level as CapabilityLevel)
    ) {
      result[key as CapabilityKey] = level as CapabilityLevel;
    }
  }
  return result;
}

function parseProfile(value: unknown): MarketReportProfile {
  const input = asRecord(value);
  if (
    typeof input.degreeLevel !== "string"
    || !DEGREE_LEVELS.has(input.degreeLevel as DegreeLevel)
    || typeof input.graduationYear !== "number"
    || !Number.isSafeInteger(input.graduationYear)
    || input.graduationYear < 2020
    || input.graduationYear > 2040
  ) {
    throw new InvalidProfileError();
  }

  const hours = input.availableHoursPerWeek;
  if (
    hours !== undefined
    && (
      typeof hours !== "number"
      || !Number.isFinite(hours)
      || hours < 0
      || hours > 168
    )
  ) {
    throw new InvalidProfileError();
  }

  return {
    degreeLevel: input.degreeLevel as DegreeLevel,
    school: optionalText(input.school, 100),
    major: requiredText(input.major, 80),
    graduationYear: input.graduationYear,
    schoolTier: optionalText(input.schoolTier, 40),
    city: optionalText(input.city, 80),
    preferredCities: optionalText(input.preferredCities, 120),
    availableHoursPerWeek: typeof hours === "number" ? hours : undefined,
    capabilityLevels: readCapabilities(input.capabilityLevels),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload: unknown = await request.json();
    const profile = parseProfile(asRecord(payload).profile);
    const educationLevel = marketReportDegreeForApi(profile.degreeLevel);
    const keywords = marketReportKeywords(profile.major);
    const reportNow = new Date();
    const historySince = new Date(reportNow);
    historySince.setUTCFullYear(historySince.getUTCFullYear() - 1);
    const [pool, marketLayers, historicalSample] = await Promise.all([
      fetchZhidaDecisionPool({
        keywords,
        majorCode: inferMarketReportMajorCode(profile.major),
        educationLevel,
        graduationYear: profile.graduationYear,
        limit: 200,
        perQuery: 100,
      }),
      fetchZhidaJobMarketLayers({
        keyword: profile.major,
        educationLevel,
        graduationYear: profile.graduationYear,
      }),
      fetchZhidaHistoricalSample({
        keyword: profile.major,
        since: historySince,
        limit: 300,
      }),
    ]);

    const report = buildMarketReport({
      profile,
      targetedJobs: pool.jobs.map((job) => ({
        id: job.id,
        companyName: job.companyName,
        jobTitle: job.jobTitle,
        jobDescription: job.jobDescription,
        workLocation: job.workLocation,
        applyEndDate: job.applyEndDate,
        applyStartDate: job.applyStartDate,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        source: job.source,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryUnit: job.salaryUnit,
        companyType: job.companyType,
        jobType: job.jobType,
        educationLevel: job.educationLevel,
        graduationYear: job.graduateYear,
        majorRequirements: job.majorRequirements,
        majorCategoryIds: job.majorCategoryIds,
      })),
      targetedTotal: pool.jobs.length,
      broadTotal: Math.max(
        marketLayers.stateOwnedCampusInternTotal,
        ...pool.querySummaries.map((summary) => summary.total),
      ),
      fetchedAt: pool.fetchedAt,
      queryMode: "main-site-decision",
      candidatePool: {
        queryLabels: pool.querySummaries.map((summary) => summary.label),
        sampleLimit: pool.sampleLimit,
        sampleLimited: pool.sampleLimited,
      },
      historicalSample: {
        jobs: historicalSample.jobs.map((job) => ({
          id: job.id,
          companyName: job.companyName,
          jobTitle: job.jobTitle,
          jobDescription: job.jobDescription,
          workLocation: job.workLocation,
          applyEndDate: job.applyEndDate,
          applyStartDate: job.applyStartDate,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          source: job.source,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryUnit: job.salaryUnit,
          companyType: job.companyType,
          jobType: job.jobType,
          educationLevel: job.educationLevel,
          graduationYear: job.graduateYear,
          majorRequirements: job.majorRequirements,
          majorCategoryIds: job.majorCategoryIds,
        })),
        fetchedAt: historicalSample.fetchedAt,
        since: historicalSample.since,
        sampleLimit: historicalSample.sampleLimit,
        sampleLimited: historicalSample.sampleLimited,
      },
      marketLayers,
      now: reportNow,
    });

    return Response.json(report, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (
      error instanceof InvalidProfileError
      || error instanceof SyntaxError
    ) {
      return Response.json(
        {
          error: {
            code: "INVALID_PROFILE",
            message: "生成报告所需的档案字段格式不正确。",
            retryable: false,
          },
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const unavailable = error instanceof ZhidaJobsUnavailableError
      ? error
      : new ZhidaJobsUnavailableError();
    return Response.json(
      {
        error: {
          code: unavailable.code,
          message: unavailable.message,
          retryable: true,
        },
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
