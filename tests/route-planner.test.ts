import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePlannerSource = readFileSync(
  new URL("../app/RoutePlannerView.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../app/AgentWorkspace.tsx", import.meta.url),
  "utf8",
);
const strategyStyles = readFileSync(
  new URL("../app/career-strategy.module.css", import.meta.url),
  "utf8",
);

test("route planner preserves both requested views behind one switch", () => {
  assert.match(routePlannerSource, /时间线版/);
  assert.match(routePlannerSource, /招聘线版/);
  assert.match(routePlannerSource, /mode === "timeline"/);
  assert.match(routePlannerSource, /mode === "recruitment"/);
});

test("route planner models non-enterprise tracks instead of forcing company language", () => {
  assert.match(routePlannerSource, /"civil-service"/);
  assert.match(routePlannerSource, /行测/);
  assert.match(routePlannerSource, /申论/);
  assert.match(routePlannerSource, /体检政审/);
  assert.match(routePlannerSource, /"public-institution"/);
  assert.match(routePlannerSource, /职测/);
  assert.match(routePlannerSource, /综应/);
});

test("unverified routes stay visibly provisional", () => {
  assert.match(routePlannerSource, /结构示例/);
  assert.match(routePlannerSource, /待核验/);
  assert.match(routePlannerSource, /当前只使用岗位已提供的截止时间/);
  assert.match(routePlannerSource, /当前不构成真实招录窗口/);
});

test("data, route and decision remain one explicit system context", () => {
  assert.match(routePlannerSource, /DecisionSystemBrief/);
  assert.match(routePlannerSource, /01 · 数据/);
  assert.match(routePlannerSource, /02 · 路线/);
  assert.match(routePlannerSource, /03 · 决策/);
  assert.match(workspaceSource, /decisionSnapshot\?\.advisorContext/);
  assert.match(workspaceSource, /"route-action"/);
});

test("direction selection enters the route planner before chat", () => {
  assert.match(workspaceSource, /"roadmap"/);
  assert.match(workspaceSource, /确认岗位，生成规划路线/);
  assert.match(workspaceSource, /onPreviewRoute/);
  assert.match(workspaceSource, /setActiveView\("roadmap"\)/);
  assert.match(workspaceSource, /marketCandidateToLiveJob/);
  assert.match(workspaceSource, /setSelectedJobs/);
});

test("direction and route views reuse the last successful report snapshot", () => {
  const reportLifecycle = workspaceSource.slice(
    workspaceSource.indexOf("const loadMarketReport = useCallback"),
    workspaceSource.indexOf("const loadJobs = useCallback"),
  );
  assert.match(reportLifecycle, /\|\| marketReport/u);
  assert.match(
    reportLifecycle,
    /\[activeView, loadMarketReport, marketReport, profile, studio\]/u,
  );
  assert.doesNotMatch(reportLifecycle, /setMarketReport\(null\)/u);
});

test("focused chat surfaces only target-triggered services with owned access first", () => {
  assert.match(workspaceSource, /focusedTriggers/);
  assert.match(workspaceSource, /当前卡点可用帮助/);
  assert.match(workspaceSource, /owned_available/);
  assert.match(workspaceSource, /直接使用/);
  assert.match(workspaceSource, /了解服务/);
  assert.match(strategyStyles, /focusedAdvisorTriggers/);
});

test("route planner includes image-led desktop hierarchy and responsive fallbacks", () => {
  assert.match(strategyStyles, /routeModeSwitch/);
  assert.match(strategyStyles, /routeCalendarPhoto/);
  assert.match(strategyStyles, /routeChapter/);
  assert.match(strategyStyles, /@media \(max-width: 720px\)/);
  assert.match(strategyStyles, /prefers-reduced-motion/);
});
