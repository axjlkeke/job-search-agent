"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowRight,
  Buildings,
  CalendarDots,
  ChartLineUp,
  ChatsCircle,
  Check,
  CheckSquare,
  Compass,
  Database,
  Plus,
  Strategy,
  Target,
  UserFocus,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  buildDecisionSystemSnapshot,
  buildStrategyNetwork,
  dedupeMarketReportCandidates,
  convertLiveJobToOpening,
  convertLiveJobsToOpenings,
  evaluateEligibility,
  eligibilityFromIntelligenceDecision,
  intelligenceProfileForDecision,
  isIntelligenceDecisionResponse,
  officialVerificationSummaryFromIntelligenceDecision,
  verifiedOfficialEvidenceFromIntelligenceDecision,
  type CapabilityLevel,
  type DecisionSystemSnapshot,
  type DegreeLevel,
  type EligibilityResult,
  type IntelligenceDecisionResponse,
  type LiveJobInput,
  type MarketReportCandidate,
  type MarketReportResult,
  type ProductCategory,
  type ProductOffering,
  type StrategyNetwork,
  type StrategyTask,
  type StudentProfile,
} from "@/lib/career";
import styles from "./career-strategy.module.css";
import { RoutePlannerView } from "./RoutePlannerView";
import { VisualAsset as ImageInsertMarker } from "./VisualAsset";

const AdvisorThread = dynamic(
  () => import("./AdvisorThread").then((module) => module.AdvisorThread),
  { ssr: false },
);

type ViewId =
  | "overview"
  | "profile"
  | "report"
  | "directions"
  | "roadmap"
  | "jobs"
  | "strategy"
  | "tasks"
  | "advisor";
type WorkspaceVariant = "classic" | "studio";
type AdvisorEntryContext =
  | "report-explain"
  | "direction-selected"
  | "route-action"
  | null;

type CareerProfile = StudentProfile & {
  name: string;
  school: string;
  schoolTier: string;
  degreeLevel: DegreeLevel;
  major: string;
  graduationYear: number;
  city: string;
  preferredCities: string;
  targetSector: string;
  availableHoursPerWeek: number;
};

type ProfileDraft = {
  name: string;
  school: string;
  schoolTier: string;
  degreeLevel: DegreeLevel;
  major: string;
  graduationYear: string;
  city: string;
  preferredCities: string;
  targetSector: string;
  availableHoursPerWeek: string;
  resume: CapabilityLevel;
  application: CapabilityLevel;
  interview: CapabilityLevel;
  projectEvidence: CapabilityLevel;
  internship: CapabilityLevel;
  competition: CapabilityLevel;
};

type LiveJob = LiveJobInput & {
  companyType: "央企" | "国企";
  jobType: "校招" | "实习";
};

type LiveProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  grantLevel: "normal" | "vip" | "svip";
  monthlyPrice: string | null;
  quarterlyPrice: string | null;
  yearlyPrice: string | null;
  lifetimePrice: string | null;
  features: Array<{ title: string; description: string | null }>;
  highlights: string[];
  isRecommended: boolean;
  purchaseUrl: string;
};

type SystemStatus = {
  zhidaLive: boolean;
  intelligenceLive?: boolean;
  intelligenceCounts?: {
    enterprises?: number;
    schools?: number;
    jobMappings?: number;
    currentJobSnapshots?: number;
    officialEvidenceSnapshots?: number;
    verifiedOfficialJobPages?: number;
  } | null;
  ragConfigured: boolean;
  difyConfigured: boolean;
  aiConfigured?: boolean;
  advisorProtected: boolean;
  advisorAccessEnabled: boolean;
  zhidaBridgeConfigured?: boolean;
};

type BridgeProfile = {
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

type BridgeEntitlement = {
  code: string;
  name: string;
  category: ProductCategory;
  routePath: string;
  dailyLimit: number | null;
};

type BridgeSessionStatus = {
  configured: boolean;
  connected: boolean;
  connectedAt?: number;
  expiresAt?: number;
  profile?: BridgeProfile | null;
  entitlements?: BridgeEntitlement[];
  membership?: {
    effectiveTier: string;
    status: "active" | "expired" | "inactive" | "none";
    expiresAt: string | null;
  };
};

type IntelligenceDecisionEntry = {
  profileKey: string;
} & (
  | { status: "loading" }
  | { status: "ready"; decision: IntelligenceDecisionResponse }
  | {
    status: "unavailable";
    reason: "not-covered" | "service-unavailable" | "invalid-response";
  }
);

type AdvisorCitation = {
  id: string;
  title: string;
  snippet: string;
  url: string | null;
  publishedAt: string | null;
};

type AdvisorMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: AdvisorCitation[];
};

type StoredWorkspace = {
  version: 1;
  savedAt: number;
  pathSavedAt: number;
  profile: CareerProfile | null;
  selectedCareerTrackId: string | null;
  selectedCareerSubtrackId: string | null;
  selectedDirectionId: string | null;
  selectedJobs: LiveJob[];
  completedTaskIds: string[];
};

type RemoteWorkspaceState = {
  selectedJobs: LiveJob[];
  completedTaskIds: string[];
};

type WorkspaceSyncStatus = {
  configured: boolean;
  connected: boolean;
  persistence: boolean;
  revision: number;
  updatedAt: number | null;
  state: RemoteWorkspaceState | null;
};

const STORAGE_KEY = "job-agent-workspace-v1";
const STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const NAV_ITEMS: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: "profile", label: "学生档案", mark: "01" },
  { id: "jobs", label: "在招岗位", mark: "02" },
  { id: "strategy", label: "策略网络", mark: "03" },
  { id: "tasks", label: "七日行动", mark: "04" },
  { id: "advisor", label: "AI 顾问", mark: "05" },
];

const FOCUSED_NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  icon: Icon;
}> = [
  { id: "advisor", label: "对话", icon: ChatsCircle },
  { id: "report", label: "求职报告", icon: ChartLineUp },
  { id: "profile", label: "个人资料", icon: UserFocus },
];

type CareerTrackOption = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  dataStatus: "live" | "pending";
  subtracks: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

type SelectedCareerPathSummary = {
  label: string;
  trackLabel: string;
  subtrackLabel: string;
  dataStatus: "live" | "pending";
  candidate: MarketReportCandidate | null;
};

function marketCandidateToLiveJob(
  candidate: MarketReportCandidate,
): LiveJob | null {
  if (
    (candidate.companyType !== "央企" && candidate.companyType !== "国企")
    || (candidate.jobType !== "校招" && candidate.jobType !== "实习")
  ) {
    return null;
  }

  return {
    id: candidate.id,
    companyName: candidate.companyName,
    companyType: candidate.companyType,
    jobTitle: candidate.jobTitle,
    jobType: candidate.jobType,
    educationLevel: candidate.educationLevel,
    graduateYear: candidate.graduationYear ?? null,
    workLocation: candidate.workLocation,
    majorRequirements: candidate.majorRequirements,
    majorCategoryIds: candidate.majorCategoryIds ?? [],
    applyStartDate: candidate.applyStartDate ?? null,
    applyEndDate: candidate.applyEndDate,
    announcementUrl: null,
    applyUrl: null,
    source: candidate.source,
    updatedAt: candidate.updatedAt ?? null,
    status: "active",
  };
}

const CAREER_TRACKS: CareerTrackOption[] = [
  {
    id: "civil-service",
    label: "公务员",
    shortLabel: "公考体系",
    description: "通过招录考试进入党政机关，先确定选调、国考或省考通道。",
    dataStatus: "pending",
    subtracks: [
      { id: "selected-graduate", label: "选调生", description: "面向符合学校、党员、学生干部等条件的应届毕业生。" },
      { id: "national-civil-service", label: "国考", description: "中央机关及其直属机构年度招录。" },
      { id: "provincial-civil-service", label: "省考", description: "各省、市、区县党政机关招录。" },
    ],
  },
  {
    id: "state-owned",
    label: "央国企",
    shortLabel: "国有企业",
    description: "进入中央企业或地方国企，第二层按企业所属行业收窄。",
    dataStatus: "live",
    subtracks: [
      { id: "power-grid", label: "电力与电网", description: "电网、发电、核电及电力服务企业。" },
      { id: "energy-chemical", label: "能源与化工", description: "石油、石化、煤炭、燃气、新能源与矿业。" },
      { id: "finance", label: "金融", description: "银行、保险、证券、信托与资产管理。" },
      { id: "tobacco", label: "烟草", description: "烟草专卖、卷烟工业及相关单位。" },
      { id: "construction-infrastructure", label: "建筑与基建", description: "建筑、工程、设计院及基础设施建设。" },
      { id: "communications-technology", label: "通信与科技", description: "通信运营、铁塔、电子与数字科技。" },
      { id: "transport-logistics", label: "交通与物流", description: "铁路、机场、航空、港口、交通与物流。" },
      { id: "defense-manufacturing", label: "军工与制造", description: "航天、航空工业、兵器、船舶及装备制造。" },
      { id: "culture-tourism-service", label: "文旅与服务", description: "酒店、文旅、会展、商业运营与客户服务。" },
      { id: "state-owned-other", label: "综合及其他", description: "当前公开文本尚不能稳定归入上述行业。" },
    ],
  },
  {
    id: "public-institution",
    label: "事业单位",
    shortLabel: "事业编",
    description: "进入事业单位，第二层同时考虑招考类别和岗位专业属性。",
    dataStatus: "pending",
    subtracks: [
      { id: "joint-a", label: "联考 A 类", description: "综合管理类岗位。" },
      { id: "joint-b", label: "联考 B 类", description: "社会科学专技类岗位。" },
      { id: "joint-c", label: "联考 C 类", description: "自然科学专技类岗位。" },
      { id: "teacher-recruitment", label: "教师招聘 / D 类", description: "中小学教师及教育系统招聘。" },
      { id: "healthcare-recruitment", label: "医疗卫生 / E 类", description: "医疗卫生专业技术岗位。" },
      { id: "provincial-unified", label: "省统考 / 单招", description: "非全国联考的地方统考或单位单独招聘。" },
    ],
  },
  {
    id: "private-enterprise",
    label: "民营企业",
    shortLabel: "私企",
    description: "按行业和商业模式选择企业，再进入真实岗位匹配。",
    dataStatus: "pending",
    subtracks: [
      { id: "internet-technology", label: "互联网与科技", description: "互联网平台、软件、人工智能与数字服务。" },
      { id: "private-finance", label: "金融", description: "银行科技、证券、保险、资管及金融服务。" },
      { id: "private-healthcare", label: "医疗健康", description: "医药、医疗器械、医疗服务与健康科技。" },
      { id: "advanced-manufacturing", label: "先进制造", description: "汽车、电子、机械、新能源与工业制造。" },
      { id: "consumer-retail", label: "消费与零售", description: "消费品、零售、电商、餐饮和生活服务。" },
      { id: "professional-services", label: "咨询与专业服务", description: "咨询、法律、财税、人力和企业服务。" },
    ],
  },
  {
    id: "foreign-enterprise",
    label: "外资企业",
    shortLabel: "外企",
    description: "先按在华业务行业收窄，再匹配职能和具体岗位。",
    dataStatus: "pending",
    subtracks: [
      { id: "foreign-manufacturing", label: "制造与工业", description: "汽车、工业设备、电子与供应链制造。" },
      { id: "foreign-healthcare", label: "医疗与医药", description: "制药、医疗器械与生命科学。" },
      { id: "foreign-consulting", label: "咨询", description: "管理、战略、审计、技术与专业咨询。" },
      { id: "foreign-finance", label: "金融", description: "银行、保险、资管及金融服务。" },
      { id: "foreign-consumer", label: "消费品与零售", description: "快消、奢侈品、零售与品牌业务。" },
      { id: "foreign-technology", label: "科技", description: "软件、云服务、半导体与数字业务。" },
    ],
  },
];

const DEGREE_OPTIONS: Array<{ value: DegreeLevel; label: string }> = [
  { value: "vocational", label: "高职" },
  { value: "associate", label: "专科" },
  { value: "bachelor", label: "本科" },
  { value: "master", label: "硕士" },
  { value: "doctorate", label: "博士" },
];

const CAPABILITY_OPTIONS: Array<{ value: CapabilityLevel; label: string }> = [
  { value: "missing", label: "尚未开始" },
  { value: "developing", label: "已有基础" },
  { value: "ready", label: "可直接使用" },
];

const ELIGIBILITY_COPY: Record<
  EligibilityResult["status"],
  { label: string; detail: string }
> = {
  eligible: { label: "当前可投", detail: "已提供的硬门槛均通过" },
  conditional: { label: "需要确认", detail: "存在相关专业等待人工确认项" },
  high_risk: { label: "可投但高风险", detail: "硬门槛通过，仍有明确风险" },
  not_eligible_current_batch: {
    label: "本批次不满足",
    detail: "长期路径保留，但不能包装成当前可投",
  },
  unknown: { label: "资料待核验", detail: "岗位信息不足，暂不作资格结论" },
};

function emptyDraft(): ProfileDraft {
  return {
    name: "",
    school: "",
    schoolTier: "普通本科",
    degreeLevel: "bachelor",
    major: "",
    graduationYear: String(new Date().getFullYear() + 1),
    city: "",
    preferredCities: "",
    targetSector: "央企 / 国企校招",
    availableHoursPerWeek: "10",
    resume: "missing",
    application: "missing",
    interview: "missing",
    projectEvidence: "missing",
    internship: "missing",
    competition: "missing",
  };
}

function draftFromProfile(profile: CareerProfile): ProfileDraft {
  return {
    name: profile.name,
    school: profile.school,
    schoolTier: profile.schoolTier,
    degreeLevel: profile.degreeLevel,
    major: profile.major,
    graduationYear: String(profile.graduationYear),
    city: profile.city,
    preferredCities: profile.preferredCities,
    targetSector: profile.targetSector,
    availableHoursPerWeek: String(profile.availableHoursPerWeek),
    resume: profile.capabilityLevels?.resume ?? "missing",
    application: profile.capabilityLevels?.application ?? "missing",
    interview: profile.capabilityLevels?.interview ?? "missing",
    projectEvidence: profile.capabilityLevels?.project_evidence ?? "missing",
    internship: profile.capabilityLevels?.internship ?? "missing",
    competition: profile.capabilityLevels?.competition ?? "missing",
  };
}

function isLiveJob(value: unknown): value is LiveJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<LiveJob>;
  return Boolean(job.id && job.companyName && job.jobTitle);
}

function isCareerProfile(value: unknown): value is CareerProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CareerProfile>;
  const requiredText = [
    candidate.id,
    candidate.name,
    candidate.school,
    candidate.schoolTier,
    candidate.major,
    candidate.city,
    candidate.preferredCities,
    candidate.targetSector,
  ];
  return Boolean(
    requiredText.every((item) => typeof item === "string") &&
      candidate.id?.trim() &&
      candidate.name?.trim() &&
      candidate.school?.trim() &&
      candidate.major?.trim() &&
      DEGREE_OPTIONS.some((option) => option.value === candidate.degreeLevel) &&
      Number.isInteger(candidate.graduationYear) &&
      Number.isFinite(candidate.availableHoursPerWeek) &&
      (candidate.availableHoursPerWeek ?? 0) >= 1 &&
      (candidate.availableHoursPerWeek ?? 0) <= 80,
  );
}

function readStoredWorkspace(): StoredWorkspace | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const stored = parsed as Partial<StoredWorkspace>;
    if (stored.version !== 1) return null;
    const now = Date.now();
    const savedAt =
      typeof stored.savedAt === "number" && Number.isFinite(stored.savedAt)
        ? stored.savedAt
        : now;
    if (savedAt > now + 5 * 60 * 1_000 || now - savedAt > STORAGE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const hasLegacyPathData =
      (Array.isArray(stored.selectedJobs) && stored.selectedJobs.length > 0) ||
      (Array.isArray(stored.completedTaskIds) &&
        stored.completedTaskIds.length > 0);
    const pathSavedAt =
      typeof stored.pathSavedAt === "number" &&
      Number.isFinite(stored.pathSavedAt) &&
      stored.pathSavedAt >= 0 &&
      stored.pathSavedAt <= now + 5 * 60 * 1_000
        ? stored.pathSavedAt
        : hasLegacyPathData
          ? savedAt
          : 0;
    const profile = isCareerProfile(stored.profile) ? stored.profile : null;
    return {
      version: 1,
      savedAt,
      pathSavedAt,
      profile,
      selectedCareerTrackId:
        profile
        && typeof stored.selectedCareerTrackId === "string"
        && CAREER_TRACKS.some((track) => track.id === stored.selectedCareerTrackId)
          ? stored.selectedCareerTrackId
          : null,
      selectedCareerSubtrackId:
        profile
        && typeof stored.selectedCareerTrackId === "string"
        && typeof stored.selectedCareerSubtrackId === "string"
        && CAREER_TRACKS.some((track) =>
          track.id === stored.selectedCareerTrackId
          && track.subtracks.some((subtrack) =>
            subtrack.id === stored.selectedCareerSubtrackId),
        )
          ? stored.selectedCareerSubtrackId
          : null,
      selectedDirectionId:
        profile
        && typeof stored.selectedDirectionId === "string"
        && /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}:._/+~-]{0,159}$/u.test(stored.selectedDirectionId)
          ? stored.selectedDirectionId
          : null,
      selectedJobs: profile && Array.isArray(stored.selectedJobs)
        ? stored.selectedJobs.filter(isLiveJob).slice(0, 3)
        : [],
      completedTaskIds: Array.isArray(stored.completedTaskIds)
        ? stored.completedTaskIds.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function remoteWorkspaceState(
  selectedJobs: LiveJob[],
  completedTaskIds: string[],
): RemoteWorkspaceState {
  return {
    selectedJobs: selectedJobs.filter(isLiveJob).slice(0, 3),
    completedTaskIds: completedTaskIds
      .filter((item) =>
        /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}:._/+~-]{0,159}$/u.test(
          item,
        ),
      )
      .slice(0, 200),
  };
}

function remoteWorkspaceKey(state: RemoteWorkspaceState): string {
  return JSON.stringify(state);
}

function parseWorkspaceSyncStatus(value: unknown): WorkspaceSyncStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const revision =
    typeof input.revision === "number" &&
    Number.isSafeInteger(input.revision) &&
    input.revision >= 0
      ? input.revision
      : 0;
  const updatedAt =
    typeof input.updatedAt === "number" &&
    Number.isSafeInteger(input.updatedAt) &&
    input.updatedAt > 0
      ? input.updatedAt
      : null;
  const rawState =
    input.state && typeof input.state === "object" && !Array.isArray(input.state)
      ? input.state as Partial<RemoteWorkspaceState>
      : null;
  const state = rawState
    ? remoteWorkspaceState(
        Array.isArray(rawState.selectedJobs)
          ? rawState.selectedJobs.filter(isLiveJob)
          : [],
        Array.isArray(rawState.completedTaskIds)
          ? rawState.completedTaskIds.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      )
    : null;
  return {
    configured: input.configured === true,
    connected: input.connected === true,
    persistence: input.persistence === true,
    revision,
    updatedAt,
    state,
  };
}

function inferMajorCode(major: string): string | undefined {
  const rules: Array<[RegExp, string]> = [
    [/计算机|软件|人工智能|数据科学|网络工程|信息安全/, "0809"],
    [/电子信息|通信工程|微电子/, "0807"],
    [/电气工程|智能电网/, "0806"],
    [/自动化|机器人工程/, "0808"],
    [/经济学|经济统计/, "0201"],
    [/金融|投资|保险/, "0203"],
    [/工商管理|会计|财务管理|人力资源|审计/, "1202"],
    [/法学|法律|知识产权/, "0301"],
    [/汉语言|中文|秘书学/, "0501"],
  ];
  return rules.find(([pattern]) => pattern.test(major))?.[1];
}

