import type {
  CapabilityRequirement,
  DegreeLevel,
  DegreeRequirement,
  EvidenceSource,
  GraduationYearRequirement,
  JobOpening,
  MajorRequirement,
} from "./types.ts";

/** The flat job object returned by GET /api/jobs. */
export interface LiveJobInput {
  id: string;
  companyName: string;
  companyType?: "央企" | "国企" | string;
  jobTitle: string;
  jobType?: "校招" | "实习" | string;
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
  status?: string | null;
}

export interface ConvertLiveJobOptions {
  now?: Date | string;
}

const ALL_DEGREES: DegreeLevel[] = [
  "secondary",
  "vocational",
  "associate",
  "bachelor",
  "master",
  "doctorate",
];

const DEGREE_TOKEN = new Map<string, DegreeLevel>([
  ["高中", "secondary"],
  ["中专", "secondary"],
  ["高职", "vocational"],
  ["专科", "associate"],
  ["大专", "associate"],
  ["本科", "bachelor"],
  ["大学本科", "bachelor"],
  ["学士", "bachelor"],
  ["硕士", "master"],
  ["硕士研究生", "master"],
  ["博士", "doctorate"],
  ["博士研究生", "doctorate"],
]);

/**
 * Four-digit prefixes follow the major category catalogue used by the source
 * system. Only categories understood by the deterministic major matcher are
 * mapped here; unknown taxonomies are deliberately ignored.
 */
const MAJOR_CODE_PREFIX = new Map<string, string>([
  ["0201", "经济学类"],
  ["0203", "金融学类"],
  ["0301", "法学类"],
  ["0501", "中国语言文学类"],
  ["0806", "电气类"],
  ["0807", "电子信息类"],
  ["0808", "自动化类"],
  ["0809", "计算机类"],
  ["1202", "工商管理类"],
]);

const MAJOR_TEXT_ALIAS = new Map<string, string>([
  ["计算机", "计算机类"],
  ["计算机类", "计算机类"],
  ["计算机科学与技术", "计算机科学与技术"],
  ["软件工程", "软件工程"],
  ["网络工程", "网络工程"],
  ["信息安全", "信息安全"],
  ["物联网工程", "物联网工程"],
  ["数据科学与大数据技术", "数据科学与大数据技术"],
  ["人工智能", "人工智能"],
  ["电子信息类", "电子信息类"],
  ["电子信息工程", "电子信息工程"],
  ["通信工程", "通信工程"],
  ["电气类", "电气类"],
  ["电气工程及其自动化", "电气工程及其自动化"],
  ["自动化类", "自动化类"],
  ["自动化", "自动化"],
  ["经济学类", "经济学类"],
  ["金融学类", "金融学类"],
  ["工商管理类", "工商管理类"],
  ["法学类", "法学类"],
  ["中国语言文学类", "中国语言文学类"],
]);

const CAPABILITY_REQUIREMENTS = (
  company: string,
  title: string,
): CapabilityRequirement[] => [
  {
    key: "resume",
    label: "基础简历",
    shareable: true,
    priority: "high",
    completionCriteria: "完成一份结构完整、项目结果可量化的基础简历。",
  },
  {
    key: "project_evidence",
    label: "项目结果证据",
    shareable: true,
    priority: "high",
    completionCriteria: "至少两段经历包含任务、行动、结果与可核验数据。",
  },
  {
    key: "application",
    label: `${company}网申材料包`,
    shareable: false,
    priority: "high",
    completionCriteria: `完成${title}要求的字段、附件和自我陈述草稿。`,
  },
  {
    key: "interview",
    label: `${company}${title}面试训练`,
    shareable: false,
    priority: "medium",
    completionCriteria: "完成一次目标化模拟面试，并记录可执行的改进项。",
  },
];

function cleanRequiredText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function validHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isoDay(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function evidenceFor(input: LiveJobInput, id: string, company: string, title: string): EvidenceSource {
  const url = validHttpUrl(input.announcementUrl) ?? validHttpUrl(input.applyUrl);
  const details = [
    input.educationLevel ? `学历：${input.educationLevel}` : undefined,
    input.graduateYear ? `届别：${input.graduateYear}` : undefined,
    input.majorRequirements ? `专业：${input.majorRequirements}` : undefined,
    input.applyEndDate ? `截止：${input.applyEndDate}` : undefined,
  ].filter(Boolean);

  return {
    id,
    title: `${company} · ${title}${input.source ? ` · ${input.source}` : ""}`,
    sourceType: "live_job_record",
    ...(url ? { url } : {}),
    ...(details.length > 0 ? { excerpt: details.join("；").slice(0, 1_000) } : {}),
    ...(isoDay(input.updatedAt) ? { retrievedAt: input.updatedAt ?? undefined } : {}),
  };
}

export function parseLiveDegreeRequirement(
  value: string | null | undefined,
  evidenceIds: string[],
): DegreeRequirement | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, "").replace(/^学历(?:要求)?[:：]?/u, "");
  if (["不限", "不限学历", "学历不限"].includes(normalized)) {
    return { accepted: ALL_DEGREES, evidenceIds };
  }

  const minimumMatch = /^(高中|中专|高职|专科|大专|本科|大学本科|学士|硕士|硕士研究生|博士|博士研究生)及以上(?:学历)?$/u.exec(
    normalized,
  );
  if (minimumMatch) {
    const minimum = DEGREE_TOKEN.get(minimumMatch[1]);
    return minimum ? { minimum, evidenceIds } : undefined;
  }

  const withoutSuffix = normalized.replace(/学历$/u, "");
  const tokens = withoutSuffix.split(/[、,，/]|(?:或)|(?:和)/u);
  if (tokens.length === 0 || tokens.some((token) => !token)) return undefined;
  const accepted = tokens.map((token) => DEGREE_TOKEN.get(token));
  if (accepted.some((degree) => !degree)) return undefined;

  if (accepted.length === 1) {
    return { minimum: accepted[0] as DegreeLevel, evidenceIds };
  }

  return { accepted: [...new Set(accepted as DegreeLevel[])], evidenceIds };
}

