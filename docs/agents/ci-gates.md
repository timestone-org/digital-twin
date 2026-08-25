# CI 闸门地图

`docs/agents/` 里的每条规范，落到 CI 上是哪个作业、哪条命令。这份文档回答两个问题：
**「这条规范谁在守？」**与**「这个红灯对应哪条规范？」**

> ⚠ 只是约定的阈值等于没有阈值。这里列的每一条都必须是**红灯**，不是告警。

---

## 1. 流水线分段

`.github/workflows/ci.yml`，**只在 main 的 push 上跑**（分支与 PR 上都不触发，理由见 §1.1），五段串行：

```
1 秒级闸门        机密扫描 / 仓库卫生 / 结构与规范闸        ← 只读源码，最便宜的红灯
      ↓
2 静态检查        格式 · lint · 类型（后端与前端并行）
      ↓
3 测试            后端（真 Postgres + Redis）· 前端        ← 含覆盖率阈值与棘轮
      ↓
4 契约与产物      openapi 一致性 · 迁移可逆性 · 构建 · 包体 · 漏洞 · 许可证
      ↓
5 汇总            gate —— 分支保护里唯一需要设成必需的检查
```

分段的意义是**反馈时序**：秒级闸门红了就不必再花几分钟装依赖跑测试。

另外两条流水线：

| 文件 | 触发 | 管什么 |
|---|---|---|
| `pr-policy.yml` | 只在 PR | 规模 ≤400 行 / ≤20 文件 / ≤1 服务（三类豁免见 [engineering-workflow §3.1](engineering-workflow.md)）、提交信息、分支名、锁文件单独成 PR、PR 描述、抽取逻辑版本 |
| `nightly.yml` | 每日定时 | 变异测试、可访问性全站扫描、镜像内容断言。**失败开 issue，不阻断合并** |

E2E、a11y、变异测试不进 PR 闸门是 `testing-standard-*.md` §9 的明确要求——它们太慢，
每个 PR 都等十几分钟的代价大于收益。

### 1.1 ⚠ 开发期不等 GitHub 的 CI

**功能分支推上去不会有任何流水线结果，PR 页面上也不会有**——那不是 CI 坏了，
是它按设计只在 main 的 push 上跑。

于是规矩是两条，且没有例外：

1. **改完先在本地过闸**：`scripts/ci-local.sh --fast`（约 5 分钟，不起容器，
   覆盖流水线第 1–2 段的全部内容）；推送或合并之前用 `scripts/ci-local.sh --all`
   （act 跑的就是 `ci.yml` 本身，同一份 YAML、同一批闸门脚本，与合并后在
   GitHub 上跑的是同一件事）。
2. **合并进 main 之后盯一眼那轮流水线**：它是最后一道真运行器上的验证，
   红了按「main 永远可发布」当场修或回滚，不许拖到下一个 PR。

理由是反馈时长：本地 act 改一次就当场知道红绿，而推一次要等一轮完整流水线。要在真运行器上补跑一次分支，用 `ci.yml` 的 `workflow_dispatch` 手动触发，
不要为了触发 CI 去造一次推送。

---

## 2. 规范 → 闸门

### 结构

| 规范 | 闸门 |
|---|---|
| project-structure-python §7 八条铁律 | `check_structure_python.py`（13 项） |
| project-structure-typescript §7 布局类 | `check_structure_web.py`（9 项） |
| 同 §4.2/§4.3 样式与页面布局 | `check_web_styles.py`（5 项） |
| 同 §2 分层依赖表、零环 | `check_web_deps.py`（3 项） |

### 代码风格

| 规范 | 闸门 |
|---|---|
| code-style-python §3 规模上限、§4 导入、§2.2 压制指令 | `check_python_style.py` |
| 同 §5–§7 异步/状态/数据结构、database-standard §6 事务边界 | `check_python_runtime.py` |
| 同 §1 命名 | `check_python_naming.py` |
| 同 §9 工具链 | `black --check` · `ruff`（零告警）· `pyright` strict |
| code-style-typescript §3 规模、§5.2 卸载清理、§6.3 key、§10 硬编码色值 | `check_ts_style.py` |
| 同 §11 必开的 ESLint 规则 | `eslint . --max-warnings=0` |
| 同 §2.1 编译器配置 | `vue-tsc --noEmit` |