function degreeForApi(degree: DegreeLevel): string | undefined {
  return {
    secondary: "高中",
    vocational: "大专",
    associate: "大专",
    bachelor: "本科",
    master: "硕士",
    doctorate: "博士",
    unknown: undefined,
  }[degree];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function compactText(value: string | null | undefined, fallback = "未提供"): string {
  if (!value?.trim()) return fallback;
  return value.replace(/\s+/g, " ").trim();
}

function formatEffort(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) return `${remainder}分钟`;
  if (remainder === 0) return `${hours}小时`;
  return `${hours}小时${remainder}分`;
}

function pricePart(value: string | null, suffix: string): string | null {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return `免费${suffix}`;
  return `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${suffix}`;
}

function productPriceLabel(product: LiveProduct): string {
  return [
    pricePart(product.monthlyPrice, "/月"),
    pricePart(product.quarterlyPrice, "/季度"),
    pricePart(product.yearlyPrice, "/年"),
    pricePart(product.lifetimePrice, "/长期"),
  ].find((value): value is string => Boolean(value)) ?? "价格以主站为准";
}

function categoryLabel(category: ProductCategory): string {
  return {
    resume: "简历卡点",
    application: "网申与投递卡点",
    interview: "面试卡点",
  }[category];
}

function productCategories(product: LiveProduct): ProductCategory[] {
  const text = [
    product.name,
    product.description,
    ...product.features.flatMap((feature) => [feature.title, feature.description]),
  ]
    .filter(Boolean)
    .join(" ");
  const result: ProductCategory[] = [];
  if (/简历/.test(text)) result.push("resume");
  if (/网申|投递|岗位推送|岗位匹配/.test(text)) result.push("application");
  if (/面试/.test(text)) result.push("interview");
  return result;
}

function toProductOfferings(products: LiveProduct[]): ProductOffering[] {
  return products.flatMap((product) =>
    productCategories(product).map((category) => ({
      id: `${product.id}:${category}`,
      name: product.name,
      category,
      enabled: true,
      description: product.description ?? undefined,
      callToAction: "查看真实产品",
    })),
  );
}

function productForOffering(
  products: LiveProduct[],
  offeringId: string,
): LiveProduct | undefined {
  const productId = offeringId.split(":")[0];
  return products.find((product) => product.id === productId);
}

function entitlementActionUrl(routePath: string): string {
  return new URL(routePath, "https://www.zhidasihai.cn").toString();
}

function profileSummary(profile: CareerProfile): string {
  return [
    `${profile.school}，${profile.schoolTier}`,
    `${profile.degreeLevel}，${profile.major}，${profile.graduationYear}届`,
    `当前城市${profile.city || "未填"}，意向地区${profile.preferredCities || "未填"}`,
    `每周可投入${profile.availableHoursPerWeek}小时`,
  ].join("；");
}

function targetSummary(jobs: LiveJob[]): string {
  return jobs.map((job) => `${job.companyName}-${job.jobTitle}`).join("；");
}

