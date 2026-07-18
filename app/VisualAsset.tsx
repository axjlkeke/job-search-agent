import {
  BookOpenText,
  Brain,
  BracketsCurly,
  Briefcase,
  Buildings,
  CalendarCheck,
  CheckSquare,
  ClipboardText,
  Crosshair,
  FileText,
  Gauge,
  GraduationCap,
  IdentificationCard,
  ListChecks,
  MapTrifold,
  SealCheck,
  ShieldCheck,
  Target,
  TreeStructure,
  Trophy,
  WarningDiamond,
  type Icon,
} from "@phosphor-icons/react";
import styles from "./career-strategy.module.css";

type VisualKind =
  | "image"
  | "avatar"
  | "logo"
  | "icon"
  | "graphic"
  | "chart"
  | "cover";

type VisualAssetProps = {
  label: string;
  className?: string;
  kind?: VisualKind;
};

type AssetKey =
  | "brand-route"
  | "path-summary"
  | "user-identity"
  | "empty-state"
  | "market-landscape"
  | "campus-scene"
  | "route-symbol"
  | "origin-identity"
  | "capability-step"
  | "destination-enterprise"
  | "route-node"
  | "truth-shield"
  | "risk-signal"
  | "action-list"
  | "profile-identity"
  | "metric-target"
  | "metric-progress"
  | "metric-risk"
  | "metric-time"
  | "next-action"
  | "target-network"
  | "company-mark"
  | "readiness-ring"
  | "system-graph"
  | "service-suite"
  | "profile-page"
  | "section-basics"
  | "section-target"
  | "section-capability"
  | "capability-resume"
  | "capability-project"
  | "capability-application"
  | "capability-interview"
  | "capability-internship"
  | "capability-competition"
  | "job-radar"
  | "target-merge"
  | "job-trend"
  | "eligibility-seal"
  | "strategy-network"
  | "strategy-targets"
  | "strategy-shared"
  | "strategy-actions"
  | "strategy-week"
  | "shared-trunk"
  | "product-cover"
  | "task-progress"
  | "day-plan"
  | "knowledge-graph"
  | "advisor-identity"
  | "context-identity"
  | "default-icon";

const SIMPLE_ASSET_ICONS: Partial<Record<AssetKey, Icon>> = {
  "truth-shield": ShieldCheck,
  "risk-signal": WarningDiamond,
  "action-list": ListChecks,
  "profile-page": IdentificationCard,
  "section-basics": GraduationCap,
  "section-target": MapTrifold,
  "section-capability": Gauge,
  "capability-resume": FileText,
  "capability-project": BracketsCurly,
  "capability-application": ClipboardText,
  "capability-interview": BookOpenText,
  "capability-internship": Briefcase,
  "capability-competition": Trophy,
  "job-radar": Crosshair,
  "eligibility-seal": SealCheck,
  "strategy-targets": Target,
  "strategy-shared": TreeStructure,
  "strategy-actions": CheckSquare,
  "strategy-week": CalendarCheck,
  "capability-step": Gauge,
  "destination-enterprise": Buildings,
  "advisor-identity": Brain,
  "default-icon": Target,
};

