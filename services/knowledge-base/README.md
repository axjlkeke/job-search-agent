# 求职 Agent 知识库服务

这是一个可单独运行的轻量知识库适配层，适合先部署在 16 GB Apple Silicon Mac mini 上：

- SQLite WAL 保存来源、当前文档、不可变版本、同步记录和人工审核队列。
- SQLite FTS5 对已经抓取到的真实正文做本地检索，中文环境优先使用 `trigram` tokenizer。
- 配置 Dify Dataset API 后，`POST /search` 优先代理 Dify 的混合检索；Dify 不可达或没有结果时回退本地 FTS5。
- 配置 Dify Dataset API 后，正文首次变化会调用 `create-by-text`，后续变化按映射调用 `update-by-text`，不会每次重复创建远端文档。
- 当前页面会被确定性分为 `evidence`（可回答证据）、`discovery_index`（只用于发现详情页的栏目索引）和 `content_stub`（缺少实质正文的残缺页）。非证据页仍可保存和版本化；新同步不会把它写入本地 FTS 或发送 Dify，既有历史 FTS/Dify 索引即使暂时保留也会被运行时门禁拦截，不能作为回答引用。
- Dify 是可重建索引，不是独立事实源。检索片段必须能映射回本地当前文档，且本地文档可回答、映射状态为 `synced`、映射 hash 与当前正文一致；孤立、排队中、过期或被审核阻断的 Dify 片段一律丢弃。
- 请求明确传入 `target.companies` 时，Dify 和 SQLite 结果还必须命中该企业或受控简称；支持常见“中国/中”简称。长度不足 8 个字符的企业核心只允许精确或受控简称匹配，较长名称才使用接近完整的二元片段覆盖做有限 OCR 容错，避免“航天科技/航天科工”等短近名企业串线；“中国石油/中石油”与“中国石化/中石化”使用受控实体规则双向隔离，不能因“中国石油化工”包含“中国石油”字面前缀而串线。企业目标优先于岗位名；明确企业无匹配证据时返回空结果，不用相似岗位绕过。
- Dify 首条命中的官方片段保留最多 700 字，为其他明确问题维度留出稳定预算。服务逐项检查招聘对象、学历、年龄、毕业时间、外语等级、专业、地点、岗位类型、投递入口、招聘批次、单位志愿、笔试时间、福利、流程等维度；英语四级和六级分别检查，不能因为已有四级片段就把六级当成已覆盖。缺失维度从映射到的本地当前不可变正文按稀有关键词和独立窗口补充，最多保留 6 个分面窗口，最终引用片段总长不超过 2500 字。页面版权或页脚之后若存在已核验补充窗口，清洗层会保留补充证据而不是在首个“版权所有”处整体截断；SQLite 回退使用同样规则。
- 同一 URL、同一正文 hash 不重复建版本；正文变化才新增版本，历史不会被覆盖。
- 同一公告的截止日期与具体时刻、招聘对象、最低学历、专业要求、明确标注的工作地点、招聘人数、官方投递入口、分人群年龄上限、分学历工作年限、英语四/六级与分数、毕业届别、境内外毕业/认证日期、笔试/初选/测评/面试日期、投递次数或撤回/延期/更正状态发生高置信变化时，新版本先进入隔离审核，不会立即替换当前版本、进入 FTS 或推送 Dify。报名区间允许从明确起始年安全继承同年终点，但跨年方向不明确时保留未知年份；地点只从“工作地点/工作城市/岗位所在地”等明确字段提取，不从企业介绍猜测；人数只接受明确招聘人数/名额字段或本次、计划、拟、公开招聘总量，不吸收报名人数、资格复审人数、开考比例、岗位数量或人月；投递入口只接受报名/网申/投递标签或紧邻登录动作的网址、邮箱，不吸收普通公司官网、公告来源、客服邮箱或待公布入口。
- 官网用新 URL 发布更正、撤回或延期通知时，新公告会进入独立的跨公告审核；显式原文链接、标题核心、招聘年份和相似度用于提出候选旧公告，但不会自动批准替代关系。
- 新公告精确链接到另一已登记官方来源的旧公告时，只有新旧两端都是 `official + A/B` 才允许跨来源提出候选；第三方转载、C 级来源或非精确外链不会建立关系。
- 跨公告审核期间，新公告不进入检索；高置信候选旧公告也会同时从 FTS 与 Dify 结果中屏蔽。批准后只有“明确整批终止”的旧公告会标记为 `superseded`；延期、补充、暂停和部分岗位取消会让新通知生效、旧公告进入待对账隔离，避免把仍有效岗位整体删除。
- 短摘要升级为完整 OCR 正文视为技术补全，不会仅因新增事实而误判成官网改版；正文大幅退化或低质量 OCR 会被隔离。
- 抓取或解析失败会进入 `review_queue`，而不是悄悄生成内容。
- 来源可以限定 `allowed_hosts`、`include_paths` 和 `exclude_paths`；跳转后的最终 URL 与跟随链接都会再次核验范围。
- 可以受限同步全部已启用来源，并用覆盖率报告区分“已登记、已启用、有正文、从未同步、陈旧、待审核”。
- Dify 文档创建/更新后的异步批次会单独对账；只有批次返回同一文档且状态为 `completed` 才标成 `synced`。
- 对主要正文位于招聘长图中的已审核页面，macOS 优先使用 Apple Vision 高精度中文 OCR，其他系统或 Vision 失败时回退 Tesseract；超长海报会分片识别。
- OCR 清洗正文用于检索，原始输出、图片 hash、引擎配置和质量分数单独写入 `ocr_artifacts` 审计表；低于质量门槛的正文不发送 Dify，并进入审核队列。
- 当前版本中已审计的 OCR 结果会按图片 hash 和引擎配置复用；同一图片重复同步不会再次运行非确定性 OCR 或制造假版本，图片内容或引擎配置变化时才重新识别。
- Bearer 鉴权可选，且不会把 Dify 密钥返回给前端。

