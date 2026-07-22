import type {
  MarketReportCandidate,
  MarketReportResult,
} from "./market-report.ts";
import { decisionAssessmentForCandidate } from "./decision-model.ts";

export type DecisionSystemPath = {
  trackId: string;
  trackLabel: string;
  subtrackId: string;
  subtrackLabel: string;
  dataStatus: "live" | "pending";
};

export type DecisionLayerState = {
  status: "live" | "partial" | "pending" | "ready" | "provisional" | "prepare-and-verify" | "structure-only";
  headline: string;
  detail: string;
};

export type DecisionSystemSnapshot = {
  data: DecisionLayerState;
  route: DecisionLayerState;
  decision: DecisionLayerState & {
    nextAction: string;
    estimatedTime: string;
  };
  advisorContext: string;
};

type BuildDecisionSystemSnapshotInput = {
  path: DecisionSystemPath;
  selectedCandidate: MarketReportCandidate | null;
  relatedCandidates: MarketReportCandidate[];
  report: MarketReportResult | null;
};

const NEXT_ACTION_BY_TRACK: Record<
  string,
  { title: string; estimatedTime: string }
> = {
  "state-owned": {
    title: "完成目标岗位资格画像",
    estimatedTime: "预计 90 分钟",
  },
  "civil-service": {
    title: "核验报考身份与岗位限制",
    estimatedTime: "预计 60 分钟",
  },
  "public-institution": {
    title: "确认考试类别与专业目录",
    estimatedTime: "预计 60 分钟",
  },
  "private-enterprise": {
    title: "建立目标公司与岗位清单",
    estimatedTime: "预计 45 分钟",
  },
  "foreign-enterprise": {
    title: "建立外企岗位能力画像",
    estimatedTime: "预计 45 分钟",
  },
};

function candidateKey(candidate: MarketReportCandidate): string {
  return [
    candidate.companyName.trim(),
    candidate.jobTitle.trim(),
    candidate.workLocation?.trim() ?? "",
    candidate.applyEndDate?.trim() ?? "",
  ].join("|");
}

export function dedupeMarketReportCandidates(
  candidates: MarketReportCandidate[],
): MarketReportCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueCandidates(
  selectedCandidate: MarketReportCandidate | null,
  relatedCandidates: MarketReportCandidate[],
): MarketReportCandidate[] {
  return dedupeMarketReportCandidates(
    [selectedCandidate, ...relatedCandidates].filter(
      (candidate): candidate is MarketReportCandidate => Boolean(candidate),
    ),
  );
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function buildDecisionSystemSnapshot({
  path,
  selectedCandidate,
  relatedCandidates,
  report,
}: BuildDecisionSystemSnapshotInput): DecisionSystemSnapshot {
  const candidates = uniqueCandidates(selectedCandidate, relatedCandidates);
  const companyCount = new Set(
    candidates.map((candidate) => candidate.companyName.trim()).filter(Boolean),
  ).size;
  const knownDeadlineCount = candidates.filter(
    (candidate) => Boolean(shortDate(candidate.applyEndDate)),
  ).length;
  const selectedDeadline = shortDate(selectedCandidate?.applyEndDate ?? null);
  const action = NEXT_ACTION_BY_TRACK[path.trackId] ?? {
    title: "完成目标资格与机会核验",
    estimatedTime: "预计 60 分钟",
  };

  const hasLiveCandidateData = path.dataStatus === "live" && candidates.length > 0;
  const hasSelectedCandidate = Boolean(selectedCandidate);
  const selectedAssessment = decisionAssessmentForCandidate(
    report?.decisionModel,
    selectedCandidate?.id,
  );

  const data: DecisionLayerState = hasLiveCandidateData
    ? {
        status: report?.status === "live" ? "live" : "partial",
        headline: `${candidates.length} 个候选 · ${companyCount} 家目标单位`,
        detail: `${knownDeadlineCount} 个候选提供截止时间；候选来自主站最新岗位，全部资格仍待官方原文核验。`,
      }
    : {
        status: "pending",
        headline: `${path.trackLabel}岗位源待接入`,
        detail: "当前只有路线结构，不能计算岗位数量、倒计时或可报资格。",
      };

  const route: DecisionLayerState = hasLiveCandidateData
    ? {
        status: "ready",
        headline: `1 条共同准备主线 · ${Math.max(1, companyCount)} 条目标分支`,
        detail: selectedAssessment
          ? `${selectedAssessment.tierLabel}：${selectedAssessment.assignmentReason}；基础准备${selectedAssessment.profilePreparationHours}小时，资格核验约${selectedAssessment.verificationHours}小时。`
          : selectedDeadline
            ? `已选目标提供截止时间 ${selectedDeadline}；企业批次和开始时间仍待核验。`
          : "已生成准备顺序；没有可靠日期的窗口不启动倒计时。",
      }
    : {
        status: "provisional",
        headline: `${path.subtrackLabel}结构路线`,
        detail: "先展示应完成的准备节点；接入官方职位表后再生成真实时间线。",
      };

  const decision: DecisionSystemSnapshot["decision"] = hasSelectedCandidate
    ? {
        status: "prepare-and-verify",
        headline: selectedAssessment
          ? `${selectedAssessment.tierLabel} · 先核验再投入`
          : "先准备并核验，暂不判定可投",
        detail: selectedAssessment
          ? `${selectedAssessment.assignmentReason}；${selectedAssessment.qualificationLabel}。排序分${selectedAssessment.opportunityScore}只用于安排核验顺序。`
          : selectedDeadline
            ? `时间信息可用于排序，但学历、专业、届别与批次仍未形成可投资格证据。`
          : "岗位方向已经确定，但时间和硬门槛证据仍不完整。",
        nextAction: selectedAssessment?.verificationTask ?? action.title,
        estimatedTime: action.estimatedTime,
      }
    : hasLiveCandidateData
      ? {
          status: "prepare-and-verify",
          headline: "先选择具体岗位，再形成路线决策",
          detail: `当前方向有 ${candidates.length} 个去重候选；选中一个目标后再核验资格并安排时间。`,
          nextAction: "从真实候选中选择一个目标岗位",
          estimatedTime: "预计 3 分钟",
        }
      : {
          status: "structure-only",
          headline: "先建立资格画像，不生成可报结论",
          detail: `${path.trackLabel} / ${path.subtrackLabel} 已确定；岗位源未接入前只推进可逆的前置准备。`,
          nextAction: action.title,
          estimatedTime: action.estimatedTime,
        };

  const selectedTarget = selectedCandidate
    ? `${selectedCandidate.companyName} / ${selectedCandidate.jobTitle}`
    : `${path.trackLabel} / ${path.subtrackLabel}`;
  const sourceLabel = report?.directions.sourceLabel ?? "岗位源待接入";
  const advisorContext = [
    `决策目标：${selectedTarget}`,
    `数据：${data.headline}；${data.detail}`,
    `路线：${route.headline}；${route.detail}`,
    `当前结论：${decision.headline}；${decision.detail}`,
    `第一行动：${decision.nextAction}（${decision.estimatedTime}）`,
    `数据来源：${sourceLabel}`,
    report?.decisionModel
      ? `决策模型：${report.decisionModel.version}；准备度${report.decisionModel.profileLevel.score}分（不是同类排名）；候选来自主站只读岗位；硬门槛只认官方已核验证据`
      : "决策模型：尚未生成",
  ].join("；");

  return { data, route, decision, advisorContext };
}
