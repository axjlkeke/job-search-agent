import type {
  MarketReportCandidate,
  MarketReportProfile,
} from "./market-report.ts";
import type {
  CapabilityKey,
  CapabilityLevel,
  DegreeLevel,
  ProductCategory,
} from "./types.ts";

export const DECISION_MODEL_VERSION = "2026-07-22.v2";

export type PreliminaryGateOutcome =
  | "pass"
  | "conditional"
  | "mismatch"
  | "unknown";

export type DecisionPortfolioTier = "primary" | "sprint" | "steady";
export type DecisionCandidateTier =
  | DecisionPortfolioTier
  | "watchlist"
  | "excluded";

export type PreliminaryGate = {
  kind: "degree" | "major" | "graduation_year" | "deadline";
  label: string;
  outcome: PreliminaryGateOutcome;
  summary: string;
  source: "main-site-field";
};

export type DecisionCandidateAssessment = {
  candidateId: string;
  tier: DecisionCandidateTier;
  tierLabel: string;
  qualificationStatus:
    | "raw-fields-aligned"
    | "needs-verification"
    | "high-risk"
    | "expired";
  qualificationLabel: string;
  opportunityScore: number;
  scoreLabel: "优先核验" | "可以跟进" | "谨慎投入";
  preliminaryGates: PreliminaryGate[];
  reasons: string[];
  risks: string[];
  assignmentReason: string;
  verificationTask: string;
  profilePreparationHours: number;
  verificationHours: number;
  preparationHours: number;
  freshnessLabel: string;
  updatedAt: string | null;
};

export type DecisionBlocker = {
  capability: CapabilityKey;
  label: string;
  level: CapabilityLevel;
  estimatedHours: number;
  productCategory: ProductCategory | null;
  trigger: "after-target-selected";
};

export type DecisionModelResult = {
  version: typeof DECISION_MODEL_VERSION;
  generatedAt: string;
  dataSnapshotAt: string;
  boundary: {
    candidateSource: "zhida-main-site-readonly";
    hardGateAuthority: "verified-official-evidence-only";
    portfolioAuthority: "deterministic-evidence-rules";
    aiRole: "explain-extract-never-override-gates";
    scoreMeaning: "ranking-not-probability";
    containsStudentPii: false;
  };
  profileLevel: {
    score: number;
    label: "起步准备阶段" | "具备求职基础" | "执行准备较充分";
    detail: string;
    dimensions: Array<{
      label: string;
      score: number;
      status: string;
    }>;
  };
  marketValue: {
    label: string;
    detail: string;
    candidateCount: number;
    companyCount: number;
    regionCount: number;
    recentlyUpdatedCount: number;
    deadlineKnownCount: number;
    rawFieldAlignedCount: number;
  };
  portfolio: {
    primary: string[];
    sprint: string[];
    steady: string[];
  };
  portfolioGuidance: Record<DecisionPortfolioTier, {
    label: string;
    standard: string;
    emptyReason: string;
  }>;
  portfolioSummary: {
    watchlistCount: number;
    highRiskExcludedCount: number;
    expiredExcludedCount: number;
  };
  candidates: DecisionCandidateAssessment[];
  blockers: DecisionBlocker[];
  nextActions: string[];
  caveats: string[];
};

type BuildDecisionModelInput = {
  profile: MarketReportProfile;
  candidates: MarketReportCandidate[];
  fetchedAt: string;
  now?: Date | string;
};

const DEGREE_RANK: Record<DegreeLevel, number> = {
  unknown: -1,
  secondary: 0,
  vocational: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  doctorate: 5,
};

const DEGREE_TOKEN: Array<[RegExp, DegreeLevel]> = [
  [/博士/u, "doctorate"],
  [/硕士|研究生/u, "master"],
  [/本科|学士/u, "bachelor"],
  [/专科|大专/u, "associate"],
  [/高职/u, "vocational"],
  [/高中|中专/u, "secondary"],
];

const DEGREE_LABEL: Record<DegreeLevel, string> = {
  unknown: "学历未知",
  secondary: "高中/中专",
  vocational: "高职",
  associate: "专科",
  bachelor: "本科",
  master: "硕士",
  doctorate: "博士",
};

