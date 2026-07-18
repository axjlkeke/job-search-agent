# Mac mini 上线说明

这套脚本的作用是：把 Mac mini 变成求职 Agent 的小型服务器。第一次配好之后，以后更新项目只需运行一条部署命令。

它会管理：

- 网页前端：`127.0.0.1:3000`
- 真实知识库接口：`127.0.0.1:8001`
- Dify 1.15.0 + Qdrant：`127.0.0.1:8000`
- Ollama 中文向量模型：`127.0.0.1:11434`
- Apple Vision 中文 OCR：Mac 上优先识别长图并自动切分超长海报
- Tesseract 中文 OCR：Vision 或非 Mac 环境下的可复现兜底
- Cloudflare Tunnel：只把 `tokensoff.com` 转到前端 3000 端口
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

   Dify 自身的数据库、Redis、Qdrant 和插件密钥可以留空。首次准备 Dify 时，脚本会在 Mac mini 本机生成强随机值，以后沿用；密钥不会显示在日志里。`env.local` 也已被 Git 忽略。

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

生成的 Tunnel 配置只有一条业务转发：`tokensoff.com -> 127.0.0.1:3000`。不会把 Dify 8000、RAG 8001 或 Ollama 11434 公开出去。

## 日常操作

更新版本：

```bash
./infra/macmini/deploy.sh remote
```

检查所有服务：

```bash
./infra/macmini/healthcheck.sh
```

备份知识库和 Dify 数据库：

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

日志默认在 `~/Library/Logs/tokensoff`。备份默认在 `~/Backups/tokensoff`，保留 14 天。备份不包含 `env.local` 或 Cloudflare 凭据。Qdrant 是可重建的检索索引，默认不打包。

## 开机和断电说明

所有常驻程序都是当前用户的 LaunchAgent，不需要免密 sudo。`caffeinate` 会在登录状态下防止休眠。

macOS 的“断电后自动开机”需要管理员权限，脚本不会绕过这个安全限制。要做到无人值守，需要你有空时在系统设置里手动开启这一项。
