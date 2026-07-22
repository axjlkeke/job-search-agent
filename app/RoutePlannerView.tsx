"use client";

import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  CalendarBlank,
  CheckCircle,
  Clock,
  Compass,
  FileText,
  Flag,
  Info,
  Lightning,
  ListChecks,
  Path,
  ShieldCheck,
  Target,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState, type CSSProperties } from "react";
import type {
  DecisionSystemSnapshot,
  MarketReportCandidate,
} from "@/lib/career";
import styles from "./career-strategy.module.css";

export type RoutePlannerMode = "timeline" | "recruitment";

type RoutePlannerProfile = {
  major: string;
  graduationYear: number;
  degreeLabel: string;
};

type RoutePlannerPath = {
  trackId: string;
  trackLabel: string;
  subtrackId: string;
  subtrackLabel: string;
};

type RouteStatus = "provided" | "example" | "pending";

type RouteEvent = {
  id: string;
  laneId: string;
  title: string;
  detail: string;
  date: Date | null;
  position: number;
  width: number;
  status: RouteStatus;
  source: string | null;
};

type RouteLane = {
  id: string;
  label: string;
  description: string;
  events: RouteEvent[];
};

type RouteMilestone = {
  id: string;
  title: string;
  detail: string;
  position: number;
};

type RouteModel = {
  noun: "招聘" | "招录";
  title: string;
  subtitle: string;
  lanesLabel: string;
  lanes: RouteLane[];
  milestones: RouteMilestone[];
  nextAction: string;
  nextActionDetail: string;
  estimatedTime: string;
  caveat: string;
  hasLiveEvents: boolean;
};

type RoutePlannerViewProps = {
  profile: RoutePlannerProfile;
  path: RoutePlannerPath;
  selectedCandidate: MarketReportCandidate | null;
  relatedCandidates: MarketReportCandidate[];
  decisionSnapshot: DecisionSystemSnapshot;
  initialMode?: RoutePlannerMode;
  onBack: () => void;
  onOpenAdvisor: () => void;
};

const STATUS_LABELS: Record<RouteStatus, string> = {
  provided: "已提供时间",
  example: "结构示例",
  pending: "待核验",
};

const STATUS_ORDER: RouteStatus[] = ["provided", "example", "pending"];

const TRACK_COPY: Record<
  string,
  {
    noun: "招聘" | "招录";
    lanesLabel: string;
    nextAction: string;
    nextActionDetail: string;
    estimatedTime: string;
    milestones: Array<[string, string]>;
    sampleLanes: string[];
    sampleWindows: string[];
  }