const CAPABILITY_WEIGHT: Array<{
  key: CapabilityKey;
  label: string;
  weight: number;
  missingHours: number;
  productCategory: ProductCategory | null;
}> = [
  { key: "resume", label: "岗位化简历", weight: 18, missingHours: 8, productCategory: "resume" },
  { key: "application", label: "网申材料", weight: 14, missingHours: 6, productCategory: "application" },
  { key: "interview", label: "面试表达", weight: 16, missingHours: 12, productCategory: "interview" },
  { key: "project_evidence", label: "项目证据", weight: 18, missingHours: 16, productCategory: null },
  { key: "internship", label: "实习经历", weight: 24, missingHours: 80, productCategory: null },
  { key: "competition", label: "竞赛与荣誉", weight: 10, missingHours: 20, productCategory: null },
];

const CAPABILITY_RATIO: Record<CapabilityLevel, number> = {
  missing: 0,
  developing: 0.55,
  ready: 1,
};

const CAPABILITY_STATUS: Record<CapabilityLevel, string> = {
  missing: "尚未开始",
  developing: "已有基础",
  ready: "可直接使用",
};

const MAJOR_FAMILY_RULES: Array<{
  profile: RegExp;
  code: string;
  tokens: RegExp;
}> = [
  { profile: /电气|电力系统|智能电网/u, code: "0806", tokens: /电气|电力|智能电网/u },
  { profile: /自动化|控制工程|机器人工程/u, code: "0808", tokens: /自动化|控制|机器人工程/u },
  { profile: /计算机|软件|人工智能|数据科学|网络工程|信息安全/u, code: "0809", tokens: /计算机|软件|人工智能|数据|网络|信息安全/u },
  { profile: /电子信息|通信|微电子/u, code: "0807", tokens: /电子信息|通信|微电子/u },
  { profile: /金融|保险|投资/u, code: "0203", tokens: /金融|保险|投资/u },
  { profile: /经济学|经济统计/u, code: "0201", tokens: /经济|统计/u },
  { profile: /工商管理|市场营销|会计|财务|人力资源|审计/u, code: "1202", tokens: /工商管理|市场营销|会计|财务|人力资源|审计/u },
  { profile: /酒店管理|旅游管理|文旅|会展/u, code: "1209", tokens: /酒店|旅游|文旅|会展|管理类/u },
  { profile: /法学|法律|知识产权/u, code: "0301", tokens: /法学|法律|知识产权/u },
  { profile: /汉语言|中文|秘书/u, code: "0501", tokens: /汉语言|中文|秘书/u },
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMajor(value: string): string {
  return value.replace(/\s+/gu, "").replace(/专业|类|工程及其/u, "");
}

function degreeGate(
  profile: MarketReportProfile,
  candidate: MarketReportCandidate,
): PreliminaryGate {
  const raw = candidate.educationLevel?.trim() ?? "";
  if (!raw) {
    return {
      kind: "degree",
      label: "学历",
      outcome: "unknown",
      summary: "主站岗位没有提供学历字段，必须回到官方公告核验。",
      source: "main-site-field",
    };
  }
  if (/不限/u.test(raw)) {
    return {
      kind: "degree",
      label: "学历",
      outcome: "pass",
      summary: "主站学历字段标记为不限，仍需官方公告确认。",
      source: "main-site-field",
    };
  }
  if (profile.degreeLevel === "unknown") {
    return {
      kind: "degree",
      label: "学历",
      outcome: "unknown",
      summary: "学生学历未明确，无法进行字段预判。",
      source: "main-site-field",
    };
  }

  const found = DEGREE_TOKEN
    .filter(([pattern]) => pattern.test(raw))
    .map(([, degree]) => degree);
  if (found.length === 0) {
    return {
      kind: "degree",
      label: "学历",
      outcome: "unknown",
      summary: `主站学历字段“${raw.slice(0, 40)}”无法安全解析。`,
      source: "main-site-field",
    };
  }

  const requiredRank = Math.min(...found.map((degree) => DEGREE_RANK[degree]));
  const aligned = DEGREE_RANK[profile.degreeLevel] >= requiredRank;
  return {
    kind: "degree",
    label: "学历",
    outcome: aligned ? "pass" : "mismatch",
    summary: aligned
      ? `${DEGREE_LABEL[profile.degreeLevel]}与主站学历字段初步一致。`
      : `主站字段最低出现${DEGREE_LABEL[found.find((degree) => DEGREE_RANK[degree] === requiredRank) ?? found[0]]}，当前为${DEGREE_LABEL[profile.degreeLevel]}。`,
    source: "main-site-field",
  };
}

function majorGate(
  profile: MarketReportProfile,
  candidate: MarketReportCandidate,
): PreliminaryGate {
  const raw = candidate.majorRequirements?.trim() ?? "";
  const codes = candidate.majorCategoryIds ?? [];
  if (!raw && codes.length === 0) {
    return {
      kind: "major",
      label: "专业",
      outcome: "unknown",
      summary: "主站岗位没有提供可解析的专业范围。",
      source: "main-site-field",
    };
  }
  if (/不限专业|专业不限|不限/u.test(raw)) {
    return {
      kind: "major",
      label: "专业",
      outcome: "pass",
      summary: "主站专业字段标记为不限，仍需官方公告确认。",
      source: "main-site-field",
    };
  }

  const family = MAJOR_FAMILY_RULES.find((rule) => rule.profile.test(profile.major));
  if (family && codes.some((code) => code.startsWith(family.code))) {
    return {
      kind: "major",
      label: "专业",
      outcome: "pass",
      summary: "主站专业分类与学生专业大类初步一致。",
      source: "main-site-field",
    };
  }

  const normalizedRaw = normalizeMajor(raw);
  const normalizedProfile = normalizeMajor(profile.major);
  if (normalizedProfile && normalizedRaw.includes(normalizedProfile)) {
    return {
      kind: "major",
      label: "专业",
      outcome: "pass",
      summary: "主站专业原文明确包含学生专业。",
      source: "main-site-field",
    };
  }
  if (family?.tokens.test(raw)) {
    return {
      kind: "major",
      label: "专业",
      outcome: "conditional",
      summary: "主站字段命中相关专业大类，需要按官方公告口径确认。",
      source: "main-site-field",
    };
  }
  const explicitlyDifferentFamily = family
    ? MAJOR_FAMILY_RULES.some((rule) =>
        rule.code !== family.code && rule.tokens.test(raw),
      )
    : false;
  if (/理工科|工科|管理类|专业不限/u.test(raw) || (/相关专业/u.test(raw) && !explicitlyDifferentFamily)) {
    return {
      kind: "major",
      label: "专业",
      outcome: "unknown",
      summary: "主站专业表述较宽，不能据此判定符合或不符合。",
      source: "main-site-field",
    };
  }
  return {
    kind: "major",
    label: "专业",
    outcome: "mismatch",
    summary: `主站专业字段暂未命中“${profile.major}”，属于高风险预警而非正式拒绝。`,
    source: "main-site-field",
  };
}

function graduationGate(
  profile: MarketReportProfile,
  candidate: MarketReportCandidate,
): PreliminaryGate {
  const raw = candidate.graduationYear?.trim() ?? "";
  const titleYears = [...candidate.jobTitle.matchAll(
    /(?<!\d)(20\d{2})(?=\s*(?:届|校招|校园招聘|毕业生))/gu,
  )].map((match) => Number(match[1]));
  if (!raw && titleYears.length === 0) {
    return {
      kind: "graduation_year",
      label: "届别",
      outcome: "unknown",
      summary: "主站岗位没有提供届别字段。",
      source: "main-site-field",
    };
  }
  if (/不限|均可|长期/u.test(raw) && titleYears.length === 0) {
    return {
      kind: "graduation_year",
      label: "届别",
      outcome: "pass",
      summary: "主站届别字段未限制具体毕业年份。",
      source: "main-site-field",
    };
  }
  const explicitClassYears = [...raw.matchAll(/(?<!\d)((?:20)?\d{2})\s*届/gu)]
    .map((match) => Number(match[1]))
    .map((year) => year < 100 ? 2000 + year : year);
  const standaloneYears = [...raw.matchAll(/(?<!\d)20\d{2}(?!\d)/gu)]
    .map((match) => Number(match[0]));
  const years = [...new Set([
    ...explicitClassYears,
    ...standaloneYears,
    ...titleYears,
  ])]
    .filter((year) => year >= 2020 && year <= 2040);
  if (years.length === 0) {
    return {
      kind: "graduation_year",
      label: "届别",
      outcome: "unknown",
      summary: `主站届别字段“${raw.slice(0, 40)}”无法安全解析。`,
      source: "main-site-field",
    };
  }
  const aligned = years.includes(profile.graduationYear);
  return {
    kind: "graduation_year",
    label: "届别",
    outcome: aligned ? "pass" : "mismatch",
    summary: aligned
      ? `${profile.graduationYear}届与主站届别字段初步一致。`
      : `主站字段面向${[...new Set(years)].map((year) => `${year}届`).join("、")}，当前为${profile.graduationYear}届。`,
    source: "main-site-field",
  };
}

function deadlineGate(
  candidate: MarketReportCandidate,
  now: Date,
): PreliminaryGate {
  const deadline = safeDate(candidate.applyEndDate);
  if (!deadline) {
    return {
      kind: "deadline",
      label: "时间",
      outcome: "unknown",
      summary: "主站岗位没有提供可解析的截止时间。",
      source: "main-site-field",
    };
  }
  const expired = deadline.getTime() < now.getTime();
  return {
    kind: "deadline",
    label: "时间",
    outcome: expired ? "mismatch" : "pass",
    summary: expired
      ? `主站截止时间为${deadline.toISOString().slice(0, 10)}，当前批次可能已结束。`
      : `主站截止时间为${deadline.toISOString().slice(0, 10)}。`,
    source: "main-site-field",
  };
}

function freshness(
  updatedAt: string | null,
  now: Date,
): { label: string; score: number; recent: boolean } {
  const updated = safeDate(updatedAt);
  if (!updated) return { label: "更新时间待核验", score: 0, recent: false };
  const days = Math.max(0, Math.floor((now.getTime() - updated.getTime()) / 86_400_000));
  if (days <= 7) return { label: "近7天更新", score: 10, recent: true };
  if (days <= 30) return { label: "近30天更新", score: 6, recent: true };
  return { label: `${days}天前更新`, score: 1, recent: false };
}

function preferredRegionMatch(
  profile: MarketReportProfile,
  candidate: MarketReportCandidate,
): boolean {
  const preferences = (profile.preferredCities || profile.city || "")
    .split(/[,，/、;；\s]+/u)
    .map((item) => item.replace(/省|市/gu, "").trim())
    .filter((item) => item && !/全国|不限/u.test(item));
  if (preferences.length === 0) return true;
  const location = (candidate.workLocation ?? "").replace(/省|市/gu, "");
  return preferences.some((item) => location.includes(item));
}

function profileReadiness(profile: MarketReportProfile): DecisionModelResult["profileLevel"] {
  const dimensions = CAPABILITY_WEIGHT.map((item) => {
    const level = profile.capabilityLevels?.[item.key] ?? "missing";
    return {
      label: item.label,
      score: Math.round(CAPABILITY_RATIO[level] * 100),
      status: CAPABILITY_STATUS[level],
      weighted: CAPABILITY_RATIO[level] * item.weight,
    };
  });
  const score = clampScore(dimensions.reduce((sum, item) => sum + item.weighted, 0));
  const label = score >= 75
    ? "执行准备较充分"
    : score >= 45
      ? "具备求职基础"
      : "起步准备阶段";
  return {
    score,
    label,
    detail: `该分数只表示简历、经历和求职材料准备度，不是同类排名或录取概率。`,
    dimensions: dimensions.map((item) => ({
      label: item.label,
      score: item.score,
      status: item.status,
    })),
  };
}

function blockersFor(profile: MarketReportProfile): DecisionBlocker[] {
  return CAPABILITY_WEIGHT
    .map((item): DecisionBlocker => {
      const level = profile.capabilityLevels?.[item.key] ?? "missing";
      const ratio = level === "missing" ? 1 : level === "developing" ? 0.5 : 0;
      return {
        capability: item.key,
        label: item.label,
        level,
        estimatedHours: Math.round(item.missingHours * ratio),
        productCategory: item.productCategory,
        trigger: "after-target-selected",
      };
    })
    .filter((item) => item.estimatedHours > 0)
    .sort((a, b) => b.estimatedHours - a.estimatedHours);
}

function assessCandidate(
  profile: MarketReportProfile,
  candidate: MarketReportCandidate,
  readinessScore: number,
  basePreparationHours: number,
  now: Date,
): DecisionCandidateAssessment {
  const gates = [
    degreeGate(profile, candidate),
    majorGate(profile, candidate),
    graduationGate(profile, candidate),
    deadlineGate(candidate, now),
  ];
  const mismatches = gates.filter((gate) => gate.outcome === "mismatch");
  const unknowns = gates.filter((gate) => gate.outcome === "unknown");
  const conditional = gates.filter((gate) => gate.outcome === "conditional");
  const deadlineExpired = gates.some(
    (gate) => gate.kind === "deadline" && gate.outcome === "mismatch",
  );
  const fresh = freshness(candidate.updatedAt ?? null, now);
  const regionMatch = preferredRegionMatch(profile, candidate);

  let score = 42 + fresh.score + Math.round(readinessScore * 0.12);
  for (const gate of gates) {
    if (gate.outcome === "pass") score += gate.kind === "major" ? 16 : 8;
    if (gate.outcome === "conditional") score += 4;
    if (gate.outcome === "mismatch") score -= gate.kind === "deadline" ? 32 : 18;
  }
  if (regionMatch) score += 8;
  const qualificationStatus: DecisionCandidateAssessment["qualificationStatus"] = deadlineExpired
    ? "expired"
    : mismatches.length > 0
      ? "high-risk"
      : unknowns.length > 0 || conditional.length > 0
        ? "needs-verification"
        : "raw-fields-aligned";
  score = clampScore(score);
  if (qualificationStatus === "needs-verification") score = Math.min(score, 89);
  if (qualificationStatus === "high-risk") score = Math.min(score, 59);
  if (qualificationStatus === "expired") score = Math.min(score, 39);
  const verificationHours = unknowns.length * 2
    + conditional.length * 3
    + mismatches.length * 8;
  const preparationHours = basePreparationHours + verificationHours;

  const tier: DecisionCandidateTier = qualificationStatus === "expired"
    || qualificationStatus === "high-risk"
    ? "excluded"
    : qualificationStatus === "raw-fields-aligned"
      ? "primary"
      : "steady";
  const tierLabel = {
    primary: "主攻候选",
    sprint: "提升后冲刺",
    steady: "备选候选",
    watchlist: "候选观察",
    excluded: "暂不进入当前组合",
  }[tier];
  const qualificationLabel = {
    "raw-fields-aligned": "主站字段初步一致 · 官方资格待核验",
    "needs-verification": "关键字段不完整 · 资格待核验",
    "high-risk": "主站字段存在冲突 · 高风险",
    expired: "当前批次可能已截止",
  }[qualificationStatus];
  const scoreLabel = score >= 72
    ? "优先核验"
    : score >= 50
      ? "可以跟进"
      : "谨慎投入";

  const reasons = [
    ...gates.filter((gate) => gate.outcome === "pass").map((gate) => gate.summary),
    regionMatch ? "工作地域与当前偏好不冲突。" : "工作地域与当前偏好不一致。",
    fresh.label,
  ].slice(0, 4);
  const risks = gates
    .filter((gate) => gate.outcome !== "pass")
    .map((gate) => gate.summary)
    .slice(0, 4);
  const assignmentReason = qualificationStatus === "raw-fields-aligned"
    ? "学历、专业、届别和截止时间字段均无冲突"
    : qualificationStatus === "needs-verification"
      ? `未见明确冲突，仍有${unknowns.length + conditional.length}项信息待核验`
      : qualificationStatus === "expired"
        ? "当前批次已截止，退出当前组合"
        : `${mismatches.length}项关键字段冲突，退出当前组合`;
  const verificationGate = gates.find((gate) => gate.outcome !== "pass");
  const verificationTask = verificationGate
    ? `核验${verificationGate.label}：${verificationGate.summary}`
    : "打开企业公告，复核学历、专业、届别和截止时间";

  return {
    candidateId: candidate.id,
    tier,
    tierLabel,
    qualificationStatus,
    qualificationLabel,
    opportunityScore: score,
    scoreLabel,
    preliminaryGates: gates,
    reasons,
    risks,
    assignmentReason,
    verificationTask,
    profilePreparationHours: basePreparationHours,
    verificationHours,
    preparationHours,
    freshnessLabel: fresh.label,
    updatedAt: candidate.updatedAt ?? null,
  };
}

export function buildDecisionModelV1({
  profile,
  candidates,
  fetchedAt,
  now: nowInput = new Date(),
}: BuildDecisionModelInput): DecisionModelResult {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const profileLevel = profileReadiness(profile);
  const blockers = blockersFor(profile);
  const basePreparationHours = blockers.reduce(
    (sum, blocker) => sum + blocker.estimatedHours,
    0,
  );
  const assessments = candidates
    .map((candidate) => assessCandidate(
      profile,
      candidate,
      profileLevel.score,
      basePreparationHours,
      safeNow,
    ))
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.candidateId.localeCompare(b.candidateId));
  const companyCount = new Set(candidates.map((candidate) => candidate.companyName)).size;
  const regionCount = new Set(
    candidates.map((candidate) => candidate.workLocation).filter(Boolean),
  ).size;
  const recentlyUpdatedCount = assessments.filter((item) =>
    /近7天|近30天/u.test(item.freshnessLabel),
  ).length;
  const deadlineKnownCount = candidates.filter((candidate) =>
    Boolean(safeDate(candidate.applyEndDate)),
  ).length;
  const rawFieldAlignedCount = assessments.filter((item) =>
    item.qualificationStatus === "raw-fields-aligned",
  ).length;

  const currentCandidates = assessments.filter((item) =>
    item.qualificationStatus === "raw-fields-aligned"
    || item.qualificationStatus === "needs-verification"
  );
  const rawFieldAlignedCandidates = currentCandidates.filter((item) =>
    item.qualificationStatus === "raw-fields-aligned"
  );
  const verificationCandidates = currentCandidates.filter((item) =>
    item.qualificationStatus === "needs-verification"
  );
  const primaryCandidates = rawFieldAlignedCandidates.slice(0, 3);
  const primaryIds = new Set(primaryCandidates.map((item) => item.candidateId));
  const steadyCandidates = [
    ...rawFieldAlignedCandidates.filter((item) => !primaryIds.has(item.candidateId)),
    ...verificationCandidates,
  ]
    .slice(0, 3);
  const steadyIds = new Set(steadyCandidates.map((item) => item.candidateId));
  // V2 does not manufacture a stretch target from a weak score or missing
  // fields. A future evidence adapter may add candidates here only after a
  // verified enterprise difficulty or role-specific gap is available.
  const sprintCandidates: DecisionCandidateAssessment[] = [];
  const activeIds = new Set([
    ...primaryIds,
    ...steadyIds,
    ...sprintCandidates.map((item) => item.candidateId),
  ]);
  const finalAssessments = assessments.map((assessment) => {
    if (primaryIds.has(assessment.candidateId)) {
      return {
        ...assessment,
        tier: "primary" as const,
        tierLabel: "主攻候选",
        assignmentReason: "四项关键字段无冲突，优先核验并确认",
      };
    }
    if (steadyIds.has(assessment.candidateId)) {
      return {
        ...assessment,
        tier: "steady" as const,
        tierLabel: "备选候选",
        assignmentReason: assessment.qualificationStatus === "raw-fields-aligned"
          ? "关键字段无冲突，作为同等条件下的替代选择"
          : assessment.assignmentReason,
      };
    }
    if (
      !activeIds.has(assessment.candidateId)
      && (
        assessment.qualificationStatus === "raw-fields-aligned"
        || assessment.qualificationStatus === "needs-verification"
      )
    ) {
      return {
        ...assessment,
        tier: "watchlist" as const,
        tierLabel: "候选观察",
        assignmentReason: "当前组合已满，继续保留在候选池",
      };
    }
    return assessment;
  });
  const finalAssessmentById = new Map(
    finalAssessments.map((item) => [item.candidateId, item]),
  );
  const portfolio = {
    primary: primaryCandidates.map((item) => item.candidateId),
    sprint: sprintCandidates.map((item) => item.candidateId),
    steady: steadyCandidates.map((item) => item.candidateId),
  };

  const topPrimaryCandidate = primaryCandidates[0];
  const topSteadyCandidate = steadyCandidates[0];
  const nextActions = [
    topPrimaryCandidate
      ? "确认主攻岗位的学历、专业、届别和截止时间。"
      : topSteadyCandidate
        ? "先核验备选岗位缺失的关键字段，再决定是否升级为主攻。"
      : assessments.length > 0
        ? "当前候选批次均可能已截止，先核验新批次、补录或替代岗位。"
        : "先调整方向关键词，重新读取主站最新岗位。",
    ...blockers.slice(0, 2).map((blocker) =>
      `补齐${blocker.label}，预计投入${blocker.estimatedHours}小时。`,
    ),
  ];

  // Ensure every portfolio id is backed by the returned assessment set.
  for (const id of [...portfolio.primary, ...portfolio.sprint, ...portfolio.steady]) {
    if (!finalAssessmentById.has(id)) throw new Error("DECISION_PORTFOLIO_INCONSISTENT");
  }

  return {
    version: DECISION_MODEL_VERSION,
    generatedAt: safeNow.toISOString(),
    dataSnapshotAt: fetchedAt,
    boundary: {
      candidateSource: "zhida-main-site-readonly",
      hardGateAuthority: "verified-official-evidence-only",
      portfolioAuthority: "deterministic-evidence-rules",
      aiRole: "explain-extract-never-override-gates",
      scoreMeaning: "ranking-not-probability",
      containsStudentPii: false,
    },
    profileLevel,
    marketValue: {
      label: candidates.length > 0
        ? `${candidates.length}个主站最新岗位进入决策候选`
        : "当前条件下尚未形成决策候选",
      detail: candidates.length > 0
        ? `覆盖${companyCount}家单位、${regionCount}个工作地域；这是机会覆盖，不是薪资或录取概率。`
        : "可以调整方向、地域或关键词后重新计算。",
      candidateCount: candidates.length,
      companyCount,
      regionCount,
      recentlyUpdatedCount,
      deadlineKnownCount,
      rawFieldAlignedCount,
    },
    portfolio,
    portfolioGuidance: {
      primary: {
        label: "主攻岗位",
        standard: "四项关键字段无冲突，优先核验并确认",
        emptyReason: "暂无四项关键字段都无冲突的岗位",
      },
      steady: {
        label: "备选岗位",
        standard: "没有明确冲突，仍有少量信息待核验",
        emptyReason: "暂无可执行的备选岗位",
      },
      sprint: {
        label: "提升后冲刺",
        standard: "硬门槛无冲突，并有可核验的额外难度证据",
        emptyReason: "暂无可核验的冲刺证据，不为凑数生成目标",
      },
    },
    portfolioSummary: {
      watchlistCount: finalAssessments.filter((item) => item.tier === "watchlist").length,
      highRiskExcludedCount: finalAssessments.filter((item) =>
        item.qualificationStatus === "high-risk"
      ).length,
      expiredExcludedCount: finalAssessments.filter((item) =>
        item.qualificationStatus === "expired"
      ).length,
    },
    candidates: finalAssessments,
    blockers,
    nextActions,
    caveats: [
      "机会排序分只用于安排核验顺序，不是录取概率。",
      "主站岗位字段只做风险预判；只有A/B级已核验官方证据可以形成当前可投资格。",
      "当前目标组合只保留届别、学历和专业未出现明确冲突的岗位。",
      "AI可以提取信息和解释建议，但不能覆盖学历、专业、届别和截止时间闸门。",
    ],
  };
}

export function decisionAssessmentForCandidate(
  model: DecisionModelResult | null | undefined,
  candidateId: string | null | undefined,
): DecisionCandidateAssessment | null {
  if (!model || !candidateId) return null;
  return model.candidates.find((candidate) => candidate.candidateId === candidateId) ?? null;
}