function resolveAsset(label: string): AssetKey {
  if (label.includes("求职Agent品牌")) return "brand-route";
  if (label.includes("当前求职路径缩略图")) return "path-summary";
  if (label === "学生头像位置") return "user-identity";
  if (label.includes("空状态插图")) return "empty-state";
  if (label.includes("首页页头横幅")) return "market-landscape";
  if (label.includes("学生或校园场景")) return "campus-scene";
  if (label.includes("路线图主视觉")) return "route-symbol";
  if (label.includes("学生起点头像")) return "origin-identity";
  if (label.includes("能力补齐步骤")) return "capability-step";
  if (label.includes("目标企业标识")) return "destination-enterprise";
  if (label.includes("求职路径节点")) return "route-node";
  if (label.includes("真实数据说明")) return "truth-shield";
  if (label.includes("风险说明")) return "risk-signal";
  if (label.includes("行动说明")) return "action-list";
  if (label.includes("学生头像或个人身份")) return "profile-identity";
  if (label.includes("目标岗位数据")) return "metric-target";
  if (label.includes("行动进度图表")) return "metric-progress";
  if (label.includes("风险分布")) return "metric-risk";
  if (label.includes("时间投入")) return "metric-time";
  if (label.includes("今日行动")) return "next-action";
  if (label.includes("多目标求职网络")) return "target-network";
  if (label.includes("策略准备度")) return "readiness-ring";
  if (label.includes("岗位、知识库与 AI")) return "system-graph";
  if (label.includes("卡点服务组合")) return "service-suite";
  if (label.includes("学生档案页")) return "profile-page";
  if (label.includes("基本条件模块")) return "section-basics";
  if (label.includes("目标与投入模块")) return "section-target";
  if (label.includes("能力起点模块")) return "section-capability";
  if (label.startsWith("简历")) return "capability-resume";
  if (label.startsWith("项目证据")) return "capability-project";
  if (label.startsWith("网申材料")) return "capability-application";
  if (label.startsWith("面试表达")) return "capability-interview";
  if (label.startsWith("实习经历")) return "capability-internship";
  if (label.startsWith("竞赛经历")) return "capability-competition";
  if (label.includes("岗位雷达")) return "job-radar";
  if (label.includes("多个目标岗位汇聚")) return "target-merge";
  if (label.includes("岗位数量趋势")) return "job-trend";
  if (label.includes("岗位资格状态")) return "eligibility-seal";
  if (label.includes("策略网络主视觉")) return "strategy-network";
  if (label.includes("目标岗位数量")) return "strategy-targets";
  if (label.includes("共同任务数量")) return "strategy-shared";
  if (label.includes("全部行动数量")) return "strategy-actions";
  if (label.includes("每周节奏")) return "strategy-week";
  if (label.includes("共同能力主干")) return "shared-trunk";
  if (label.includes("产品封面") || label.includes("服务缩略图")) return "product-cover";
  if (label.includes("七日行动完成度")) return "task-progress";
  if (label.includes("行动主题图形")) return "day-plan";
  if (label.includes("知识库与 AI") || label.includes("知识库检索与依据")) return "knowledge-graph";
  if (label.includes("AI 顾问头像")) return "advisor-identity";
  if (label.includes("学生规划上下文")) return "context-identity";
  if (label.includes("企业 Logo")) return "company-mark";
  return "default-icon";
}

function subjectFromLabel(label: string): string {
  return label
    .replace(/企业 Logo.*$/u, "")
    .replace(/产品封面.*$/u, "")
    .replace(/服务缩略图.*$/u, "")
    .replace(/空状态插图.*$/u, "")
    .trim();
}

function compactMark(value: string): string {
  const cleaned = value
    .replace(/中国|集团|股份|有限|公司|控股|招聘|岗位|服务|指导|优化/gu, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
  const characters = Array.from(cleaned || value.replace(/\s+/gu, ""));
  return characters.slice(0, 2).join("").toUpperCase() || "职";
}

function accessibleLabel(label: string): string {
  if (label.includes("企业 Logo")) {
    return label.replace("企业 Logo", "企业识别标记，非官方 Logo");
  }
  return label;
}

function BrandRoute() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <path className={styles.assetRouteStroke} d="M12 45 C20 45 19 27 30 27 S40 14 52 14" />
      <circle cx="12" cy="45" r="4" />
      <circle cx="31" cy="27" r="4" />
      <rect x="47" y="9" width="11" height="11" rx="2" />
    </svg>
  );
}

function RouteGlyph({ compact = false }: { compact?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 64">
      <path className={styles.assetRouteStroke} d="M9 48 C30 48 29 31 48 31 S66 15 91 15" />
      <circle className={styles.assetNodePulse} cx="9" cy="48" r={compact ? 4 : 5} />
      <circle cx="49" cy="31" r={compact ? 3 : 4} />
      <circle cx="91" cy="15" r={compact ? 4 : 6} />
    </svg>
  );
}