这里的“来源已登记”和“资料已抓取”是两种状态。`examples/sources.json` 仅包含 4 个待审核的官方入口，默认全部 `enabled=false`，不代表已经抓完整站点，更不代表岗位覆盖率。

## 快速启动

```bash
cd services/knowledge-base
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
set -a && source .env && set +a
python -m app.cli init
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

健康检查不要求鉴权：

```bash
curl http://127.0.0.1:8001/health
```

将前端服务端环境变量指向：

```dotenv
RAG_API_URL=http://127.0.0.1:8001/search
RAG_API_KEY=<与 KB_API_KEY 相同；不启用鉴权时都留空>
```

## 搜索接口

```http
POST /search
Content-Type: application/json
Authorization: Bearer <KB_API_KEY>  # 仅配置 KB_API_KEY 后需要

{
  "query": "计算机专业想进国家电网，应该重点准备什么？",
  "topK": 6,
  "profile": {
    "degreeLevel": "本科",
    "major": "计算机科学与技术",
    "graduationYear": 2027
  },
  "target": {
    "companies": ["国家电网"],
    "jobTitles": ["信息技术"]
  },
  "filters": {
    "validAt": "2026-07-13",
    "status": "recruiting"
  }
}
```

返回值与现有前端 RAG 契约兼容：

```json
{
  "results": [
    {
      "id": "document-or-segment-id",
      "title": "官方招聘公告",
      "snippet": "只来自已索引原文的相关片段",
      "url": "https://official.example/notice/1",
      "publishedAt": "2026-07-01",
      "score": 0.91
    }
  ],
  "engine": "sqlite_fts5",
  "fallbackUsed": false
}
```

`filters` 已兼容 `validAt`、`validFrom`、`validUntil`、`status`、`sourceId/sourceIds`，也接受其他元数据字段。资料尚未结构化出某个日期字段时不会被错误丢弃；上层回答仍应明确提示“有效性待核验”。`results[]` 只返回 `documentRole=evidence` 的当前正文，发现索引和残缺页不会作为证据出现。

## 来源登记与单源同步

先导入默认关闭的官方入口：

```bash
python -m app.cli source import examples/sources.json
python -m app.cli source list
```

运营人员核对抓取范围、频率、站点条款和页面类型后，再逐个启用并同步：

```bash
python -m app.cli source enable "国务院国资委人事招聘"
python -m app.cli sync "国务院国资委人事招聘"
```

经过审核的来源可单独导入：

```bash
python -m app.cli source import examples/verified-sources.json
python -m app.cli source import examples/verified-high-frequency-enterprises.json
```

当前包中的国资委来源使用 HTTP 并标记为 B 级：2026-07-17 的 Mac mini 网络验证中该站 HTTPS 连接异常而 HTTP 可达。正文仍按 hash 版本化并进入审核流程，不能因为发布机构是官方就把传输条件忽略后升为 A 级。

`verified-high-frequency-enterprises.json` 固定登记国家电网 2026 第三批、中国石油 2026 春招和中国石化 2026 校招三份经过人工复核的静态官方页面。招聘门户本身受 WAF、单页应用或批次结束影响，暂不作为自动正文入口；这三份公告用于核验历史规则和招聘流程，不能据此声称当前仍在报名。中国石油页面包含图片正文，Mac mini 当前由 Tesseract 留存原始 OCR 审计后进入证据链。

也可以登记一个新来源：

```bash
python -m app.cli source add \
  --name "某央企官方招聘栏目" \
  --url "https://official.example/recruitment/" \
  --authority official \
  --grade A \
  --tag 央企 \
  --follow-links \
  --max-documents 50
