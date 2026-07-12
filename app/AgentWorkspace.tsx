"use client";

import { useMemo, useState, type FormEvent } from "react";

type ViewId = "chat" | "plan" | "jobs" | "resume" | "interview";

type Message = {
  id: number;
  role: "assistant" | "user";
  content: string;
};

const NAV_ITEMS: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: "chat", label: "AI 规划师", mark: "AI" },
  { id: "plan", label: "行动计划", mark: "计" },
  { id: "jobs", label: "岗位雷达", mark: "岗" },
  { id: "resume", label: "简历中心", mark: "历" },
  { id: "interview", label: "面试训练", mark: "练" },
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "我已经按你的目标做了第一轮拆解：国家电网和中石油可以共用一条“计算机岗基础准备线”，但招聘批次、专业范围和项目表达要分别准备。你目前最值得先补的是目标单位清单与简历项目证据。",
  },
];

const PLAN_TASKS = [
  {
    id: "market",
    phase: "第 1—2 周",
    title: "完成目标单位地图",
    detail: "筛出 12 家匹配单位，标记批次、地区与专业限制",
  },
  {
    id: "project",
    phase: "第 3—4 周",
    title: "重写两段项目经历",
    detail: "把技术描述改成任务、行动、结果与岗位能力证据",
  },
  {
    id: "resume",
    phase: "第 2 个月",
    title: "完成双版本简历",
    detail: "国家电网版强调稳定交付，中石油版强调场景适配",
  },
  {
    id: "interview",
    phase: "第 3 个月",
    title: "完成 3 次模拟面试",
    detail: "覆盖半结构化、专业追问和央企价值观表达",
  },
];

const JOBS = [
  {
    id: "sgcc",
    company: "国家电网 · 数字化单位",
    role: "信息通信技术岗",
    location: "北京 / 多地",
    match: 86,
    tags: ["计算机类", "校招", "第一批"],
    note: "专业匹配度高，建议优先补电力数字化场景认知。",
  },
  {
    id: "cnpc",
    company: "中国石油 · 集团直属单位",
    role: "软件开发与数据应用",
    location: "北京",
    match: 79,
    tags: ["计算机类", "项目制", "统招"],
    note: "岗位契合，但需要加强大型系统或数据项目的结果表达。",
  },
  {
    id: "cmcc",
    company: "中国移动 · 专业公司",
    role: "平台研发工程师",
    location: "北京 / 上海",
    match: 75,
    tags: ["研发", "央企", "提前批"],
    note: "技术能力匹配，竞争较高，建议补一段高并发项目证据。",
  },
];

function Sidebar({
  activeView,
  onChange,
}: {
  activeView: ViewId;
  onChange: (view: ViewId) => void;
}) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onChange("chat")} aria-label="回到 AI 规划师">
        <span className="brand-mark" aria-hidden="true">
          职
        </span>
        <span>
          <strong>求职Agent</strong>
          <small>央国企求职规划助手</small>
        </span>
      </button>

      <div className="prototype-pill">
        <span aria-hidden="true" />
        原型模式 · API 待接入
      </div>

      <nav className="side-nav" aria-label="主要功能">
        <p className="nav-caption">求职工作台</p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? "nav-item is-active" : "nav-item"}
            onClick={() => onChange(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span className="nav-mark" aria-hidden="true">
              {item.mark}
            </span>
            <span>{item.label}</span>
            {item.id === "jobs" && <span className="nav-count">3</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <section className="mini-goal" aria-label="本周目标">
        <div className="mini-goal-top">
          <span>本周目标</span>
          <strong>2 / 5</strong>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: "40%" }} />
        </div>
        <p>再完成 1 项，就能解锁本周复盘。</p>
      </section>

      <button className="profile-card" type="button">
        <span className="avatar">林</span>
        <span>
          <strong>林同学</strong>
          <small>计算机科学与技术 · 2027届</small>
        </span>
        <span className="profile-more" aria-hidden="true">
          ···
        </span>
      </button>
    </aside>
  );
}

function MobileTopbar() {
  return (
    <header className="mobile-topbar">
      <div className="brand compact">
        <span className="brand-mark" aria-hidden="true">
          职
        </span>
        <span>
          <strong>求职Agent</strong>
          <small>央国企求职规划助手</small>
        </span>
      </div>
      <span className="avatar small">林</span>
    </header>
  );
}