function EditorialLandscape() {
  return (
    <svg aria-hidden="true" viewBox="0 0 760 480">
      <defs>
        <linearGradient id="hero-paper" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f7f7f4" />
          <stop offset="1" stopColor="#dededa" />
        </linearGradient>
        <pattern id="hero-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="#b8b8b3" strokeOpacity=".24" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="760" height="480" fill="url(#hero-paper)" />
      <rect width="760" height="480" fill="url(#hero-grid)" />
      <path d="M0 358 C138 322 226 382 346 342 C468 301 568 278 760 302 V480 H0 Z" fill="#c9c9c4" opacity=".5" />

      <g opacity=".72">
        <rect x="48" y="80" width="82" height="250" rx="6" fill="#d3d3cf" stroke="#777773" strokeWidth="2" />
        <rect x="143" y="40" width="118" height="290" rx="6" fill="#ecece8" stroke="#777773" strokeWidth="2" />
        <rect x="276" y="113" width="74" height="217" rx="6" fill="#d9d9d5" stroke="#777773" strokeWidth="2" />
        <path d="M72 115H106 M72 151H106 M72 187H106 M168 80H235 M168 121H235 M168 162H235 M168 203H235 M301 148H326 M301 184H326" fill="none" stroke="#8b8b87" strokeWidth="5" />
      </g>

      <g>
        <rect x="374" y="54" width="328" height="207" rx="18" fill="#fafaf8" stroke="#5f5f5c" strokeWidth="2.5" />
        <circle cx="406" cy="87" r="7" fill="#30302f" />
        <path d="M428 86H533" fill="none" stroke="#6f6f6c" strokeWidth="4" strokeLinecap="round" />
        <path d="M406 126 C472 126 474 181 540 181 S605 103 669 103" fill="none" stroke="#333332" strokeDasharray="9 12" strokeLinecap="round" strokeWidth="4" />
        <circle cx="406" cy="126" r="11" fill="#f8f8f5" stroke="#333332" strokeWidth="4" />
        <circle cx="541" cy="181" r="11" fill="#f8f8f5" stroke="#333332" strokeWidth="4" />
        <circle cx="669" cy="103" r="14" fill="#30302f" />
        <rect x="392" y="205" width="87" height="34" rx="8" fill="#e5e5e1" />
        <rect x="489" y="205" width="87" height="34" rx="8" fill="#e5e5e1" />
        <rect x="586" y="205" width="92" height="34" rx="8" fill="#30302f" />
      </g>

      <g>
        <ellipse cx="318" cy="439" rx="211" ry="19" fill="#858581" opacity=".18" />
        <rect x="111" y="350" width="418" height="24" rx="12" fill="#3c3c3a" />
        <rect x="147" y="370" width="18" height="95" rx="8" fill="#777773" />
        <rect x="472" y="370" width="18" height="95" rx="8" fill="#777773" />
        <circle cx="254" cy="278" r="38" fill="#2d2d2c" />
        <path d="M195 354 C199 302 218 283 255 283 C296 283 315 307 320 354 Z" fill="#555552" />
        <path d="M204 326 C176 337 165 347 151 359 M302 323 C333 330 348 341 369 359" fill="none" stroke="#3a3a38" strokeLinecap="round" strokeWidth="18" />
        <rect x="322" y="287" width="142" height="76" rx="8" fill="#f4f4f1" stroke="#4c4c49" strokeWidth="3" />
        <rect x="342" y="306" width="103" height="42" rx="4" fill="#dadad6" />
        <circle cx="394" cy="327" r="8" fill="#555552" />
      </g>

      <g>
        <rect x="531" y="287" width="171" height="137" rx="14" fill="#f8f8f5" stroke="#6a6a67" strokeWidth="2" />
        <rect x="552" y="309" width="65" height="9" rx="4.5" fill="#3b3b39" />
        <rect x="552" y="331" width="126" height="7" rx="3.5" fill="#b6b6b1" />
        <rect x="552" y="349" width="102" height="7" rx="3.5" fill="#c4c4bf" />
        <path d="M554 393 L583 374 L613 386 L643 358 L678 370" fill="none" stroke="#3d3d3b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        <circle cx="643" cy="358" r="7" fill="#2f2f2e" />
      </g>
    </svg>
  );
}