### 注释

| 规范 | 闸门 |
|---|---|
| comment-style-* 变更史、作者块、大横幅、JSDoc 类型、`@ts-ignore` | `check_comments.py` |
| 同 文件头 `@fileoverview` / 模块 docstring | `check_comments.py` · `ruff` |

### 契约与数据

| 规范 | 闸门 |
|---|---|
| api-contract §1 URL 形状、§5.2 分页上限、§6 序列化口径、§4.1 错误码 | `check_api_contract.py`（读提交进仓的 `openapi.json`） |
| 同 §9 openapi 与代码逐字节一致 | `contracts` 作业的 `python -m scripts.export_openapi --check`（每个服务各一次） |
| database-standard §5 扩展—收缩、lock_timeout、禁回填/改名/改类型 | `check_migrations.py` |
| 同 §5.5 可逆性 | `contracts` 作业的 `upgrade → downgrade → upgrade` |

### 运行时与配置

| 规范 | 闸门 |
|---|---|
| observability §2.2 `event` 字面量、§2.4 密钥/PII 不进日志、§5 liveness 不查依赖、§4.2 队列带 traceparent | `check_logging.py` |
| config-and-secrets §4.1 密钥无默认值、§6 禁环境分支、§8 模板列全变量、§4.3 回退链一致 | `check_config_secrets.py` |

### 测试

| 规范 | 闸门 |
|---|---|
| testing-standard-* §5.1 无断言/§2 命名/§6 skip 与 xfail/§1 分层 | `check_tests.py` |
| 同 §4.1 覆盖率阈值 | `pyproject.toml` 的 `fail_under` · `vitest.config.ts` 的 `thresholds` |
| 同 §4.2 棘轮（不低于基线，基线按 90%/80% 封顶） | `check_coverage.py` + `coverage-baseline.json` |
| 同 §4.1 增量覆盖 ≥85% | `diff-cover`，基线是本次推送前的 main（`github.event.before`）；本地跑时是与 `origin/main` 的合并基，两者判的是同一段 diff。前端 lcov 的 SF 路径口径由 `check_lcov_paths.py` 先验（对不上时 diff-cover 只报「0 行」照样放行） |
| 同 §4.3 `--cov=` 点号模块名、§6.2 禁外网、CI 里禁 skip | `check_pytest_run.py`（读 junit 与日志） |
| 同 §6.3 L2/L3 打真实 Postgres | `server-test` 的服务容器 |
| 同 §8 首屏包体预算 | `check_bundle_budget.py`（读真实产物） |

### 供应链与协作

| 规范 | 闸门 |
|---|---|
| engineering-workflow §5.4 Action 按 SHA 固定、§6.1 禁 `latest`、锁文件在仓 | `check_ci_hygiene.py` |
| 同 §5.3 许可证（GPL/AGPL 阻断） | `check_licenses.py` + `licenses-reviewed.json` |
| 同 §5.4 依赖漏洞 | `pip-audit --strict` · `pnpm audit --audit-level=high` |
| 同 §1–§3 分支、提交、PR 规模 | `check_pr_policy.py`（PR 专用） |
| 密钥不进版本库 | `gitleaks` + `.gitleaks.toml` |
| docker-build §5 镜像内容断言 | `nightly.yml` 的 `images` 作业 |
| 服务只用自己声明的依赖 | `check_service_deps.py` |

⚠ **`check_service_deps.py` 守的是一个在单仓里看不见的洞。** 开发与测试跑在
workspace 的**共享 venv** 里，一个服务可以用上另一个服务装进来的包而毫无察觉——
import 成功、pyright 通过、全部用例绿，只有按自己声明的依赖独立安装的生产镜像会崩。

它不猜「import 名 → 分发名」（`jwt`←`pyjwt` 这类映射既要人工维护，又会在条件
导入上漏判），而是复现生产条件：`uv export --package <svc>` 取该服务的依赖闭包，
装进一个全新的空 venv，再 `walk_packages` 把服务包下每个模块都 import 一遍。