export function parseLiveGraduationYearRequirement(
  value: string | null | undefined,
  evidenceIds: string[],
): GraduationYearRequirement | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/(?:高校)?(?:应届)?毕业生$/u, "")
    .replace(/应届生$/u, "");

  if (!/^(?:20\d{2}(?:年)?(?:届)?)(?:[、,，/]|(?:或)|(?:和))(?:20\d{2}(?:年)?(?:届)?)(?:(?:[、,，/]|(?:或)|(?:和))(?:20\d{2}(?:年)?(?:届)?))*$|^20\d{2}(?:年)?(?:届)?$/u.test(normalized)) {
    return undefined;
  }

  const years = [...normalized.matchAll(/20\d{2}/g)].map((match) => Number(match[0]));
  return years.length > 0 ? { acceptedYears: [...new Set(years)], evidenceIds } : undefined;
}

function majorFromText(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = value
    .trim()
    .replace(/^专业(?:要求)?[:：]?/u, "")
    .replace(/(?:等)?相关专业$/u, "")
    .replace(/专业$/u, "");

  if (["不限", "专业不限", "不限专业"].includes(normalized)) return ["不限"];
  if (!normalized || /优先|建议|包括但不限于/u.test(normalized)) return [];

  const tokens = normalized.split(/[、,，/；;]|(?:或)|(?:和)/u).map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => !token)) return [];
  const mapped = tokens.map((token) => MAJOR_TEXT_ALIAS.get(token));
  return mapped.some((major) => !major) ? [] : [...new Set(mapped as string[])];
}

export function parseLiveMajorRequirement(
  majorCategoryIds: string[] | null | undefined,
  majorRequirements: string | null | undefined,
  evidenceIds: string[],
): MajorRequirement | undefined {
  const safeCodes = Array.isArray(majorCategoryIds) && majorCategoryIds.length <= 30
    ? majorCategoryIds
    : [];
  const fromCodes = safeCodes
    .filter((code) => /^\d{4}(?:\d{2})?$/u.test(code))
    .map((code) => MAJOR_CODE_PREFIX.get(code.slice(0, 4)))
    .filter((major): major is string => Boolean(major));
  const fromText = majorFromText(majorRequirements);
  const accepted = [...new Set([...fromCodes, ...fromText])];
  return accepted.length > 0 ? { accepted, evidenceIds } : undefined;
}

function liveStatus(input: LiveJobInput, now: Date | string | undefined): JobOpening["status"] {
  const today = isoDay(now ?? new Date());
  const start = isoDay(input.applyStartDate);
  const end = isoDay(input.applyEndDate);
  const upstream = input.status?.trim().toLowerCase();

  if (end && today && end < today) return "closed";
  if (upstream && ["closed", "inactive", "已截止", "已结束", "结束"].includes(upstream)) {
    return "closed";
  }
  if (start && today && start > today) return "unknown";
  if (upstream && ["open", "active", "招聘中", "报名中"].includes(upstream)) return "open";
  if (end && today && end >= today) return "open";
  return "unknown";
}

/**
 * Converts one normalized /api/jobs record without inventing missing rules.
 * Invalid required identity fields return null; unparseable requirements are
 * omitted so evaluateEligibility reports unknown.
 */
export function convertLiveJobToOpening(
  input: LiveJobInput,
  options: ConvertLiveJobOptions = {},
): JobOpening | null {
  const id = cleanRequiredText(input.id);
  const company = cleanRequiredText(input.companyName);
  const title = cleanRequiredText(input.jobTitle);
  if (!id || !company || !title) return null;

  const evidenceId = `live-job:${id}:record`;
  const evidence = evidenceFor(input, evidenceId, company, title);
  const degree = parseLiveDegreeRequirement(input.educationLevel, [evidenceId]);
  const graduationYear = parseLiveGraduationYearRequirement(input.graduateYear, [evidenceId]);
  const major = parseLiveMajorRequirement(
    input.majorCategoryIds,
    input.majorRequirements,
    [evidenceId],
  );
  const deadline = isoDay(input.applyEndDate);

  return {
    id,
    company,
    title,
    ...(cleanRequiredText(input.workLocation) ? { location: input.workLocation!.trim() } : {}),
    status: liveStatus(input, options.now),
    dataMode: "live",
    hardRequirements: {
      ...(degree ? { degree } : {}),
      ...(major ? { major } : {}),
      ...(graduationYear ? { graduationYear } : {}),
      ...(deadline ? { deadline: { date: deadline, evidenceIds: [evidenceId] } } : {}),
    },
    capabilityRequirements: CAPABILITY_REQUIREMENTS(company, title),
    riskFlags: [],
    evidence: [evidence],
  };
}

export function convertLiveJobsToOpenings(
  inputs: LiveJobInput[],
  options: ConvertLiveJobOptions = {},
): JobOpening[] {
  return inputs
    .map((input) => convertLiveJobToOpening(input, options))
    .filter((job): job is JobOpening => job !== null);
}