function CampusScene() {
  return (
    <svg aria-hidden="true" viewBox="0 0 150 92">
      <path className={styles.assetContour} d="M10 75 H140" />
      <path d="M23 70 V35 L50 22 L77 35 V70 Z" />
      <path d="M31 70 V42 H69 V70 M42 42 V70 M58 42 V70" />
      <rect x="88" y="22" width="45" height="51" rx="5" />
      <path d="M97 34 H124 M97 43 H118 M97 52 H124" />
      <circle className={styles.assetNodePulse} cx="110" cy="64" r="4" />
      <path className={styles.assetRouteStroke} d="M73 61 C85 61 83 54 96 54" />
    </svg>
  );
}

function PortraitGlyph({ context = false }: { context?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <circle className={styles.assetPortraitHalo} cx="32" cy="30" r="24" />
      <path d="M24 27 C24 20 28 16 34 16 C40 16 43 21 42 27 C41 34 38 37 33 37 C28 37 24 33 24 27 Z" />
      <path d="M16 53 C18 43 24 39 33 39 C42 39 48 44 50 53" />
      {context ? <path className={styles.assetAccentStroke} d="M14 13 H28 M14 18 H23" /> : null}
    </svg>
  );
}

function MiniChart({ variant }: { variant: AssetKey }) {
  if (variant === "metric-progress" || variant === "task-progress" || variant === "readiness-ring") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <circle className={styles.assetRingTrack} cx="32" cy="32" r="21" />
        <circle className={styles.assetRingValue} cx="32" cy="32" r="21" />
        <path d="M23 33 L29 39 L42 24" />
      </svg>
    );
  }

  if (variant === "metric-risk") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 48">
        <path d="M8 39 L22 16 L34 30 L45 10 L57 39 Z" />
        <circle className={styles.assetNodePulse} cx="45" cy="10" r="4" />
      </svg>
    );
  }

  if (variant === "metric-time" || variant === "strategy-week") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 48">
        <path d="M11 38 V26 M23 38 V17 M35 38 V23 M47 38 V9 M59 38 V20" />
        <path className={styles.assetContour} d="M8 38 H61" />
      </svg>
    );
  }

  if (variant === "metric-target" || variant === "strategy-targets") {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 48">
        <circle cx="19" cy="28" r="8" />
        <circle cx="43" cy="18" r="8" />
        <path className={styles.assetRouteStroke} d="M27 26 C33 25 34 22 35 21" />
        <circle className={styles.assetNodePulse} cx="43" cy="18" r="3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 64 48">
      <path className={styles.assetContour} d="M6 39 H59" />
      <path className={styles.assetTrendStroke} d="M8 34 L19 27 L29 31 L40 16 L49 20 L58 8" />
      <circle className={styles.assetNodePulse} cx="58" cy="8" r="3" />
    </svg>
  );
}

function NetworkGlyph({ dense = false }: { dense?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 72">
      <path className={styles.assetRouteStroke} d="M13 36 H43 M43 36 C56 36 55 14 70 14 H89 M43 36 C56 36 55 58 70 58 H89" />
      <circle cx="13" cy="36" r={dense ? 5 : 7} />
      <circle className={styles.assetNodePulse} cx="43" cy="36" r={dense ? 4 : 6} />
      <rect x="84" y="8" width="12" height="12" rx="3" />
      <rect x="84" y="52" width="12" height="12" rx="3" />
    </svg>
  );
}

function KnowledgeGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 78">
      <path className={styles.assetContour} d="M20 16 H55 V34 H88 V61" />
      <path className={styles.assetRouteStroke} d="M20 58 H48 V39 H74 V17 H101" />
      <rect x="10" y="8" width="22" height="18" rx="4" />
      <rect x="8" y="50" width="24" height="18" rx="4" />
      <circle className={styles.assetNodePulse} cx="60" cy="37" r="7" />
      <rect x="91" y="8" width="20" height="18" rx="4" />
      <rect x="79" y="52" width="24" height="18" rx="4" />
    </svg>
  );
}