function ChatView() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");

  const sendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    setMessages((current) => {
      const nextId = current.length + 1;
      const userMessage: Message = {
        id: nextId,
        role: "user",
        content: trimmed,
      };
      const assistantMessage: Message = {
        id: nextId + 1,
        role: "assistant",
        content: trimmed.includes("3个月")
          ? "可以。我会把 3 个月拆成“岗位校准—材料升级—实战训练”三段，并优先围绕国家电网、中石油的计算机类岗位安排。先确认一个关键点：你每周能稳定投入多少小时？"
          : "收到。当前是交互原型，我先把这个问题记入你的规划上下文。接入知识库与产品接口后，我会先检索依据，再给出可执行建议和对应服务入口。",
      };

      return [...current, userMessage, assistantMessage];
    });
    setInput("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="view-stack chat-view">
      <header className="page-heading chat-heading">
        <div>
          <p className="eyebrow">央国企求职规划 · 7月12日</p>
          <h1>晚上好，林同学。</h1>
          <p>今天我们把“想进央企”，继续变成一条看得见的路。</p>
        </div>
        <button className="quiet-button" type="button">
          <span className="button-dot" aria-hidden="true" />
          查看求职档案
        </button>
      </header>

      <section className="focus-strip">
        <div className="focus-index">01</div>
        <div>
          <span>当前主线</span>
          <strong>国家电网 / 中石油 · 计算机技术岗</strong>
        </div>
        <div className="focus-deadline">
          <span>距离秋招准备节点</span>
          <strong>47 天</strong>
        </div>
      </section>

      <section className="conversation" aria-label="与求职规划师的对话">
        <div className="conversation-head">
          <div>
            <span className="agent-avatar" aria-hidden="true">A</span>
            <div>
              <strong>央企求职规划师</strong>
              <small>会先查依据，再给建议</small>
            </div>
          </div>
          <span className="demo-label">演示数据</span>
        </div>

        <div className="message-list" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              {message.role === "assistant" && (
                <span className="message-avatar" aria-hidden="true">A</span>
              )}
              <div className="message-body">
                <p>{message.content}</p>
                {message.id === 1 && (
                  <>
                    <div className="evidence-card">
                      <div className="evidence-title">
                        <span>依据引用示例</span>
                        <small>2 条</small>
                      </div>
                      <button type="button">
                        <span>01</span>
                        国家电网高校毕业生招聘公告
                        <em>招聘政策</em>
                      </button>
                      <button type="button">
                        <span>02</span>
                        中石油高校毕业生招聘启事
                        <em>招聘信息</em>
                      </button>
                    </div>
                    <div className="answer-actions">
                      <button type="button">有帮助</button>
                      <button type="button">继续追问</button>
                    </div>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="suggestion-row" aria-label="推荐问题">
          {["帮我做一份3个月计划", "先看我的简历短板", "比较两个单位的准备差异"].map(
            (suggestion) => (
              <button key={suggestion} onClick={() => sendMessage(suggestion)} type="button">
                {suggestion}
              </button>
            ),
          )}
        </div>

        <form className="composer" onSubmit={submit}>
          <label htmlFor="chat-input" className="sr-only">输入你的求职问题</label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="问岗位、做规划，或告诉我你卡在哪里……"
            rows={2}
          />
          <div className="composer-foot">
            <div>
              <button type="button" aria-label="添加简历或岗位附件">＋</button>
              <span>可上传简历 / 岗位信息</span>
            </div>
            <button className="send-button" type="submit" disabled={!input.trim()}>
              发送 <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
        <p className="model-note">重要建议会展示依据；涉及招聘时点时，请以单位最新公告为准。</p>
      </section>
    </div>
  );
}

function PlanView() {
  const [done, setDone] = useState<Record<string, boolean>>({ market: true });
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="view-stack">
      <header className="page-heading section-heading">
        <div>
          <p className="eyebrow">行动计划</p>
          <h1>你的 90 天求职路线</h1>
          <p>每一步都对应一个可检查的结果，不用靠焦虑推动自己。</p>
        </div>
        <button className="primary-button" type="button">让 AI 调整计划</button>
      </header>

      <section className="plan-overview">
        <div>
          <span>总体进度</span>
          <strong>{completed} / {PLAN_TASKS.length}</strong>
        </div>
        <div className="progress-track large" aria-label={`计划已完成 ${completed} 项`}>
          <span style={{ width: `${(completed / PLAN_TASKS.length) * 100}%` }} />
        </div>
        <p>当前重点：完成目标单位地图，确认招聘批次与专业限制。</p>
      </section>

      <section className="timeline-card">
        {PLAN_TASKS.map((task, index) => (
          <article className={done[task.id] ? "timeline-item is-done" : "timeline-item"} key={task.id}>
            <button
              className="task-check"
              type="button"
              aria-label={done[task.id] ? `取消完成：${task.title}` : `标记完成：${task.title}`}
              onClick={() => setDone((current) => ({ ...current, [task.id]: !current[task.id] }))}
            >
              {done[task.id] ? "✓" : index + 1}
            </button>
            <div>
              <span>{task.phase}</span>
              <h2>{task.title}</h2>
              <p>{task.detail}</p>
            </div>
            <button className="text-button" type="button">查看任务</button>
          </article>
        ))}
      </section>
    </div>
  );
}

