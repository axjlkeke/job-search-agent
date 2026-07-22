import type { Metadata } from "next";
import Link from "next/link";
import styles from "./progress.module.css";

export const metadata: Metadata = {
  title: {
    absolute: "开发进度｜求职Agent",
  },
  description: "求职Agent 快速上线版的开发进度、当前边界与验收状态。",
};

const milestones = [
  {
    id: "01",
    title: "项目边界与隔离工作区",
    detail: "求职Agent 功能分支与职达决策内核干净工作区已建立。",
    state: "done",
    label: "已完成",
  },
  {
    id: "02",
    title: "学生建档",
    detail: "完成学历、学校、专业、届别、地区、经历与投入约束。",
    state: "done",
    label: "已完成",
  },
  {
    id: "03",
    title: "真实岗位与目标选择",
    detail: "服务端只读获取职达在招岗位，并支持同时选择多个求职终点。",
    state: "done",
    label: "已完成",
  },
  {
    id: "04",
    title: "策略网络与 7 天行动",
    detail: "合并共同能力节点，保留企业专属分支，并明确总时间、每周容量、超载、能力工作量、未知现金费用与每项任务的计划耗时。",
    state: "done",
    label: "已完成",
  },
  {
    id: "05",
    title: "官方证据决策接线",
    detail: "策略页已接入独立只读情报服务；无 A/B 级核验证据时统一降级为待核验。本地待发布版还能区分官网实时核验、官网本次失败与历史证据快照。",
    state: "done",
    label: "已完成",
  },
  {
    id: "06",
    title: "本地质量基线",
    detail: "主项目 86 项单元测试、5 项页面渲染；主站全仓 429 项测试；职业情报 61 项规则/安全/发布测试、2 项页面渲染；本地 189 项知识库测试、类型检查与生产构建已通过。",
    state: "done",
    label: "已完成",
  },
  {
    id: "07",
    title: "扩充官方证据与真实知识库",
    detail: "职业情报已有 79 个核验岗位页、49 个去重证据快照；知识库保存 81 条文档，动态分为 61 条可回答证据、20 条发现索引和 0 条残缺页；国家电网、中国石油、中国石化、中国移动、中车长客、中国能建投资集团等高频企业官方公告已接入，Dify 73 个映射均完成对账且正文一致；1 条经人工核验的事实变化已安全批准，剩余 3 条失效入口告警继续保留；校园/社会招聘顾问真实回归通过 17/17。",
    state: "active",
    label: "进行中",
  },
  {
    id: "08",
    title: "主站档案与已购权益",
    detail: "双端一次性码、PKCE、脱敏快照、匿名工作区标识、加密会话、表单核对、权益优先触发和跨设备路径进度已通过本地闭环；主站授权端点与 Agent 状态目录仍待审批部署。",
    state: "active",
    label: "待主站联调",
  },
  {
    id: "09",
    title: "Mac mini 与正式公网版本",
    detail: "Stage O API 与包含匿名路径安全门禁的主前端包已锁成一个本地发布列车：顺序固定为 API 先走 18081/18080，主前端再走 3002/3000；两个内容哈希、批准变量和失败边界不可调换，尚未上传或执行。tokensoff.com 仍由 3001 影子前端提供，主 Beta 尚未切换公网。",
    state: "todo",
    label: "待切主 Beta",
  },
] as const;

export default function ProgressPage() {
  const completed = milestones.filter((item) => item.state === "done").length;
  const percent = Math.round((completed / milestones.length) * 100);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>求职Agent · 快速上线版</p>
            <h1>开发进度台</h1>
            <p className={styles.intro}>
              这里只展示已经发生的事。功能通过验证后才会从“进行中”进入“已完成”。
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryLink} href="/v2">
              打开产品预览
            </Link>
            <a className={styles.primaryLink} href="/progress">
              刷新状态
            </a>
          </div>
        </header>

        <section className={styles.summary} aria-label="总体进度">
          <div className={styles.metric}>
            <span>当前阶段</span>
            <strong>匿名路径发布列车已锁定，等待授权预演</strong>
          </div>
          <div className={styles.metric}>
            <span>已通过</span>
            <strong>
              {completed} / {milestones.length}
            </strong>
          </div>
          <div className={styles.metric}>
            <span>总体进度</span>
            <strong>{percent}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label={`已完成 ${percent}%`}>
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.roadmap} aria-labelledby="roadmap-title">
            <div className={styles.sectionHeading}>
              <div>
                <p>BUILD LOG</p>
                <h2 id="roadmap-title">上线路线</h2>
              </div>
              <span>2026-07-18</span>
            </div>

            <div className={styles.milestoneList}>
              {milestones.map((item) => (
                <article className={styles.milestone} data-state={item.state} key={item.id}>
                  <span className={styles.milestoneIndex}>{item.id}</span>
                  <div>
                    <div className={styles.milestoneTitle}>
                      <h3>{item.title}</h3>
                      <span>{item.label}</span>
                    </div>
                    <p>{item.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className={styles.sideColumn}>
            <section className={styles.nowPanel}>
              <p className={styles.panelLabel}>NOW BUILDING</p>
              <h2>先证明 API 和主前端都能回退，再允许上线</h2>
              <p>
                API 包锁定六个运行文件并准备在 18081 做真实只读烟测；主前端安全发布包
                只包含构建产物和依赖锁，准备在 3002 检查核心页面、岗位搜索和决策隐私。
                两个包现已锁入同一发布列车，顺序不能调换。当前均未上传或重启；
                获得授权后先预演，失败自动恢复旧版或停在向后兼容状态。
              </p>
              <dl>
                <div>
                  <dt>主项目分支</dt>
                  <dd>codex/rapid-beta-mvp</dd>
                </div>
                <div>
                  <dt>公网地址</dt>
                  <dd>3001 影子在线，主 Beta 未切换</dd>
                </div>
                <div>
                  <dt>职业情报</dt>
                  <dd>旧版只读在线；Stage M 发布包已生成、未上传</dd>
                </div>
                <div>
                  <dt>主 Beta 前端</dt>
                  <dd>运行产物发布包已生成；3002 候选预检、显式批准和自动回滚已就绪</dd>
                </div>
                <div>
                  <dt>发布列车</dt>
                  <dd>API → 前端顺序、双包哈希和批准变量已锁定；仅本地生成</dd>
                </div>
                <div>
                  <dt>真实知识库</dt>
                  <dd>81 条已保存；61 条可回答，20 条索引，0 条残缺</dd>
                </div>
                <div>
                  <dt>顾问事实回归</dt>
                  <dd>17 / 17，覆盖六家高频央企、多条件取证与来源隔离</dd>
                </div>
                <div>
                  <dt>登录与订单权益</dt>
                  <dd>Agent 侧闭环通过，主站端点待部署</dd>
                </div>
              </dl>
            </section>

            <section className={styles.guardrailPanel}>
              <p className={styles.panelLabel}>RELEASE GUARDRAILS</p>
              <h2>只有这些通过才算上线</h2>
              <ul>
                <li>硬性条件不符时明确阻断当前批次</li>
                <li>岗位事实显示来源和更新时间</li>
                <li>刷新后档案、目标与任务不丢失</li>
                <li>接入登录后，已购服务不再重复营销</li>
                <li>RAG 不可用时不编造结论</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