function SuiteGlyph({ label }: { label: string }) {
  const mark = compactMark(subjectFromLabel(label));
  return (
    <span className={styles.assetSuite}>
      <span><FileText size={18} weight="duotone" /><i /></span>
      <span><Briefcase size={18} weight="duotone" /><i /></span>
      <strong>{mark}</strong>
    </span>
  );
}

function CompanyMark({ label }: { label: string }) {
  return (
    <span className={styles.assetMonogram} aria-hidden="true">
      <strong>{compactMark(subjectFromLabel(label))}</strong>
      <i />
    </span>
  );
}

function DayPlan({ label }: { label: string }) {
  const day = label.match(/第\s*(\d+)\s*天/u)?.[1] ?? "1";
  return (
    <span className={styles.assetDay} aria-hidden="true">
      <strong>{day.padStart(2, "0")}</strong>
      <i />
    </span>
  );
}

function IconGlyph({ asset }: { asset: AssetKey }) {
  const AssetIcon = SIMPLE_ASSET_ICONS[asset] ?? Target;
  return <AssetIcon aria-hidden="true" size="68%" weight="duotone" />;
}

function renderAsset(asset: AssetKey, label: string) {
  switch (asset) {
    case "brand-route":
      return <BrandRoute />;
    case "path-summary":
    case "route-symbol":
      return <RouteGlyph compact={asset === "path-summary"} />;
    case "market-landscape":
      return <EditorialLandscape />;
    case "campus-scene":
      return <CampusScene />;
    case "user-identity":
    case "profile-identity":
    case "origin-identity":
      return <PortraitGlyph />;
    case "context-identity":
      return <PortraitGlyph context />;
    case "route-node":
      return (
        <svg aria-hidden="true" viewBox="0 0 64 64">
          <circle className={styles.assetOrbit} cx="32" cy="32" r="22" />
          <circle className={styles.assetNodePulse} cx="32" cy="32" r="7" />
          <circle cx="49" cy="18" r="4" />
        </svg>
      );
    case "metric-target":
    case "metric-progress":
    case "metric-risk":
    case "metric-time":
    case "readiness-ring":
    case "job-trend":
    case "strategy-targets":
    case "strategy-week":
    case "task-progress":
      return <MiniChart variant={asset} />;
    case "next-action":
      return (
        <svg aria-hidden="true" viewBox="0 0 70 54">
          <circle className={styles.assetOrbit} cx="35" cy="27" r="20" />
          <path d="M35 11 V43 M19 27 H51" />
          <circle className={styles.assetNodePulse} cx="35" cy="27" r="6" />
        </svg>
      );
    case "target-network":
    case "target-merge":
    case "strategy-network":
    case "shared-trunk":
      return <NetworkGlyph dense={asset === "target-network" || asset === "target-merge"} />;
    case "system-graph":
    case "knowledge-graph":
      return <KnowledgeGlyph />;
    case "service-suite":
    case "product-cover":
      return <SuiteGlyph label={label} />;
    case "company-mark":
      return <CompanyMark label={label} />;
    case "day-plan":
      return <DayPlan label={label} />;
    case "strategy-shared":
    case "strategy-actions":
      return <IconGlyph asset={asset} />;
    case "empty-state":
      return (
        <svg aria-hidden="true" viewBox="0 0 100 68">
          <rect x="14" y="14" width="52" height="40" rx="7" />
          <path className={styles.assetRouteStroke} d="M25 44 C38 44 37 32 49 32 S63 20 82 20" />
          <circle className={styles.assetNodePulse} cx="82" cy="20" r="5" />
        </svg>
      );
    default:
      return <IconGlyph asset={asset} />;
  }
}

export function VisualAsset({
  label,
  className = "",
  kind = "image",
}: VisualAssetProps) {
  const asset = resolveAsset(label);
  return (
    <span
      aria-label={accessibleLabel(label)}
      className={`${styles.imageInsertMarker} ${styles.visualAsset} ${className}`.trim()}
      data-visual-asset={asset}
      data-visual-kind={kind}
      role="img"
      title={accessibleLabel(label)}
    >
      {renderAsset(asset, label)}
    </span>
  );
}
