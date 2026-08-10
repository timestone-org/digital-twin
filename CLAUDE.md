# DigitalTwin

## Agent skills

### Issue tracker

议题与规格以 GitHub issue 的形式存放，统一用 `gh` CLI 操作。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准分诊角色沿用默认标签串。见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文——根 `CONTEXT-MAP.md` 指向各上下文自己的 `CONTEXT.md`。见 `docs/agents/domain.md`。

### Service topology

后端 **5 个代码单元、8 个部署单元**：`auth-server` / `platform-server` / `collector-server` / `realtime-hub` / `ai-assistant`，其中 `platform-server` 按 `ROLE=api|worker|publisher` 跑出三种进程。**代码单元 ≠ 部署单元**——扩缩与故障隔离在部署层解决，不为运行角色另建服务目录。数据是一库多 schema、**写独占读放行**。见 `docs/ARCHITECTURE_MICROSERVICES.md` 与 `docs/adr/0001`–`0005`。

### Project structure

后端整体在 `server/`（uv workspace 根），与 `web/` 左右对称，分三层：基础设施只有一份在 `server/lib/`，领域共享包在 `server/domain/*`，服务在 `server/services/<svc>/` 各出一个入口函数，依赖方向 `services → domain → lib`。**`lib` 内零项目名词**（数字孪生/大屏/点位/台账等一律不许出现，产品差异靠参数注入）；`domain` 可含项目名词，但**不许含 ORM 模型/CRUD**，也不许互相 import，入场券是「已有 ≥ 2 个服务真实消费」。`lib` 不许 import domain 与服务、服务之间不许互相 import、服务下不许再出现 `core/`|`config/`|`utils/`。业务只写在 `apps/<feature>/`，依赖方向 `api → services → crud → models`。前端 `web/` 是 pnpm workspace，`@dt/*` 包分四层无环，`packages/*` 不许依赖 `app/`，不许深链包内部路径。
按语言见 `docs/agents/project-structure-python.md` 与 `docs/agents/project-structure-typescript.md`；镜像构建见 `docs/agents/docker-build.md`。

### API contract

全服务同一套口径：URL `/api/v1/<service>/<资源复数>`、动作端点 `POST …:verb`、统一信封 `{code,message,data,trace_id}` 且 **HTTP 状态码必须真实（严禁恒 200）**、错误码分段十进制、时序集合用游标分页（页码分页会静默重复漏行）、时间一律 UTC RFC3339、精确小数走 string、**禁数字枚举**、下发写值与长任务必须支持 `Idempotency-Key`、内部接口挂 `/internal/` 并用服务级密钥。`openapi.json` 提交进仓、CI 校验一致，前端类型由它生成。见 `docs/agents/api-contract.md`。

### Database

命名/约束显式化，主键默认 UUIDv7（超大追加表除外），时刻一律 `timestamptz` 存 UTC，精确值 `numeric`，**禁原生 ENUM**。**迁移按扩展—收缩两次发布**：加列必可空、删列两步、**禁改名与原地改类型**、加索引 `CONCURRENTLY`、加约束先 `NOT VALID` 再 `VALIDATE`；迁移里**禁止回填数据**（走 worker 批处理），开头必设 `lock_timeout`。事务由 service 层持有、**禁提前 commit 取 id（用 flush）**、**禁事务内做外部 IO 与投队列**。见 `docs/agents/database-standard.md`。

### Observability

结构化 JSON 日志，`event` 必须是稳定字面量不许拼变量；**4xx 不是 ERROR**；密钥/PII/请求体全文禁入日志。`traceparent` 跨服务传播，**队列消息信封里必须带它**（否则链路在异步处齐断），长循环按批切 trace，错误链路 100% 采样。指标只用低基数标签。**liveness 严禁查依赖**（否则依赖抖动会引发全副本重启风暴）；collector 的 readiness 与是否 leader 无关。写值/授权/发布等操作的审计记录**写在业务事务内**。见 `docs/agents/observability.md`。

