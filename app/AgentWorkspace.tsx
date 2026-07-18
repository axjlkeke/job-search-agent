"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Buildings,
  CalendarDots,
  ChatsCircle,
  Check,
  CheckSquare,
  Compass,
  Database,
  House,
  MagnifyingGlass,
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
} from "react";
import {
  buildStrategyNetwork,
  convertLiveJobToOpening,
  convertLiveJobsToOpenings,
  evaluateEligibility,
  eligibilityFromIntelligenceDecision,
  intelligenceProfileForDecision,
  isIntelligenceDecisionResponse,
  verifiedOfficialEvidenceFromIntelligenceDecision,
  type CapabilityLevel,
  type DegreeLevel,
  type EligibilityResult,
  type IntelligenceDecisionResponse,
  type LiveJobInput,
  type ProductCategory,
  type ProductOffering,
  type StrategyNetwork,
  type StrategyTask,
  type StudentProfile,
} from "@/lib/career";
import styles from "./career-strategy.module.css";
import { VisualAsset as ImageInsertMarker } from "./VisualAsset";

const AdvisorThread = dynamic(
  () => import("./AdvisorThread").then((module) => module.AdvisorThread),
  { ssr: false },
);

type ViewId = "overview" | "profile" | "jobs" | "strategy" | "tasks" | "advisor";
type WorkspaceVariant = "classic" | "studio";

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
  profile: CareerProfile | null;
  selectedJobs: LiveJob[];
  completedTaskIds: string[];
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