```

同步器支持公开 HTML、可提取文本的 PDF 和纯文本。它只跟随同域链接，并拒绝内网、回环和保留地址。栏目索引会标记为 `discovery_index` 并保留用于继续发现详情页，但不进入回答；只有标题或 OCR 失败的残缺页标记为 `content_stub` 并进入 `content_quality` 审核，补齐实质正文后会自动恢复为 `evidence`、关闭审核并进入索引。JavaScript 单页站、验证码、扫描 PDF、反爬阻断或其他抓取失败会进入审核队列；系统不会把失败页面当成成功资料。

批量同步只处理已启用来源，单次最多 50 个来源；一个来源失败不会阻止后续来源，最终会明确返回成功、部分成功、失败和无变化数量：

```bash
python -m app.cli sync --all --limit-sources 20
python -m app.cli dify-reconcile --limit 200
python -m app.cli coverage --stale-after-days 14
```

`dify-reconcile` 对处理中状态保持 `queued`；Dify 返回 `error`/`paused`、未知状态、文档不匹配或正文 hash 已变化时进入审核，不会升级成成功。已经恢复的 Dify 失败审核项会自动标记为已解决。

栏目链接采用两级受限队列：普通正文和 PDF 优先，`index_*.html` 分页只在当前正文队列清空后渐进处理；从一个分页发现的正文会先于下一个分页进入抓取，因此固定页数预算不会被栏目索引耗尽。当前解析器明确不支持的 Office、压缩包、图片和音视频锚点不会进入网页抓取队列，既有同 URL `sync_failure` 会在再次发现这些附件时自动关闭；附件内容若要作为证据，必须后续增加相应解析器和独立测试，不能把跳过写成“附件已经入库”。

Dify 批次进入终态错误后，可定向重提当前安全正文，不必扩大来源抓取范围：

```bash
python -m app.cli dify-retry --limit 100
python -m app.cli dify-reconcile --limit 200
```

`dify-retry` 只处理 `error` 映射，并再次检查来源启用、文档 `active`、证据可用性、事实审核、OCR 质量和跨公告阻断；任何一项不满足都会显示 `blocked` 而不会重提。重试成功只代表获得新的异步批次，映射仍是 `queued`；必须由后续 `dify-reconcile` 确认 Dify 返回 `completed` 才能成为回答证据。

关键事实变化会保留为不可变候选版本，并从本地与 Dify 检索结果中屏蔽整份文档，直到运营人员核对官网原文：

```bash
python -m app.cli fact-review list
python -m app.cli fact-review approve <document-id>
# 或确认是 OCR 退化、抓取污染时：
python -m app.cli fact-review reject <document-id>
```

`approve` 会原子切换当前版本并重建本地 FTS，随后必须重新同步该来源并执行 `dify-reconcile`；`reject` 保留原当前版本，并记住被驳回的正文 hash，后续同步不会反复创建同一审核项。审核前不要直接改 SQLite 指针。

新 URL 的更正、撤回或延期使用单独的关系审核：

```bash
python -m app.cli cross-review list

