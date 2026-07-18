import { evaluateEligibility } from "./eligibility.ts";
import type {
  BuildStrategyNetworkInput,
  CapabilityKey,
  CapabilityLevel,
  CapabilityRequirement,
  DailyActionPlan,
  JobOpening,
  ProductCategory,
  ProductOffering,
  CapabilityEntitlement,
  ProductTrigger,
  StrategyBranch,
  StrategyNetwork,
  StrategyTask,
  StudentProfile,
} from "./types.ts";

const CAPABILITY_RANK: Record<CapabilityLevel, number> = {
  missing: 0,
  developing: 1,
  ready: 2,
};

const TASK_DAY: Record<CapabilityKey, StrategyTask["recommendedDay"]> = {
  target_research: 2,
  resume: 3,
  project_evidence: 3,
  application: 4,
  academic: 4,
  qualification: 4,
  interview: 5,
  internship: 6,
  competition: 6,
};

const DAY_FOCUS: Record<DailyActionPlan["day"], string> = {
  1: "核验硬门槛与本批次资格",
  2: "研究目标单位与岗位",
  3: "补齐简历和能力证据",
  4: "准备网申材料",
  5: "进行岗位化表达训练",
  6: "完成目标专属准备",
  7: "复盘本周并调整优先级",
};

function dateOnly(value: Date | string | undefined): string {
  const parsed = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("now 必须是有效日期");
  return parsed.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stablePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function requirementIsGap(profile: StudentProfile, requirement: CapabilityRequirement): boolean {
  const current = profile.capabilityLevels?.[requirement.key] ?? "missing";
  const required = requirement.minimumLevel ?? "ready";
  return CAPABILITY_RANK[current] < CAPABILITY_RANK[required];
}

function taskKind(capability: CapabilityKey): StrategyTask["kind"] {
  if (capability === "resume" || capability === "application" || capability === "interview") {
    return capability;
  }
  if (capability === "target_research") return "research";
  return "capability";
}

function capabilityDescription(requirement: CapabilityRequirement, targets: string[]): string {
  if (targets.length > 1) {
    return `先完成可被${targets.length}个目标共同复用的${requirement.label}，再进入各岗位的专属适配。`;
  }
  return `围绕该目标补齐${requirement.label}，完成后再进入下一阶段。`;
}

function highestPriority(requirements: CapabilityRequirement[]): StrategyTask["priority"] {
  if (requirements.some((item) => item.priority === "high")) return "high";
  if (requirements.some((item) => item.priority === "medium")) return "medium";
  return "low";
}

function mergedCriteria(requirements: CapabilityRequirement[]): string {
  const criteria = [...new Set(requirements.map((item) => item.completionCriteria).filter(Boolean))];
  return criteria.length > 0 ? criteria.join("；") : `形成一份可检查、可复用的${requirements[0].label}成果。`;
}

function createCapabilityTask(
  scope: StrategyTask["scope"],
  requirements: CapabilityRequirement[],
  jobIds: string[],
  generatedDay: string,
): StrategyTask {
  const primary = requirements[0];
  const recommendedDay = TASK_DAY[primary.key];
  const key = stablePart(primary.key);
  const targetPart = scope === "shared" ? "shared" : stablePart(jobIds[0]);

  return {
    id: `task:${targetPart}:${key}`,
    kind: taskKind(primary.key),
    capability: primary.key,
    scope,
    targetJobIds: [...jobIds].sort(),
    title: scope === "shared" ? `完成共用${primary.label}` : `完成${primary.label}`,
    description: capabilityDescription(primary, jobIds),
    completionCriteria: mergedCriteria(requirements),
    priority: highestPriority(requirements),
    recommendedDay,
    dueDate: addDays(generatedDay, recommendedDay - 1),
  };
}

function createEligibilityTask(job: JobOpening, generatedDay: string, branch: StrategyBranch): StrategyTask {
  const ineligible = branch.eligibility.status === "not_eligible_current_batch";
  const unknown = branch.eligibility.status === "unknown";

  return {
    id: `task:${stablePart(job.id)}:eligibility`,
    kind: "eligibility",
    scope: "target",
    targetJobIds: [job.id],
    title: ineligible
      ? `记录${job.company}本批次硬门槛并建立替代路线`
      : unknown
        ? `补齐${job.company}资格核验信息`
        : `确认${job.company}投递资格与截止时间`,
    description: ineligible
      ? "本任务不会把当前不可投包装成可投；保留长期目标，同时寻找本批次可执行的替代岗位。"
      : "逐项核对学历、专业、届别与截止时间，并保存公告依据。",
    completionCriteria: ineligible
      ? "保存不满足项的公告依据，并增加至少1个当前可申请的替代岗位。"
      : "四项硬门槛均有结论和来源；未知项已完成人工核验。",
    priority: "high",
    recommendedDay: 1,
    dueDate: generatedDay,
  };
}

function createResearchTask(job: JobOpening, generatedDay: string): StrategyTask {
  return {
    id: `task:${stablePart(job.id)}:research`,
    kind: "research",
    capability: "target_research",
    scope: "target",
    targetJobIds: [job.id],
    title: `完成${job.company}岗位情报卡`,
    description: `整理${job.title}的工作内容、单位偏好、时间节点与准备重点。`,
    completionCriteria: "形成一张包含岗位要求、截止时间、来源和下一动作的情报卡。",
    priority: "high",
    recommendedDay: 2,
    dueDate: addDays(generatedDay, 1),
  };
}

function createReviewTask(jobIds: string[], generatedDay: string): StrategyTask {
  return {
    id: "task:shared:weekly-review",
    kind: "review",
    scope: "shared",
    targetJobIds: [...jobIds].sort(),
    title: "完成7天求职复盘",
    description: "检查资格变化、已完成成果、未完成原因和下一周优先级。",
    completionCriteria: "更新每个目标的状态，并明确下一周最重要的3项行动。",
    priority: "medium",
    recommendedDay: 7,
    dueDate: addDays(generatedDay, 6),
  };
}

function productCategory(capability: CapabilityKey | undefined): ProductCategory | undefined {
  return capability === "resume" || capability === "application" || capability === "interview"
    ? capability
    : undefined;
}

export function buildProductTriggers(
  tasks: StrategyTask[],
  profile: StudentProfile,
  products: ProductOffering[],
  applicableJobIds: Set<string>,
  entitlements: CapabilityEntitlement[] = [],
): ProductTrigger[] {
  const owned = new Set(profile.ownedProductIds ?? []);
  const triggers: ProductTrigger[] = [];

  for (const category of ["resume", "application", "interview"] as const) {
    const relevantTasks = tasks.filter((task) => productCategory(task.capability) === category);
    if (relevantTasks.length === 0) continue;

    const entitlement = entitlements
      .filter((item) => item.category === category)
      .sort((left, right) => left.code.localeCompare(right.code))[0];
    if (entitlement) {
      triggers.push({
        productId: `entitlement:${entitlement.code}`,
        productName: entitlement.name,
        category,
        source: "entitlement",
        status: "owned_available",
        actionUrl: entitlement.actionUrl,
        message: `你当前的主站权益已包含${entitlement.name}，需要时可直接使用。`,
        triggerAtTaskIds: relevantTasks.map((task) => task.id),
      });
      continue;
    }

    const available = products
      .filter((product) => product.enabled && product.category === category)
      .sort((left, right) => Number(owned.has(right.id)) - Number(owned.has(left.id)) || left.id.localeCompare(right.id));
    const product = available[0];
    if (!product) continue;

    const isOwned = owned.has(product.id);
    const hasCurrentBatchTarget = relevantTasks.some((task) =>
      task.targetJobIds.some((jobId) => applicableJobIds.has(jobId)),
    );
    if (!isOwned && !hasCurrentBatchTarget) continue;

    triggers.push({
      productId: product.id,
      productName: product.name,
      category,
      source: "product",
      status: isOwned ? "owned_available" : "optional_offer",
      message: isOwned
        ? `你已拥有${product.name}，可在当前任务中直接使用。`
        : `当前任务遇到${category === "resume" ? "简历" : category === "application" ? "网申" : "面试"}卡点时，可选用${product.name}。`,
      triggerAtTaskIds: relevantTasks.map((task) => task.id),
    });
  }

  return triggers;
}

export function buildStrategyNetwork(input: BuildStrategyNetworkInput): StrategyNetwork {
  const { profile, products = [], entitlements = [] } = input;
  const generatedDay = dateOnly(input.now);
  const jobs = [...new Map(input.jobs.map((job) => [job.id, job])).values()];

  if (!profile.id.trim()) throw new TypeError("profile.id 不能为空");
  if (jobs.length === 0) throw new RangeError("至少选择1个目标岗位");
  if (jobs.length > 3) throw new RangeError("快速上线版最多同时规划3个目标岗位");

  const entries = jobs.flatMap((job) =>
    (job.capabilityRequirements ?? [])
      .filter((requirement) => requirementIsGap(profile, requirement))
      .map((requirement) => ({ job, requirement })),
  );

  const shareableByCapability = new Map<CapabilityKey, typeof entries>();
  for (const entry of entries.filter((item) => item.requirement.shareable !== false)) {
    const group = shareableByCapability.get(entry.requirement.key) ?? [];
    group.push(entry);
    shareableByCapability.set(entry.requirement.key, group);
  }

  const sharedKeys = new Set<CapabilityKey>();
  const sharedTasks: StrategyTask[] = [];
  for (const [key, group] of shareableByCapability) {
    const jobIds = [...new Set(group.map((entry) => entry.job.id))];
    if (jobIds.length < 2) continue;
    sharedKeys.add(key);
    sharedTasks.push(
      createCapabilityTask(
        "shared",
        group.map((entry) => entry.requirement),
        jobIds,
        generatedDay,
      ),
    );
  }

  const branches: StrategyBranch[] = jobs.map((job) => {
    const eligibility = input.eligibilityByJobId?.[job.id]
      ?? evaluateEligibility(profile, job, generatedDay);
    const branch: StrategyBranch = {
      jobId: job.id,
      company: job.company,
      title: job.title,
      eligibility,
      sharedTaskIds: sharedTasks
        .filter((task) => task.targetJobIds.includes(job.id))
        .map((task) => task.id),
      tasks: [],
    };

    branch.tasks.push(createEligibilityTask(job, generatedDay, branch));
    branch.tasks.push(createResearchTask(job, generatedDay));

    for (const entry of entries.filter((item) => item.job.id === job.id)) {
      if (entry.requirement.shareable !== false && sharedKeys.has(entry.requirement.key)) continue;
      branch.tasks.push(createCapabilityTask("target", [entry.requirement], [job.id], generatedDay));
    }

    return branch;
  });

  const reviewTask = createReviewTask(
    jobs.map((job) => job.id),
    generatedDay,
  );
  sharedTasks.push(reviewTask);

  const allTasks = [...sharedTasks, ...branches.flatMap((branch) => branch.tasks)];
  const sevenDayPlan = ([1, 2, 3, 4, 5, 6, 7] as const).map((day): DailyActionPlan => ({
    day,
    date: addDays(generatedDay, day - 1),
    focus: DAY_FOCUS[day],
    taskIds: allTasks.filter((task) => task.recommendedDay === day).map((task) => task.id),
  }));
  const applicableJobIds = new Set(
    branches.filter((branch) => branch.eligibility.canApplyCurrentBatch).map((branch) => branch.jobId),
  );

  return {
    id: `strategy:${stablePart(profile.id)}:${jobs.map((job) => stablePart(job.id)).sort().join("+")}`,
    profileId: profile.id,
    generatedAt: `${generatedDay}T00:00:00.000Z`,
    targetJobIds: jobs.map((job) => job.id),
    sharedTasks,
    branches,
    sevenDayPlan,
    productTriggers: buildProductTriggers(
      allTasks,
      profile,
      products,
      applicableJobIds,
      entitlements,
    ),
  };
}