const STUDIO_NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  hint: string;
  icon: Icon;
}> = [
  { id: "overview", label: "策略总览", hint: "今天该做什么", icon: House },
  { id: "profile", label: "学生档案", hint: "确认真实起点", icon: UserFocus },
  { id: "jobs", label: "在招岗位", hint: "找到目标终点", icon: Buildings },
  { id: "strategy", label: "策略网络", hint: "看清成本与风险", icon: Strategy },
  { id: "tasks", label: "七日行动", hint: "完成可检查任务", icon: CheckSquare },
  { id: "advisor", label: "AI 顾问", hint: "依据知识库解释", icon: ChatsCircle },
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
    const profile = isCareerProfile(stored.profile) ? stored.profile : null;
    return {
      version: 1,
      savedAt,
      profile,
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

function compactText(value: string | null | undefined, fallback = "未提供"): string {
  if (!value?.trim()) return fallback;
  return value.replace(/\s+/g, " ").trim();
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
      status?.difyConfigured &&
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
            <strong>档案只保存在这台电脑的浏览器中，最多保留 30 天</strong>
            <span>可随时一键清除；接入账号系统前，不会写入职达生产数据库。</span>
          </div>
          <div className={styles.formActions}>
            {profile && <button className={styles.clearDataButton} type="button" onClick={onClear}>清除本机资料</button>}
            <button className={styles.primaryButton} type="submit">{profile ? "保存并重新匹配" : "保存档案，查看岗位"}</button>
          </div>
        </footer>
        {error && <p className={styles.formError} role="alert">{error}</p>}
      </form>
    </div>
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
        <div><ImageInsertMarker className={styles.strategyMetricInsert} kind="chart" label="每周节奏图形位置" /><span>每周节奏</span><strong>7 天</strong></div>
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
            const evidenceState = officialEvidence
              ? "verified"
              : decisionEntry?.status === "ready"
                ? "uncovered"
                : decisionEntry?.status === "unavailable"
                  ? "unavailable"
                  : "loading";
            const unavailableMessage = decisionEntry?.status === "unavailable"
              ? {
                "not-covered": "该岗位尚未进入独立情报库，当前只保留主站岗位事实，不做资格推断。",
                "service-unavailable": "只读职业情报服务暂时不可用，当前结论保持待核验，不影响你继续整理目标。",
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
                        ? `${officialEvidence.sourceGrade} 级 · 已核验`
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
                        <span>核验于 {formatDate(officialEvidence.fetchedAt)}</span>
                      </p>
                    </div>
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
}: {
  network: StrategyNetwork | null;
  completedTaskIds: string[];
  onToggleTask: (taskId: string) => void;
  products: LiveProduct[];
  onChooseJobs: () => void;
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
          <p>每个任务都有完成标准。勾选结果保存在本机，刷新页面后不会丢失。</p>
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
                          <span>{task.scope === "shared" ? "共同任务" : "目标分支"} · {task.priority === "high" ? "高优先级" : task.priority === "medium" ? "中优先级" : "低优先级"}</span>
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
  selectedJobs,
  status,
}: {
  profile: CareerProfile | null;
  selectedJobs: LiveJob[];
  status: SystemStatus | null;
}) {
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const ready = Boolean(
    status?.ragConfigured &&
      status?.difyConfigured &&
      status?.advisorProtected &&
      status?.advisorAccessEnabled,
  );

  useEffect(() => () => {
    const activeRequest = requestController.current;
    requestController.current = null;
    activeRequest?.abort();
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
          profileSummary: profileSummary(profile),
          targetSummary: targetSummary(selectedJobs),
          profile: {
            degreeLevel: profile.degreeLevel,
            major: profile.major,
            graduationYear: profile.graduationYear,
          },
          target: {
            companies: [...new Set(selectedJobs.map((job) => job.companyName))],
            jobTitles: [...new Set(selectedJobs.map((job) => job.jobTitle))],
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
  }, [conversationId, profile, ready, selectedJobs, sending]);

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
          <StatusPill ok={Boolean(status?.difyConfigured)}>Dify</StatusPill>
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
                <h2>知识库或 AI 编排尚未完成配置</h2>
                <p>系统不会用模型常识冒充你的知识库。接入 RAG、Dify、会话密钥与登录授权后才会开放；公开知识库可显式开启匿名测试。</p>
                <dl>
                  <div><dt>实时岗位</dt><dd>{status?.zhidaLive ? "已连接" : "不可用"}</dd></div>
                  <div><dt>知识库检索</dt><dd>{status?.ragConfigured ? "已配置" : "待配置"}</dd></div>
                  <div><dt>AI 编排</dt><dd>{status?.difyConfigured ? "已配置" : "待配置"}</dd></div>
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
  const [activeView, setActiveView] = useState<ViewId>(studio ? "overview" : "profile");
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [profileError, setProfileError] = useState<string | null>(null);
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
  const [intelligenceDecisions, setIntelligenceDecisions] = useState<
    Record<string, IntelligenceDecisionEntry>
  >({});
  const requestNumber = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredWorkspace();
      if (stored) {
        setProfile(stored.profile);
        setSelectedJobs(stored.selectedJobs);
        setCompletedTaskIds(stored.completedTaskIds);
        if (stored.profile) {
          setDraft(draftFromProfile(stored.profile));
          setActiveView(studio ? "overview" : stored.selectedJobs.length ? "strategy" : "jobs");
        }
      }
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView && (studio ? STUDIO_NAV_ITEMS : NAV_ITEMS).some((item) => item.id === requestedView)) {
        setActiveView(requestedView as ViewId);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [studio]);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot: StoredWorkspace = {
      version: 1,
      savedAt: Date.now(),
      profile,
      selectedJobs,
      completedTaskIds,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [completedTaskIds, hydrated, profile, selectedJobs]);

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
    setProfile(nextProfile);
    setSelectedJobs([]);
    setCompletedTaskIds([]);
    setProfileError(null);
    setActiveView("jobs");
  };

  const clearLocalWorkspace = () => {
    if (!window.confirm("确定清除这台电脑上保存的学生档案、目标岗位和任务进度吗？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setProfile(null);
    setDraft(emptyDraft());
    setSelectedJobs([]);
    setCompletedTaskIds([]);
    setKeyword("");
    setProfileError(null);
    setActiveView(studio ? "overview" : "profile");
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
      <TasksView network={network} completedTaskIds={completedTaskIds} onToggleTask={toggleTask} products={products} onChooseJobs={() => setActiveView("jobs")} />
    ),
    advisor: <AdvisorView profile={profile} selectedJobs={selectedJobs} status={status} />,
  };

  const currentContent = activeContent[activeView];
  const activeStudioItem = STUDIO_NAV_ITEMS.find((item) => item.id === activeView) ?? STUDIO_NAV_ITEMS[0];
  const ActiveStudioIcon = activeStudioItem.icon;

  if (studio) {
    return (
      <div className={styles.studioShell}>
        <aside className={styles.studioSidebar}>
          <button className={styles.studioBrand} type="button" onClick={() => setActiveView("overview")}>
            <ImageInsertMarker className={styles.brandLogoInsert} kind="logo" label="求职Agent品牌 Logo 位置" />
            <div><strong>求职Agent</strong><small>央国企策略工作台</small></div>
          </button>

          <nav className={styles.studioNav} aria-label="求职策略功能">
            <p>策略工作台</p>
            {STUDIO_NAV_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  aria-current={activeView === item.id ? "page" : undefined}
                  className={activeView === item.id ? styles.studioNavActive : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  <ItemIcon size={19} weight={activeView === item.id ? "duotone" : "regular"} />
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                  {item.id === "jobs" && selectedJobs.length > 0 ? <em>{selectedJobs.length}</em> : null}
                </button>
              );
            })}
          </nav>

          <div className={styles.studioSidebarSpacer} />
          <section className={styles.studioPathSummary}>
            <div><Compass size={18} weight="duotone" /><span>当前求职路径</span><ImageInsertMarker className={styles.sidebarPathGraphicInsert} kind="graphic" label="当前求职路径缩略图位置" /></div>
            <strong>{selectedJobs.length ? `${selectedJobs.length} 个目标正在推进` : "等待选择目标岗位"}</strong>
            <p>{profile ? `${profile.major} · ${profile.graduationYear} 届` : "完成档案后开始生成"}</p>
            <button type="button" onClick={() => setActiveView(selectedJobs.length ? "strategy" : profile ? "jobs" : "profile")}>
              {selectedJobs.length ? "查看策略网络" : profile ? "去选择岗位" : "开始建档"}<ArrowRight size={14} weight="bold" />
            </button>
          </section>
          <div className={styles.studioSidebarLinks}>
            <Link href="/progress">开发进度</Link>
            <Link href="/">经典版</Link>
          </div>
        </aside>

        <div className={styles.studioWorkspace}>
          <header className={styles.studioTopbar}>
            <div className={styles.studioTopbarTitle}>
              <ActiveStudioIcon size={19} weight="duotone" />
              <div><strong>{activeStudioItem.label}</strong><small>{activeStudioItem.hint}</small></div>
            </div>
            <div className={styles.studioTopbarActions}>
              <button type="button" onClick={() => setActiveView("jobs")}><MagnifyingGlass size={17} />搜索在招岗位</button>
              <span className={styles.studioLiveStatus} data-ready={Boolean(status?.zhidaLive)}><i />{status?.zhidaLive ? "岗位数据已连接" : "正在确认数据"}</span>
              <button className={styles.studioUser} type="button" onClick={() => setActiveView("profile")} aria-label="打开学生档案">
                <ImageInsertMarker className={styles.userAvatarInsert} kind="avatar" label="学生头像位置" />
                <div><strong>{profile?.name || "尚未建档"}</strong><small>{profile ? `${profile.graduationYear} 届` : "点击开始"}</small></div>
              </button>
            </div>
          </header>

          <header className={styles.studioMobileHeader}>
            <button className={styles.studioBrand} type="button" onClick={() => setActiveView("overview")}>
              <ImageInsertMarker className={styles.brandLogoInsert} kind="logo" label="求职Agent品牌 Logo 位置" /><div><strong>求职Agent</strong><small>{activeStudioItem.label}</small></div>
            </button>
            <span data-ready={Boolean(status?.zhidaLive)}><i />{status?.zhidaLive ? "数据在线" : "确认中"}</span>
          </header>

          <main className={`${styles.mainStage} ${styles.studioMainStage}`}>{currentContent}</main>

          <nav className={styles.studioMobileNav} aria-label="移动端求职策略功能">
            {STUDIO_NAV_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  aria-current={activeView === item.id ? "page" : undefined}
                  className={activeView === item.id ? styles.studioMobileActive : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                >
                  <ItemIcon size={19} weight={activeView === item.id ? "fill" : "regular"} />
                  <span>{item.label.replace("学生", "").replace("在招", "").replace("七日", "")}</span>
                </button>
              );
            })}
          </nav>
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