真实案例：`opcua-server` 漏声明 `lib[auth]`，容器启动即
`ModuleNotFoundError: No module named 'jwt'` 并无限重启，而 385 条用例全绿。

### 领域不变量

有些口径只写在领域文档里，靠人记；它们同样得有红灯。

| 规范 | 闸门 |
|---|---|
| AC_STARTUP_DESIGN §5 改抽取逻辑必须手动 +1 `LOGIC_VERSION` | `check_logic_version.py`（PR 专用） |

⚠ 这条闸比的是「抽取引擎那两个文件**去掉 `#` 注释之后**的内容在基线与头之间
差没差」对「`LOGIC_VERSION` 的取值差没差」，**不对源码求哈希**：哈希一次格式化
就炸，而 +1 的代价是已有批次全部判为过期、要重跑一次全量抽取——为一条改过措辞的
注释付这个代价，这条闸很快就会被绕过。注释改不了抽取行为，去掉它不会漏报；
docstring 不去，它可能被程序读走。

⚠ **这条闸目前只报不拦**：按 §5，分支保护里唯一必需的检查是 `5·全部闸门`，
而 `pr-policy.yml` 的作业都不在其列。红了照样合得进去——把它设成必需检查
之前，别把它当成在拦。

---

## 3. 闸门自己也要被守住

闸门脚本是执行机制，它坏了比业务代码坏了更危险——**它坏的方式是「一直绿」**。
因此：

- 闸门脚本自己过 `black` / `ruff` / `pyright --project scripts`（strict）。
- **类型检查范围自检**（`check_typecheck_scope.py`）：断言 pyright 真的看了全部源码。
  ⚠ 本仓踩过：`include = ["services/*/src"]` 里的单个 `*` 匹配不到那一层目录，
  于是**一个服务文件都没被检查**，而输出仍然是「0 errors」。
- **测试运行结果自检**（`check_pytest_run.py`）：CI 里出现任何 skip 即红。
  ⚠ 本仓踩过：一条契约用例因为参数化列表为空被 pytest 标成 skip，
  它守的「闸 1 与闸 2 口径一致」于是长期空跑。
- **lcov 路径口径自检**（`check_lcov_paths.py`）：SF 路径必须能在仓库根解析到真实文件。
  ⚠ 本仓踩过（#59）：vitest 默认把 SF 写成 `web/` 相对路径，与 git diff 的
  `web/...` 前缀对不上，diff-cover 不报错、只报「0 行」——前端增量覆盖闸对
  **每个** PR 都静默放行。
- **CI 不配置任何重试**（`check_ci_hygiene.py` 扫 `continue-on-error` 与重试 Action）。
  重试会把不确定性藏起来；偶发失败按 P1 缺陷处理。

---

## 4. 本地怎么跑

**开发期的每一次验证都在这里**（§1.1）：GitHub 上只有 main 的 push 会触发流水线，
分支上没有 CI 可等。

```bash
scripts/ci-local.sh --fast          # 第 1–2 段的全部静态检查，约 5 分钟，不起容器
scripts/ci-local.sh                 # act 跑第 1–2 段
scripts/ci-local.sh -j server-test  # act 跑指定作业（含服务容器）
scripts/ci-local.sh --all           # act 跑整条流水线 —— 推送/合并前必须绿
```

`--fast` 跑 20 道闸门脚本，外加与「2·前端/后端格式、lint、类型」逐字同源的六步：
`prettier` / `black` / `ruff` / `eslint` / `typecheck` / `pyright`（含类型检查
范围自检）。⚠ **格式与类型不许留到 `--all` 才暴露**：它们是全流水线里最早红、
也最没有信息量的一档，为一个空格白等二三十分钟的容器启动与真库测试是纯浪费。
代价是 `--fast` 从秒级变成分钟级，大头在 eslint 全量遍历。

⚠ **跑 act 期间不要改工作树**：act 绑的是本地目录，跑到一半新写的文件会被当成
被测内容，报出来的红与已提交的状态无关。

