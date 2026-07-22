# Mac mini 上线说明

这套脚本的作用是：把 Mac mini 变成求职 Agent 的小型服务器。第一次配好之后，以后更新项目只需运行一条部署命令。

它会管理：

- 网页前端：`127.0.0.1:3000`
- 真实知识库接口：`127.0.0.1:8001`
- Dify 1.15.0 + Qdrant：`127.0.0.1:8000`
- Ollama 中文向量模型：`127.0.0.1:11434`
- Agent 匿名路径状态：`~/.local/share/tokensoff/workspaces`，仅服务端读写、目录 `0700`、文件 `0600`
- Apple Vision 中文 OCR：Mac 上优先识别长图并自动切分超长海报
- Tesseract 中文 OCR：Vision 或非 Mac 环境下的可复现兜底
- Cloudflare Tunnel：默认把 `tokensoff.com` 转到主 Beta 前端 3000；职业情报影子阶段可经独立切换脚本改到 3001
- 每日知识来源同步：04:10 运行受限批量同步并输出覆盖率报告

Dify、RAG 和 Ollama 都只在 Mac mini 本机可见，不直接暴露到公网。这套方案不经过 VPS，不会改 VPS 443 端口或现有转发规则。

## 第一次：只需配一次

1. 复制配置模板：

   ```bash
   cp infra/macmini/env.example infra/macmini/env.local
   ```

2. 打开 `env.local`，至少填好以下项：

   - `DEPLOY_TARGET`：Mac mini 的 SSH 别名。如果直接在 Mac mini 上执行可留空。
   - `APP_REPO_DIR` 和 `KB_WORKDIR`：把 `your-name` 换成 Mac mini 用户名。
   - `KB_API_KEY`/`RAG_API_KEY` 和 `ADVISOR_SESSION_SECRET` 可以留空；首次部署会在 Mac mini 本地自动生成，以后更新会沿用。
   - `DIFY_API_KEY`、`DIFY_DATASET_ID` 和 `DIFY_DATASET_API_KEY` 不能伪造，首次先留空；在 Dify 里创建聊天应用和知识库后再回填。
   - `PREPARE_KB_OCR=true` 时会编译项目内的 Vision OCR，并准备 Tesseract 固定版本中文模型；模型只保存在 Mac mini 的私有数据目录，不进入 Git。
   - `JOB_AGENT_WORKSPACE_DIR` 使用模板默认的绝对路径即可；它只保存公开岗位快照和任务勾选，不连接或修改主站数据库。

   Dify 自身的数据库、Redis、Qdrant 和插件密钥可以留空。首次准备 Dify 时，脚本会在 Mac mini 本机生成强随机值，以后沿用；密钥不会显示在日志里。`env.local` 也已被 Git 忽略。准备脚本会把 Qdrant 容器的 `nofile` 软/硬上限固定为 `65536`，避免分段和索引文件增多后卡在 Docker 默认的 1024 文件句柄。

3. 运行部署：

   ```bash
   ./infra/macmini/deploy.sh remote
   ```

   如果你已经在 Mac mini 终端中，运行：

   ```bash
   ./infra/macmini/deploy.sh local
   ```

脚本会先检查现有 Docker。只要现有 daemon 能用就不做改动；如果 Docker Desktop 卡在管理员弹窗，就会用 Colima（4 CPU、8GB 内存、30GB 磁盘），不强制打开 Docker Desktop。

## Cloudflare 域名：首次需要人工授权一次

在 Mac mini 上执行：

```bash
cloudflared tunnel login
cloudflared tunnel create tokensoff-macmini
cloudflared tunnel route dns tokensoff-macmini tokensoff.com
```

完成后：

1. 把返回的 Tunnel ID 填入 `CLOUDFLARE_TUNNEL_ID`。
2. 把对应 JSON 凭据路径填入 `CLOUDFLARE_CREDENTIALS_FILE`。
3. 把 `ENABLE_CLOUDFLARE_TUNNEL` 改为 `true`。
4. 再运行一次 `deploy.sh local`。

本仓库首次生成的 Tunnel 配置只有一条业务转发：
`tokensoff.com -> 127.0.0.1:3000`。职业情报影子分支可将同一入口受控切换至
`127.0.0.1:3001`；无论指向哪个前端，都不会把 Dify 8000、RAG 8001、
Ollama 11434 或独立数据库直接公开出去。健康检查按本仓库主 Beta 的
`/v2` 验证；若域名当前指向只提供根工作台的 3001 影子前端，公网项会提示
版本不匹配，而不是把根首页 200 误报成主 Beta 已上线。