function statusClass(status: EligibilityResult["status"]): string {
  return {
    eligible: styles.eligible,
    conditional: styles.conditional,
    high_risk: styles.highRisk,
    not_eligible_current_batch: styles.notEligible,
    unknown: styles.unknown,
  }[status];
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={ok ? styles.statusOk : styles.statusPending}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={styles.emptyState}>
      <ImageInsertMarker className={styles.emptyStateVisualInsert} kind="graphic" label={`${title}空状态插图位置`} />
      <span className={styles.emptyIndex}>路径待补全</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

function OverviewView({
  profile,
  selectedJobs,
  network,
  completedTaskIds,
  products,
  status,
  onOpen,
}: {
  profile: CareerProfile | null;
  selectedJobs: LiveJob[];
  network: StrategyNetwork | null;
  completedTaskIds: string[];
  products: LiveProduct[];
  status: SystemStatus | null;
  onOpen: (view: ViewId) => void;
}) {
  const taskMap = new Map<string, StrategyTask>(
    network
      ? [
          ...network.sharedTasks,
          ...network.branches.flatMap((branch) => branch.tasks),
        ].map((task) => [task.id, task])
      : [],
  );
  const orderedTaskIds = network
    ? network.sevenDayPlan.flatMap((day) => day.taskIds)
    : [];
  const allTaskIds = [...new Set([...taskMap.keys(), ...orderedTaskIds])];
  const completedCount = allTaskIds.filter((id) => completedTaskIds.includes(id)).length;
  const progress = allTaskIds.length
    ? Math.round((completedCount / allTaskIds.length) * 100)
    : 0;
  const nextTaskId = orderedTaskIds.find((id) => !completedTaskIds.includes(id));
  const nextTask = nextTaskId ? taskMap.get(nextTaskId) : undefined;
  const missingCapabilities = profile
    ? Object.values(profile.capabilityLevels ?? {}).filter((level) => level === "missing").length
    : 0;
  const targetRisks = network
    ? network.branches.filter((branch) => branch.eligibility.status !== "eligible").length
    : 0;
  const readinessCount =
    1 +
    (selectedJobs.length > 0 ? 1 : 0) +
    (network ? 1 : 0);
  const advisorReady = Boolean(
    status?.ragConfigured &&
      (status?.aiConfigured ?? status?.difyConfigured) &&
      status?.advisorProtected &&
      status?.advisorAccessEnabled,
  );

  if (!profile) {
    return (
      <div className={`${styles.viewStack} ${styles.overviewView}`}>
        <header className={`${styles.overviewHeader} ${styles.overviewLandingHeader}`}>
          <div className={styles.overviewHeroCopy}>
            <p className={styles.eyebrow}>求职策略总览 · 从终点倒推</p>
            <h1>先确定终点，<br />再规划行动</h1>
            <p>从真实在招岗位中选定目标，再把学历、经历与能力差距，拆成一条可以逐步完成的求职路径。</p>
          </div>
          <div className={styles.overviewHeaderMedia}>
            <ImageInsertMarker className={styles.overviewImageInsert} kind="image" label="首页页头横幅图片位置" />
            <div className={styles.overviewMediaCaption}>
              <span className={styles.overviewStatus}><Database size={17} weight="duotone" />岗位、规则与建议可追溯</span>
              <small>真实起点 / 目标岗位 / 能力成本 / 行动计划</small>
            </div>
          </div>
        </header>

        <section className={styles.onboardingPanel}>
          <div className={styles.onboardingCopy}>
            <span>第一步 · 建立真实起点</span>
            <h2>一份学生档案，换一张通往目标岗位的作战地图</h2>
            <p>系统先核验学历、专业、届别和经历，再告诉你：哪些岗位值得争取、风险在哪里，以及要付出多少时间和能力成本。</p>
            <div className={styles.onboardingActions}>
              <button className={styles.studioPrimaryButton} type="button" onClick={() => onOpen("profile")}>
                开始建立档案 <ArrowRight size={18} weight="bold" />
              </button>
              <small>预计 3–5 分钟 · 随时可以修改</small>
            </div>
          </div>
          <figure className={styles.routePreview} aria-label="从学生档案到目标岗位 Offer 的路径预览">
            <header>
              <span>你的求职路线图</span>
              <div className={styles.routePreviewActions}><em>终点优先</em></div>
            </header>
            <div className={styles.routeCanvas}>
              <svg aria-hidden="true" viewBox="0 0 440 240" preserveAspectRatio="none">
                <path d="M44 196 C122 196 117 129 203 129 C296 129 276 48 394 48" />
                <circle cx="44" cy="196" r="7" />
                <circle cx="203" cy="129" r="7" />
                <circle cx="394" cy="48" r="9" />
              </svg>
              <div className={styles.routeOrigin}>
                <ImageInsertMarker className={styles.routeOriginInsert} kind="avatar" label="学生起点头像或人物图形位置" />
                <span>起点</span>
                <strong>你的真实条件</strong>
                <small>学历 · 专业 · 经历</small>
              </div>
              <div className={styles.routeMilestone}>
                <ImageInsertMarker className={styles.routeMilestoneInsert} kind="icon" label="能力补齐步骤图标位置" />
                <span>能力补齐</span>
                <strong>行动与成本</strong>
              </div>
              <div className={styles.routeDestination}>
                <ImageInsertMarker className={styles.routeDestinationInsert} kind="logo" label="目标企业标识位置" />
                <span><Buildings size={16} weight="duotone" />目标终点</span>
                <strong>央国企目标岗位</strong>
                <small>门槛、风险和准备标准清清楚楚</small>
                <em>OFFER</em>
              </div>
            </div>
            <figcaption>建档后，示意内容会替换成你的真实目标岗位与行动路径。</figcaption>
          </figure>
        </section>

        <section className={styles.boundaryGrid}>
          <article><ImageInsertMarker className={styles.boundaryImageInsert} kind="icon" label="真实数据说明图标位置" /><div><strong>事实来自真实接口</strong><p>岗位、产品与知识库没有返回时，页面不会补造结果。</p></div></article>
          <article><ImageInsertMarker className={styles.boundaryImageInsert} kind="icon" label="风险说明图标位置" /><div><strong>高风险路径仍会保留</strong><p>系统明确硬门槛与风险，但不会把当前不可投包装成机会。</p></div></article>
          <article><ImageInsertMarker className={styles.boundaryImageInsert} kind="icon" label="行动说明图标位置" /><div><strong>每一步都有完成标准</strong><p>建议会被拆成可以勾选、复盘和继续推进的行动。</p></div></article>
        </section>
      </div>
    );
  }

  return (
    <div className={`${styles.viewStack} ${styles.overviewView}`}>
      <header className={`${styles.overviewHeader} ${styles.overviewPersonalHeader}`}>
        <div className={styles.overviewPersonalCopy}>
          <p className={styles.eyebrow}>求职策略总览</p>
          <h1>{profile.name}，这是你<span>现在最该做</span>的事</h1>
          <p>{profile.school} · {profile.major} · {profile.graduationYear} 届。所有判断都从这份真实档案出发。</p>
        </div>
        <div className={styles.overviewHeaderActions}>
          <ImageInsertMarker className={styles.overviewProfileInsert} kind="avatar" label="学生头像或个人身份图形位置" />
          <button className={styles.studioPrimaryButton} type="button" onClick={() => onOpen(selectedJobs.length ? "tasks" : "jobs")}>
            {selectedJobs.length ? "继续今日行动" : "选择目标岗位"} <ArrowRight size={17} weight="bold" />
          </button>
        </div>
      </header>

      <section className={styles.overviewMetrics} aria-label="当前策略概况">
        <article><span><Target size={18} weight="duotone" />目标岗位</span><strong>{selectedJobs.length}<small>/ 3</small></strong><p>{selectedJobs.length ? "已锁定求职终点" : "尚未选择目标"}</p></article>
        <article><span><CheckSquare size={18} weight="duotone" />行动完成</span><strong>{completedCount}<small>/ {allTaskIds.length}</small></strong><p>{allTaskIds.length ? `当前完成 ${progress}%` : "选岗后自动生成"}</p></article>
        <article><span><Warning size={18} weight="duotone" />待核验目标</span><strong>{targetRisks}</strong><p>{network ? "含风险或未知项" : "策略尚未生成"}</p></article>
        <article><span><CalendarDots size={18} weight="duotone" />每周投入</span><strong>{profile.availableHoursPerWeek}<small>小时</small></strong><p>用于安排执行节奏</p></article>
      </section>

      <div className={styles.overviewColumns}>
        <div className={styles.overviewMainColumn}>
          <section className={styles.todayCard}>
            <header>
              <div><span>下一项行动</span><h2>{nextTask ? nextTask.title : selectedJobs.length ? "本轮任务已经完成" : "先选择一个目标岗位"}</h2></div>
              <div className={styles.todayProgressCluster}><span className={styles.todayProgress}>{progress}%</span></div>
            </header>
            <div className={styles.todayProgressTrack}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
            <p>{nextTask ? nextTask.description : selectedJobs.length ? "进入七日行动页复盘结果，或返回岗位页调整目标。" : "起点已经建立。接下来从真实在招岗位中确定一至三个终点。"}</p>
            {nextTask && <small>完成标准：{nextTask.completionCriteria}</small>}
            <button type="button" onClick={() => onOpen(selectedJobs.length ? "tasks" : "jobs")}>
              {selectedJobs.length ? "打开七日行动" : "查看在招岗位"}<ArrowRight size={15} weight="bold" />
            </button>
          </section>

          <section className={styles.targetOverviewCard}>
            <header>
              <div><span>求职终点</span><h2>目标岗位与硬门槛</h2><p>三条路径共享准备主干，各自保留企业门槛与风险。</p></div>
              <div className={styles.targetHeaderActions}><button type="button" onClick={() => onOpen("jobs")}>管理目标</button></div>
            </header>
            {selectedJobs.length ? (
              <div className={styles.targetOverviewList}>
                {selectedJobs.map((job) => {
                  const branch = network?.branches.find((item) => item.jobId === job.id);
                  const opening = convertLiveJobToOpening(job);
                  const eligibility = branch?.eligibility ?? (opening ? evaluateEligibility(profile, opening) : null);
                  const eligibilityStatus = eligibility?.status ?? "unknown";
                  const copy = ELIGIBILITY_COPY[eligibilityStatus];
                  return (
                    <article key={job.id}>
                      <div className={styles.targetCompanyMark}>
                        <ImageInsertMarker kind="logo" label={`${job.companyName} 企业 Logo 图片位置`} />
                      </div>
                      <div><span>{job.companyName}</span><h3>{job.jobTitle}</h3><p>{compactText(job.workLocation, "地点待核验")} · 截止 {formatDate(job.applyEndDate)}</p></div>
                      <strong className={`${styles.overviewRisk} ${statusClass(eligibilityStatus)}`}>{copy.label}</strong>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.overviewEmptyRow}><Buildings size={22} weight="duotone" /><p>还没有目标岗位，策略网络和行动成本暂时无法生成。</p></div>
            )}
          </section>
        </div>

        <aside className={styles.overviewRail}>
          <section className={styles.readinessCard}>
            <header>
              <div><span>策略准备度</span><strong>{selectedJobs.length && network ? "路径已生成" : "继续补全"}</strong></div>
              <p><strong>{readinessCount}</strong><span>/ 3 环节已建立</span></p>
            </header>
            <ul>
              <li data-ready="true"><Check size={15} weight="bold" /><div><strong>学生档案</strong><span>{missingCapabilities} 项能力尚未开始</span></div></li>
              <li data-ready={selectedJobs.length > 0}><Check size={15} weight="bold" /><div><strong>目标岗位</strong><span>{selectedJobs.length ? `已选择 ${selectedJobs.length} 个` : "等待选择"}</span></div></li>
              <li data-ready={Boolean(network)}><Check size={15} weight="bold" /><div><strong>行动路径</strong><span>{network ? `${allTaskIds.length} 项可检查行动` : "等待生成"}</span></div></li>
            </ul>
            <button type="button" onClick={() => onOpen("strategy")}>查看完整策略网络<ArrowRight size={14} weight="bold" /></button>
          </section>

          <section className={styles.dataStatusCard}>
            <header><Database size={18} weight="duotone" /><div><strong>系统依据状态</strong><span>不满足条件时主动关闭</span></div></header>
            <dl>
              <div><dt>实时岗位</dt><dd data-ready={Boolean(status?.zhidaLive)}>{status?.zhidaLive ? "已连接" : "确认中"}</dd></div>
              <div><dt>官方情报</dt><dd data-ready={Boolean(status?.intelligenceLive)}>{status?.intelligenceLive ? "只读在线" : "安全降级"}</dd></div>
              <div><dt>知识库</dt><dd data-ready={Boolean(status?.ragConfigured)}>{status?.ragConfigured ? "已连接" : "待配置"}</dd></div>
              <div><dt>AI 顾问</dt><dd data-ready={advisorReady}>{advisorReady ? "可使用" : "安全关闭"}</dd></div>
            </dl>
            <ImageInsertMarker className={styles.statusGraphicInsert} kind="graphic" label="岗位、官方情报、知识库与 AI 连接关系图位置" />
          </section>

          {network?.productTriggers.length ? (
            <section className={styles.serviceCard}>
              <span>卡点服务与已有权益</span>
              <h2>先用已有功能，再考虑可选帮助</h2>
              <ImageInsertMarker className={styles.serviceGraphicInsert} kind="cover" label="卡点服务组合封面位置" />
              {network.productTriggers.slice(0, 2).map((trigger) => {
                const product = productForOffering(products, trigger.productId);
                return <p key={`${trigger.productId}:${trigger.category}`}><strong>{trigger.productName}</strong><small>{categoryLabel(trigger.category)}</small>{trigger.source === "entitlement" && trigger.actionUrl ? <a href={trigger.actionUrl} target="_blank" rel="noreferrer">直接使用</a> : product && <a href={product.purchaseUrl} target="_blank" rel="noreferrer">查看</a>}</p>;
              })}
              <button type="button" onClick={() => onOpen("tasks")}>查看触发原因<ArrowRight size={14} weight="bold" /></button>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ProfileView({
  draft,
  setDraft,
  profile,
  error,
  onSave,
  onClear,
  status,
  bridgeSession,
  bridgeError,
  bridgeStarting,
  workspaceSync,
  workspaceSaving,
  workspaceSyncError,
  onConnectBridge,
  onUseBridgeProfile,
  onDisconnectBridge,
}: {
  draft: ProfileDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProfileDraft>>;
  profile: CareerProfile | null;
  error: string | null;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  status: SystemStatus | null;
  bridgeSession: BridgeSessionStatus | null;
  bridgeError: string | null;
  bridgeStarting: boolean;
  workspaceSync: WorkspaceSyncStatus | null;
  workspaceSaving: boolean;
  workspaceSyncError: string | null;
  onConnectBridge: () => void;
  onUseBridgeProfile: () => void;
  onDisconnectBridge: () => void;
}) {
  const update = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const capabilityFields: Array<{
    key: keyof Pick<
      ProfileDraft,
      "resume" | "application" | "interview" | "projectEvidence" | "internship" | "competition"
    >;
    label: string;
    hint: string;
  }> = [
    { key: "resume", label: "简历", hint: "是否已有可投递版本" },
    { key: "projectEvidence", label: "项目证据", hint: "经历是否有行动与结果" },
    { key: "application", label: "网申材料", hint: "字段、附件、自我陈述" },
    { key: "interview", label: "面试表达", hint: "是否完成岗位化训练" },
    { key: "internship", label: "实习经历", hint: "是否形成可核验证据" },
    { key: "competition", label: "竞赛经历", hint: "是否形成可核验证据" },
  ];

  return (
    <div className={`${styles.viewStack} ${styles.profileWorkspaceView}`}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>第一步 · 建立求职起点</p>
          <h1>{profile ? "更新你的学生档案" : "先把真实情况填清楚"}</h1>
          <p>系统只用明确资料做判断。学校、学历、专业和届别决定硬门槛，经历与投入决定行动成本。</p>
        </div>
        <div className={styles.systemPills} aria-label="数据服务状态">
          <StatusPill ok={Boolean(status?.zhidaLive)}>在招岗位</StatusPill>
          <StatusPill ok={Boolean(status?.intelligenceLive)}>官方情报</StatusPill>
          <StatusPill ok={Boolean(status?.ragConfigured)}>知识库</StatusPill>
        </div>
      </header>

      <section className={styles.profileBridgeCard} data-connected={Boolean(bridgeSession?.connected)}>
        <div className={styles.profileBridgeIdentity}>
          <span aria-hidden="true">职达</span>
          <div>
            <p>主站资料接力</p>
            <h2>
              {!bridgeSession?.configured
                ? "手工建档仍是当前入口"
                : bridgeSession.connected
                  ? "主站资料与可用功能已连接"
                  : "少填一次，连接后核对即可"}
            </h2>
            <small>
              仅接收学历、专业、求职偏好和可用功能；不导入姓名、手机号、证件或简历原文件。
            </small>
          </div>
        </div>
        <div className={styles.profileBridgeActions}>
          {bridgeSession?.connected ? (
            <>
              <div className={styles.profileBridgeFacts}>
                <span>{bridgeSession.profile ? "档案可核对" : "主站档案未完善"}</span>
                <span>{bridgeSession.entitlements?.length ?? 0} 项功能可直接使用</span>
                {workspaceSync?.connected && workspaceSync.persistence ? (
                  <span>
                    {workspaceSyncError
                      ? "本机已保留，跨设备待重试"
                      : workspaceSaving
                        ? "正在保存路径进度"
                        : "路径进度可跨设备保存"}
                  </span>
                ) : (
                  <span>路径进度当前仅保存在本机</span>
                )}
                {bridgeSession.membership?.effectiveTier ? (
                  <span>权益层级 {bridgeSession.membership.effectiveTier}</span>
                ) : null}
              </div>
              {bridgeSession.profile ? (
                <button type="button" onClick={onUseBridgeProfile}>填入表单并核对</button>
              ) : null}
              <button className={styles.profileBridgeSecondary} type="button" onClick={onDisconnectBridge}>断开连接</button>
            </>
          ) : bridgeSession?.configured ? (
            <button type="button" onClick={onConnectBridge} disabled={bridgeStarting}>
              {bridgeStarting ? "正在前往主站…" : "连接职达主站资料"}
            </button>
          ) : (
            <span className={styles.profileBridgeDisabled}>资料接力尚未开启，可继续填写下方档案</span>
          )}
        </div>
        {bridgeError ? <p className={styles.profileBridgeError} role="alert">{bridgeError}</p> : null}
      </section>

      <form className={styles.profileForm} onSubmit={onSave}>
        <section className={styles.formSection}>
          <div className={styles.sectionTitle}>
            <span>01</span>
            <div>
              <h2>基本条件</h2>
              <p>用于核验学历、专业、届别等招聘硬门槛。</p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label>
              <span>姓名或称呼</span>
              <input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：林同学" required />
            </label>
            <label>
              <span>学校</span>
              <input value={draft.school} onChange={(event) => update("school", event.target.value)} placeholder="填写学校全称" required />
            </label>
            <label>
              <span>学校层次</span>
              <select value={draft.schoolTier} onChange={(event) => update("schoolTier", event.target.value)}>
                {[
                  "高职高专",
                  "普通本科",
                  "双一流",
                  "985 / 211",
                  "海外院校",
                ].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>当前学历</span>
              <select value={draft.degreeLevel} onChange={(event) => update("degreeLevel", event.target.value as DegreeLevel)}>
                {DEGREE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>专业</span>
              <input value={draft.major} onChange={(event) => update("major", event.target.value)} placeholder="例如：计算机科学与技术" required />
            </label>
            <label>
              <span>毕业年份</span>
              <input type="number" min="2024" max="2035" value={draft.graduationYear} onChange={(event) => update("graduationYear", event.target.value)} required />
            </label>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionTitle}>
            <span>02</span>
            <div>
              <h2>目标与投入</h2>
              <p>用于控制推荐范围，并算清楚你每周要付出的时间成本。</p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label>
              <span>当前城市</span>
              <input value={draft.city} onChange={(event) => update("city", event.target.value)} placeholder="例如：武汉" />
            </label>
            <label>
              <span>意向城市</span>
              <input value={draft.preferredCities} onChange={(event) => update("preferredCities", event.target.value)} placeholder="例如：北京、武汉，可接受全国" />
            </label>
            <label>
              <span>求职方向</span>
              <input value={draft.targetSector} onChange={(event) => update("targetSector", event.target.value)} placeholder="例如：央企信息技术岗" />
            </label>
            <label>
              <span>每周可投入小时</span>
              <input type="number" min="1" max="80" value={draft.availableHoursPerWeek} onChange={(event) => update("availableHoursPerWeek", event.target.value)} />
            </label>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionTitle}>
            <span>03</span>
            <div>
              <h2>能力起点</h2>
              <p>请选择当前真实状态。系统会把缺口变成行动，不会拿它给你打虚假分数。</p>
            </div>
          </div>
          <div className={styles.capabilityGrid}>
            {capabilityFields.map((field) => (
              <label key={field.key}>
                <span>
                  <ImageInsertMarker className={styles.capabilityIconInsert} kind="icon" label={`${field.label}能力图标位置`} />
                  <span>
                    <strong>{field.label}</strong>
                    <small>{field.hint}</small>
                  </span>
                </span>
                <select value={draft[field.key]} onChange={(event) => update(field.key, event.target.value as CapabilityLevel)}>
                  {CAPABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>

        <footer className={styles.formFooter}>
          <div>
            <strong>
              {workspaceSync?.connected && workspaceSync.persistence
                ? "个人档案仍只留在本机；目标岗位与行动进度可跨设备保存"
                : "档案只保存在这台电脑的浏览器中，最多保留 30 天"}
            </strong>
            <span>
              不会写入职达生产数据库；连接状态下也只保存公开岗位和任务勾选。
            </span>
          </div>
          <div className={styles.formActions}>
            {profile && (
              <button className={styles.clearDataButton} type="button" onClick={onClear}>
                {workspaceSync?.connected && workspaceSync.persistence
                  ? "清除本机与跨设备进度"
                  : "清除本机资料"}
              </button>
            )}
            <button className={styles.primaryButton} type="submit">{profile ? "保存并重新匹配" : "保存档案，查看岗位"}</button>
          </div>
        </footer>
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </form>
    </div>
  );
}

function FocusedProfileView({
  draft,
  setDraft,
  profile,
  error,
  onSave,
  onClear,
  bridgeSession,
  bridgeError,
  bridgeStarting,
  workspaceSync,
  workspaceSaving,
  workspaceSyncError,
  onConnectBridge,
  onUseBridgeProfile,
  onDisconnectBridge,
  onViewReport,
}: {
  draft: ProfileDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProfileDraft>>;
  profile: CareerProfile | null;
  error: string | null;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  bridgeSession: BridgeSessionStatus | null;
  bridgeError: string | null;
  bridgeStarting: boolean;
  workspaceSync: WorkspaceSyncStatus | null;
  workspaceSaving: boolean;
  workspaceSyncError: string | null;
  onConnectBridge: () => void;
  onUseBridgeProfile: () => void;
  onDisconnectBridge: () => void;
  onViewReport: () => void;
}) {
  const update = <Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const capabilityFields: Array<{
    key: keyof Pick<
      ProfileDraft,
      "resume" | "application" | "interview" | "projectEvidence" | "internship" | "competition"
    >;
    label: string;
  }> = [
    { key: "resume", label: "简历" },
    { key: "application", label: "网申材料" },
    { key: "interview", label: "面试表达" },
    { key: "projectEvidence", label: "项目证据" },
    { key: "internship", label: "实习经历" },
    { key: "competition", label: "竞赛经历" },
  ];

  const bridgeVisible = Boolean(
    bridgeSession?.configured || bridgeSession?.connected,
  );

  return (
    <div className={styles.focusedProfilePage}>
      <div className={styles.focusedProfileHero}>
        <header className={styles.focusedProfileHeading}>
          <span>个人资料</span>
          <h1>{profile ? "更新你的求职信息" : "先让顾问了解你"}</h1>
          <p>
            这些资料会成为每次对话的背景，帮助系统结合真实岗位给出更具体的判断。
          </p>
        </header>
        <Image
          alt=""
          aria-hidden="true"
          className={styles.focusedProfileIllustration}
          height={1086}
          priority
          src="/visuals/report-2026/04-profile-dossier.png"
          unoptimized
          width={1448}
        />
      </div>

      {bridgeVisible ? (
        <section
          className={styles.focusedBridge}
          data-connected={Boolean(bridgeSession?.connected)}
        >
          <div>
            <strong>
              {bridgeSession?.connected ? "已连接职达主站" : "从职达主站导入"}
            </strong>
            <span>
              {bridgeSession?.connected
                ? workspaceSyncError
                  ? "资料已导入，本机记录仍会保留"
                  : workspaceSaving
                    ? "正在保存路径进度"
                    : workspaceSync?.persistence
                      ? "目标与行动进度可跨设备保存"
                      : "请核对导入内容"
                : "可导入学历、专业和求职偏好，减少重复填写"}
            </span>
          </div>
          <div>
            {bridgeSession?.connected ? (
              <>
                {bridgeSession.profile ? (
                  <button type="button" onClick={onUseBridgeProfile}>
                    填入并核对
                  </button>
                ) : null}
                <button
                  className={styles.focusedTextButton}
                  type="button"
                  onClick={onDisconnectBridge}
                >
                  断开
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onConnectBridge}
                disabled={bridgeStarting}
              >
                {bridgeStarting ? "正在连接…" : "连接主站"}
              </button>
            )}
          </div>
          {bridgeError ? (
            <p role="alert">{bridgeError}</p>
          ) : null}
        </section>
      ) : null}

      <form className={styles.focusedProfileForm} onSubmit={onSave}>
        <section className={styles.focusedFormSection}>
          <header>
            <span>01</span>
            <div>
              <h2>基本信息</h2>
              <p>用于判断学历、专业、届别等岗位硬门槛。</p>
            </div>
          </header>
          <div className={styles.focusedFormGrid}>
            <label>
              <span>姓名或称呼</span>
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="例如：林同学"
                required
              />
            </label>
            <label>
              <span>学校</span>
              <input
                value={draft.school}
                onChange={(event) => update("school", event.target.value)}
                placeholder="填写学校全称"
                required
              />
            </label>
            <label>
              <span>学校层次</span>
              <select
                value={draft.schoolTier}
                onChange={(event) => update("schoolTier", event.target.value)}
              >
                {[
                  "高职高专",
                  "普通本科",
                  "双一流",
                  "985 / 211",
                  "海外院校",
                ].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>当前学历</span>
              <select
                value={draft.degreeLevel}
                onChange={(event) =>
                  update("degreeLevel", event.target.value as DegreeLevel)}
              >
                {DEGREE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>专业</span>
              <input
                value={draft.major}
                onChange={(event) => update("major", event.target.value)}
                placeholder="例如：计算机科学与技术"
                required
              />
            </label>
            <label>
              <span>毕业年份</span>
              <input
                type="number"
                min="2024"
                max="2035"
                value={draft.graduationYear}
                onChange={(event) =>
                  update("graduationYear", event.target.value)}
                required
              />
            </label>
          </div>
        </section>

        <section className={styles.focusedFormSection}>
          <header>
            <span>02</span>
            <div>
              <h2>求职偏好</h2>
              <p>让对话优先围绕你愿意投入的方向展开。</p>
            </div>
          </header>
          <div className={styles.focusedFormGrid}>
            <label>
              <span>当前城市</span>
              <input
                value={draft.city}
                onChange={(event) => update("city", event.target.value)}
                placeholder="例如：武汉"
              />
            </label>
            <label>
              <span>意向城市</span>
              <input
                value={draft.preferredCities}
                onChange={(event) =>
                  update("preferredCities", event.target.value)}
                placeholder="例如：北京、武汉，可接受全国"
              />
            </label>
            <label>
              <span>求职方向</span>
              <input
                value={draft.targetSector}
                onChange={(event) =>
                  update("targetSector", event.target.value)}
                placeholder="例如：央企信息技术岗"
              />
            </label>
            <label>
              <span>每周可投入时间</span>
              <div className={styles.focusedInputSuffix}>
                <input
                  type="number"
                  min="1"
                  max="80"
                  value={draft.availableHoursPerWeek}
                  onChange={(event) =>
                    update("availableHoursPerWeek", event.target.value)}
                />
                <span>小时</span>
              </div>
            </label>
          </div>
        </section>

        <details className={styles.focusedCapabilityDetails}>
          <summary>
            <span>
              <strong>补充能力现状</strong>
              <small>选填，填写后建议会更具体</small>
            </span>
            <span>展开</span>
          </summary>
          <div className={styles.focusedCapabilityGrid}>
            {capabilityFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <select
                  value={draft[field.key]}
                  onChange={(event) =>
                    update(field.key, event.target.value as CapabilityLevel)}
                >
                  {CAPABILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        {error ? (
          <p className={styles.focusedFormError} role="alert">{error}</p>
        ) : null}

        <footer className={styles.focusedFormFooter}>
          <div>
            <strong>资料只保存在当前浏览器，最多保留 30 天</strong>
            <span>不会写入职达生产数据库；你可以随时清除。</span>
          </div>
          <div>
            {profile ? (
              <>
                <button
                  className={styles.focusedClearButton}
                  type="button"
                  onClick={onClear}
                >
                  清除资料
                </button>
                <button
                  className={styles.focusedReportButton}
                  type="button"
                  onClick={onViewReport}
                >
                  查看报告
                </button>
              </>
            ) : null}
            <button className={styles.focusedSaveButton} type="submit">
              {profile ? "保存修改，更新报告" : "保存资料，生成报告"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function reportHeatLevel(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return 1;
  const ratio = value / maximum;
  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function isMarketReportResult(value: unknown): value is MarketReportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<MarketReportResult>;
  return (
    (input.status === "live" || input.status === "partial")
    && typeof input.generatedAt === "string"
    && Boolean(input.source)
    && Boolean(input.position)
    && Array.isArray(input.qualificationMatrix)
    && Boolean(input.schoolIntelligence)
    && typeof input.conclusion === "string"
    && Boolean(input.competitiveness)
    && Array.isArray(input.competitiveness?.factors)
    && Boolean(input.studentAssessment)
    && Array.isArray(input.studentAssessment?.strengths)
    && Array.isArray(input.studentAssessment?.constraints)
    && Boolean(input.employmentConditions)
    && Array.isArray(input.employmentConditions?.items)
    && Boolean(input.marketLayers)
    && Boolean(input.directions)
    && Array.isArray(input.directions?.recommendations)
    && Array.isArray(input.directions?.candidates)
    && Boolean(input.metrics)
    && Boolean(input.heatmap)
    && Boolean(input.history)
    && Array.isArray(input.milestones)
    && Array.isArray(input.prioritySteps)
    && Array.isArray(input.levers)
    && Array.isArray(input.actions)
    && Boolean(input.decisionModel)
    && Array.isArray(input.decisionModel?.candidates)
    && Array.isArray(input.caveats)
  );
}

function MarketReportChapter({
  index,
  title,
  summary,
  children,
}: {
  index: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.marketReportChapter} data-chapter={index}>
      <header className={styles.marketReportChapterHeader}>
        <i>{index}</i>
        <div>
          <h2>{title}</h2>
          <span>{summary}</span>
        </div>
      </header>
      <div className={styles.marketReportChapterBody}>{children}</div>
    </section>
  );
}

function FocusedMarketReport({
  profile,
  report,
  loading,
  error,
  onRetry,
  onExplain,
  onChooseDirection,
}: {
  profile: CareerProfile;
  report: MarketReportResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onExplain: () => void;
  onChooseDirection: () => void;
}) {
  const [heatmapMode, setHeatmapMode] = useState<"current" | "history">("current");
  const degreeLabel =
    DEGREE_OPTIONS.find((option) => option.value === profile.degreeLevel)?.label
    ?? profile.degreeLevel;
  const profileLine = [
    `${profile.graduationYear} 届`,
    degreeLabel,
    profile.school,
    profile.major,
    profile.preferredCities || profile.city || "全国",
    profile.targetSector,
  ].filter(Boolean).join(" · ");
  const fetchedAt = report?.source.fetchedAt
    ? formatDate(report.source.fetchedAt)
    : "正在读取";
  const activeHeatmap = report
    ? heatmapMode === "history"
      ? report.history.heatmap
      : report.heatmap
    : null;
  const heatMaximum = activeHeatmap
    ? Math.max(0, ...activeHeatmap.rows.flatMap((row) => row.values))
    : 0;
  return (
    <section
      className={styles.marketReport}
      aria-labelledby="market-report-title"
      data-report-status={report?.status ?? (loading ? "loading" : "unavailable")}
    >
      <header className={styles.marketReportHeader}>
        <div className={styles.marketReportIdentity}>
          <span>求职咨询报告</span>
          <h1 id="market-report-title">个人求职市场报告</h1>
          <p>{profileLine}</p>
        </div>
        <div className={styles.marketReportMeta}>
          <span><Database size={15} />{report ? "数据来源：职达主站" : "等待数据"}</span>
          <span><CalendarDots size={15} />更新：{fetchedAt}</span>
        </div>
      </header>

      {loading ? (
        <div className={styles.marketReportState} role="status">
          <Database size={28} weight="duotone" />
          <strong>正在生成报告</strong>
          <span>正在读取岗位数据</span>
        </div>
      ) : error || !report ? (
        <div className={styles.marketReportState} role="alert">
          <Warning size={28} weight="duotone" />
          <strong>市场报告暂时没有生成</strong>
          <span>{error ?? "真实岗位服务暂时不可用，请稍后重试。"}</span>
          <button type="button" onClick={onRetry}>重新读取</button>
        </div>
      ) : (
        <>
          <MarketReportChapter
            index="01"
            title="整体情况"
            summary="你的当前竞争力"
          >
            <section className={styles.marketCompetitiveness} aria-labelledby="market-competitiveness-title">
              <div className={styles.marketCompetitivenessGauge}>
                <svg viewBox="0 0 180 108" role="img" aria-label={`综合评分 ${report.competitiveness.score} 分`}>
                  <path className={styles.marketCompetitivenessGaugeTrack} d="M 20 94 A 70 70 0 0 1 160 94" pathLength="100" />
                  <path
                    className={styles.marketCompetitivenessGaugeValue}
                    d="M 20 94 A 70 70 0 0 1 160 94"
                    pathLength="100"
                    style={{ strokeDasharray: `${report.competitiveness.score} 100` }}
                  />
                </svg>
                <div>
                  <strong>{report.competitiveness.score}</strong>
                  <span>/ 100</span>
                </div>
              </div>
              <div className={styles.marketCompetitivenessSummary}>
                <span>市场竞争力</span>
                <h2 id="market-competitiveness-title">{report.competitiveness.label}</h2>
                <p>{report.competitiveness.summary}</p>
                {report.competitiveness.improvementRoom > 0 ? (
                  <small>完成当前能力项，预计可提升 {report.competitiveness.improvementRoom} 分</small>
                ) : (
                  <small>当前求职准备已较充分</small>
                )}
              </div>
              <div className={styles.marketCompetitivenessFactors} aria-label="评分构成">
                {report.competitiveness.factors.map((factor) => (
                  <article key={factor.id}>
                    <header>
                      <span>{factor.label}</span>
                      <strong>{factor.score}</strong>
                    </header>
                    <i><b style={{ transform: `scaleX(${factor.score / 100})` }} /></i>
                    <small>{factor.note}</small>
                  </article>
                ))}
              </div>
              <div className={styles.marketCompetitivenessStats} aria-label="市场机会概览">
                <article>
                  <small>央国企机会</small>
                  <strong>{report.marketLayers.stateOwnedCampusInternTotal}</strong>
                </article>
                <article>
                  <small>初步符合</small>
                  <strong>{report.marketLayers.strictProfileTotal}</strong>
                </article>
                <article>
                  <small>涉及企业</small>
                  <strong>{report.metrics.companyCount}</strong>
                </article>
                <p>{report.competitiveness.disclaimer}</p>
              </div>
            </section>
          </MarketReportChapter>

          <MarketReportChapter
            index="02"
            title="学校情况"
            summary="院校与专业能提供什么"
          >

          {report.schoolIntelligence.status === "available" ? (
            <section className={styles.schoolIntelligence} aria-labelledby="school-intelligence-title">
              <header className={styles.schoolIntelligenceHeader}>
                <div>
                  <span>学校与专业</span>
                  <h2 id="school-intelligence-title">{report.schoolIntelligence.schoolName} · {report.schoolIntelligence.majorName}</h2>
                  <p>{report.schoolIntelligence.summary}</p>
                </div>
                <div>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className={styles.schoolResourceIllustration}
                    height={1086}
                    src="/visuals/report-2026/02-school-resource-folders.png"
                    unoptimized
                    width={1448}
                  />
                  <strong>{report.schoolIntelligence.studentDecision.level}</strong>
                  <span>{report.schoolIntelligence.campusRecruitmentAccess.items.length} 条来校招聘记录</span>
                  <small>更新 {report.schoolIntelligence.snapshotAt}</small>
                </div>
              </header>

              <div className={styles.schoolSignalGrid}>
                {report.schoolIntelligence.signals.slice(0, 3).map((signal) => (
                  <article key={signal.id}>
                    <span>{signal.label}</span>
                    <strong>{signal.value}</strong>
                  </article>
                ))}
              </div>

              <section className={styles.schoolRecruitmentWatch} aria-label="校招资源概览">
                <div className={styles.schoolRecruitmentWatchCopy}>
                  <span>校招资源</span>
                  <h3>电力行业重点雇主会来校招聘</h3>
                  <p>已核验国家电网、国家电投、特变电工等公开校招记录，可作为后续筛选目标企业的参考。</p>
                  <div className={styles.schoolRecruitmentWatchTags}>
                    {report.schoolIntelligence.campusRecruitmentAccess.items.slice(0, 4).map((item) => (
                      <span key={item.sector}>{item.sector}</span>
                    ))}
                  </div>
                  <small>{report.schoolIntelligence.campusRecruitmentAccess.cohort} · 仅作历史参考</small>
                </div>
                <Image
                  alt=""
                  aria-hidden="true"
                  className={styles.schoolEmployerNetworkIllustration}
                  height={941}
                  src="/visuals/report-2026/08-school-employer-network.png"
                  unoptimized
                  width={1672}
                />
              </section>

              <details className={styles.schoolDeepDetails}>
                <summary>
                  <span>查看学校求职资源</span>
                  <small>专业方向 · 重点雇主 · 历史去向</small>
                </summary>
                <div className={styles.schoolDeepContent}>
              <section className={styles.schoolTrainingProfile} aria-label="专业就业方向">
                <div className={styles.schoolTrainingHero}>
                  <div>
                    <span>专业方向</span>
                    <h3>三条主要就业路径</h3>
                    <p>课程与实践基础可覆盖电网运行、电气装备和高压检测，具体方向取决于后续项目与实习经历。</p>
                    <small>{report.schoolIntelligence.trainingProfile.curriculumVersion} · 历史培养方案</small>
                  </div>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className={styles.schoolCareerPathIllustration}
                    height={1003}
                    src="/visuals/report-2026/09-school-career-pathways.png"
                    unoptimized
                    width={1568}
                  />
                </div>
                <div className={styles.schoolDirectionTracks}>
                  {report.schoolIntelligence.trainingProfile.directionTracks.map((track, index) => (
                    <article key={track.label}>
                      <i>{index + 1}</i>
                      <div>
                        <strong>{track.label}</strong>
                        <span>{track.jobFamilies.slice(0, 3).join(" · ")}</span>
                        <small>{track.courses.slice(0, 3).join(" · ")}</small>
                        <em>可形成：{track.proof}</em>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.schoolRecruitmentAccess} aria-labelledby="school-recruitment-access-title">
                <div className={styles.schoolRecruitmentAccessHero}>
                  <div>
                    <span>重点雇主</span>
                    <h3 id="school-recruitment-access-title">学校可接触的电力行业雇主</h3>
                    <p>以下企业均有公开来校记录，用于判断校招资源覆盖范围。</p>
                    <small>{report.schoolIntelligence.campusRecruitmentAccess.cohort}</small>
                  </div>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className={styles.schoolRecruitmentGatewayIllustration}
                    height={1003}
                    src="/visuals/report-2026/10-school-recruitment-gateway.png"
                    unoptimized
                    width={1568}
                  />
                </div>
                <div className={styles.schoolRecruitmentGrid}>
                  {report.schoolIntelligence.campusRecruitmentAccess.items.map((item, index) => (
                    <article key={item.employer}>
                      <i>{String(index + 1).padStart(2, "0")}</i>
                      <div>
                        <span>{item.sector}</span>
                        <strong>{item.employer}</strong>
                        <p>{item.opportunity}</p>
                        <em>历史校招记录</em>
                      </div>
                    </article>
                  ))}
                </div>
                <p className={styles.schoolRecruitmentNote}>{report.schoolIntelligence.campusRecruitmentAccess.note}</p>
              </section>

              <div className={styles.schoolIntelligenceBody}>
                <article className={styles.schoolResourceCard}>
                  <div className={styles.schoolResourceCardHero}>
                    <div>
                      <span>校内资源</span>
                      <h3>专业平台能提供什么</h3>
                      <p>实验平台、课程项目和就业服务，是天津大学电气专业最直接的求职资源。</p>
                    </div>
                    <Image
                      alt=""
                      aria-hidden="true"
                      className={styles.schoolEvidenceKitIllustration}
                      height={1254}
                      src="/visuals/report-2026/11-school-evidence-kit.png"
                      unoptimized
                      width={1254}
                    />
                  </div>
                  <ol>
                    {report.schoolIntelligence.resources.map((resource, index) => (
                      <li key={resource.id}>
                        <i>{index + 1}</i>
                        <div>
                          <strong>{resource.label}</strong>
                          <em>{resource.action}</em>
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>

                <article className={styles.schoolOutcomeCard}>
                  <header>
                    <div>
                      <span>历史去向</span>
                      <h3>毕业生主要去向</h3>
                    </div>
                    <small>{report.schoolIntelligence.schoolOutcome.cohort} · {report.schoolIntelligence.schoolOutcome.scopeLabel}</small>
                  </header>
                  <div className={styles.schoolOutcomeRows}>
                    {[
                      ["国内升学", report.schoolIntelligence.schoolOutcome.domesticFurtherStudyRate],
                      ["直接就业", report.schoolIntelligence.schoolOutcome.directEmploymentRate],
                      ["境外深造", report.schoolIntelligence.schoolOutcome.overseasStudyRate],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <span>{label}</span>
                        <i><b style={{ transform: `scaleX(${Number(value) / 100})` }} /></i>
                        <strong>{Number(value).toFixed(2)}%</strong>
                      </div>
                    ))}
                  </div>
                  <p>{report.schoolIntelligence.schoolOutcome.note}</p>
                  <div className={styles.schoolMajorOutcome}>
                    <span>电气专业历史样本 · {report.schoolIntelligence.majorOutcome.cohort}</span>
                    <strong>{report.schoolIntelligence.majorOutcome.total} 人</strong>
                    <dl>
                      <div><dt>国内升学</dt><dd>{report.schoolIntelligence.majorOutcome.domesticFurtherStudy}</dd></div>
                      <div><dt>直接就业</dt><dd>{report.schoolIntelligence.majorOutcome.directEmployment}</dd></div>
                      <div><dt>境外深造</dt><dd>{report.schoolIntelligence.majorOutcome.overseasStudy}</dd></div>
                      <div><dt>待就业</dt><dd>{report.schoolIntelligence.majorOutcome.pending}</dd></div>
                    </dl>
                    <small>{report.schoolIntelligence.majorOutcome.note}</small>
                  </div>
                  <div className={styles.schoolEmployerExamples}>
                    <small>2024届本科整体集中就业单位</small>
                    {report.schoolIntelligence.employerExamples.map((employer) => (
                      <span key={employer.name}>{employer.name} <strong>{employer.count}</strong></span>
                    ))}
                  </div>
                </article>

                <article className={styles.schoolDecisionCard}>
                  <div>
                    <span>综合判断</span>
                    <strong>{report.schoolIntelligence.studentDecision.level}</strong>
                    <h3>院校优势明显，竞争看个人准备</h3>
                    <p>{report.schoolIntelligence.studentDecision.whatItMeans[0]}</p>
                    <ul>
                      {report.schoolIntelligence.studentDecision.whatItMeans.slice(1).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className={styles.schoolCareerImpactIllustration}
                    height={1086}
                    src="/visuals/report-2026/12-school-career-impact.png"
                    unoptimized
                    width={1448}
                  />
                </article>
              </div>

              <details className={styles.schoolEvidenceDetails}>
                <summary>查看证据来源与数据缺口</summary>
                <div>
                  <section>
                    <h3>来源</h3>
                    <ol>
                      {report.schoolIntelligence.sources.map((source) => (
                        <li key={source.id}>
                          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                          <span>{source.publisher} · {source.grade}级证据</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3>仍需补充</h3>
                    <ul>
                      {report.schoolIntelligence.dataGaps.map((gap) => <li key={gap}>{gap}</li>)}
                    </ul>
                  </section>
                </div>
              </details>
                </div>
              </details>
            </section>
          ) : (
            <section className={styles.schoolIntelligenceUnavailable}>
              <div>
                <span>学校与专业</span>
                <h2>学校资料待补充</h2>
                <p>{report.schoolIntelligence.reason}</p>
              </div>
            </section>
          )}

          </MarketReportChapter>

          <MarketReportChapter
            index="03"
            title="市场情况"
            summary="岗位、企业与工作条件"
          >

          <section className={styles.marketEmploymentConditions} aria-labelledby="market-employment-conditions-title">
            <header>
              <div>
                <span>工作条件</span>
                <h2 id="market-employment-conditions-title">薪资、发展、城市、强度与福利</h2>
              </div>
              <small>{report.employmentConditions.sampleSize} 条岗位样本</small>
            </header>
            <div className={styles.marketConditionGrid}>
              {report.employmentConditions.items.map((item, index) => (
                <article data-status={item.status} key={item.id}>
                  <header>
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <div>
                      <span>{item.label}</span>
                      <small>{item.status === "available" ? "数据可用" : item.status === "partial" ? "部分可用" : "数据不足"}</small>
                    </div>
                  </header>
                  <strong>{item.headline}</strong>
                  {item.signals.length > 0 ? (
                    <div className={styles.marketConditionSignals}>
                      {item.signals.slice(0, 4).map((signal) => (
                        <span key={signal.label}>{signal.label}<b>{signal.count}</b></span>
                      ))}
                    </div>
                  ) : null}
                  <footer>
                    <span>怎么选</span>
                    <p>{item.tradeoff}</p>
                  </footer>
                </article>
              ))}
            </div>
            <p className={styles.marketConditionBoundary}>数据不足的项目暂不下结论。</p>
          </section>

          <section className={styles.marketDirectionDecision} aria-labelledby="market-direction-title">
            <header>
              <div>
                <span>市场方向</span>
                <h2 id="market-direction-title">岗位方向</h2>
              </div>
              <small>按当前岗位归类</small>
            </header>
            <div>
              {report.directions.recommendations.slice(0, 3).map((direction, index) => (
                <article key={direction.id}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <div>
                    <strong>{direction.label}</strong>
                    <span>{direction.jobCount} 个岗位 · {direction.companyCount} 家企业</span>
                    <small>{direction.sampleJobTitles.slice(0, 2).join(" · ") || "岗位样本待核验"}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.marketRoleSamples} aria-label="真实在招岗位样本">
            <header>
              <div>
                <span>真实岗位</span>
                <h2>在招岗位</h2>
              </div>
              <small>当前岗位样本</small>
            </header>
            <div>
              {report.directions.candidates.slice(0, 6).map((candidate) => (
                <article key={candidate.id}>
                <header>
                    <strong>{candidate.jobTitle}</strong>
                    <small>{candidate.companyType || candidate.jobType || "类型待核验"}</small>
                </header>
                  <p>{candidate.companyName}</p>
                  <dl className={styles.marketCandidateFacts}>
                              <div><dt>地域</dt><dd>{candidate.workLocation || "待核验"}</dd></div>
                              <div><dt>学历</dt><dd>{candidate.educationLevel || "待核验"}</dd></div>
                              <div><dt>届别</dt><dd>{candidate.graduationYear || "待核验"}</dd></div>
                              <div><dt>截止</dt><dd>{candidate.applyEndDate ? formatDate(candidate.applyEndDate) : "待核验"}</dd></div>
                              <div><dt>年薪</dt><dd>{candidate.salaryMin && candidate.salaryMax ? `${candidate.salaryMin}–${candidate.salaryMax}万` : candidate.salaryMin ? `${candidate.salaryMin}万起` : candidate.salaryMax ? `不高于${candidate.salaryMax}万` : "未公开"}</dd></div>
                  </dl>
                  <small>来源 {candidate.source || "待核验"} · 更新 {candidate.updatedAt ? formatDate(candidate.updatedAt) : fetchedAt}</small>
                </article>
              ))}
            </div>
            <p>岗位条件仍需查看企业公告，样本数量不等于可投数量。</p>
          </section>

          <section className={styles.marketReportAnalysis}>
            <article className={styles.marketHeatmap}>
              <header>
                <div>
                  <h3>地域与岗位分布</h3>
                  <span>
                    {heatmapMode === "history"
                      ? `近12个月数据库样本 ${report.history.sampleSize} 条`
                      : `当前报告样本 ${report.metrics.sampleSize} 条`}
                  </span>
                </div>
                <div className={styles.marketHeatmapSwitch} role="group" aria-label="热力图时间范围">
                  <button
                    aria-pressed={heatmapMode === "current"}
                    onClick={() => setHeatmapMode("current")}
                    type="button"
                  >当前</button>
                  <button
                    aria-pressed={heatmapMode === "history"}
                    onClick={() => setHeatmapMode("history")}
                    type="button"
                  >近12个月</button>
                </div>
              </header>
              {activeHeatmap && activeHeatmap.rows.length > 0 ? (
                <>
                  <div className={styles.marketHeatmapScroll}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col" />
                          {activeHeatmap.categories.map((item) => (
                            <th scope="col" key={item}>{item}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeHeatmap.rows.map((row) => (
                          <tr key={row.region}>
                            <th scope="row">{row.region}</th>
                            {row.values.map((value, index) => (
                              <td
                                data-highlight={activeHeatmap.bestMatches.some(
                                  (item) =>
                                    item.region === row.region
                                    && item.category === activeHeatmap.categories[index],
                                )}
                                data-level={reportHeatLevel(value, heatMaximum)}
                                key={`${row.region}-${activeHeatmap.categories[index]}`}
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.marketBestMatch}>
                    <i /> 深色区域代表岗位更集中
                  </p>
                </>
              ) : (
                <p className={styles.marketReportEmpty}>
                  当前筛选没有返回可用于分布分析的岗位样本。
                </p>
              )}
            </article>

          </section>

          </MarketReportChapter>

          <MarketReportChapter
            index="04"
            title="建议"
            summary="优势、短板与综合建议"
          >
            <section className={styles.marketStudentAssessment} aria-labelledby="market-student-assessment-title">
              <header>
                <div>
                  <span>个人评估</span>
                  <h2 id="market-student-assessment-title">优势与短板</h2>
                </div>
              </header>
              <div className={styles.marketAssessmentGrid}>
                <article data-kind="strength">
                  <header><span>优势</span></header>
                  <ol>
                    {report.studentAssessment.strengths.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <i>{index + 1}</i>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>
                <article data-kind="constraint">
                  <header><span>待补</span></header>
                  <ol>
                    {report.studentAssessment.constraints.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <i>{index + 1}</i>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>
                <aside>
                  <span>综合建议</span>
                  <strong>{report.studentAssessment.advice}</strong>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className={styles.marketAssessmentIllustration}
                    height={1254}
                    src="/visuals/report-2026/03-advice-target-path.png"
                    unoptimized
                    width={1254}
                  />
                </aside>
              </div>
            </section>
          </MarketReportChapter>

          <footer className={styles.marketReportFooter}>
            <button type="button" onClick={onExplain}>咨询这份报告</button>
            <button type="button" onClick={onChooseDirection}>
              选择求职方向
              <ArrowRight size={16} weight="bold" />
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

function FocusedDirectionSelector({
  profile,
  report,
  loading,
  error,
  selectedCareerTrackId,
  selectedCareerSubtrackId,
  selectedDirectionId,
  decisionSnapshot,
  onBackReport,
  onRetry,
  onSelectTrack,
  onSelectSubtrack,
  onSelectCandidate,
  onChangeTrack,
  onChangeSubtrack,
  onContinue,
  onPreviewRoute,
}: {
  profile: CareerProfile;
  report: MarketReportResult | null;
  loading: boolean;
  error: string | null;
  selectedCareerTrackId: string | null;
  selectedCareerSubtrackId: string | null;
  selectedDirectionId: string | null;
  decisionSnapshot: DecisionSystemSnapshot | null;
  onBackReport: () => void;
  onRetry: () => void;
  onSelectTrack: (trackId: string) => void;
  onSelectSubtrack: (subtrackId: string) => void;
  onSelectCandidate: (candidateId: string) => void;
  onChangeTrack: () => void;
  onChangeSubtrack: () => void;
  onContinue: () => void;
  onPreviewRoute: () => void;
}) {
  const selectedTrack = CAREER_TRACKS.find(
    (track) => track.id === selectedCareerTrackId,
  ) ?? null;
  const selectedSubtrack = selectedTrack?.subtracks.find(
    (subtrack) => subtrack.id === selectedCareerSubtrackId,
  ) ?? null;
  const allCandidates = report?.directions.candidates ?? [];
  const decisionAssessments = new Map(
    (report?.decisionModel.candidates ?? []).map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  );
  const currentCandidates = selectedTrack?.id === "state-owned" && selectedSubtrack
    ? dedupeMarketReportCandidates(
        allCandidates.filter((candidate) =>
          candidate.sectorIds.some((sectorId) => sectorId === selectedSubtrack.id),
        ),
      )
    : [];
  const selectedCandidate = currentCandidates.find(
    (candidate) => candidate.id === selectedDirectionId,
  ) ?? null;
  const initialVisibleCandidates = currentCandidates.slice(0, 12);
  const visibleCandidates = selectedCandidate
    && !initialVisibleCandidates.some((candidate) => candidate.id === selectedCandidate.id)
      ? [selectedCandidate, ...initialVisibleCandidates.slice(0, 11)]
      : initialVisibleCandidates;
  const currentStep = !selectedTrack ? 1 : !selectedSubtrack ? 2 : 3;
  const heading = currentStep === 1
    ? "先选你要进入的就业体系"
    : currentStep === 2
      ? `再选${selectedTrack?.label ?? "目标"}的细分方向`
      : "最后选择一个具体岗位";

  return (
    <section className={styles.directionPicker} aria-labelledby="direction-title">
      <header className={styles.directionPickerHeader}>
        <div>
          <span><Compass size={22} weight="duotone" /></span>
          <div>
            <small>求职方向 · 第 {currentStep} 层</small>
            <h1 id="direction-title">{heading}</h1>
            <p>{profile.major} · {profile.graduationYear} 届。每一屏只做一个决定。</p>
          </div>
        </div>
        <button type="button" onClick={onBackReport}>
          <ChartLineUp size={17} />
          查看求职报告
        </button>
      </header>

      <ol className={styles.directionSteps} aria-label="求职方向选择进度">
        <li data-current={currentStep === 1} data-complete={currentStep > 1}>
          <span>01</span><strong>就业赛道</strong><small>先选体系</small>
        </li>
        <li data-current={currentStep === 2} data-complete={currentStep > 2}>
          <span>02</span><strong>细分方向</strong><small>再选行业或招考类型</small>
        </li>
        <li data-current={currentStep === 3}>
          <span>03</span><strong>具体岗位</strong><small>只看真实岗位</small>
        </li>
      </ol>

      {selectedTrack ? (
        <div className={styles.directionPathSummary}>
          <span>已选路径</span>
          <button type="button" onClick={onChangeTrack}>{selectedTrack.label}</button>
          {selectedSubtrack ? (
            <>
              <ArrowRight size={13} />
              <button type="button" onClick={onChangeSubtrack}>{selectedSubtrack.label}</button>
            </>
          ) : null}
          {selectedCandidate ? (
            <>
              <ArrowRight size={13} />
              <strong>{selectedCandidate.jobTitle}</strong>
            </>
          ) : null}
        </div>
      ) : null}

      {currentStep === 1 ? (
        <div className={styles.directionTrackGrid}>
          {CAREER_TRACKS.map((track, index) => (
            <button
              className={styles.directionTrackCard}
              key={track.id}
              onClick={() => onSelectTrack(track.id)}
              type="button"
            >
              <header>
                <span>赛道 {String(index + 1).padStart(2, "0")}</span>
                <small>{track.dataStatus === "live" ? "岗位源已连接" : "岗位源待接入"}</small>
              </header>
              <strong>{track.label}</strong>
              <i>{track.shortLabel}</i>
              <p>{track.description}</p>
              <footer>
                <span>{track.subtracks.length} 个细分方向</span>
                <ArrowRight size={17} weight="bold" />
              </footer>
            </button>
          ))}
        </div>
      ) : null}

      {currentStep === 2 && selectedTrack ? (
        <>
          <div className={styles.directionLevelNote} role="note">
            <strong>{selectedTrack.label}</strong>
            <span>
              {selectedTrack.dataStatus === "live"
                ? "数量按公开企业与岗位文本初步归类；同一岗位可能命中多个标签，不能把各项直接相加。"
                : "选择细分方向后才读取对应岗位；更换这一层会清空已选岗位。"}
            </span>
          </div>
          <div className={styles.directionSubtrackGrid}>
            {selectedTrack.subtracks.map((subtrack, index) => {
              const candidateCount = selectedTrack.dataStatus === "live"
                ? allCandidates.filter((candidate) =>
                    candidate.sectorIds.some((sectorId) => sectorId === subtrack.id),
                  ).length
                : null;
              return (
                <button
                  className={styles.directionSubtrackCard}
                  key={subtrack.id}
                  onClick={() => onSelectSubtrack(subtrack.id)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{subtrack.label}</strong>
                    <p>{subtrack.description}</p>
                  </div>
                  <small>
                    {candidateCount === null
                      ? "岗位数据待接入"
                      : candidateCount > 0
                        ? `当前样本 ${candidateCount} 条`
                        : "当前样本暂无"}
                  </small>
                  <ArrowRight size={16} weight="bold" />
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {currentStep === 3 && selectedTrack && selectedSubtrack ? (
        selectedTrack.dataStatus === "pending" ? (
          <div className={styles.directionPickerState} role="status">
            <Database size={28} weight="duotone" />
            <strong>{selectedTrack.label}岗位数据源待接入</strong>
            <span>
              “{selectedSubtrack.label}”路线已经确定，但当前系统还没有对应的官方职位表或企业岗位源，因此不会生成假岗位。
            </span>
            {decisionSnapshot ? (
              <div className={styles.directionDecisionPreview} role="note">
                <small>当前决策</small>
                <strong>{decisionSnapshot.decision.headline}</strong>
                <span>{decisionSnapshot.decision.detail}</span>
              </div>
            ) : null}
            <div className={styles.directionPendingActions}>
              <button type="button" onClick={onPreviewRoute}>查看{selectedTrack.label}路线示例</button>
              <button type="button" onClick={onChangeSubtrack}>返回细分方向</button>
            </div>
          </div>
        ) : loading ? (
          <div className={styles.directionPickerState} role="status">
            <Database size={28} weight="duotone" />
            <strong>正在读取真实岗位</strong>
            <span>正在从主站持续更新的岗位接口读取候选，不让模型临时编造岗位。</span>
          </div>
        ) : error || !report ? (
          <div className={styles.directionPickerState} role="alert">
            <Warning size={28} weight="duotone" />
            <strong>真实岗位暂时无法读取</strong>
            <span>{error ?? "主站只读岗位源暂时不可用，请稍后重试。"}</span>
            <button type="button" onClick={onRetry}>重新读取</button>
          </div>
        ) : currentCandidates.length === 0 ? (
          <div className={styles.directionPickerState} role="status">
            <Compass size={28} weight="duotone" />
            <strong>本次样本中暂无“{selectedSubtrack.label}”岗位</strong>
            <span>这只代表当前返回的 {report.directions.sampleSize} 条候选没有命中，不代表市场上没有该类岗位。</span>
            <button type="button" onClick={onChangeSubtrack}>更换细分方向</button>
          </div>
        ) : (
          <>
            <div className={styles.directionPickerSource} role="note">
              <span>真实岗位</span>
              <strong>{report.directions.sourceLabel}</strong>
              <small>
                当前细分方向命中 {currentCandidates.length} 条，本页展示 {visibleCandidates.length} 条；岗位来自主站最新接口，行业为确定性归类，资格仍需逐岗核验。
              </small>
            </div>
            <div className={styles.directionJobGrid}>
              {visibleCandidates.map((candidate) => {
                const selected = candidate.id === selectedDirectionId;
                const assessment = decisionAssessments.get(candidate.id);
                return (
                  <button
                    aria-pressed={selected}
                    className={styles.directionJobCard}
                    data-selected={selected}
                    data-tier={assessment?.tier ?? "unclassified"}
                    key={candidate.id}
                    onClick={() => onSelectCandidate(candidate.id)}
                    type="button"
                  >
                    <header>
                      <span>{compactText(candidate.companyType, "企业类型待核验")}</span>
                      <small>{assessment?.tierLabel ?? "资格待核验"}</small>
                    </header>
                    <h2>{candidate.jobTitle}</h2>
                    <h3>{candidate.companyName}</h3>
                    <div>
                      <span>{compactText(candidate.workLocation, "地点待核验")}</span>
                      <span>{compactText(candidate.educationLevel, "学历待核验")}</span>
                      <span>{compactText(candidate.jobType, "招聘类型待核验")}</span>
                      {assessment ? <span>排序 {assessment.opportunityScore}</span> : null}
                    </div>
                    <p>{compactText(candidate.majorRequirements, "专业要求尚未提供可核验原文。")}</p>
                    {assessment ? (
                      <p className={styles.directionJobDecision}>{assessment.qualificationLabel} · {assessment.freshnessLabel}</p>
                    ) : null}
                    <footer>
                      <span>截止 {formatDate(candidate.applyEndDate)}</span>
                      <strong>{selected ? "已选为目标岗位" : "选择这个岗位"}</strong>
                      <Check size={16} weight="bold" />
                    </footer>
                  </button>
                );
              })}
            </div>
            {decisionSnapshot ? (
              <div className={styles.directionDecisionPreview} role="note">
                <small>当前决策</small>
                <strong>{decisionSnapshot.decision.headline}</strong>
                <span>{decisionSnapshot.decision.detail}</span>
              </div>
            ) : null}
            <footer className={styles.directionPickerFooter}>
              <div>
                <small>当前完整路径</small>
                <strong>
                  {selectedCandidate
                    ? `${selectedTrack.label} · ${selectedSubtrack.label} · ${selectedCandidate.jobTitle}`
                    : `${selectedTrack.label} · ${selectedSubtrack.label} · 尚未选择岗位`}
                </strong>
                <span>{selectedCandidate?.companyName ?? "从真实候选中选择一个岗位后继续。"}</span>
              </div>
              <button
                disabled={!selectedCandidate}
                onClick={onContinue}
                type="button"
              >
                确认岗位，生成规划路线
                <ArrowRight size={17} weight="bold" />
              </button>
            </footer>
          </>
        )
      ) : null}
    </section>
  );
}

function JobsView({
  profile,
  jobs,
  total,
  fetchedAt,
  loading,
  error,
  selectedJobs,
  keyword,
  setKeyword,
  onSearch,
  onReload,
  onToggle,
  onOpenStrategy,
}: {
  profile: CareerProfile | null;
  jobs: LiveJob[];
  total: number | null;
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
  selectedJobs: LiveJob[];
  keyword: string;
  setKeyword: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onReload: () => void;
  onToggle: (job: LiveJob) => void;
  onOpenStrategy: () => void;
}) {
  if (!profile) {
    return <EmptyState title="先完成学生档案" detail="岗位推荐必须知道你的学历、专业和届别。" />;
  }

  return (
    <div className={`${styles.viewStack} ${styles.jobsWorkspaceView}`}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>第二步 · 确定求职终点</p>
          <h1>从真实在招岗位里选择目标</h1>
          <p>首批结果按专业、学历与届别读取。最多同时选择 3 个岗位，系统会形成一张多目标求职网络。</p>
        </div>
        <div className={styles.pageHeadingActions}>
          <button className={styles.primaryButton} type="button" onClick={onOpenStrategy} disabled={selectedJobs.length === 0}>
            生成策略网络 · {selectedJobs.length}/3
          </button>
        </div>
      </header>

      <section className={styles.targetTray} aria-label="已选目标">
        <div>
          <span>已选目标</span>
          <strong>{selectedJobs.length === 0 ? "还没有选定终点" : `${selectedJobs.length} 条路径将合并规划`}</strong>
        </div>
        <div className={styles.targetChips}>
          {selectedJobs.map((job) => (
            <button key={job.id} type="button" onClick={() => onToggle(job)} title="移除目标">
              <span>{job.companyName}</span>
              <small>{job.jobTitle}</small>
            </button>
          ))}
        </div>
      </section>

      <form className={styles.jobSearch} onSubmit={onSearch}>
        <label htmlFor="job-keyword">搜索企业或岗位</label>
        <div>
          <input id="job-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：国家电网、软件开发、财务" />
          <button type="submit">搜索真实岗位</button>
          {keyword && <button type="button" className={styles.clearButton} onClick={() => { setKeyword(""); window.setTimeout(onReload, 0); }}>清除</button>}
        </div>
        <p>
          专业编码：{inferMajorCode(profile.major) ?? "无法可靠映射，已使用宽泛检索"} · 学历：{degreeForApi(profile.degreeLevel) ?? "未限定"} · {profile.graduationYear}届
        </p>
      </form>

      <div className={styles.dataBar}>
        <span>{total === null ? "等待读取岗位" : `上游共返回 ${total.toLocaleString("zh-CN")} 条符合检索条件的记录，本页展示前 ${jobs.length} 条`}</span>
        <span>读取时间：{formatDate(fetchedAt)}</span>
      </div>

      {loading && (
        <div className={styles.loadingList} aria-label="正在读取岗位">
          {[1, 2, 3].map((item) => <span key={item} />)}
        </div>
      )}

      {!loading && error && (
        <section className={styles.errorState} role="alert">
          <div><span>实时接口未返回结果</span><strong>{error}</strong></div>
          <button type="button" onClick={onReload}>重新读取</button>
        </section>
      )}

      {!loading && !error && jobs.length === 0 && (
        <EmptyState title="没有找到符合当前条件的岗位" detail="可以换一个企业或岗位关键词，也可以清空搜索查看宽泛结果。" />
      )}

      {!loading && !error && jobs.length > 0 && (
        <section className={styles.jobList} aria-live="polite">
          {jobs.map((job) => {
            const opening = convertLiveJobToOpening(job);
            const eligibility = opening ? evaluateEligibility(profile, opening) : null;
            const selected = selectedJobs.some((item) => item.id === job.id);
            const atLimit = selectedJobs.length >= 3 && !selected;
            return (
              <article className={selected ? `${styles.jobCard} ${styles.jobSelected}` : styles.jobCard} key={job.id}>
                <div className={styles.jobCardTop}>
                  <div className={styles.companyIdentity}>
                    <ImageInsertMarker kind="logo" label={`${job.companyName} 企业 Logo 图片位置`} />
                    <div>
                      <p>{job.companyName}</p>
                      <h2>{job.jobTitle}</h2>
                    </div>
                  </div>
                  {eligibility && (
                    <div className={`${styles.eligibilityBadge} ${statusClass(eligibility.status)}`}>
                      <ImageInsertMarker className={styles.eligibilityIconInsert} kind="icon" label="岗位资格状态图标位置" />
                      <strong>{ELIGIBILITY_COPY[eligibility.status].label}</strong>
                      <span>{ELIGIBILITY_COPY[eligibility.status].detail}</span>
                    </div>
                  )}
                </div>
                <div className={styles.jobFacts}>
                  <span>{job.companyType}</span>
                  <span>{job.jobType}</span>
                  <span>{compactText(job.workLocation, "地点待核验")}</span>
                  <span>{compactText(job.educationLevel, "学历待核验")}</span>
                  <span>{compactText(job.graduateYear, "届别待核验")}</span>
                </div>
                <p className={styles.majorRequirement}>{compactText(job.majorRequirements, "该岗位未提供可核验的专业文字要求。")}</p>
                <dl className={styles.jobSource}>
                  <div><dt>截止时间</dt><dd>{formatDate(job.applyEndDate)}</dd></div>
                  <div><dt>数据来源</dt><dd>{compactText(job.source)}</dd></div>
                  <div><dt>记录更新</dt><dd>{formatDate(job.updatedAt)}</dd></div>
                </dl>
                <footer className={styles.jobActions}>
                  <div>
                    {job.announcementUrl && <a href={job.announcementUrl} target="_blank" rel="noreferrer">查看岗位依据</a>}
                    {job.applyUrl && <a href={job.applyUrl} target="_blank" rel="noreferrer">前往投递页面</a>}
                  </div>
                  <button type="button" onClick={() => onToggle(job)} disabled={atLimit}>
                    {selected ? "移出目标" : atLimit ? "最多选择 3 个" : "选为目标岗位"}
                  </button>
                </footer>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function StrategyView({
  network,
  selectedJobs,
  products,
  intelligenceDecisions,
  decisionProfileKey,
  onChooseJobs,
  onOpenTasks,
}: {
  network: StrategyNetwork | null;
  selectedJobs: LiveJob[];
  products: LiveProduct[];
  intelligenceDecisions: Readonly<Record<string, IntelligenceDecisionEntry>>;
  decisionProfileKey: string;
  onChooseJobs: () => void;
  onOpenTasks: () => void;
}) {
  if (!network) {
    return (
      <EmptyState
        title="先选定至少一个目标岗位"
        detail="起点和终点确定后，系统才能把共同能力、企业分支和行动成本连成一张网络。"
        action={<button className={styles.primaryButton} type="button" onClick={onChooseJobs}>去选择岗位</button>}
      />
    );
  }

  const totalTasks = network.sharedTasks.length + network.branches.reduce((sum, branch) => sum + branch.tasks.length, 0);
  return (
    <div className={`${styles.viewStack} ${styles.strategyWorkspaceView}`}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>第三步 · 看清整张求职网络</p>
          <h1>共同准备一条主干，企业差异各走分支</h1>
          <p>本批次不能投不代表路径消失。系统会明确风险、保留长期目标，并把当前可执行的成本列出来。</p>
        </div>
        <div className={styles.pageHeadingActions}>
          <ImageInsertMarker className={styles.strategyHeroVisual} kind="graphic" label="策略网络主视觉位置" />
          <button className={styles.primaryButton} type="button" onClick={onOpenTasks}>进入 7 天行动</button>
        </div>
      </header>

      <section className={styles.strategyMetrics}>
        <div><ImageInsertMarker className={styles.strategyMetricInsert} kind="chart" label="目标岗位数量图形位置" /><span>目标岗位</span><strong>{network.targetJobIds.length}</strong></div>
        <div><ImageInsertMarker className={styles.strategyMetricInsert} kind="chart" label="共同任务数量图形位置" /><span>共同任务</span><strong>{network.sharedTasks.length}</strong></div>
        <div><ImageInsertMarker className={styles.strategyMetricInsert} kind="chart" label="全部行动数量图形位置" /><span>全部行动</span><strong>{totalTasks}</strong></div>
        <div><ImageInsertMarker className={styles.strategyMetricInsert} kind="chart" label="预计投入图形位置" /><span>预计投入</span><strong>{formatEffort(network.costSummary.totalEstimatedMinutes)}</strong></div>
      </section>

      <section className={styles.pathCostPanel} aria-labelledby="path-cost-title">
        <header>
          <div>
            <p>路径成本</p>
            <h2 id="path-cost-title">先看清这一周需要付出什么</h2>
          </div>
          <span>计划估算，不代表录用承诺</span>
        </header>
        <div className={styles.pathCostGrid}>
          <article>
            <span>时间成本</span>
            <strong>{formatEffort(network.costSummary.totalEstimatedMinutes)}</strong>
            <p>{totalTasks} 项可检查行动</p>
          </article>
          <article>
            <span>每周容量</span>
            <strong>{network.costSummary.weeklyCapacityMinutes === null ? "未提供" : formatEffort(network.costSummary.weeklyCapacityMinutes)}</strong>
            <p>{network.costSummary.utilizationPercent === null ? "填写投入时间后计算负荷" : `当前负荷 ${network.costSummary.utilizationPercent}%`}</p>
          </article>
          <article>
            <span>能力工作量</span>
            <strong>{network.costSummary.capabilityGapCount} 项</strong>
            <p>{network.costSummary.targetSpecificTaskCount} 项需要按目标单独完成</p>
          </article>
          <article>
            <span>现金支出</span>
            <strong>未估算</strong>
            <p>不把未知考试、交通或服务费用写成 0 元</p>
          </article>
        </div>
        {network.costSummary.weeklyCapacityMinutes !== null ? (
          <div
            className={styles.capacityMeter}
            data-over-capacity={network.costSummary.overflowMinutes > 0}
          >
            <div>
              <span style={{ transform: `scaleX(${Math.min(1, network.costSummary.totalEstimatedMinutes / network.costSummary.weeklyCapacityMinutes)})` }} />
            </div>
            <p>
              {network.costSummary.overflowMinutes > 0
                ? `按当前每周投入仍超出 ${formatEffort(network.costSummary.overflowMinutes)}，建议减少目标或延长周期。`
                : `按当前投入可以装入本周，并保留 ${formatEffort(network.costSummary.weeklyCapacityMinutes - network.costSummary.totalEstimatedMinutes)} 机动时间。`}
            </p>
          </div>
        ) : (
          <p className={styles.capacityUnknown}>当前没有每周可投入时间，系统只展示任务工作量，不推断你能否按期完成。</p>
        )}
        <footer>
          <span>耗时按任务类型统一估算，完成后可根据真实用时校正。</span>
          <span>{network.costSummary.optionalProductCount} 项可选服务；{network.costSummary.ownedServiceCount} 项已有功能可直接使用。</span>
        </footer>
      </section>

      <section className={styles.networkCanvas}>
        <div className={styles.startNode}>
          <ImageInsertMarker className={styles.startNodeVisualInsert} kind="avatar" label="学生起点头像或人物图形位置" />
          <span>你的起点</span>
          <strong>档案与能力现状</strong>
          <small>所有结论从这里出发</small>
        </div>
        <div className={styles.networkLine} aria-hidden="true" />
        <div className={styles.sharedNode}>
          <div className={styles.nodeHeading}>
            <div><span>共同主干</span><strong>{network.sharedTasks.length} 个可复用成果</strong></div>
            <ImageInsertMarker className={styles.sharedNodeVisualInsert} kind="graphic" label="共同能力主干图形位置" />
          </div>
          <div className={styles.sharedTasks}>
            {network.sharedTasks.map((task) => (
              <article key={task.id}>
                <span>第 {task.recommendedDay} 天</span>
                <strong>{task.title}</strong>
                <p>{task.completionCriteria}</p>
              </article>
            ))}
          </div>
        </div>
        <div className={styles.branchGrid}>
          {network.branches.map((branch) => {
            const copy = ELIGIBILITY_COPY[branch.eligibility.status];
            const rawJob = selectedJobs.find((job) => job.id === branch.jobId);
            const storedDecision = intelligenceDecisions[branch.jobId];
            const decisionEntry = storedDecision?.profileKey === decisionProfileKey
              ? storedDecision
              : undefined;
            const decision = decisionEntry?.status === "ready"
              ? decisionEntry.decision
              : undefined;
            const officialEvidence = decision
              ? verifiedOfficialEvidenceFromIntelligenceDecision(decision)[0]
              : undefined;
            const verificationSummary = decision
              ? officialVerificationSummaryFromIntelligenceDecision(decision)
              : undefined;
            const evidenceState = verificationSummary?.status === "live-failed"
              ? "verification-failed"
              : officialEvidence
                ? verificationSummary?.status === "live-verified"
                  ? "live-verified"
                  : "verified"
              : decisionEntry?.status === "ready"
                ? "uncovered"
                : decisionEntry?.status === "unavailable"
                  ? "unavailable"
                  : "loading";
            const unavailableMessage = decisionEntry?.status === "unavailable"
              ? {
                "not-covered": "该岗位尚未进入独立情报库，当前只保留主站岗位事实，不做资格推断。",
                "service-unavailable": "岗位数据暂时不可用，请稍后重试。",
                "invalid-response": "职业情报响应未通过结构或隐私校验，系统已拒绝采用这次结论。",
              }[decisionEntry.reason]
              : null;
            return (
              <article className={styles.branchCard} key={branch.jobId}>
                <header>
                  <ImageInsertMarker className={styles.branchLogoInsert} kind="logo" label={`${branch.company} 企业 Logo 位置`} />
                  <div><span>{branch.company}</span><h2>{branch.title}</h2></div>
                  <strong className={`${styles.branchStatus} ${statusClass(branch.eligibility.status)}`}>
                    {decision?.evaluation.routeLabel ?? copy.label}
                  </strong>
                </header>
                <p className={styles.branchNotice}>
                  {decision?.evaluation.actions[0] ?? (branch.eligibility.canApplyCurrentBatch
                    ? "当前可以继续按本批次准备，但录用结果仍取决于竞争与后续考核。"
                    : branch.eligibility.status === "not_eligible_current_batch"
                      ? "当前批次不满足，长期目标继续保留；先记录硬门槛并建立替代路线。"
                      : "资料不足，先核验未知项，再决定是否进入本批次投递。")}
                </p>
                <section className={styles.officialEvidencePanel} data-state={evidenceState}>
                  <header>
                    <span>官方证据</span>
                    <strong>
                      {officialEvidence
                        ? verificationSummary?.status === "live-verified"
                          ? `${officialEvidence.sourceGrade} 级 · 官网实时核验`
                          : `${officialEvidence.sourceGrade} 级 · 已核验快照`
                        : evidenceState === "verification-failed"
                          ? "官网本次无法核验"
                        : evidenceState === "loading"
                          ? "正在核验"
                          : evidenceState === "uncovered"
                            ? "待补官方原文"
                            : "本次未连接"}
                    </strong>
                  </header>
                  {officialEvidence ? (
                    <div>
                      <a href={officialEvidence.url} target="_blank" rel="noreferrer">
                        {officialEvidence.title}
                        <ArrowRight aria-hidden="true" size={13} weight="bold" />
                      </a>
                      <p>
                        {compactText(officialEvidence.publisher, "招聘单位官方页面")}
                        <span>
                          {verificationSummary?.status === "live-verified"
                            ? `本次核验 ${formatDateTime(verificationSummary.checkedAt)}`
                            : `证据快照 ${formatDate(officialEvidence.fetchedAt)}`}
                        </span>
                      </p>
                      {verificationSummary?.status === "live-verified" ? (
                        <small>仅核验公开岗位参数，未向招聘网站发送你的学生档案。</small>
                      ) : null}
                    </div>
                  ) : evidenceState === "verification-failed" ? (
                    <p>
                      企业官网在 {formatDateTime(verificationSummary?.checkedAt)}
                      未返回可确认结果；系统已停用旧快照的资格结论，稍后可重新核验。
                    </p>
                  ) : evidenceState === "loading" ? (
                    <p>正在通过独立只读情报库核对岗位原文，不会发送姓名、学校或联系方式。</p>
                  ) : evidenceState === "uncovered" ? (
                    <p>岗位快照已找到，但暂无 A/B 级已核验证据；所有硬门槛继续显示“未知”。</p>
                  ) : (
                    <p>{unavailableMessage}</p>
                  )}
                </section>
                <div className={styles.checkList}>
                  {branch.eligibility.checks.map((check) => (
                    <div key={`${branch.jobId}-${check.kind}`} data-outcome={check.outcome}>
                      <span>{check.outcome === "pass" ? "通过" : check.outcome === "fail" ? "不满足" : check.outcome === "conditional" ? "需确认" : "未知"}</span>
                      <p>{check.summary}</p>
                    </div>
                  ))}
                </div>
                <div className={styles.branchTasks}>
                  <span>企业专属分支</span>
                  {branch.tasks.map((task) => <p key={task.id}>{task.title}</p>)}
                </div>
                <footer>
                  <span>来源：{compactText(rawJob?.source)}</span>
                  <span>更新：{formatDate(rawJob?.updatedAt)}</span>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.productTriggerSection}>
        <div className={styles.sectionHeading}>
          <div><p>服务触发规则</p><h2>已有权益优先，可选产品只在真实卡点出现</h2></div>
          <span>主站已确认的功能会标记为直接使用；未确认的不会声称已购买</span>
        </div>
        {network.productTriggers.length > 0 ? (
          <div className={styles.productGrid}>
            {network.productTriggers.map((trigger) => {
              const product = productForOffering(products, trigger.productId);
              return (
                <article key={`${trigger.productId}:${trigger.category}`}>
                  <ImageInsertMarker className={styles.productImageInsert} kind="cover" label={`${trigger.productName} 产品封面图片位置`} />
                  <span>{categoryLabel(trigger.category)}</span>
                  <h3>{trigger.productName}</h3>
                  <p>{trigger.message}</p>
                  <small className={styles.productPrice}>
                    {product ? productPriceLabel(product) : "已有权益，不重复计费"}
                  </small>
                  {trigger.source === "entitlement" && trigger.actionUrl ? (
                    <a href={trigger.actionUrl} target="_blank" rel="noreferrer">直接使用已有功能</a>
                  ) : product ? (
                    <a href={product.purchaseUrl} target="_blank" rel="noreferrer">查看后台真实产品</a>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.noMarketing}>
            <strong>当前不触发产品营销</strong>
            <p>可能因为岗位资格仍待核验、目标本批次不可投，或后台没有对应卡点的在线产品。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function TasksView({
  network,
  completedTaskIds,
  onToggleTask,
  products,
  onChooseJobs,
  crossDevicePersistence,
}: {
  network: StrategyNetwork | null;
  completedTaskIds: string[];
  onToggleTask: (taskId: string) => void;
  products: LiveProduct[];
  onChooseJobs: () => void;
  crossDevicePersistence: boolean;
}) {
  if (!network) {
    return <EmptyState title="行动计划还没有起点" detail="先选定目标岗位，系统会自动形成接下来 7 天的可检查任务。" action={<button className={styles.primaryButton} type="button" onClick={onChooseJobs}>去选择目标</button>} />;
  }

  const taskMap = new Map<string, StrategyTask>([
    ...network.sharedTasks,
    ...network.branches.flatMap((branch) => branch.tasks),
  ].map((task) => [task.id, task]));
  const allTaskIds = [...taskMap.keys()];
  const completed = allTaskIds.filter((id) => completedTaskIds.includes(id)).length;
  const percent = allTaskIds.length ? Math.round((completed / allTaskIds.length) * 100) : 0;

  return (
    <div className={`${styles.viewStack} ${styles.tasksWorkspaceView}`}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>第四步 · 按成本执行</p>
          <h1>未来 7 天，只做能检查的动作</h1>
          <p>
            每个任务都有完成标准和计划耗时，预计总投入 {formatEffort(network.costSummary.totalEstimatedMinutes)}。
            {crossDevicePersistence
              ? "勾选结果会保存到你的匿名工作区，换设备连接主站后仍可继续。"
              : "勾选结果保存在本机，刷新页面后不会丢失。"}
          </p>
        </div>
        <div className={styles.taskProgress}>
          <ImageInsertMarker className={styles.taskProgressVisualInsert} kind="chart" label="七日行动完成度图形位置" />
          <span>已完成</span><strong>{completed}/{allTaskIds.length}</strong><small>{percent}%</small>
        </div>
      </header>

      <div className={styles.taskProgressTrack} aria-label={`行动完成 ${percent}%`}><span style={{ transform: `scaleX(${percent / 100})` }} /></div>

      <section className={styles.dayList}>
        {network.sevenDayPlan.map((day) => {
          const dayTasks = day.taskIds.map((id) => taskMap.get(id)).filter((task): task is StrategyTask => Boolean(task));
          return (
            <article className={styles.dayCard} key={day.day}>
              <header>
                <div><span>DAY {String(day.day).padStart(2, "0")}</span><strong>{day.focus}</strong></div>
                <ImageInsertMarker className={styles.dayGraphicInsert} kind="graphic" label={`第 ${day.day} 天行动主题图形位置`} />
                <time>{day.date}</time>
              </header>
              {dayTasks.length === 0 ? <p className={styles.restDay}>今天没有新增任务，用于消化前一天成果。</p> : (
                <div className={styles.dayTasks}>
                  {dayTasks.map((task) => {
                    const checked = completedTaskIds.includes(task.id);
                    const triggers = network.productTriggers.filter((trigger) => trigger.triggerAtTaskIds.includes(task.id));
                    return (
                      <div className={checked ? `${styles.taskRow} ${styles.taskDone}` : styles.taskRow} key={task.id}>
                        <button type="button" onClick={() => onToggleTask(task.id)} aria-pressed={checked} aria-label={checked ? `取消完成 ${task.title}` : `完成 ${task.title}`}><span aria-hidden="true" /></button>
                        <div>
                          <span>{task.scope === "shared" ? "共同任务" : "目标分支"} · {task.priority === "high" ? "高优先级" : task.priority === "medium" ? "中优先级" : "低优先级"} · 预计 {formatEffort(task.estimatedMinutes)}</span>
                          <h2>{task.title}</h2>
                          <p>{task.description}</p>
                          <small>完成标准：{task.completionCriteria}</small>
                          {triggers.map((trigger) => {
                            const product = productForOffering(products, trigger.productId);
                            return (
                              <aside className={styles.inlineProduct} key={`${trigger.productId}:${trigger.category}`}>
                                <ImageInsertMarker className={styles.inlineProductVisualInsert} kind="cover" label={`${trigger.productName} 服务缩略图位置`} />
                                <div><span>此处出现服务入口，因为任务遇到{categoryLabel(trigger.category)}</span><strong>{trigger.productName}</strong></div>
                                {trigger.source === "entitlement" && trigger.actionUrl ? (
                                  <a href={trigger.actionUrl} target="_blank" rel="noreferrer">直接使用已有功能</a>
                                ) : product ? (
                                  <a href={product.purchaseUrl} target="_blank" rel="noreferrer">作为可选帮助查看</a>
                                ) : null}
                              </aside>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function AdvisorView({
  profile,
  selectedDirection,
  decisionSnapshot,
  selectedJobs,
  network,
  products,
  status,
  focused = false,
  onEditProfile,
  onViewReport,
  entryContext = null,
}: {
  profile: CareerProfile | null;
  selectedDirection: SelectedCareerPathSummary | null;
  decisionSnapshot: DecisionSystemSnapshot | null;
  selectedJobs: LiveJob[];
  network: StrategyNetwork | null;
  products: LiveProduct[];
  status: SystemStatus | null;
  focused?: boolean;
  onEditProfile?: () => void;
  onViewReport?: () => void;
  entryContext?: AdvisorEntryContext;
}) {
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const ready = Boolean(
    status?.ragConfigured &&
      (status?.aiConfigured ?? status?.difyConfigured) &&
      status?.advisorProtected &&
      status?.advisorAccessEnabled,
  );
  const focusedTriggers = (network?.productTriggers ?? [])
    .map((trigger) => ({
      trigger,
      product: productForOffering(products, trigger.productId),
    }))
    .filter(({ trigger, product }) =>
      (trigger.source === "entitlement" && Boolean(trigger.actionUrl))
      || Boolean(product),
    )
    .slice(0, 2);

  useEffect(() => () => {
    const activeRequest = requestController.current;
    requestController.current = null;
    activeRequest?.abort();
  }, []);

  const resetConversation = useCallback(() => {
    requestController.current?.abort();
    requestController.current = null;
    setMessages([]);
    setConversationId(null);
    setSending(false);
  }, []);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || !profile || !ready || sending) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content: message }]);
    setSending(true);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          conversationId,
          history: messages
            .filter((entry) => entry.role === "user" || entry.role === "assistant")
            .slice(-4)
            .map((entry) => ({
              role: entry.role,
              content: entry.content.slice(0, 600),
            })),
          profileSummary: profileSummary(profile),
          targetSummary: [
            selectedDirection
              ? `已选求职路径：${selectedDirection.label}`
              : "",
            decisionSnapshot?.advisorContext ?? "",
            targetSummary(selectedJobs),
          ].filter(Boolean).join("；"),
          profile: {
            degreeLevel: profile.degreeLevel,
            major: profile.major,
            graduationYear: profile.graduationYear,
            schoolTier: profile.schoolTier,
          },
          target: {
            companies: [...new Set([
              selectedDirection?.candidate?.companyName ?? "",
              ...selectedJobs.map((job) => job.companyName),
            ].filter(Boolean))],
            jobTitles: [...new Set([
              selectedDirection?.candidate?.jobTitle ?? "",
              ...selectedJobs.map((job) => job.jobTitle),
            ].filter(Boolean))],
          },
          filters: {
            validAt: new Date().toISOString().slice(0, 10),
            status: "unknown",
          },
        }),
      });
      const data = await response.json() as {
        available?: boolean;
        answer?: string;
        conversationId?: string | null;
        citedSourceIds?: string[];
        citations?: AdvisorCitation[];
        error?: { message?: string };
      };
      if (!response.ok || !data.available || !data.answer) {
        throw new Error(data.error?.message ?? "AI 顾问暂时无法完成回答。");
      }
      const citedSourceIds = new Set(
        Array.isArray(data.citedSourceIds)
          ? data.citedSourceIds.filter((id): id is string => typeof id === "string")
          : [],
      );
      const groundedCitations = Array.isArray(data.citations)
        ? data.citations.filter((citation) => citedSourceIds.has(citation.id))
        : [];
      if (groundedCitations.length === 0) {
        throw new Error("回答引用依据无法核验，本次结果已停止展示。");
      }
      setConversationId(data.conversationId ?? null);
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer ?? "",
        citations: groundedCitations,
      }]);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessages((current) => [...current, {
        id: `system-${Date.now()}`,
        role: "system",
        content: error instanceof Error ? error.message : "AI 顾问暂时无法完成回答。",
      }]);
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setSending(false);
      }
    }
  }, [
    conversationId,
    messages,
    profile,
    ready,
    decisionSnapshot,
    selectedDirection,
    selectedJobs,
    sending,
  ]);

  if (focused) {
    const suggestions = entryContext === "report-explain"
      ? [
          "解释我为什么处于同类中位",
          "报告中哪些结论需要真实数据支持",
          "我最大的提升杠杆是什么",
        ]
      : entryContext === "route-action"
        ? [
            `围绕“${decisionSnapshot?.decision.nextAction ?? "第一项行动"}”生成今天的执行清单`,
            "先核验这个目标的硬门槛和时间依据",
            "哪些数据还不完整，暂时不能下什么结论",
          ]
        : entryContext === "direction-selected"
          ? [
              `按照“${selectedDirection?.label ?? "已选方向"}”给我制定 30 天计划`,
              "这个方向最先要补哪项能力",
              "从候选岗位里帮我继续缩小企业和岗位",
            ]
          : selectedJobs.length
          ? [
          "比较我当前目标岗位的硬门槛",
          "根据我的缺口安排未来 3 个月",
          "告诉我本周最该做的三件事",
            ]
          : [
          "根据我的专业推荐正在招聘的岗位",
          "帮我制定未来三个月的求职计划",
          "我适合哪些央国企方向",
            ];
    const emptyTitle = entryContext === "report-explain"
      ? `${profile?.name ?? "同学"}，想先解释报告里的哪一部分？`
      : entryContext === "route-action"
        ? `当前决策：${decisionSnapshot?.decision.headline ?? "先完成第一项行动"}`
        : entryContext === "direction-selected"
          ? `已选择“${selectedDirection?.label ?? "主求职方向"}”，接下来继续收窄目标`
          : `${profile?.name ?? "同学"}，今天想先解决什么？`;

    return (
      <section className={styles.focusedAdvisor}>
        <header className={styles.focusedAdvisorHeader}>
          <div>
            <strong>求职顾问</strong>
            <span data-ready={ready}>
              <i />
              {ready ? "基于真实知识库回答" : "知识服务正在连接"}
            </span>
          </div>
          <div>
            {profile && onViewReport ? (
              <button type="button" onClick={onViewReport}>
                查看报告
              </button>
            ) : null}
            {profile ? (
              <button type="button" onClick={onEditProfile}>
                <UserFocus size={17} />
                修改资料
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetConversation}
              disabled={messages.length === 0 && !sending}
            >
              <Plus size={17} />
              新对话
            </button>
          </div>
        </header>

        {!profile ? (
          <div className={styles.focusedAdvisorEmpty}>
            <Image
              alt=""
              aria-hidden="true"
              className={styles.focusedAdvisorIllustration}
              height={1254}
              priority
              src="/visuals/report-2026/05-chat-guidance.png"
              unoptimized
              width={1254}
            />
            <h1>先填写一份个人资料</h1>
            <p>只需填写学校、专业、届别和求职偏好，顾问才能结合你的真实情况回答。</p>
            <button type="button" onClick={onEditProfile}>
              填写个人资料
            </button>
          </div>
        ) : ready ? (
          <AdvisorThread
            ariaLabel="基于真实知识库的求职顾问"
            className={styles.focusedAdvisorThread}
            disabled={!ready}
            emptyDescription={`${profile.major} · ${profile.graduationYear} 届。你可以直接问目标岗位、准备成本或下一步行动。`}
            emptyTitle={emptyTitle}
            emptyVisual={(
              <Image
                alt=""
                aria-hidden="true"
                className={styles.focusedAdvisorIllustration}
                height={1254}
                priority
                src="/visuals/report-2026/05-chat-guidance.png"
                unoptimized
                width={1254}
              />
            )}
            isRunning={sending}
            messages={messages}
            onSend={sendMessage}
            placeholder="输入你的求职问题"
            styles={styles}
            suggestions={suggestions}
            contextualActions={focusedTriggers.length > 0 ? (
              <aside className={styles.focusedAdvisorTriggers} aria-label="当前卡点可用服务">
                <header>
                  <strong>当前卡点可用帮助</strong>
                  <span>确认目标后按能力缺口出现</span>
                </header>
                <div>
                  {focusedTriggers.map(({ trigger, product }) => (
                    <article key={`${trigger.productId}:${trigger.category}`}>
                      <span>{trigger.status === "owned_available" ? "已有功能" : "可选服务"}</span>
                      <strong>{trigger.productName}</strong>
                      <small>{trigger.message}</small>
                      {trigger.source === "entitlement" && trigger.actionUrl ? (
                        <a href={trigger.actionUrl}>直接使用</a>
                      ) : product ? (
                        <a href={product.purchaseUrl} rel="noreferrer" target="_blank">了解服务</a>
                      ) : null}
                    </article>
                  ))}
                </div>
              </aside>
            ) : undefined}
          />
        ) : (
          <div className={styles.focusedAdvisorOffline}>
            <Image
              alt=""
              aria-hidden="true"
              className={styles.focusedAdvisorIllustration}
              height={1254}
              src="/visuals/report-2026/05-chat-guidance.png"
              unoptimized
              width={1254}
            />
            <h1>对话功能正在连接</h1>
            <p>
              为避免给出没有依据的答案，知识库、AI 服务和访问许可全部就绪后才会开放提问。
            </p>
            <div>
              <span data-ready={Boolean(status?.ragConfigured)}>知识库</span>
              <span data-ready={Boolean(status?.aiConfigured ?? status?.difyConfigured)}>AI 服务</span>
              <span data-ready={Boolean(status?.advisorAccessEnabled)}>访问许可</span>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={`${styles.viewStack} ${styles.advisorWorkspaceView}`}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>第五步 · 用知识库解释策略</p>
          <h1>AI 可以解释，但不能替代硬规则</h1>
          <p>学历、专业、届别和截止时间由确定性规则判断；AI 只在检索到真实资料后负责解释与规划。</p>
        </div>
        <div className={styles.systemPills}>
          <StatusPill ok={Boolean(status?.ragConfigured)}>RAG 检索</StatusPill>
          <StatusPill ok={Boolean(status?.aiConfigured ?? status?.difyConfigured)}>AI 服务</StatusPill>
          <StatusPill ok={Boolean(status?.advisorProtected)}>会话保护</StatusPill>
          <StatusPill ok={Boolean(status?.advisorAccessEnabled)}>访问许可</StatusPill>
        </div>
      </header>

      {!profile ? (
        <EmptyState title="先完成学生档案" detail="AI 顾问需要知道你的真实起点，才能给出个性化建议。" />
      ) : (
        <section className={styles.advisorLayout}>
          <div className={styles.advisorMain}>
            {!ready && (
              <div className={styles.advisorOffline}>
                <ImageInsertMarker className={styles.advisorKnowledgeInsert} kind="graphic" label="知识库检索与依据关系图位置" />
                <span>当前保持关闭</span>
                <h2>知识库或 AI 服务尚未完成配置</h2>
                <p>系统不会用模型常识冒充知识库。接入检索、AI 服务、会话保护与访问许可后才会开放。</p>
                <dl>
                  <div><dt>实时岗位</dt><dd>{status?.zhidaLive ? "已连接" : "不可用"}</dd></div>
                  <div><dt>知识库检索</dt><dd>{status?.ragConfigured ? "已配置" : "待配置"}</dd></div>
                  <div><dt>AI 服务</dt><dd>{(status?.aiConfigured ?? status?.difyConfigured) ? "已配置" : "待配置"}</dd></div>
                  <div><dt>会话保护</dt><dd>{status?.advisorProtected ? "已配置" : "待配置"}</dd></div>
                  <div><dt>访问许可</dt><dd>{status?.advisorAccessEnabled ? "公开库测试" : "待登录"}</dd></div>
                </dl>
              </div>
            )}

            {ready ? (
              <AdvisorThread
                ariaLabel="基于真实知识库的求职顾问"
                disabled={!ready}
                emptyDescription="问题会同时带上你的学生档案和已选岗位；回答只有在依据校验通过后才会显示。"
                emptyTitle="从当前目标开始规划"
                isRunning={sending}
                messages={messages}
                onSend={sendMessage}
                placeholder="例如：我选的三个岗位，哪些能力可以共同准备？"
                styles={styles}
                suggestions={["比较我选的岗位硬门槛", "根据当前缺口安排未来 3 个月", "解释某个岗位的准备重点"]}
              />
            ) : (
              <div className={styles.advisorDisabledComposer}>
                <ChatsCircle size={22} weight="duotone" />
                <ImageInsertMarker className={styles.advisorAvatarInsert} kind="avatar" label="AI 顾问头像或品牌形象位置" />
                <div><strong>提问入口尚未开放</strong><span>无检索结果、无有效引用或流程中断时，系统会拒绝作答。</span></div>
              </div>
            )}
          </div>

          <aside className={styles.advisorContext}>
            <ImageInsertMarker className={styles.advisorProfileInsert} kind="avatar" label="学生规划上下文头像位置" />
            <span>本次规划上下文</span>
            <h2>{profile.name}</h2>
            <dl>
              <div><dt>学校</dt><dd>{profile.school}</dd></div>
              <div><dt>专业</dt><dd>{profile.major}</dd></div>
              <div><dt>届别</dt><dd>{profile.graduationYear}届</dd></div>
              <div><dt>每周投入</dt><dd>{profile.availableHoursPerWeek}小时</dd></div>
            </dl>
            <div className={styles.contextTargets}>
              <span>已选目标</span>
              {selectedJobs.length ? selectedJobs.map((job) => (
                <p key={job.id}>
                  <ImageInsertMarker className={styles.contextTargetLogoInsert} kind="logo" label={`${job.companyName} 企业 Logo 位置`} />
                  <span>{job.companyName}<small>{job.jobTitle}</small></span>
                </p>
              )) : <p>尚未选择岗位</p>}
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}

export function AgentWorkspace({
  variant = "classic",
}: {
  variant?: WorkspaceVariant;
}) {
  const studio = variant === "studio";
  const [activeView, setActiveView] = useState<ViewId>("profile");
  const [advisorEntryContext, setAdvisorEntryContext] =
    useState<AdvisorEntryContext>(null);
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [marketReport, setMarketReport] =
    useState<MarketReportResult | null>(null);
  const [selectedCareerTrackId, setSelectedCareerTrackId] =
    useState<string | null>(null);
  const [selectedCareerSubtrackId, setSelectedCareerSubtrackId] =
    useState<string | null>(null);
  const [selectedDirectionId, setSelectedDirectionId] =
    useState<string | null>(null);
  const [marketReportLoading, setMarketReportLoading] = useState(false);
  const [marketReportError, setMarketReportError] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState<number | null>(null);
  const [jobsFetchedAt, setJobsFetchedAt] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<LiveJob[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [bridgeSession, setBridgeSession] = useState<BridgeSessionStatus | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeStarting, setBridgeStarting] = useState(false);
  const [workspaceSync, setWorkspaceSync] =
    useState<WorkspaceSyncStatus | null>(null);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceSyncError, setWorkspaceSyncError] = useState<string | null>(
    null,
  );
  const [intelligenceDecisions, setIntelligenceDecisions] = useState<
    Record<string, IntelligenceDecisionEntry>
  >({});
  const requestNumber = useRef(0);
  const marketReportRequestNumber = useRef(0);
  const localPathSavedAt = useRef(0);
  const localPathStateKey = useRef<string | null>(null);
  const remoteWorkspaceRevision = useRef(0);
  const remoteWorkspaceStateKey = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredWorkspace();
      if (stored) {
        localPathSavedAt.current = stored.pathSavedAt;
        localPathStateKey.current = remoteWorkspaceKey(
          remoteWorkspaceState(
            stored.selectedJobs,
            stored.completedTaskIds,
          ),
        );
        setProfile(stored.profile);
        setSelectedCareerTrackId(stored.selectedCareerTrackId);
        setSelectedCareerSubtrackId(stored.selectedCareerSubtrackId);
        setSelectedDirectionId(stored.selectedDirectionId);
        setSelectedJobs(stored.selectedJobs);
        setCompletedTaskIds(stored.completedTaskIds);
        if (stored.profile) {
          setDraft(draftFromProfile(stored.profile));
          setActiveView(studio ? "advisor" : stored.selectedJobs.length ? "strategy" : "jobs");
        }
      }
      const requestedView = new URLSearchParams(window.location.search).get("view");
      const requestedViewAllowed = studio
        ? requestedView === "directions"
          || requestedView === "roadmap"
          || FOCUSED_NAV_ITEMS.some((item) => item.id === requestedView)
        : NAV_ITEMS.some((item) => item.id === requestedView);
      if (requestedView && requestedViewAllowed) {
        setActiveView(requestedView as ViewId);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studio]);

  useEffect(() => {
    if (!hydrated) return;
    const pathState = remoteWorkspaceState(selectedJobs, completedTaskIds);
    const pathStateKey = remoteWorkspaceKey(pathState);
    if (localPathStateKey.current === null) {
      localPathStateKey.current = pathStateKey;
    } else if (localPathStateKey.current !== pathStateKey) {
      localPathStateKey.current = pathStateKey;
      localPathSavedAt.current = Date.now();
    }
    const snapshot: StoredWorkspace = {
      version: 1,
      savedAt: Date.now(),
      pathSavedAt: localPathSavedAt.current,
      profile,
      selectedCareerTrackId,
      selectedCareerSubtrackId,
      selectedDirectionId,
      selectedJobs,
      completedTaskIds,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    completedTaskIds,
    hydrated,
    profile,
    selectedCareerSubtrackId,
    selectedCareerTrackId,
    selectedDirectionId,
    selectedJobs,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    let cancelled = false;

    const hydrateRemoteWorkspace = async () => {
      try {
        const response = await fetch("/api/workspace", {
          cache: "no-store",
          signal: controller.signal,
        });
        const raw: unknown = await response.json();
        const parsed = parseWorkspaceSyncStatus(raw);
        if (cancelled) return;
        if (!parsed) {
          setWorkspaceSyncError("跨设备进度返回格式不正确，本机记录仍会保留。");
          setWorkspaceHydrated(true);
          return;
        }
        setWorkspaceSync(parsed);
        if (
          response.ok &&
          parsed.connected &&
          parsed.persistence &&
          parsed.state
        ) {
          remoteWorkspaceRevision.current = parsed.revision;
          remoteWorkspaceStateKey.current = remoteWorkspaceKey(parsed.state);
          const remoteIsAuthoritative =
            parsed.revision > 0 &&
            (localPathSavedAt.current === 0 ||
              (parsed.updatedAt ?? 0) >= localPathSavedAt.current);
          if (remoteIsAuthoritative) {
            localPathSavedAt.current = parsed.updatedAt ?? Date.now();
            localPathStateKey.current = remoteWorkspaceKey(parsed.state);
            setSelectedJobs(parsed.state.selectedJobs);
            setCompletedTaskIds(parsed.state.completedTaskIds);
          }
        }
        setWorkspaceSyncError(null);
        setWorkspaceHydrated(true);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setWorkspaceSyncError("跨设备进度暂时不可用，本机记录仍会保留。");
        setWorkspaceHydrated(true);
      }
    };

    void hydrateRemoteWorkspace();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hydrated]);

  useEffect(() => {
    if (
      !hydrated ||
      !workspaceHydrated ||
      !workspaceSync?.connected ||
      !workspaceSync.persistence
    ) {
      return;
    }
    const state = remoteWorkspaceState(selectedJobs, completedTaskIds);
    const stateKey = remoteWorkspaceKey(state);
    if (stateKey === remoteWorkspaceStateKey.current) {
      setWorkspaceSaving(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setWorkspaceSaving(true);
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: remoteWorkspaceRevision.current,
            state,
          }),
          signal: controller.signal,
        });
        if (response.status === 409) {
          const latestResponse = await fetch("/api/workspace", {
            cache: "no-store",
            signal: controller.signal,
          });
          const latest = parseWorkspaceSyncStatus(await latestResponse.json());
          if (
            !cancelled &&
            latestResponse.ok &&
            latest?.connected &&
            latest.persistence &&
            latest.state
          ) {
            remoteWorkspaceRevision.current = latest.revision;
            remoteWorkspaceStateKey.current = remoteWorkspaceKey(latest.state);
            localPathSavedAt.current = latest.updatedAt ?? Date.now();
            localPathStateKey.current = remoteWorkspaceStateKey.current;
            setSelectedJobs(latest.state.selectedJobs);
            setCompletedTaskIds(latest.state.completedTaskIds);
            setWorkspaceSync(latest);
            setWorkspaceSyncError(
              "另一台设备刚刚更新了进度，已切换到最新版本。",
            );
          }
          return;
        }
        const saved = parseWorkspaceSyncStatus(await response.json());
        if (
          !response.ok ||
          !saved?.connected ||
          !saved.persistence ||
          !saved.state
        ) {
          throw new Error("workspace save failed");
        }
        if (!cancelled) {
          remoteWorkspaceRevision.current = saved.revision;
          remoteWorkspaceStateKey.current = stateKey;
          localPathSavedAt.current = saved.updatedAt ?? Date.now();
          localPathStateKey.current = stateKey;
          setWorkspaceSync(saved);
          setWorkspaceSyncError(null);
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setWorkspaceSyncError("跨设备进度暂时未保存，本机记录仍会保留。");
      } finally {
        if (!cancelled) setWorkspaceSaving(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    completedTaskIds,
    hydrated,
    selectedJobs,
    workspaceHydrated,
    workspaceSync?.connected,
    workspaceSync?.persistence,
  ]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeView]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch("/api/products", { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { products?: LiveProduct[] };
        if (!response.ok) throw new Error("products unavailable");
        if (!cancelled) setProducts(Array.isArray(data.products) ? data.products : []);
      }),
      fetch("/api/system/status").then(async (response) => {
        const data = await response.json() as SystemStatus;
        if (!response.ok) throw new Error("status unavailable");
        if (!cancelled) setStatus(data);
      }),
      fetch("/api/zhida-connect/session", { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as BridgeSessionStatus;
        if (!response.ok) throw new Error("bridge unavailable");
        if (!cancelled) setBridgeSession(data);
      }),
    ]).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const loadMarketReport = useCallback(async () => {
    if (!profile) return;
    const currentRequest = ++marketReportRequestNumber.current;
    setMarketReportLoading(true);
    setMarketReportError(null);

    try {
      const response = await fetch("/api/market-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          profile: {
            degreeLevel: profile.degreeLevel,
            school: profile.school,
            major: profile.major,
            graduationYear: profile.graduationYear,
            schoolTier: profile.schoolTier,
            city: profile.city,
            preferredCities: profile.preferredCities,
            availableHoursPerWeek: profile.availableHoursPerWeek,
            capabilityLevels: profile.capabilityLevels,
          },
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload
          && typeof payload === "object"
          && !Array.isArray(payload)
          && "error" in payload
          && payload.error
          && typeof payload.error === "object"
          && !Array.isArray(payload.error)
          && "message" in payload.error
          && typeof payload.error.message === "string"
            ? payload.error.message
            : "真实岗位服务暂时不可用，请稍后重试。";
        throw new Error(message);
      }
      if (!isMarketReportResult(payload)) {
        throw new Error("市场报告返回格式不完整，请稍后重试。");
      }
      if (marketReportRequestNumber.current !== currentRequest) return;
      setMarketReport(payload);
    } catch (error) {
      if (marketReportRequestNumber.current !== currentRequest) return;
      setMarketReportError(
        error instanceof Error
          ? error.message
          : "真实岗位服务暂时不可用，请稍后重试。",
      );
    } finally {
      if (marketReportRequestNumber.current === currentRequest) {
        setMarketReportLoading(false);
      }
    }
  }, [profile]);

  useEffect(() => {
    if (
      !studio
      || (
        activeView !== "report"
        && activeView !== "directions"
        && activeView !== "roadmap"
      )
      || !profile
      || marketReport
    ) {
      return;
    }
    const timer = window.setTimeout(() => void loadMarketReport(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadMarketReport, marketReport, profile, studio]);

  const loadJobs = useCallback(async (searchKeyword = "") => {
    if (!profile) return;
    const currentRequest = ++requestNumber.current;
    setJobsLoading(true);
    setJobsError(null);
    const params = new URLSearchParams();
    const majorCode = inferMajorCode(profile.major);
    const educationLevel = degreeForApi(profile.degreeLevel);
    if (majorCode) params.set("majorCode", majorCode);
    if (educationLevel) params.set("educationLevel", educationLevel);
    params.set("graduationYear", String(profile.graduationYear));
    if (searchKeyword.trim()) params.set("keyword", searchKeyword.trim());

    try {
      const response = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as {
        jobs?: LiveJob[];
        total?: number;
        fetchedAt?: string;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(data.error?.message ?? "实时岗位服务暂时不可用。");
      if (requestNumber.current !== currentRequest) return;
      setJobs(Array.isArray(data.jobs) ? data.jobs.filter(isLiveJob) : []);
      setJobsTotal(typeof data.total === "number" ? data.total : null);
      setJobsFetchedAt(data.fetchedAt ?? null);
    } catch (error) {
      if (requestNumber.current !== currentRequest) return;
      setJobs([]);
      setJobsTotal(null);
      setJobsFetchedAt(null);
      setJobsError(error instanceof Error ? error.message : "实时岗位服务暂时不可用。");
    } finally {
      if (requestNumber.current === currentRequest) setJobsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs, profile]);

  const decisionProfile = useMemo(
    () => profile ? intelligenceProfileForDecision(profile) : null,
    [profile],
  );
  const decisionProfileKey = useMemo(
    () => decisionProfile ? JSON.stringify(decisionProfile) : "",
    [decisionProfile],
  );

  useEffect(() => {
    if (!decisionProfile || !decisionProfileKey || selectedJobs.length === 0) {
      return;
    }

    const controller = new AbortController();
    const targets = selectedJobs.slice(0, 3);

    void Promise.all(targets.map(async (job): Promise<[string, IntelligenceDecisionEntry]> => {
      if (!/^\d+$/u.test(job.id)) {
        return [job.id, {
          status: "unavailable",
          reason: "not-covered",
          profileKey: decisionProfileKey,
        }];
      }

      try {
        const response = await fetch("/api/intelligence/v1/decisions/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, profile: decisionProfile }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          return [job.id, {
            status: "unavailable",
            reason: "not-covered",
            profileKey: decisionProfileKey,
          }];
        }
        if (!response.ok) {
          return [job.id, {
            status: "unavailable",
            reason: "service-unavailable",
            profileKey: decisionProfileKey,
          }];
        }

        const payload: unknown = await response.json();
        if (
          !isIntelligenceDecisionResponse(payload)
          || payload.context.job.externalJobId !== job.id
        ) {
          return [job.id, {
            status: "unavailable",
            reason: "invalid-response",
            profileKey: decisionProfileKey,
          }];
        }
        return [job.id, {
          status: "ready",
          decision: payload,
          profileKey: decisionProfileKey,
        }];
      } catch {
        return [job.id, {
          status: "unavailable",
          reason: "service-unavailable",
          profileKey: decisionProfileKey,
        }];
      }
    })).then((entries) => {
      if (!controller.signal.aborted) {
        setIntelligenceDecisions(Object.fromEntries(entries));
      }
    });

    return () => controller.abort();
  }, [decisionProfile, decisionProfileKey, selectedJobs]);

  const openings = useMemo(
    () => convertLiveJobsToOpenings(selectedJobs),
    [selectedJobs],
  );
  const offerings = useMemo(() => toProductOfferings(products), [products]);
  const capabilityEntitlements = useMemo(
    () => (bridgeSession?.connected ? bridgeSession.entitlements ?? [] : []).map((entitlement) => ({
      code: entitlement.code,
      name: entitlement.name,
      category: entitlement.category,
      actionUrl: entitlementActionUrl(entitlement.routePath),
      dailyLimit: entitlement.dailyLimit,
    })),
    [bridgeSession],
  );
  const intelligenceEligibilityByJobId = useMemo(() => {
    const result: Record<string, EligibilityResult> = {};
    for (const opening of openings) {
      const entry = intelligenceDecisions[opening.id];
      if (
        entry?.status === "ready"
        && entry.profileKey === decisionProfileKey
      ) {
        result[opening.id] = eligibilityFromIntelligenceDecision(entry.decision);
      }
    }
    return result;
  }, [decisionProfileKey, intelligenceDecisions, openings]);
  const network = useMemo(() => {
    if (!profile || openings.length === 0) return null;
    try {
      return buildStrategyNetwork({
        profile: { ...profile, ownedProductIds: [] },
        jobs: openings,
        products: offerings,
        entitlements: capabilityEntitlements,
        eligibilityByJobId: intelligenceEligibilityByJobId,
      });
    } catch {
      return null;
    }
  }, [capabilityEntitlements, intelligenceEligibilityByJobId, offerings, openings, profile]);
  const selectedDirection = useMemo((): SelectedCareerPathSummary | null => {
    const track = CAREER_TRACKS.find(
      (item) => item.id === selectedCareerTrackId,
    );
    const subtrack = track?.subtracks.find(
      (item) => item.id === selectedCareerSubtrackId,
    );
    const candidate = marketReport?.directions.candidates.find(
      (item) => item.id === selectedDirectionId,
    );
    if (!track || !subtrack) return null;
    return {
      label: candidate
        ? `${track.label} · ${subtrack.label} · ${candidate.jobTitle}`
        : `${track.label} · ${subtrack.label}`,
      trackLabel: track.label,
      subtrackLabel: subtrack.label,
      dataStatus: track.dataStatus,
      candidate: candidate ?? null,
    };
  }, [
    marketReport,
    selectedCareerSubtrackId,
    selectedCareerTrackId,
    selectedDirectionId,
  ]);
  const selectedRoutePath = useMemo(() => {
    const track = CAREER_TRACKS.find(
      (item) => item.id === selectedCareerTrackId,
    );
    const subtrack = track?.subtracks.find(
      (item) => item.id === selectedCareerSubtrackId,
    );
    if (!track || !subtrack) return null;
    return {
      trackId: track.id,
      trackLabel: track.label,
      subtrackId: subtrack.id,
      subtrackLabel: subtrack.label,
      dataStatus: track.dataStatus,
    };
  }, [selectedCareerSubtrackId, selectedCareerTrackId]);
  const relatedRouteCandidates = useMemo(() => {
    if (!selectedRoutePath || selectedRoutePath.trackId !== "state-owned") {
      return [];
    }
    return (marketReport?.directions.candidates ?? []).filter((candidate) =>
      candidate.sectorIds.some(
        (sectorId) => sectorId === selectedRoutePath.subtrackId,
      ),
    );
  }, [marketReport, selectedRoutePath]);
  const decisionSnapshot = useMemo(() => {
    if (!selectedRoutePath) return null;
    return buildDecisionSystemSnapshot({
      path: selectedRoutePath,
      selectedCandidate: selectedDirection?.candidate ?? null,
      relatedCandidates: relatedRouteCandidates,
      report: marketReport,
    });
  }, [
    marketReport,
    relatedRouteCandidates,
    selectedDirection?.candidate,
    selectedRoutePath,
  ]);

  const startBridgeConnection = async () => {
    setBridgeStarting(true);
    setBridgeError(null);
    try {
      const response = await fetch("/api/zhida-connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo: `${studio ? "/v2" : "/"}?view=profile&connected=1`,
        }),
        cache: "no-store",
      });
      const data = await response.json() as { authorizeUrl?: string; error?: string };
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(data.error || "主站资料接力暂时不可用。");
      }
      window.location.assign(data.authorizeUrl);
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "主站资料接力暂时不可用。");
      setBridgeStarting(false);
    }
  };

  const useBridgeProfile = () => {
    const imported = bridgeSession?.profile;
    if (!imported) return;
    setDraft((current) => ({
      ...current,
      name: current.name.trim() || profile?.name || imported.name,
      school: imported.school,
      schoolTier: imported.schoolTier,
      degreeLevel: imported.degreeLevel,
      major: imported.major,
      graduationYear: String(imported.graduationYear),
      city: imported.city || current.city,
      preferredCities: imported.preferredCities || current.preferredCities,
      targetSector: imported.targetSector || current.targetSector,
      availableHoursPerWeek: String(imported.availableHoursPerWeek),
      resume: imported.capabilityLevels.resume ?? current.resume,
      application: imported.capabilityLevels.application ?? current.application,
      interview: imported.capabilityLevels.interview ?? current.interview,
      projectEvidence: imported.capabilityLevels.project_evidence ?? current.projectEvidence,
      internship: imported.capabilityLevels.internship ?? current.internship,
      competition: imported.capabilityLevels.competition ?? current.competition,
    }));
    setProfileError(null);
    setBridgeError(null);
  };

  const disconnectBridge = async () => {
    setBridgeError(null);
    try {
      const response = await fetch("/api/zhida-connect/session", {
        method: "DELETE",
        cache: "no-store",
      });
      const data = await response.json() as BridgeSessionStatus;
      if (!response.ok) throw new Error("断开失败");
      setBridgeSession(data);
      setWorkspaceSync((current) =>
        current
          ? {
              ...current,
              connected: false,
              persistence: false,
              state: null,
            }
          : null,
      );
      setWorkspaceHydrated(true);
      remoteWorkspaceRevision.current = 0;
      remoteWorkspaceStateKey.current = null;
      setWorkspaceSyncError(null);
    } catch {
      setBridgeError("暂时无法断开连接，请稍后再试。");
    }
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const graduationYear = Number(draft.graduationYear);
    const hours = Number(draft.availableHoursPerWeek);
    if (!draft.name.trim() || !draft.school.trim() || !draft.major.trim()) {
      setProfileError("请先填写姓名、学校和专业。");
      return;
    }
    if (!Number.isInteger(graduationYear) || graduationYear < 2024 || graduationYear > 2035) {
      setProfileError("请填写有效的毕业年份。");
      return;
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 80) {
      setProfileError("每周投入时间需在 1 到 80 小时之间。");
      return;
    }
    const nextProfile: CareerProfile = {
      id: profile?.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      school: draft.school.trim(),
      schoolTier: draft.schoolTier,
      degreeLevel: draft.degreeLevel,
      major: draft.major.trim(),
      graduationYear,
      city: draft.city.trim(),
      preferredCities: draft.preferredCities.trim(),
      targetSector: draft.targetSector.trim(),
      availableHoursPerWeek: hours,
      capabilityLevels: {
        resume: draft.resume,
        application: draft.application,
        interview: draft.interview,
        project_evidence: draft.projectEvidence,
        internship: draft.internship,
        competition: draft.competition,
      },
      ownedProductIds: [],
    };
    const replacingExistingProfile = Boolean(profile);
    setMarketReport(null);
    setMarketReportError(null);
    setSelectedCareerTrackId(null);
    setSelectedCareerSubtrackId(null);
    setSelectedDirectionId(null);
    setProfile(nextProfile);
    if (replacingExistingProfile) {
      setSelectedJobs([]);
      setCompletedTaskIds([]);
    }
    setProfileError(null);
    setAdvisorEntryContext(null);
    setActiveView(studio ? "report" : "jobs");
  };

  const clearLocalWorkspace = async () => {
    const clearRemote = Boolean(
      workspaceSync?.connected && workspaceSync.persistence,
    );
    const prompt = clearRemote
      ? "仅清除求职Agent在本机保存的学生档案，以及求职Agent独立保存的跨设备路径进度；不会删除或修改职达主站数据库。确定继续吗？"
      : "仅清除当前浏览器保存的学生档案、目标岗位和任务进度；不会删除或修改职达主站数据库。确定继续吗？";
    if (!window.confirm(prompt)) return;
    if (clearRemote) {
      setWorkspaceHydrated(false);
      try {
        const response = await fetch("/api/workspace", {
          method: "DELETE",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("workspace delete failed");
        remoteWorkspaceRevision.current = 0;
        remoteWorkspaceStateKey.current = remoteWorkspaceKey(
          remoteWorkspaceState([], []),
        );
        setWorkspaceSync((current) =>
          current
            ? {
                ...current,
                revision: 0,
                updatedAt: null,
                state: remoteWorkspaceState([], []),
              }
            : current,
        );
        setWorkspaceSyncError(null);
      } catch {
        setWorkspaceHydrated(true);
        setWorkspaceSyncError(
          "跨设备进度未能清除，为避免残留，本次没有清除任何资料。",
        );
        return;
      }
    }
    localStorage.removeItem(STORAGE_KEY);
    localPathSavedAt.current = 0;
    localPathStateKey.current = remoteWorkspaceKey(
      remoteWorkspaceState([], []),
    );
    setProfile(null);
    setMarketReport(null);
    setSelectedCareerTrackId(null);
    setSelectedCareerSubtrackId(null);
    setSelectedDirectionId(null);
    setMarketReportError(null);
    setMarketReportLoading(false);
    setDraft(emptyDraft());
    setSelectedJobs([]);
    setCompletedTaskIds([]);
    setKeyword("");
    setProfileError(null);
    setActiveView("profile");
    if (clearRemote) setWorkspaceHydrated(true);
  };

  const toggleJob = (job: LiveJob) => {
    setSelectedJobs((current) => {
      if (current.some((item) => item.id === job.id)) {
        return current.filter((item) => item.id !== job.id);
      }
      return current.length >= 3 ? current : [...current, job];
    });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadJobs(keyword);
  };

  const toggleTask = (taskId: string) => {
    setCompletedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  };

  const activeContent: Record<ViewId, React.ReactNode> = {
    overview: (
      <OverviewView
        profile={profile}
        selectedJobs={selectedJobs}
        network={network}
        completedTaskIds={completedTaskIds}
        products={products}
        status={status}
        onOpen={setActiveView}
      />
    ),
    profile: (
      <ProfileView
        draft={draft}
        setDraft={setDraft}
        profile={profile}
        error={profileError}
        onSave={saveProfile}
        onClear={clearLocalWorkspace}
        status={status}
        bridgeSession={bridgeSession}
        bridgeError={bridgeError}
        bridgeStarting={bridgeStarting}
        workspaceSync={workspaceSync}
        workspaceSaving={workspaceSaving}
        workspaceSyncError={workspaceSyncError}
        onConnectBridge={() => void startBridgeConnection()}
        onUseBridgeProfile={useBridgeProfile}
        onDisconnectBridge={() => void disconnectBridge()}
      />
    ),
    jobs: (
      <JobsView profile={profile} jobs={jobs} total={jobsTotal} fetchedAt={jobsFetchedAt} loading={jobsLoading} error={jobsError} selectedJobs={selectedJobs} keyword={keyword} setKeyword={setKeyword} onSearch={submitSearch} onReload={() => void loadJobs()} onToggle={toggleJob} onOpenStrategy={() => setActiveView("strategy")} />
    ),
    strategy: (
      <StrategyView
        network={network}
        selectedJobs={selectedJobs}
        products={products}
        intelligenceDecisions={intelligenceDecisions}
        decisionProfileKey={decisionProfileKey}
        onChooseJobs={() => setActiveView("jobs")}
        onOpenTasks={() => setActiveView("tasks")}
      />
    ),
    tasks: (
      <TasksView
        network={network}
        completedTaskIds={completedTaskIds}
        onToggleTask={toggleTask}
        products={products}
        onChooseJobs={() => setActiveView("jobs")}
        crossDevicePersistence={Boolean(
          workspaceSync?.connected && workspaceSync.persistence,
        )}
      />
    ),
    advisor: (
      <AdvisorView
        profile={profile}
        selectedDirection={selectedDirection}
        decisionSnapshot={decisionSnapshot}
        selectedJobs={selectedJobs}
        network={network}
        products={products}
        status={status}
      />
    ),
    report: null,
    directions: null,
    roadmap: null,
  };

  const currentContent = activeContent[activeView];

  if (studio) {
    return (
      <div className={styles.focusedShell}>
        <aside className={styles.focusedSidebar}>
          <button
            className={styles.focusedBrand}
            type="button"
            onClick={() => setActiveView(profile ? "advisor" : "profile")}
          >
            <span aria-hidden="true"><Strategy size={21} weight="bold" /></span>
            <div>
              <strong>求职Agent</strong>
              <small>央国企求职顾问</small>
            </div>
          </button>

          <nav className={styles.focusedNav} aria-label="主要功能">
            {FOCUSED_NAV_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              const isCurrent = activeView === item.id;
              return (
                <button
                  aria-current={isCurrent ? "page" : undefined}
                  className={isCurrent ? styles.focusedNavActive : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  <ItemIcon
                    size={19}
                    weight={isCurrent ? "fill" : "regular"}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className={styles.focusedSidebarSpacer} />
          <div className={styles.focusedDataStatus}>
            <i data-ready={Boolean(status?.zhidaLive)} />
            <span>
              <strong>{status?.zhidaLive ? "岗位数据已连接" : "正在确认数据"}</strong>
              <small>回答会标注可核验依据</small>
            </span>
          </div>
          <div className={styles.focusedProfileSummary}>
            <span><UserFocus size={18} weight="duotone" /></span>
            <div>
              <strong>{profile?.name || "尚未填写资料"}</strong>
              <small>
                {profile
                  ? `${profile.major} · ${profile.graduationYear} 届`
                  : "填写后开始个性化对话"}
              </small>
            </div>
          </div>
        </aside>

        <div className={styles.focusedWorkspace}>
          <header className={styles.focusedMobileHeader}>
            <button
              className={styles.focusedMobileBrand}
              type="button"
              onClick={() => setActiveView(profile ? "advisor" : "profile")}
            >
              <span aria-hidden="true"><Strategy size={18} weight="bold" /></span>
              <strong>求职Agent</strong>
            </button>
            <nav aria-label="主要功能">
              {FOCUSED_NAV_ITEMS.map((item) => (
                <button
                  aria-current={
                    activeView === item.id ? "page" : undefined
                  }
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </header>

          <main className={styles.focusedMain}>
            <div
              className={styles.focusedPane}
              hidden={activeView !== "advisor"}
            >
              <AdvisorView
                focused
                profile={profile}
                selectedDirection={selectedDirection}
                decisionSnapshot={decisionSnapshot}
                selectedJobs={selectedJobs}
                network={network}
                products={products}
                status={status}
                onEditProfile={() => setActiveView("profile")}
                onViewReport={() => setActiveView("report")}
                entryContext={advisorEntryContext}
              />
            </div>
            <div
              className={styles.focusedPane}
              hidden={
                activeView !== "profile"
                && !(
                  (
                    activeView === "report"
                    || activeView === "directions"
                    || activeView === "roadmap"
                  )
                  && !profile
                )
              }
            >
              <FocusedProfileView
                draft={draft}
                setDraft={setDraft}
                profile={profile}
                error={profileError}
                onSave={saveProfile}
                onClear={clearLocalWorkspace}
                bridgeSession={bridgeSession}
                bridgeError={bridgeError}
                bridgeStarting={bridgeStarting}
                workspaceSync={workspaceSync}
                workspaceSaving={workspaceSaving}
                workspaceSyncError={workspaceSyncError}
                onConnectBridge={() => void startBridgeConnection()}
                onUseBridgeProfile={useBridgeProfile}
                onDisconnectBridge={() => void disconnectBridge()}
                onViewReport={() => setActiveView("report")}
              />
            </div>
            <div
              className={styles.focusedPane}
              hidden={activeView !== "report" || !profile}
            >
              {profile ? (
                <FocusedMarketReport
                  profile={profile}
                  report={marketReport}
                  loading={marketReportLoading}
                  error={marketReportError}
                  onRetry={() => void loadMarketReport()}
                  onExplain={() => {
                    setAdvisorEntryContext("report-explain");
                    setActiveView("advisor");
                  }}
                  onChooseDirection={() => {
                    setAdvisorEntryContext(null);
                    setActiveView("directions");
                  }}
                />
              ) : null}
            </div>
            <div
              className={styles.focusedPane}
              hidden={activeView !== "directions" || !profile}
            >
              {profile ? (
                <FocusedDirectionSelector
                  profile={profile}
                  report={marketReport}
                  loading={marketReportLoading}
                  error={marketReportError}
                  selectedCareerTrackId={selectedCareerTrackId}
                  selectedCareerSubtrackId={selectedCareerSubtrackId}
                  selectedDirectionId={selectedDirectionId}
                  decisionSnapshot={decisionSnapshot}
                  onBackReport={() => setActiveView("report")}
                  onRetry={() => void loadMarketReport()}
                  onSelectTrack={(trackId) => {
                    setSelectedCareerTrackId(trackId);
                    setSelectedCareerSubtrackId(null);
                    setSelectedDirectionId(null);
                  }}
                  onSelectSubtrack={(subtrackId) => {
                    setSelectedCareerSubtrackId(subtrackId);
                    setSelectedDirectionId(null);
                  }}
                  onSelectCandidate={setSelectedDirectionId}
                  onChangeTrack={() => {
                    setSelectedCareerTrackId(null);
                    setSelectedCareerSubtrackId(null);
                    setSelectedDirectionId(null);
                  }}
                  onChangeSubtrack={() => {
                    setSelectedCareerSubtrackId(null);
                    setSelectedDirectionId(null);
                  }}
                  onPreviewRoute={() => {
                    if (!selectedRoutePath) return;
                    setAdvisorEntryContext(null);
                    setActiveView("roadmap");
                  }}
                  onContinue={() => {
                    if (!selectedDirection?.candidate) return;
                    const selectedJob = marketCandidateToLiveJob(
                      selectedDirection.candidate,
                    );
                    if (selectedJob) {
                      setSelectedJobs((current) => {
                        const withoutDuplicate = current.filter(
                          (job) => job.id !== selectedJob.id,
                        );
                        return [selectedJob, ...withoutDuplicate].slice(0, 3);
                      });
                    }
                    setAdvisorEntryContext("direction-selected");
                    setActiveView("roadmap");
                  }}
                />
              ) : null}
            </div>
            <div
              className={styles.focusedPane}
              hidden={activeView !== "roadmap" || !profile}
            >
              {profile && selectedRoutePath && decisionSnapshot ? (
                <RoutePlannerView
                  profile={{
                    major: profile.major,
                    graduationYear: profile.graduationYear,
                    degreeLabel: DEGREE_OPTIONS.find(
                      (option) => option.value === profile.degreeLevel,
                    )?.label ?? "学历待确认",
                  }}
                  path={selectedRoutePath}
                  selectedCandidate={selectedDirection?.candidate ?? null}
                  relatedCandidates={relatedRouteCandidates}
                  decisionSnapshot={decisionSnapshot}
                  onBack={() => setActiveView("directions")}
                  onOpenAdvisor={() => {
                    setAdvisorEntryContext("route-action");
                    setActiveView("advisor");
                  }}
                />
              ) : null}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <button className={styles.brand} type="button" onClick={() => setActiveView("profile")}>
          <span aria-hidden="true">职</span>
          <div><strong>求职Agent</strong><small>央国企求职策略平台</small></div>
        </button>
        <div className={styles.liveMode}>
          <span aria-hidden="true" />
          {status?.zhidaLive ? "真实岗位已连接" : "正在确认数据状态"}
        </div>
        <nav className={styles.sideNav} aria-label="规划流程">
          <p>求职路径</p>
          {NAV_ITEMS.map((item) => (
            <button className={activeView === item.id ? styles.navActive : ""} key={item.id} type="button" onClick={() => setActiveView(item.id)}>
              <span>{item.mark}</span>
              <strong>{item.label}</strong>
              {item.id === "jobs" && selectedJobs.length > 0 && <small>{selectedJobs.length}</small>}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarSpacer} />
        <section className={styles.sidebarSummary}>
          <span>当前路径</span>
          <strong>{selectedJobs.length ? `${selectedJobs.length} 个目标岗位` : "尚未选定目标"}</strong>
          <p>{profile ? `${profile.major} · ${profile.graduationYear}届` : "完成档案后开始推荐"}</p>
        </section>
        <Link className={styles.progressLink} href="/progress">查看开发进度台</Link>
      </aside>

      <header className={styles.mobileHeader}>
        <button type="button" onClick={() => setActiveView("profile")}><span>职</span><strong>求职Agent</strong></button>
        <Link href="/progress">进度</Link>
      </header>

      <main className={styles.mainStage}>{currentContent}</main>

      <nav className={styles.mobileNav} aria-label="移动端规划流程">
        {NAV_ITEMS.map((item) => (
          <button className={activeView === item.id ? styles.mobileActive : ""} key={item.id} type="button" onClick={() => setActiveView(item.id)}>
            <span>{item.mark}</span>
            {item.label.replace("学生", "").replace("在招", "")}
          </button>
        ))}
      </nav>
    </div>
  );
}
