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
    detail: "合并共同能力节点，保留企业专属分支，产生可检查任务。",
    state: "done",
    label: "已完成",
  },
  {
    id: "05",
    title: "官方证据决策接线",
    detail: "策略页已接入独立只读情报服务；无 A/B 级核验证据时统一降级为待核验。",
    state: "done",
    label: "已完成",
  },
  {
    id: "06",
    title: "本地质量基线",
    detail: "66 项单元测试、5 项页面渲染、类型检查与生产构建已通过。",
    state: "done",
    label: "已完成",
  },
  {
    id: "07",
    title: "扩充官方证据与真实知识库",
    detail: "职业情报已有 62 个核验岗位页、43 个去重证据快照；知识库保存 55 条文档，已分为 35 条可回答证据、20 条发现索引和 0 条残缺页；同图 OCR 已稳定复用，列表/残缺页、错误企业及航天科技/航天科工近名证据均在知识库出口阻断，校园/社会招聘顾问事实回归通过 11/11。",
    state: "active",
    label: "进行中",
  },
  {
    id: "08",
    title: "主站档案与已购权益",
    detail: "Agent 侧一次性码、PKCE、脱敏快照、加密会话、表单核对和权益优先触发已实现并通过本地闭环；主站授权端点仍待审批部署。",
    state: "active",
    label: "待主站联调",
  },
  {
    id: "09",
    title: "Mac mini 与正式公网版本",
    detail: "已有 tokensoff.com 影子部署历史记录；当前最新主 Beta 尚未做正式公网复验。",
    state: "todo",
    label: "待复验",
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
            <strong>扩充事实覆盖，并准备主站安全联调</strong>
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
              <span>2026-07-17</span>
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
              <h2>先把“待核验”变成有依据的路径</h2>
              <p>
                策略页已经能消费只读职业情报决策，真实 RAG 与扩展事实回归也已跑通。
                下一步优先扩大高频央企、热门岗位和回归样本；没有官方证据时继续明确拒答或显示未知。
              </p>
              <dl>
                <div>
                  <dt>主项目分支</dt>
                  <dd>codex/rapid-beta-mvp</dd>
                </div>
                <div>
                  <dt>公网地址</dt>
                  <dd>历史影子验证，当前未复验</dd>
                </div>
                <div>
                  <dt>职业情报</dt>
                  <dd>只读在线，62 个核验岗位页</dd>
                </div>
                <div>
                  <dt>真实知识库</dt>
                  <dd>55 条已保存；35 条可回答，20 条索引，0 条残缺</dd>
                </div>
                <div>
                  <dt>顾问事实回归</dt>
                  <dd>11 / 11，覆盖过期、硬门槛、来源隔离与证据恢复</dd>
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
