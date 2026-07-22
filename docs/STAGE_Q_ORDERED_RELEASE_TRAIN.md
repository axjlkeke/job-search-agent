# Stage Q：API + 主 Beta 有序发布列车

> 状态：最终列车已在本地生成并完成离线完整性验证；未上传、未连接远端预演、
> 未重启、未应用。

## 1. 为什么需要发布列车

Stage O 的职业情报 API 与 Stage P 的主 Beta 前端是两个独立、可回滚的发布包。
如果人工拿错版本、先后顺序颠倒或只上传其中一个，单包本身通过也不能证明整条
升级链正确。Stage Q 将两个已验证压缩包、应用顺序、候选/正式端口、批准变量
和失败边界绑定为一个内容寻址清单。

最终本地列车：

- 列车 ID：`job-search-agent-release-train-cbe9268bd5feff6c`
- 列车内容 SHA-256：`cbe9268bd5feff6cff83d32bdf52a03b55b5ef26047329b83c9524de3c84da5a`
- 列车压缩包 SHA-256：`3fbbb3c1fb185c513d8847cf5b6242f572a942097806a73d5001a356d70bc926`
- 压缩包：`work/releases/job-search-agent-release-train-cbe9268bd5feff6c.tar.gz`
- 文件权限：`0600`

## 2. 被锁定的两个步骤

| 顺序 | 服务 | 发布 ID | 候选 → 正式 | 独立批准变量 |
| --- | --- | --- | --- | --- |
| 1 | 职业情报 API | `career-intelligence-api-8b04102064054d75` | 18081 → 18080 | `CAREER_INTELLIGENCE_RELEASE_APPROVED` |
| 2 | 主 Beta 前端 | `job-search-agent-main-beta-faba6b0cfac27baf` | 3002 → 3000 | `JOB_SEARCH_AGENT_RELEASE_APPROVED` |

API 压缩包 SHA-256：
`17ad2976c63090f51c2b28efa709842f152230ec3b3f1c8e5e8e7d0544b7e826`。

前端压缩包 SHA-256：
`ed8c1f7519d4c0a06ff4126d4c40d7045fcc7ed1460b7771047397a5a45f7ebb`。

列车 ID 会同时吸收两个服务的顺序、发布 ID、运行集合 hash、压缩包 hash、
候选/正式端口和批准变量；任一值变化都会生成新列车，旧 ID 不再适用。

## 3. 离线校验边界

列车校验器会：

1. 拒绝顺序颠倒、服务扩张、候选/正式端口变化或批准变量变化；
2. 拒绝任一内层压缩包 hash 与列车清单不一致；
3. 在安全检查 tar 路径和文件类型后，解压到临时目录；
4. 逐文件复算内层 manifest 的大小、SHA-256 和运行集合身份；
5. 拒绝未声明文件、符号链接、路径逃逸、私钥或密钥赋值；
6. 确认 API 具备请求时官网核验、失败清旧证据和不向官网发送学生档案能力；
7. 确认前端不含源码、密钥或环境变化，并明确不触碰 3001；
8. 确认整个列车声明 `remoteChanges=false`、`databaseChanges=false`、
   `environmentChanges=false`、`tunnelChanges=false`。

构建器和校验器没有 SSH、上传、服务重启或应用逻辑；它们只操作本地文件。

## 4. 失败边界

- API 候选或正式验证失败：API 自身自动回滚，发布列车立即停止，不执行前端。
- API 成功、前端候选失败：保留“新 API + 旧前端”。Stage M API 对旧前端
  向后兼容，因此这是可运行的安全状态。
- 前端正式替换失败：前端脚本自动恢复旧 `dist`；API 保持已验证的新版本。
- 任何阶段都不改变 3001、主站/独立数据库、Dify、知识库、依赖、环境文件或
  Cloudflare Tunnel。

Stage Q 不提供“一条命令直接生产发布”，避免一次授权跨越两个独立服务边界。
即使列车整体已获上传/预演授权，两个正式 apply 仍分别需要自己的精确发布 ID。

## 5. 本地复现

生成列车：

```bash
node scripts/release/build-release-train.mjs \
  --career-archive ../求职Agent-career-intelligence/work/releases/career-intelligence-api-8b04102064054d75.tar.gz \
  --frontend-archive work/releases/job-search-agent-main-beta-faba6b0cfac27baf.tar.gz
```

校验已经生成的列车目录：

```bash
node scripts/release/verify-release-train.mjs \
  work/releases/job-search-agent-release-train-cbe9268bd5feff6c
```

定向测试：

```bash
node --test tests/release-train.test.ts
```

测试固定验证顺序、零远端变化、防篡改、独立批准和失败策略。最终列车压缩包还需
在获得用户明确授权后才能上传；上传本身不等于允许远端预演或正式应用。