function JobsView() {
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  return (
    <div className="view-stack">
      <header className="page-heading section-heading">
        <div>
          <p className="eyebrow">岗位雷达 · 3 个新匹配</p>
          <h1>不只是“能投”，还要知道为什么适合</h1>
          <p>按你的专业、届别、地区和目标单位筛选的岗位示例。</p>
        </div>
        <button className="primary-button" type="button">调整匹配条件</button>
      </header>

      <div className="filter-bar">
        <button className="is-selected" type="button">全部岗位</button>
        <button type="button">高匹配</button>
        <button type="button">国家电网</button>
        <button type="button">在京岗位</button>
      </div>

      <section className="job-list">
        {JOBS.map((job) => (
          <article className="job-card" key={job.id}>
            <div className="company-mark" aria-hidden="true">{job.company.slice(0, 1)}</div>
            <div className="job-main">
              <p>{job.company}</p>
              <h2>{job.role}</h2>
              <div className="job-meta">
                <span>{job.location}</span>
                {job.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <p className="job-note">{job.note}</p>
            </div>
            <div className="match-column">
              <div className="match-score">
                <strong>{job.match}</strong>
                <span>% 匹配</span>
              </div>
              <button
                className={saved[job.id] ? "save-button is-saved" : "save-button"}
                type="button"
                onClick={() => setSaved((current) => ({ ...current, [job.id]: !current[job.id] }))}
              >
                {saved[job.id] ? "已加入计划" : "加入求职计划"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ResumeView() {
  const [showChecklist, setShowChecklist] = useState(false);

  return (
    <div className="view-stack">
      <header className="page-heading section-heading">
        <div>
          <p className="eyebrow">简历中心</p>
          <h1>让招聘方一眼看见你的岗位证据</h1>
          <p>当前为界面演示；接入简历服务后可完成解析、诊断与改写。</p>
        </div>
        <button className="primary-button" type="button">上传新版简历</button>
      </header>

      <section className="resume-grid">
        <article className="score-card">
          <p>央企计算机岗适配度</p>
          <div className="score-ring" aria-label="适配度 74 分">
            <strong>74</strong>
            <span>/ 100</span>
          </div>
          <p className="score-caption">基础合格，项目结果与岗位关键词仍有明显提升空间。</p>
          <button className="primary-button full" type="button" onClick={() => setShowChecklist(true)}>
            生成优化清单
          </button>
        </article>

        <article className="audit-card">
          <div className="card-title-row">
            <div>
              <span>诊断摘要</span>
              <h2>优先修改这 3 处</h2>
            </div>
            <span className="version-tag">简历 v2.3</span>
          </div>
          <ol className="audit-list">
            <li>
              <span>01</span>
              <div><strong>项目经历缺少结果证据</strong><p>“负责开发”较多，缺少规模、效率与业务结果。</p></div>
              <em>高优先级</em>
            </li>
            <li>
              <span>02</span>
              <div><strong>央企岗位关键词覆盖不足</strong><p>可补充信息安全、系统运维与协同交付场景。</p></div>
              <em>中优先级</em>
            </li>
            <li>
              <span>03</span>
              <div><strong>自我评价信息密度偏低</strong><p>建议换成岗位优势摘要，不重复通用性格描述。</p></div>
              <em>中优先级</em>
            </li>
          </ol>
          {showChecklist && (
            <div className="success-banner" role="status">
              优化清单已生成：先改项目经历，再生成国家电网与中石油两个版本。
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function InterviewView() {
  const [started, setStarted] = useState(false);

  return (
    <div className="view-stack interview-view">
      <header className="page-heading section-heading">
        <div>
          <p className="eyebrow">面试训练</p>
          <h1>把“临场发挥”，变成提前演练</h1>
          <p>围绕目标单位与简历内容，生成可追问、可复盘的模拟面试。</p>
        </div>
      </header>

      <section className="interview-panel">
        <div className="interview-copy">
          <span className="session-tag">推荐训练 · 约 15 分钟</span>
          <h2>国家电网计算机岗<br />半结构化模拟面试</h2>
          <p>包含 6 道核心题与 2 轮追问，重点训练项目表达、求职动机和场景判断。</p>
          <div className="interview-stats">
            <div><strong>8</strong><span>问题</span></div>
            <div><strong>2</strong><span>追问轮次</span></div>
            <div><strong>1</strong><span>复盘报告</span></div>
          </div>
          <button className="primary-button interview-start" type="button" onClick={() => setStarted(true)}>
            {started ? "训练已准备，开始回答" : "开始模拟面试"}
          </button>
        </div>
        <div className="question-preview">
          <div className="preview-top"><span>问题预览</span><em>01 / 08</em></div>
          <p>请用 2 分钟介绍一个你主导或深度参与的技术项目，并说明它与电网数字化岗位的关联。</p>
          <div className="thinking-guide">
            <span>回答提示</span>
            <ul>
              <li>先交代业务场景与个人职责</li>
              <li>用数字说明技术行动与结果</li>
              <li>最后连接到目标岗位能力</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function RightRail({ onOpenPlan }: { onOpenPlan: () => void }) {
  return (
    <aside className="right-rail">
      <header className="rail-header">
        <span>今日求职状态</span>
        <button type="button" aria-label="更多状态选项">···</button>
      </header>

      <section className="readiness-card">
        <div className="readiness-score">
          <div className="readiness-ring" role="img" aria-label="求职战备度 68%" />
          <div className="readiness-number"><strong>68</strong><span>%</span></div>
        </div>
        <div className="readiness-copy">
          <span>求职战备度</span>
          <strong>准备中段</strong>
          <p>补齐岗位清单和项目证据后，预计可提升至 76%。</p>
        </div>
      </section>

      <section className="rail-section profile-facts">
        <div className="rail-title"><span>你的目标</span><button type="button">编辑</button></div>
        <dl>
          <div><dt>届别</dt><dd>2027 届</dd></div>
          <div><dt>专业</dt><dd>计算机科学与技术</dd></div>
          <div><dt>意向</dt><dd>国家电网 · 中石油</dd></div>
          <div><dt>地区</dt><dd>北京优先 · 接受多地</dd></div>
        </dl>
      </section>

      <section className="rail-section next-actions">
        <div className="rail-title"><span>下一步行动</span><em>今天</em></div>
        <button type="button">
          <span className="action-check is-done">✓</span>
          <span><strong>确认目标单位方向</strong><small>已完成 · 10 分钟</small></span>
        </button>
        <button type="button">
          <span className="action-check">2</span>
          <span><strong>补充一段项目结果</strong><small>建议今天 · 20 分钟</small></span>
        </button>
        <button type="button">
          <span className="action-check">3</span>
          <span><strong>收藏 3 个目标岗位</strong><small>本周 · 15 分钟</small></span>
        </button>
        <button className="view-plan-button" type="button" onClick={onOpenPlan}>查看完整行动计划</button>
      </section>

      <footer className="rail-foot">以上内容为首版产品原型演示</footer>
    </aside>
  );
}

export function AgentWorkspace() {
  const [activeView, setActiveView] = useState<ViewId>("chat");

  const activeContent = useMemo(() => {
    switch (activeView) {
      case "plan":
        return <PlanView />;
      case "jobs":
        return <JobsView />;
      case "resume":
        return <ResumeView />;
      case "interview":
        return <InterviewView />;
      default:
        return <ChatView />;
    }
  }, [activeView]);

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <MobileTopbar />
      <main className="main-stage">{activeContent}</main>
      <RightRail onOpenPlan={() => setActiveView("plan")} />
      <nav className="mobile-nav" aria-label="移动端主要功能">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeView === item.id ? "is-active" : ""}
            onClick={() => setActiveView(item.id)}
          >
            <span aria-hidden="true">{item.mark}</span>
            {item.label.replace("AI ", "")}
          </button>
        ))}
      </nav>
    </div>
  );
}
