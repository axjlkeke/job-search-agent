# Stage P：主 Beta 前端安全发布包

> 状态：发布包已通过 3002 完整候选验证并应用到 Mac mini 内部 3000；公网 3001 未切换。

## 1. 目的

Stage P 只解决“怎样安全地把当前主 Beta 构建产物交给 Mac mini”。
发布工具本身不改变业务状态；当前构建包含匿名跨设备路径代码，但未配置时保持
关闭。该流程不接触主站数据库、独立 MySQL、知识库、Dify、Cloudflare
Tunnel 或 3001 影子前端，也不会把开发机源码和密钥上传到服务器。

当前本地发布物：

- 发布 ID：`job-search-agent-main-beta-abc6a3e90a99e935`
- 运行集合 SHA-256：`abc6a3e90a99e9356f6d8125f0a3ee5f0b3bf8a9c9d16e6da213d467a14cdde5`
- 压缩包 SHA-256：`62b9e90881c68c1313a4fa5a62a1cf54cdea49b1865b673e64bc0b88d1e606a3`
- 压缩包：`work/releases/job-search-agent-main-beta-abc6a3e90a99e935.tar.gz`
- 文件权限：`0600`

发布 ID 由 54 个运行文件的路径与内容哈希共同生成。工作区是 dirty 状态，
这一事实写入 manifest；发布身份不依赖 Git 提交号。

## 2. 发布包边界

包内只有：

- `dist/`：Vinext 生产构建产物；
- `package.json` 与 `package-lock.json`：只用于核对现有服务器依赖是否可复用；
- `release-main-beta.sh`：候选预检、显式批准、替换与回滚；
- `verify-main-beta-release.mjs`：文件集合、内容哈希、安全边界和构建标记校验；
- `release-manifest.json`：发布身份与不变边界。

包内没有：

- `app/`、`lib/`、`services/`、测试或评测源码；
- `node_modules/`；
- `.env.production`、API Key、会话密钥、SSH/Cloudflare 凭据或私钥；
- SQLite、MySQL、Dify、Qdrant 或知识库数据；
- 任何主站资料或学生档案。

校验器会拒绝未声明文件、符号链接、路径逃逸、内容篡改、私钥、密钥赋值、
源码目录扩张，以及缺少三种证据时效状态、匿名路径接口/界面标记或进度标记的
旧构建。

## 3. 候选与正式端口

| 端口 | 用途 | Stage P 行为 |
| --- | --- | --- |
| 3000 | 当前主 Beta | 预检前必须健康；只有显式批准后才可能替换 `dist` |
| 3001 | 当前公网影子前端 | 完全不使用、不停止、不替换 |
| 3002 | 临时候选实例 | 使用发布包和现有依赖启动；验证完立即停止 |

3002 候选读取现有 `.env.production` 到进程环境，但不会复制或打包该文件。
服务器现有 `package-lock.json` 必须与发布包完全同 hash，才允许复用
`node_modules`；不一致时直接停止，不运行 `npm ci` 或在线安装。

## 4. 候选必须通过的检查

候选实例依次验证：

1. `/`、`/v2`、`/progress`、`/api/system/status` 均可访问；
2. 系统状态确认职业情报服务在线；
3. 同源岗位搜索至少返回一个真实岗位；
4. 岗位 `63381` 的决策请求返回 200；
5. 决策响应明确 `profilePersisted=false`、`profileLogged=false`、
   `directIdentifiersAccepted=false`；
6. `/progress` 确认当前构建包含“主前端安全发布包”标记；
7. 无接力会话时 `/api/workspace` 必须返回 401 或 503，并明确
   `connected=false`；
8. 工作区响应不得包含 `workspaceSubject`；
9. 工作区响应不得包含 `profile`。
10. 市场报告返回 200，候选来源为主站只读接口；
11. 决策模型版本为 `2026-07-22.v2`；
12. 排序分明确为核验优先级而不是录取概率；
13. 市场报告不包含学生个人资料；
14. 主站最新候选总量和决策候选均大于 0；
15. 已截止岗位不能进入主攻、稳妥或冲刺的当前执行组合；
16. 已截止或明确高风险岗位不能进入主攻组合；
17. 目标组合权威必须为确定性证据规则，AI 只能抽取和解释，不能覆盖资格门槛；
18. 3000 切换后只复验同一产物的服务、路由、只读接口和隐私边界，避免重复大报告请求造成误回滚。

最终发布包已在 Mac mini `127.0.0.1:3002` 完成以上验证，四个核心路由均为
200，岗位搜索与市场报告返回真实候选，决策模型版本、来源、非概率边界和隐私
字段全部通过；工作区在未配置状态下返回 503、`connected=false`，没有匿名
标识或个人档案字段。候选验证完成后 3002 已停止。

## 5. 远端执行合同

发布包已在用户批准后放入固定目录：

`/Users/work/Services/job-search-agent/incoming-main-beta/`

解压后先运行：

```bash
./infra/macmini/release-main-beta.sh preflight \
  /Users/work/Services/job-search-agent/incoming-main-beta/job-search-agent-main-beta-abc6a3e90a99e935
```

`preflight` 只运行校验和 3002 临时候选，不替换 3000。

正式应用还必须提供与 manifest 完全一致的一次性批准值：

```bash
JOB_SEARCH_AGENT_RELEASE_APPROVED=job-search-agent-main-beta-abc6a3e90a99e935 \
  ./infra/macmini/release-main-beta.sh apply \
  /Users/work/Services/job-search-agent/incoming-main-beta/job-search-agent-main-beta-abc6a3e90a99e935
```

应用流程先把新 `dist` 复制到同一磁盘的临时目录并逐文件比对；随后停止
`com.tokensoff.frontend`，把旧 `dist` 原样移动到带时间戳的备份目录，再把
新目录切入 3000。启动或完整烟测任何一项失败，脚本会自动移走失败版本、恢复
旧 `dist`、重新启动并复验。

最终内部 3000 已启用该发布 ID，回滚备份保存在
`/Users/work/Services/job-search-agent/release-backups/main-beta/job-search-agent-main-beta-abc6a3e90a99e935-20260722-162955`。
公网 3001 进程 PID 50814 前后不变；整个流程没有替换源码、依赖、运行环境、
数据库、知识库、Dify 或 Tunnel。

## 6. 本地复现

完整构建、签名和打包：

```bash
node scripts/release/build-main-beta-release.mjs
```

只校验已生成目录：

```bash
node scripts/release/verify-main-beta-release.mjs \
  work/releases/job-search-agent-main-beta-abc6a3e90a99e935
```

定向安全测试：

```bash
node --test tests/main-beta-release.test.ts
```

测试覆盖运行时最小集合、源码/密钥排除、压缩包 `0600`、内容篡改拒绝、
3002 候选、匿名工作区默认关闭与无泄露、依赖锁一致、显式批准与自动回滚合同。