## 日常操作

更新版本：

```bash
./infra/macmini/deploy.sh remote
```

### 主 Beta 安全发布包

日常全量部署脚本会同步源码、安装依赖并准备多个服务；已有服务器只更新主
Beta 构建产物时，优先使用 Stage P 的隔离发布包，合同见
[`../../docs/STAGE_P_SAFE_MAIN_BETA_RELEASE_PACKAGE.md`](../../docs/STAGE_P_SAFE_MAIN_BETA_RELEASE_PACKAGE.md)。

该流程先在 `127.0.0.1:3002` 启动临时候选，验证页面、系统状态、岗位搜索、
决策接口、档案不落库字段，以及未登录匿名工作区保持关闭且不返回标识/档案；
通过后仍不会自动替换 3000。只有提供与 manifest 一致的
`JOB_SEARCH_AGENT_RELEASE_APPROVED` 才能应用，失败会恢复旧 `dist`。
3001、环境文件、依赖、数据库、知识库、Dify 和 Tunnel 均不改变。

API 与主前端一起准备发布时，先使用
[`../../docs/STAGE_Q_ORDERED_RELEASE_TRAIN.md`](../../docs/STAGE_Q_ORDERED_RELEASE_TRAIN.md)
核对双包发布列车。列车只锁定本地压缩包和执行顺序，不会上传或执行远端命令；
正式应用仍需 API 与前端各自独立的精确批准值。

检查所有服务：

```bash
./infra/macmini/healthcheck.sh
```

备份知识库、Agent 匿名路径状态和 Dify 数据库：

```bash
./infra/macmini/backup.sh
```

手动执行一次已启用知识来源同步：

```bash
./infra/macmini/run-kb-sync.sh
```

只准备或复核图片公告 OCR：

```bash
./infra/macmini/prepare-kb-ocr.sh
```

脚本先把 `vision-ocr.swift` 编译到 `KB_VISION_OCR_PATH`，随后固定使用 `tessdata_fast 4.1.0` 的 `chi_sim.traineddata` 作为兜底，下载后验证 SHA-256，再与本机 `eng.traineddata` 一起放入 `KB_TESSDATA_DIR`。checksum 不一致时会停止，不会把未知模型投入知识同步。

Vision 会按图片高度切分超过 3000 像素的海报，避免 600×9901 这类长图只识别到一行。知识库另外保存原始识别审计记录；质量分数不足的内容不会进入 Dify。

任务只处理已经由运营审核并启用的来源，受 `KB_SYNC_SOURCE_LIMIT` 和每个来源 `max_documents` 双重限制；同步后最多按 `KB_DIFY_RECONCILE_LIMIT` 对账异步索引，再输出覆盖率。若 Mac 使用 fake-IP DNS，可设置 `KB_ALLOW_FAKE_IP_DNS=true`；`KB_PROXY_URL` 只有在确认对应本机端口实际监听时才填写，否则保持空值。

日志默认在 `~/Library/Logs/tokensoff`。备份默认在 `~/Backups/tokensoff`，保留 14 天。备份包含知识库、Agent 匿名路径状态和可用时的 Dify PostgreSQL 导出，但不包含 `env.local`、主站内部用户号、个人档案或 Cloudflare 凭据。Qdrant 是可重建的检索索引，默认不打包。

如果 Dify 文档长期停在 `waiting`，并且 Qdrant 日志出现 `Too many open files`，不要把映射手工改成 `synced`。先确认容器内 Qdrant 进程的 `Max open files` 为 `65536`，按发布前流程备份向量目录后运行 `prepare-dify.sh` 重建容器；服务恢复后用 `dify-retry` 重提终态错误映射，再用 `dify-reconcile` 逐批确认完成。2026-07-18 的修复回滚点位于 `~/Backups/tokensoff/releases/20260717-175149-kb-detail-first-frontier/dify-qdrant`。

## 开机和断电说明

所有常驻程序都是当前用户的 LaunchAgent，不需要免密 sudo。`caffeinate` 会在登录状态下防止休眠。

macOS 的“断电后自动开机”需要管理员权限，脚本不会绕过这个安全限制。要做到无人值守，需要你有空时在系统设置里手动开启这一项。
