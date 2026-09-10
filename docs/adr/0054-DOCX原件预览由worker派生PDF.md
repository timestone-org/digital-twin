---
status: accepted
date: 2026-09-09
---

# ADR-0054：DOCX 原件预览由 worker 派生私有 PDF

知识库继续用本地 `DocxParser` 解析 DOCX 的正文与结构；同一次摄取由 worker
调用无界面的 LibreOffice，把原件另行派生为 PDF，存入文档自己的私有对象前缀。
读取预览仍走认人的知识库 API，浏览器优先用现有 pdf.js 显示；派生物尚未生成或
转换失败时，回退到现有 `docx-preview` 并明确提示复杂图形可能不完整。
生成开关只控制后续派生；关闭后已有私有 PDF 仍可读取，不做破坏性清理。

`docx-preview` 只处理 DrawingML 图片，Word 形状、图表与 SmartArt 会被静默跳过；
在浏览器里补齐完整 Office 绘图与分页引擎的代价远高于一次服务端转换。不能改把
DOCX 交给 MinerU：那会违反 ADR-0043 的解析分层，并丢掉本地解析器更准确的标题、
表格和图文定位。Office Online 一类公网查看器也不能读取私有、离线部署的原件。

转换只在 worker 角色运行，使用独立临时目录与用户配置、固定超时、无 shell 参数；
伪装的宏包被拒，会出站的关系在交给进程前移除，子进程不继承服务密钥。PDF 是可
丢弃派生物：生成或写入失败不阻断正文摄取，重复
任务覆盖同一个确定键。代价是 knowledge 镜像增加 LibreOffice 与中文字体；由于
API/worker 共用同一镜像（ADR-0002），API 角色也承担这部分镜像体积。

摄取仍只有一条队列消息：整份任务有总超时，处理期间按 pending idle 的三分之一
用 Lua 原子续期，且只有当前 owner 能续期或确认。每个 worker 进程使用带随机后缀
的 consumer 名，开工前先核对 owner；`XAUTOCLAIM` 续用返回游标，不能反复扫描 PEL
前缀。续期失败、所有权转移时旧 worker 立即取消本次摄取且不确认。

长任务也放大了“旧消息确认失败后，用户又点重新解析”的竞态。因此文档行与 v1
队列信封共享一个 `ingest_generation`：重新解析只在待投递或终态原子开启新期次，
处理中返回 409；旧期次与 `ready` / `failed` 消息只确认、不再执行。新增列按扩展步
保持可空，不做迁移回填；信封只增加可选字段，旧 worker 会忽略，存量消息只处理
generation 为空的存量行，因此不会把任一版本的消息当坏信封丢弃。

不过“旧 worker 会忽略”也意味着它**不会执行 generation 栅栏**。因此采用符合
engineering-workflow §6.2 的两次滚动发布：第一版加可空列并发布能读取 generation
的新代码，但 `KNOWLEDGE_INGEST_GENERATION_WRITE_ENABLED=false`，重新解析沿用当前
期次；确认全部旧 worker 消失后，第二版只把该开关改成 `true`，生产者才为重排写新
期次。第二次滚动期间所有新旧副本都已理解字段，不需要停写；fresh install 可在首次
启动前直接设 `true`。

开关启用后若必须回滚到不认识 generation 的旧镜像，不能做普通的新旧 worker 滚动
共存：先暂停上传/来源同步/重新解析，排空并停止全部新版 worker，再回滚 API 与
worker，最后恢复写入口。新列保留不回滚，旧代码会忽略它；这个协调顺序避免新版
worker 把旧 API 发出的无 generation 消息判过期并确认，留下永久 pending 的文档。
发行版提供的 LibreOffice 采用 MPL-2.0 / LGPLv3+ 双许可，本仓选择 MPL-2.0
这一支，不修改或再分发其源码。随镜像安装的 Noto CJK 字体采用 SIL OFL-1.1，
允许与应用一同分发；镜像保留 Debian 包内的许可证与版权文件，不改单独字体文件。
