# 求职Agent 2026 视觉系统 Design QA

## 设计源

- 主参考：`/var/folders/m8/g4yt2g5s7gg43b0yp7jyqfg40000gn/T/codex-clipboard-ae3196db-babe-4bd8-97f0-066ef6752126.png`
- 辅助参考：`codex-clipboard-3153b581-95ad-4e55-985e-48e9d8ed4042.png`、`codex-clipboard-124ed3d1-3d84-4ea5-a50e-7ff3ce7026fb.png`
- 主参考尺寸：`1796 × 876`
- 视觉目标：蓝紫主色、白色章节卡、清晰编号、数据可视化、少量高质量 3D 素材；不改变原功能、数据和交互顺序。

## 实现证据

- 桌面报告：`docs/design-qa/ui-refresh-report-1440x1000.jpg`
- 手机报告：`docs/design-qa/ui-refresh-report-mobile-390x844.jpg`
- 对话页：`docs/design-qa/ui-refresh-chat-1440x1000.jpg`
- 方向选择：`docs/design-qa/ui-refresh-directions-1440x1000.jpg`
- 路线页：`docs/design-qa/ui-refresh-route-1440x1000.jpg`
- 同屏对比：`docs/design-qa/ui-refresh-comparison.png`
- 验收入口：`http://localhost:3012/v2`
- 桌面视口：`1440 × 1000`
- 手机视口：`390 × 844`

## 素材与代码边界

- 7 张独立视觉素材保存在 `public/visuals/report-2026/`，桌面原件保存在 `/Users/mr.zze/Desktop/求职Agent-UI素材/`。
- 长幅主视觉、学校资源、建议路径、档案、对话引导、时间线和招聘网络采用独立图片。
- 仪表盘、进度条、热力图、表格、标签、卡片、按钮、切换器和标准图标继续由代码与 Phosphor Icons 生成，保证数据变化和响应式布局可用。
- 未修改接口、规则、计算、数据库、岗位来源、导航结构或功能状态。

## 验收记录

1. 把主参考图与实现报告首屏放在同一张 `1440 × 1000` 对比图中检查。
2. 桌面端依次验证个人资料、报告四章、对话、三级方向、真实岗位、时间线版和招聘线版。
3. 手机端验证 390px 顶部导航、报告首屏、竞争力卡和对话空状态；没有页面级横向溢出。
4. 浏览器控制台在报告、对话、方向和双路线视图均无 error/warn。
5. `npm run typecheck`、`npm run lint`、`npm run build:vercel` 通过。
6. 报告与路线专项回归 `18/18` 通过；全量单测 `120/124`，4 个既有工作区存储测试仍以 `corrupt_state` / `503` 失败，涉及文件未被本轮修改。

## 结论

- P0：无。
- P1：无。
- P2：无新增问题。
- 可见差异：参考图使用示例曲线和图标；实现保留真实产品数据、真实状态和既有信息边界。

final result: passed

---

## 学校情况视觉深化（2026-07-23）

### 设计源与验收状态

- 设计源：`/var/folders/m8/g4yt2g5s7gg43b0yp7jyqfg40000gn/T/codex-clipboard-ae3196db-babe-4bd8-97f0-066ef6752126.png`
- 辅助源：`/var/folders/m8/g4yt2g5s7gg43b0yp7jyqfg40000gn/T/codex-clipboard-124ed3d1-3d84-4ea5-a50e-7ff3ce7026fb.png`
- 页面状态：个人求职市场报告 → 学校情况 → 学校求职资源已展开。
- 桌面视口：`1440 × 1000`。
- 手机视口：`390 × 844`。

### 实现证据

- 学校情况首屏：`docs/design-qa/school-refresh-final-desktop-1.png`
- 就业路径与雇主：`docs/design-qa/school-refresh-final-desktop-2.png`
- 校内资源与历史去向：`docs/design-qa/school-refresh-final-desktop-3.png`
- 手机就业路径：`docs/design-qa/school-refresh-final-mobile.png`
- 手机综合判断：`docs/design-qa/school-refresh-final-mobile-impact-3.png`
- 完整视觉对照：`docs/design-qa/school-refresh-comparison-overview-final.jpg`
- 重点区域对照：`docs/design-qa/school-refresh-comparison-focused-final.jpg`

### 视觉与内容调整

1. 以校招资源、三条就业路径、重点雇主、专业平台、毕业去向和综合判断六段替代旧版的长文本墙。
2. 新增 5 张独立视觉素材，分别服务雇主网络、就业路径、校招入口、专业资源和综合判断；未使用占位图、emoji 或 CSS 拼图。
3. 删除对求职判断帮助有限的旧届满意度和泛化评价；历史数据继续保留年份、口径和边界说明。
4. 标题改为可直接理解的产品语言，重要判断使用大标题和独立视觉中心，辅助说明保持次级层级。
5. 桌面端采用文字与素材分栏，手机端统一单列；未发现横向溢出、图片拉伸、卡片越界或低对比度正文。

### 对照结论

- 参考图的蓝紫视觉、白色章节卡、编号系统、低密度信息层级和 3D 素材语言已被延续。
- 实现保留真实产品内容和数据口径，没有复制参考图中的示例数字或虚构事实。
- P0：无。
- P1：无。
- P2：无新增问题。

final result: passed