# 只有一个高置信候选旧公告时：
python -m app.cli cross-review approve <review-id>

# 无法唯一定位时，人工核对 URL 后显式指定：
python -m app.cli cross-review approve <review-id> \
  --target-document-id <old-document-id>

# 确认两份公告互不替代时：
python -m app.cli cross-review reject <review-id>

# 查看已批准但仍需合并核验的公告：
python -m app.cli cross-review reconciliation-list

# 原公告已更新为完整现行版本后，解除隔离：
python -m app.cli cross-review reconcile <review-id> \
  --replacement-document-id <updated-original-document-id>

# 也可以指定另一篇已经包含完整现行范围的官方公告：
python -m app.cli cross-review reconcile <review-id> \
  --replacement-document-id <complete-replacement-document-id>
```

`approve` 会先读取 `changeScope`、`resumeCompleteness` 和 `resolutionMode`。只有 `withdrawn + whole`，或同时包含岗位/人数、招聘条件、报名信息、考试流程中至少三类完整结构且正文达到安全长度的 `resumed + complete`，才把旧公告设为 `superseded`。一句“恢复报名、后续另行通知”只能得到 `status_only`，即使调用方错误请求 `supersede`，数据库也会强制降为 `reconcile`。完整恢复公告接管暂停公告时，会同时关闭此前“原公告 → 暂停公告”的待对账链，把原公告和暂停公告都指向新的完整恢复公告，防止旧路径永久停留在暂停状态。其他变更会把旧公告设为 `review_pending`，创建 `cross_document_reconciliation` 运维项，同时让经过审核的新通知进入检索。对账时若重新启用原公告，其正文 hash 必须已经变化；否则命令会拒绝解除隔离。也可由人工指定另一篇 `active` 的 A/B 级官方完整公告作为替代。`reject` 会把新公告作为独立资料启用，旧公告保持不变。每次批准或完成对账后都要运行 `dify-reconcile`。若没有唯一候选，省略 `--target-document-id` 会明确失败。

`examples/cross-document-change-cases.json` 固定保存九条公开官方变更公告，覆盖七组招聘关系链：中国广电 2026 年高校毕业生招聘同域延期、国家统计局页面精确链接人社部原公告的跨域补充、江汽集团整批招聘终止、建宁县单岗位取消、最高人民法院第五巡回法庭 2020 年同一招聘的暂缓与完整恢复、大冶市同一人才引进的两次部分岗位取消/核减，以及淮安市市属国企延长报名同时取消岗位并转移名额。最高法样本明确证明恢复公告可能改变招聘人数、报名期限并要求重新提交材料，不能只做状态翻转；淮安样本证明同一补充公告可以同时包含延期和岗位调整。文件只保留关系和作用范围判定所需片段与原始 URL，实际审核仍须打开两端官网核验全文。

Mac 透明代理使用 `198.18.0.0/15` fake-IP DNS 时，可显式设置 `KB_ALLOW_FAKE_IP_DNS=true`。这只对已经命中来源 `allowed_hosts` 的域名生效，直接 IP、回环、内网和其他保留地址仍会被拒绝。`KB_PROXY_URL` 只能指向本机 HTTP/HTTPS 代理；端口未监听时必须留空。

图片 OCR 默认关闭。Mac mini 的推荐配置：

```dotenv
KB_VISION_OCR_PATH=$HOME/.local/bin/tokensoff-vision-ocr
KB_TESSERACT_PATH=/opt/homebrew/bin/tesseract
KB_TESSDATA_DIR=$HOME/.local/share/tokensoff/tessdata
KB_OCR_TIMEOUT_SECONDS=90
KB_OCR_MAX_IMAGES=3
KB_OCR_TRIGGER_CHARS=200
```

`infra/macmini/prepare-kb-ocr.sh` 会在 macOS 上编译项目内的 `vision-ocr.swift`，并准备 Tesseract 兜底。私有 tessdata 目录至少需要固定版本 `tessdata_fast 4.1.0` 的 `chi_sim.traineddata` 和 Tesseract 自带的 `eng.traineddata`。同步器只下载当前来源白名单与路径范围内的图片；不用 shell 拼接参数，单图仍受 `MAX_FETCH_BYTES` 限制。OCR 是可追溯的文本提取方式，但不能直接成为学历、专业、届别等硬门槛的唯一依据。

管理 API 还提供：

- `GET /stats`：来源、保存文档、版本、同步、待审核，以及 `retrievableDocuments`、`discoveryDocuments`、`contentStubs` 三层数量。
- `GET /coverage?stale_after_days=14`：来源覆盖、保存文档覆盖、可回答证据/发现索引/残缺页、从未同步、陈旧和待审核报告。
- `GET /sources`：来源注册表。
- `POST /sources`：登记并启用一个来源。
- `POST /sources/{source_id}/sync`：同步一个已启用来源。

## 可选 Dify Dataset 检索

配置以下三项后启用：

```dotenv
DIFY_API_URL=http://127.0.0.1:8000/v1
DIFY_DATASET_ID=<dataset-id>
DIFY_DATASET_API_KEY=<dataset-api-key>
```

服务请求 `${DIFY_API_URL}/datasets/${DIFY_DATASET_ID}/retrieve`，将 Dify 的 `records[].segment` 归一化为前端需要的 `results[]`。每条远端记录都必须回查本地映射、本地当前正文、证据角色和 hash；无法映射或已过期的远端记录不会直接透传。多维问题先保留向量检索已经命中的官方片段，只从本地当前正文补充缺失维度，避免只命中公告开头时漏掉后半段的专业、地点或投递入口，也避免覆盖已通过事实回归的原片段。来源同步发现新的可回答正文 hash 时，会通过 `create-by-text` 或 `update-by-text` 同步同一份 Dify 文档；发现索引和残缺页不发送。远端失败不会回滚 SQLite，而是把同步标为 `partial` 并加入审核队列；人工确认后可再次处理。Dify Dataset 是可重建的检索索引，SQLite 中的来源、正文版本、同步记录、映射和审核队列才是本地事实记录。

## 数据表

| 表 | 用途 |
| --- | --- |
| `sources` | 官方入口、可信等级、标签、抓取范围与启用状态 |
| `documents` | 每个来源 URL 的当前状态和当前版本指针 |
| `versions` | 由内容 hash 去重的不可变正文版本 |
| `sync_runs` | 每次单源同步的成功、部分成功或失败结果 |
| `review_queue` | 解析失败、OCR、动态页面和关键事实变化等需人工处理的异常 |
| `cross_document_reviews` | 新 URL 更正/撤回/延期/取消公告的关系类型、作用范围、审批与待对账状态 |
| `cross_document_review_targets` | 候选旧公告、匹配分数、证据、临时屏蔽和最终选择 |
| `ocr_artifacts` | 每次 OCR 的图片 hash、原始输出、清洗正文、引擎配置和质量分数 |
| `dify_documents` | 本地文档与 Dify 文档的一对一映射、最后成功 hash 和同步状态 |
| `document_fts` | 可由当前版本重建的全文检索索引 |

## 测试

```bash
pytest -q
```

当前 189 项测试覆盖 hash 去重/版本变化、同图 OCR 审计复用、正文优先与分页渐进、已知不支持附件跳过及旧故障自动关闭、关键事实提取、同 URL 候选版本批准/驳回、报名区间省略终点年份、17:00/17时截止、同年安全继承与跨年未知保留、截止日期/时刻变化及新增/删除隔离、同句考试日期污染反例、高校/应届/未就业/留学回国/社会/系统内外等招聘对象提取及变化隔离、非招聘语境和 OCR 补全反误报、笔试/初选考试/测评/面试类型、完整日期/月日/日期区间、暂定与确定状态、考试安排变化/新增/删除隔离、英语等级考试与无日期流程反误报、混合学历列表最低可报层级、裸硕士研究生和应聘要求栏目识别、学历收紧隔离、博士/硕士/本科等分组年龄上限、上下限区间、严格小于语义、年龄新增/删除/变化与人群互换隔离、最低年龄和 OCR 补全反误报、分学历最低工作年限、中文/数字年限归一、通用工作经验表达、经验变化/新增/删除与人群互换隔离、项目周期/毕业年份/OCR 补全反误报、分学历英语四/六级与最低分、CET 中英文缩写归一、无分数等级要求、语言变化/新增/删除与人群互换隔离、培训介绍/OCR 补全反误报、境内外毕业取证截止、境外毕业区间与学历认证截止、毕业/认证日期变化/新增/删除隔离、普通报名截止和无日期毕业要求反误报、单行与分组专业清单提取、专业要求新增/删除/变化隔离、专业顺序与分隔符变化反误报、明确工作地点/工作城市/岗位所在地清单提取、地点新增/删除/变化隔离、行政区后缀/排序/分隔符归一、企业介绍和待定地点反误报、招聘人数/名额与计划/拟/公开招聘总量提取、中文/阿拉伯数字归一、人数新增/删除/变化隔离、报名/复审人数、岗位数、开考比例、人月和待定人数反误报、报名/网申/投递网址和邮箱提取、协议/域名大小写/www/尾斜杠/参数顺序/追踪参数归一、入口新增/删除/变化隔离、普通官网/公告来源/客服邮箱/待公布入口和远距登录动作反误报、跨 URL 公告匹配、整批终止/部分取消/未知范围分流、决定型/字段型/标题型已生效岗位取消或核减、未来可能取消/未来补充公告与明确暂不取消反例、暂缓与恢复表达、完整恢复公告接管、状态型恢复强制对账、暂停旧链自动闭环、待对账隔离与恢复、可信官方替代公告、同域与跨官方来源真实样本、跨来源 A/B 官方双端门禁、第三方外链拒绝、无法唯一定位时的人工指定、`superseded` 防复活、本地与 Dify 双重隔离、Dify 错误映射安全重提、CLI 审核/对账、中文本地检索、发现索引/残缺页/可回答证据分层、残缺正文恢复、孤立 Dify 记录拒绝、映射 hash 一致性、目标企业前置门禁、受控央企简称、中石油/中石化与其他近名企业双向隔离、批次/单位志愿/笔试时间/年龄/毕业时间/岗位类型/福利/流程/投递入口多分面补证、长企业介绍后的多条件预算分配、企业目标优先、无目标通用检索、Dify 结果归一化、异步索引对账与故障回退、Bearer 鉴权、来源范围、fake-IP 限定、受限批量同步、审核项去重、覆盖率报告、Vision 优先/Tesseract 回退、OCR 原始审计记录和低质量禁止入 Dify。

## 上线边界

- 只抓公开招聘资料；学生简历、档案和购买记录不要进入公共知识库。
- 来源必须由运营审核后逐个启用，抓取频率应遵守站点条款，必要时增加限速与定时任务。
- `fallbackUsed=true` 表示 Dify 没有给出可用结果，当前结果来自 SQLite 真实正文，不表示 Dify 健康。
- `documents` 只表示当前保存页面数，不等于可回答证据数；运营报表必须同时展示 `retrievableDocuments`、`discoveryDocuments` 和 `contentStubs`。
- `fact-review list` 非空时表示存在可能影响学生决策的公告版本变化；该文档在审核完成前不会被回答链路使用，不能通过关闭过滤或手工改索引绕过。
- `cross-review list` 非空时表示有新 URL 公告可能替代旧公告；必须核对两边官方 URL、标题、发布日期和正文，再批准或驳回。
- `cross-review reconciliation-list` 非空时表示变更关系已经批准，但完整现行岗位范围尚未完成对账；不得直接把旧公告改回 `active`，也不得把部分取消解释成整批招聘结束。
- 生产环境必须设置强随机 `KB_API_KEY`，并让外网只访问前端；知识库和 Dify 应通过本机或受控内网连接。
- 在把回答用于投递决策前，应建立事实级评测集，验证每条结论确实被所引用原文支持。