⚠ 脚本给 act 喂一份写死 `ref: refs/heads/main` 的 push 负载：流水线的触发条件是
`push: branches: [main]`，不喂负载就得指望当前分支正好叫 main。负载里的 `before`
填的是与 `origin/main` 的合并基，增量覆盖那步于是按「这条分支相对 main 改了什么」判。

`act` 的参数在 `.actrc` 里，三处与默认不同的取值都写了理由：镜像必须是带完整
工具链的那档、串行跑（Docker Desktop 并发建容器会偶发失败）、以及显式补上
node 的 PATH（否则 JS action 的 post 步骤会把一个全绿的作业报成失败）。

⚠ **act 与 GitHub 的唯一实质差异是服务容器的健康检查**：GitHub 会等 `health-cmd`
通过再跑步骤，act 不会。流水线里因此有一步 `wait_for_deps.py` 显式等待——
它在两边都跑，不是只为 act 加的补丁。

---

## 5. 分支保护怎么配

⚠ **没有必需的状态检查可设**：主流水线在 PR 上不跑，把 `5·全部闸门` 设成必需
只会让每个 PR 永远卡在 pending。合并前的绿灯由 `scripts/ci-local.sh --all` 出，
合并后 main 上的那一轮是**事后**的守门人——它 `needs` 全部上游作业，任一失败
**或被跳过**都会让它失败（跳过的闸门不算通过），红了当场修或回滚。

仍然要配的：禁止直推 `main`、禁止管理员绕过、要求分支为最新再合并。

⚠ **`pr-policy.yml` 的三个作业照常在 PR 上跑**（都是秒级的，不用等），
**但红了不拦合并**，包括 §2「领域不变量」那条 `check_logic_version.py`——
一条不拦的闸只有在被人看的时候才有用，别把它当成在拦。

---

## 6. 运行器与它的前提

三条流水线都跑在 **GitHub 托管运行器**上：`runs-on: ubuntu-24.04`。

⚠ **钉版本，不写 `ubuntu-latest`**：`latest` 会跟着 GitHub 换镜像悄悄漂移，
而漂移带来的失败长得跟「闸门真的红了」一模一样。同一个理由也让 `.actrc` 里
只留这一个标签映射——act 的标签要与 workflow 里写的**逐字一致**，写错了它会
**静默跳过**那个作业，输出里看着像它压根不存在。

托管镜像自带 `git` / `curl` / `tar` / `docker` / `node`，流水线不必自检。
**Python、uv、pnpm 一律由流水线自己装**，版本也由它钉死。

三处仍然成立的取舍：

1. **闸门脚本用 uv 装的 3.12，不用运行器自带的 `python3`。**
   ⚠ 闸门脚本用了 3.12 的语法（`type` 别名、`X | Y` 形式的 isinstance）。
   镜像里那个 `python3` 的版本随镜像走——自己装一个钉死的，差异就不会跟着
   runner 镜像升级悄悄冒出来。
2. **服务容器映射到 55432 / 56379，不是 5432 / 6379。**
   ⚠ 理由现在只剩本地那一半：`scripts/ci-local.sh` 用 act 在开发机上跑同一份
   YAML，而开发机十有八九已经有一个 Postgres 占着 5432。两边用同一组端口，
   流水线里才不必为本地另写一套地址。
3. **不依赖 `jq`。** pyright 原始输出的切分与逐条报错都在 `check_pyright.py` 里。

### 依赖缓存

托管运行器是**一次性**的：`~/.cache/uv` 与 pnpm 的 store 每轮从零开始，所以
`setup-uv` 开 `enable-cache`、`setup-node` 开 `cache: pnpm`，省的是整份依赖的
下载。缓存键跟着锁文件走，锁文件不变才命中。

⚠ **`cache-dependency-path: web/pnpm-lock.yaml` 不能省**：仓库根没有锁文件，
不指路 setup-node 会以「找不到锁文件」直接失败。

⚠ **这一层本地验不到**：act 没有真的缓存后端，`enable-cache` 与 `cache: pnpm`
在本地既不命中也不保存。`ci-local.sh --all` 全绿也不代表缓存那几步在 GitHub 上
是对的——第一次推上去要单独看一眼这几步的日志。