### Runtime resilience

异常三层（领域/应用/基础设施），业务层不构造 HTTP 响应；**每个跨进程调用必须有超时**且下游之和 < 上游；**一条链路只有一层负责重试**（逐层重试会相乘成雪崩）；**写操作超时按不可重试处理**；队列是 at-least-once 故消费者必须幂等（"先查再插"不是幂等）；**锁内禁长 IO**、租约 renew-or-die、Redis 不可达一律判非 leader；关停顺序 = 先摘就绪 → 停收新活 → drain → 让租约，**停止顺序不是启动的逆序**；降级方向逐项显式，**返回陈旧数据必须标注为陈旧**。见 `docs/agents/runtime-resilience.md`。

### Config & secrets

启动即全量校验、缺失即退出（不给 WARN continue）；**密钥类绝不给默认值**——弱默认的密钥等于没有密钥；跨服务共享值的回退链**必须每个服务都写全**，否则非对称失效；环境差异只能是取值不能是行为（**禁 `if env == "prod"`**）；密钥不进版本库/镜像层/日志/URL，且要能不停机轮换；**环境变量是永久默认值，不是一次性播种**。见 `docs/agents/config-and-secrets.md`。

### Testing

按公网发布的生产标准：四层分层（单元/集成/契约/E2E）、整体行覆盖 ≥ 80% 且分支 ≥ 75%、**增量覆盖 ≥ 90%** 且整体不许下降、零容忍 flaky、CI 不重试。缺陷修复必须先有一条修复前必红的用例。
按语言见 `docs/agents/testing-standard-python.md` 与 `docs/agents/testing-standard-typescript.md`。

### Code style

Python：`pyright` **strict** 无例外；`Any` 只在边界且立刻收敛，裸 `type: ignore` 打回；函数 ≤50 行/参数 ≤5/复杂度 ≤10/路由函数 ≤20 行；**禁函数内 import 打破循环**（惰性只是把环藏到运行期）；**`async` 里禁任何阻塞调用**，CPU 密集只进进程池（线程池救不了 GIL）；`create_task` 必须存强引用；**ORM 模型禁止直接返给 HTTP 层**；禁模块级可变状态与 import 副作用。
TypeScript：tsconfig 开满（含 `noUncheckedIndexedAccess`）；禁 `any`/`!`/`@ts-ignore`，**禁给后端数据写 `as` 断言**（类型来自 openapi 生成）；不用 `enum` 用 const 联合；**默认 `ref` 不用 `reactive`**（解构即失活）；**卸载必须清理**定时器/监听/Observer/echarts/three 资源；`computed` 禁副作用；`v-for` key 禁用索引；**可被快速切换触发的加载必须防竞态**；⚠ **模板里的 prop/插槽/注册名写错，typecheck 与 lint 双双放行**，只能靠契约测试兜；必开 `no-floating-promises`。
按语言见 `docs/agents/code-style-python.md` 与 `docs/agents/code-style-typescript.md`。

### Comment style

注释只做四件事：文件头 = 这个文件是什么（1–3 行，理由指向文档）；函数 = 一句话 + 参数；常量/行内 = 一个名字，不是一句话；反直觉的坑 = 用到处一行。禁止变更史注释。
按语言见 `docs/agents/comment-style-python.md` 与 `docs/agents/comment-style-typescript.md`。

### Engineering workflow

主干开发，分支 ≤2 天；PR ≤400 行且只碰一个服务，锁文件单独成 PR；迁移/鉴权/并发/对外契约/新增 `type: ignore` 必须逐行评审；**迁移先行且只做扩展步**——代码可回滚、数据库不回滚，故「新结构 + 旧代码」必须可用；镜像 tag 用版本+SHA、**禁 `latest`**；第三方 Action 按 commit SHA 固定；ADR 的四条触发条件见文档。见 `docs/agents/engineering-workflow.md`。