> = {
  "state-owned": {
    noun: "招聘",
    lanesLabel: "企业招聘线",
    nextAction: "完成目标企业资格画像",
    nextActionDetail: "先核验学历、专业、届别和批次，再决定简历与笔试准备顺序。",
    estimatedTime: "预计 90 分钟",
    milestones: [
      ["资格画像", "建立企业与岗位硬门槛"],
      ["专业课与证书", "补齐关键专业知识"],
      ["实习与项目", "沉淀可验证经历"],
      ["岗位版简历", "按企业与岗位改写"],
      ["笔试准备", "依据考试范围训练"],
      ["面试准备", "结构化表达与复盘"],
    ],
    sampleLanes: ["目标企业 A", "目标企业 B", "目标企业 C"],
    sampleWindows: ["提前批", "第一批", "第二批", "补录批次"],
  },
  "civil-service": {
    noun: "招录",
    lanesLabel: "考试招录线",
    nextAction: "核验报考身份与岗位限制",
    nextActionDetail: "先确认届别、政治面貌、基层经历、专业代码和地区要求。",
    estimatedTime: "预计 60 分钟",
    milestones: [
      ["身份核验", "确认选调与公考资格"],
      ["行测基础", "建立模块能力基线"],
      ["申论训练", "材料阅读与表达"],
      ["职位表筛选", "按专业代码排除"],
      ["报名材料", "照片与证明文件"],
      ["笔面试", "按节点集中冲刺"],
    ],
    sampleLanes: ["选调生招录线", "国考招录线", "省考招录线"],
    sampleWindows: ["公告", "报名", "资格审查", "笔试", "面试", "体检政审"],
  },
  "public-institution": {
    noun: "招录",
    lanesLabel: "事业单位招录线",
    nextAction: "确认考试类别与专业目录",
    nextActionDetail: "先锁定联考类别、专业代码和目标地区，再匹配职测与综应。",
    estimatedTime: "预计 60 分钟",
    milestones: [
      ["类别核验", "确认 A/B/C/D/E 类"],
      ["职测基础", "建立题型能力基线"],
      ["综应训练", "按类别准备主观题"],
      ["岗位表筛选", "核对专业与地区"],
      ["资格复审", "提前整理证明材料"],
      ["笔面试", "围绕招考节点冲刺"],
    ],
    sampleLanes: ["全国联考线", "省级统考线", "单位单招线"],
    sampleWindows: ["公告", "报名", "笔试", "资格复审", "面试", "体检考察"],
  },
  "private-enterprise": {
    noun: "招聘",
    lanesLabel: "企业招聘线",
    nextAction: "建立目标公司与岗位清单",
    nextActionDetail: "先按行业、城市和岗位能力模型筛出三组公司，再倒推实习与秋招。",
    estimatedTime: "预计 45 分钟",
    milestones: [
      ["方向校准", "确认行业与岗位族"],
      ["能力基线", "技能与项目差距"],
      ["实习投递", "获得真实业务证据"],
      ["简历作品", "形成岗位化材料"],
      ["笔面试", "题库与项目深挖"],
      ["Offer 决策", "比较成长与回报"],
    ],
    sampleLanes: ["头部企业线", "成长企业线", "保底企业线"],
    sampleWindows: ["暑期实习", "提前批", "秋招", "春招", "补录"],
  },
  "foreign-enterprise": {
    noun: "招聘",
    lanesLabel: "外企招聘线",
    nextAction: "建立外企岗位能力画像",
    nextActionDetail: "先核对语言、实习、职能技能与申请材料要求，再排列申请窗口。",
    estimatedTime: "预计 45 分钟",
    milestones: [
      ["岗位画像", "识别职能与语言要求"],
      ["语言材料", "中英文简历与表达"],
      ["实习证据", "跨文化协作与结果"],
      ["网申测评", "准备测评与案例"],
      ["面试训练", "行为与业务面试"],
      ["Offer 决策", "比较岗位与发展"],
    ],
    sampleLanes: ["目标外企 A", "目标外企 B", "目标外企 C"],
    sampleWindows: ["实习项目", "秋季招聘", "春季招聘", "滚动补录"],
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDay(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("/", ".");
}

function shortDate(date: Date | null): string {
  if (!date) return "时间待核验";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function seasonLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const season = month >= 3 && month <= 5
    ? "春"
    : month >= 6 && month <= 8
      ? "夏"
      : month >= 9 && month <= 11
        ? "秋"
        : "冬";
  return `${date.getFullYear()} ${season}`;
}

function seasonKey(date: Date | null): string | null {
  return date ? seasonLabel(date) : null;
}

function datePosition(date: Date | null, start: Date, end: Date): number {
  if (!date) return 88;
  const span = Math.max(1, end.getTime() - start.getTime());
  return clamp(((date.getTime() - start.getTime()) / span) * 100, 4, 94);
}

function uniqueCandidates(
  selected: MarketReportCandidate | null,
  related: MarketReportCandidate[],
): MarketReportCandidate[] {
  const seenIds = new Set<string>();
  const seenOpenings = new Set<string>();
  return [selected, ...related]
    .filter((candidate): candidate is MarketReportCandidate => Boolean(candidate))
    .filter((candidate) => {
      const openingKey = [
        candidate.companyName.trim(),
        candidate.jobTitle.trim(),
        candidate.workLocation?.trim() ?? "",
        candidate.applyEndDate?.trim() ?? "",
      ].join("|");
      if (seenIds.has(candidate.id) || seenOpenings.has(openingKey)) return false;
      seenIds.add(candidate.id);
      seenOpenings.add(openingKey);
      return true;
    })
    .slice(0, 24);
}

function buildRouteModel(
  path: RoutePlannerPath,
  selected: MarketReportCandidate | null,
  related: MarketReportCandidate[],
  today: Date,
  horizon: Date,
): RouteModel {
  const copy = TRACK_COPY[path.trackId] ?? TRACK_COPY["state-owned"];
  const candidates = uniqueCandidates(selected, related);
  const grouped = new Map<string, MarketReportCandidate[]>();
  for (const candidate of candidates) {
    const company = candidate.companyName.trim() || "企业名称待核验";
    const group = grouped.get(company) ?? [];
    group.push(candidate);
    grouped.set(company, group);
  }

  let lanes: RouteLane[] = [];
  if (path.trackId === "state-owned" && grouped.size > 0) {
    const orderedCompanies = [...grouped.entries()]
      .sort(([companyA], [companyB]) => {
        if (selected?.companyName === companyA) return -1;
        if (selected?.companyName === companyB) return 1;
        return companyA.localeCompare(companyB, "zh-CN");
      })
      .slice(0, 3);
    lanes = orderedCompanies.map(([companyName, jobs], laneIndex) => ({
      id: `company-${laneIndex}`,
      label: companyName,
      description: `${jobs.length} 个真实候选 · 资格待核验`,
      events: jobs.slice(0, 4).map((job, eventIndex) => {
        const date = safeDate(job.applyEndDate);
        return {
          id: `${job.id}-${eventIndex}`,
          laneId: `company-${laneIndex}`,
          title: job.jobType ? `${job.jobType}窗口` : "招聘窗口",
          detail: job.jobTitle,
          date,
          position: datePosition(date, today, horizon),
          width: 12,
          status: date ? "provided" : "pending",
          source: job.source,
        };
      }),
    }));
  }

  if (lanes.length === 0) {
    const laneNames = path.trackId === "civil-service"
      ? [path.subtrackLabel, "目标地区/部门 A", "备选地区/部门 B"]
      : path.trackId === "public-institution"
        ? [path.subtrackLabel, "省级统考线", "单位单招线"]
        : copy.sampleLanes;
    lanes = laneNames.slice(0, 3).map((laneName, laneIndex) => ({
      id: `sample-${laneIndex}`,
      label: laneName,
      description: "结构示例 · 数据源待接入",
      events: copy.sampleWindows.slice(0, 4).map((windowLabel, eventIndex) => ({
        id: `sample-${laneIndex}-${eventIndex}`,
        laneId: `sample-${laneIndex}`,
        title: windowLabel,
        detail: "日期与资格均待官方来源",
        date: null,
        position: 12 + eventIndex * 23 + laneIndex * 2,
        width: 14,
        status: eventIndex < 2 ? "example" : "pending",
        source: null,
      })),
    }));
  }

  const milestones: RouteMilestone[] = copy.milestones.map(
    ([title, detail], index) => ({
      id: `${path.trackId}-milestone-${index}`,
      title,
      detail,
      position: 5 + index * 18,
    }),
  );
  const hasLiveEvents = lanes.some((lane) =>
    lane.events.some((event) => event.status === "provided"),
  );

  return {
    noun: copy.noun,
    title: copy.noun === "招录" ? `${path.trackLabel}招录规划` : `${path.trackLabel}求职规划`,
    subtitle: `${path.subtrackLabel} · 一条总计划，多次${copy.noun}窗口`,
    lanesLabel: copy.lanesLabel,
    lanes,
    milestones,
    nextAction: copy.nextAction,
    nextActionDetail: copy.nextActionDetail,
    estimatedTime: copy.estimatedTime,
    caveat: hasLiveEvents
      ? `当前只使用岗位已提供的截止时间；企业批次、开始时间和资格仍需回查官方公告。`
      : `${path.trackLabel}岗位源尚未接入；当前只展示路线结构，不触发倒计时或可报判断。`,
    hasLiveEvents,
  };
}

function timelineStyle(position: number, width: number): CSSProperties {
  return {
    "--route-left": `${position}%`,
    "--route-width": `${width}%`,
  } as CSSProperties;
}

function RouteModeSwitch({
  mode,
  onChange,
}: {
  mode: RoutePlannerMode;
  onChange: (mode: RoutePlannerMode) => void;
}) {
  return (
    <div className={styles.routeModeSwitch} role="group" aria-label="路线视图">
      <button
        aria-pressed={mode === "timeline"}
        data-active={mode === "timeline"}
        onClick={() => onChange("timeline")}
        type="button"
      >
        <CalendarBlank size={17} weight={mode === "timeline" ? "fill" : "regular"} />
        时间线版
      </button>
      <button
        aria-pressed={mode === "recruitment"}
        data-active={mode === "recruitment"}
        onClick={() => onChange("recruitment")}
        type="button"
      >
        <Path size={17} weight={mode === "recruitment" ? "fill" : "regular"} />
        招聘线版
      </button>
    </div>
  );
}

function DecisionSystemBrief({ snapshot }: { snapshot: DecisionSystemSnapshot }) {
  const layers = [
    ["01 · 数据", snapshot.data],
    ["02 · 路线", snapshot.route],
    ["03 · 决策", snapshot.decision],
  ] as const;
  return (
    <section className={styles.routeDecisionSystem} aria-label="数据、路线与决策摘要">
      <header>
        <small>决策系统</small>
        <strong>{snapshot.decision.headline}</strong>
        <span>{snapshot.decision.nextAction}</span>
      </header>
      <div>
        {layers.map(([label, layer]) => (
          <article data-status={layer.status} key={label}>
            <span>{label}</span>
            <strong>{layer.headline}</strong>
            <p>{layer.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusLegend() {
  return (
    <div className={styles.routeLegend} aria-label="时间状态说明">
      {STATUS_ORDER.map((status) => (
        <span data-status={status} key={status}>
          <i />{STATUS_LABELS[status]}
        </span>
      ))}
    </div>
  );
}

function CurrentAction({
  model,
  onOpenAdvisor,
  compact = false,
}: {
  model: RouteModel;
  onOpenAdvisor: () => void;
  compact?: boolean;
}) {
  return (
    <aside className={styles.routeCurrentAction} data-compact={compact}>
      <header>
        <span>现在只做这一件事</span>
        <ArrowRight size={20} weight="bold" />
      </header>
      <h2>{model.nextAction}</h2>
      <p>{model.nextActionDetail}</p>
      <div><Clock size={17} />{model.estimatedTime}</div>
      <button type="button" onClick={onOpenAdvisor}>
        开始第一项行动 <ArrowRight size={17} weight="bold" />
      </button>
    </aside>
  );
}

function TimelineVersion({
  model,
  today,
  horizon,
  onOpenAdvisor,
}: {
  model: RouteModel;
  today: Date;
  horizon: Date;
  onOpenAdvisor: () => void;
}) {
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const visibleLanes = laneFilter === "all"
    ? model.lanes
    : model.lanes.filter((lane) => lane.id === laneFilter);
  const periodLabels = [
    `${today.getFullYear()} 下半年`,
    `${today.getFullYear() + 1} 上半年`,
    `${today.getFullYear() + 1} 下半年`,
    `${horizon.getFullYear()} 上半年`,
  ];
  const eventCount = model.lanes.reduce((sum, lane) => sum + lane.events.length, 0);
  const pendingCount = model.lanes.reduce(
    (sum, lane) => sum + lane.events.filter((event) => event.status !== "provided").length,
    0,
  );

  return (
    <div className={styles.routeTimelineVersion}>
      <div className={styles.routeTimelineRail}>
        <CurrentAction model={model} onOpenAdvisor={onOpenAdvisor} />
        <section className={styles.routeCampaignOverview}>
          <small>{model.noun === "招录" ? "招录概览" : "战役概览"}</small>
          <strong>
            {model.hasLiveEvents
              ? `${model.lanes.length} 条${model.lanesLabel} · ${eventCount} 个窗口`
              : `${model.lanes.length} 条结构路线 · ${eventCount} 个待核验节点`}
          </strong>
          <span>
            {model.hasLiveEvents
              ? `${pendingCount} 个窗口时间待核验`
              : "当前不构成真实招录窗口"}
          </span>
          <div>
            <button
              data-active={laneFilter === "all"}
              onClick={() => setLaneFilter("all")}
              type="button"
            >全部路线</button>
            {model.lanes.map((lane) => (
              <button
                data-active={laneFilter === lane.id}
                key={lane.id}
                onClick={() => setLaneFilter(lane.id)}
                type="button"
              >{lane.label}</button>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.routeCalendarBoard} aria-label={`统一${model.noun}时间线`}>
        <header className={styles.routeCalendarAxis}>
          <div className={styles.routeTodayMarker}>
            <span>今天</span><strong>{isoDay(today)}</strong>
          </div>
          {periodLabels.map((label) => <span key={label}>{label}</span>)}
        </header>

        <div className={styles.routeSharedLane}>
          <div className={styles.routeLaneLabel}>
            <ListChecks size={19} weight="duotone" />
            <span><strong>共同准备主线</strong><small>所有目标共用</small></span>
          </div>
          <div className={styles.routeSharedTrack}>
            {model.milestones.map((milestone) => (
              <article key={milestone.id}>
                <strong>{milestone.title}</strong>
                <span>{milestone.detail}</span>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.routeLaneRows}>
          {visibleLanes.map((lane) => (
            <div className={styles.routeLaneRow} key={lane.id}>
              <div className={styles.routeLaneLabel}>
                {model.noun === "招录"
                  ? <FileText size={20} weight="duotone" />
                  : <Buildings size={20} weight="duotone" />}
                <span><strong>{lane.label}</strong><small>{lane.description}</small></span>
              </div>
              <div className={styles.routeLaneTrack}>
                {lane.events.map((event) => (
                  <article
                    data-status={event.status}
                    key={event.id}
                    style={timelineStyle(event.position, event.width)}
                    title={`${event.title} · ${event.detail}`}
                  >
                    <strong>{event.title}</strong>
                    <span>{shortDate(event.date)}</span>
                    <small>{event.detail}</small>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>

        <footer>
          <StatusLegend />
          <p><Info size={15} />{model.caveat}</p>
        </footer>
      </section>

      <div className={styles.routeCalendarPhoto} aria-hidden="true" />
    </div>
  );
}

function RecruitmentVersion({
  model,
  selectedCandidate,
  onOpenAdvisor,
}: {
  model: RouteModel;
  selectedCandidate: MarketReportCandidate | null;
  onOpenAdvisor: () => void;
}) {
  const allEvents = model.lanes.flatMap((lane) =>
    lane.events.map((event) => ({ ...event, lane: lane.label })),
  );
  const [expandedEventId, setExpandedEventId] = useState<string | null>(
    allEvents[0]?.id ?? null,
  );
  const expanded = allEvents.find((event) => event.id === expandedEventId)
    ?? allEvents[0]
    ?? null;
  const datedEvents = allEvents
    .filter((event) => event.date)
    .sort((eventA, eventB) => (eventA.date?.getTime() ?? 0) - (eventB.date?.getTime() ?? 0));
  const firstSeason = seasonKey(datedEvents[0]?.date ?? null);
  const midpoint = Math.max(1, Math.ceil(allEvents.length / 2));
  const earlyEvents = firstSeason
    ? allEvents.filter((event) => seasonKey(event.date) === firstSeason)
    : allEvents.slice(0, midpoint);
  const laterEvents = firstSeason
    ? allEvents.filter((event) => seasonKey(event.date) !== firstSeason)
    : allEvents.slice(midpoint);
  const laterDatedEvent = laterEvents.find((event) => event.date);
  const chapterEvents = [[], earlyEvents, laterEvents, []] as Array<typeof allEvents>;
  const firstRoundTitle = firstSeason
    ? `${firstSeason} · 第一轮${model.noun}季`
    : `第一轮${model.noun}季 · 时间待核验`;
  const secondRoundTitle = laterDatedEvent?.date
    ? `${seasonLabel(laterDatedEvent.date)} · 第二轮${model.noun}季`
    : `后续${model.noun}窗口 · 时间待核验`;
  const decisionTitle = model.noun === "招录" ? "录用确认" : "Offer 决策";
  const decisionItems = model.noun === "招录"
    ? ["笔试冲刺", "面试复盘", "体检考察", "录用确认"]
    : ["笔试冲刺", "面试复盘", "Offer 对比", "签约决策"];
  const chapterCopy = [
    ["现在 · 基础准备季", "夯实基础，建立匹配力"],
    [firstRoundTitle, `提前准备，${model.noun}窗口集中启动`],
    [secondRoundTitle, `滚动窗口、补充批次与冲刺阶段`],
    [`终点前 · ${decisionTitle}`, model.noun === "招录" ? "完成笔试、面试、体检考察与录用确认" : "综合比较，做出最优选择"],
  ];

  return (
    <div className={styles.routeRecruitmentVersion}>
      <div className={styles.routeScrollTrack}>
        {chapterCopy.map(([title, detail], chapterIndex) => (
          <section className={styles.routeChapter} data-chapter={chapterIndex + 1} key={title}>
            <div className={styles.routeChapterNumber}>0{chapterIndex + 1}</div>
            <header>
              <h2>{title}</h2>
              <p>{detail}</p>
            </header>

            {chapterIndex === 0 ? (
              <div className={styles.routeMilestoneStrip}>
                {model.milestones.slice(0, 4).map((milestone) => (
                  <article key={milestone.id}>
                    <i><CheckCircle size={17} /></i>
                    <strong>{milestone.title}</strong>
                    <span>{milestone.detail}</span>
                  </article>
                ))}
              </div>
            ) : null}

            {chapterEvents[chapterIndex].length > 0 ? (
              <div className={styles.routeOpportunityLine}>
                {chapterEvents[chapterIndex].map((event) => (
                  <button
                    aria-expanded={expandedEventId === event.id}
                    data-status={event.status}
                    key={event.id}
                    onClick={() => setExpandedEventId(event.id)}
                    type="button"
                  >
                    <span>{event.lane}</span>
                    <strong>{event.title}</strong>
                    <small>{shortDate(event.date)} · {STATUS_LABELS[event.status]}</small>
                  </button>
                ))}
              </div>
            ) : null}

            {chapterIndex === 1 && expanded ? (
              <article className={styles.routeStrategyCard}>
                <header>
                  <span>{expanded.lane}</span>
                  <small>{expanded.title} · {STATUS_LABELS[expanded.status]}</small>
                </header>
                <div><Target size={17} /><span><strong>匹配判断</strong>资格待核验</span></div>
                <div><WarningCircle size={17} /><span><strong>关键风险</strong>{selectedCandidate ? "专业、学历和批次要求尚未逐项确认" : "岗位源和官方时间尚未接入"}</span></div>
                <div><FileText size={17} /><span><strong>行动</strong>查看官方公告原文并保存证据</span></div>
                <button type="button" onClick={onOpenAdvisor}>加入主计划</button>
              </article>
            ) : null}

            {chapterIndex === 3 ? (
              <div className={styles.routeDecisionStrip}>
                {decisionItems.map((item, index) => (
                  <article key={item}>
                    <i>{index === 3 ? <Flag size={17} /> : <Compass size={17} />}</i>
                    <strong>{item}</strong>
                    <span>{index === 3 ? "终点" : "进入主计划后生成"}</span>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <div className={styles.routeRecruitmentFooter}>
        <p><ShieldCheck size={17} />{model.caveat}</p>
        <CurrentAction compact model={model} onOpenAdvisor={onOpenAdvisor} />
      </div>
    </div>
  );
}

export function RoutePlannerView({
  profile,
  path,
  selectedCandidate,
  relatedCandidates,
  decisionSnapshot,
  initialMode = "timeline",
  onBack,
  onOpenAdvisor,
}: RoutePlannerViewProps) {
  const [mode, setMode] = useState<RoutePlannerMode>(initialMode);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const horizon = useMemo(() => {
    const graduation = new Date(profile.graduationYear, 5, 30);
    const minimum = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate());
    return graduation > minimum ? graduation : minimum;
  }, [profile.graduationYear, today]);
  const model = useMemo(() => {
    const base = buildRouteModel(
      path,
      selectedCandidate,
      relatedCandidates,
      today,
      horizon,
    );
    return {
      ...base,
      nextAction: decisionSnapshot.decision.nextAction,
      estimatedTime: decisionSnapshot.decision.estimatedTime,
    };
  }, [
    decisionSnapshot.decision.estimatedTime,
    decisionSnapshot.decision.nextAction,
    horizon,
    path,
    relatedCandidates,
    selectedCandidate,
    today,
  ]);

  return (
    <section className={styles.routePlanner} aria-labelledby="route-planner-title">
      <header className={styles.routePlannerHeader}>
        <div className={styles.routePlannerOrigin}>
          <button type="button" onClick={onBack} aria-label="返回修改求职方向">
            <ArrowLeft size={18} weight="bold" />
          </button>
          <div>
            <small>已选路线</small>
            <strong>{path.trackLabel} / {path.subtrackLabel}</strong>
            <span>{profile.graduationYear} 届 · {profile.major} · {profile.degreeLabel}</span>
          </div>
        </div>
        <div className={styles.routePlannerHeading}>
          <span><Lightning size={18} weight="duotone" />从今天开始</span>
          <h1 id="route-planner-title">
            {mode === "timeline"
              ? model.noun === "招录" ? "招录节点日历" : "招聘战役日历"
              : `从今天走到每一次${model.noun}窗口`}
          </h1>
          <p>
            {mode === "timeline"
              ? `把所有${model.lanesLabel}放进同一张时间表。`
              : `同一目标可以多次出现，但所有行动只进入一条总计划。`}
          </p>
        </div>
        <RouteModeSwitch mode={mode} onChange={setMode} />
      </header>

      <div className={styles.routePlannerNotice} role="note">
        <Info size={16} weight="fill" />
        <span>{model.caveat}</span>
        <strong>{model.hasLiveEvents ? "真实截止信息" : "结构示例"}</strong>
      </div>

      <DecisionSystemBrief snapshot={decisionSnapshot} />

      {mode === "timeline" ? (
        <TimelineVersion
          horizon={horizon}
          model={model}
          onOpenAdvisor={onOpenAdvisor}
          today={today}
        />
      ) : (
        <RecruitmentVersion
          model={model}
          onOpenAdvisor={onOpenAdvisor}
          selectedCandidate={selectedCandidate}
        />
      )}
    </section>
  );
}
