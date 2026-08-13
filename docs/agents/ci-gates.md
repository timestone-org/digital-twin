# CI 闸门地图

`docs/agents/` 里的每条规范，落到 CI 上是哪个作业、哪条命令。这份文档回答两个问题：
**「这条规范谁在守？」**与**「这个红灯对应哪条规范？」**

> ⚠ 只是约定的阈值等于没有阈值。这里列的每一条都必须是**红灯**，不是告警。

---

## 1. 流水线分段

`.github/workflows/ci.yml`，main 的 push 与每个 PR 都跑（分支 push 不单独触发——PR 事件已经验过同一份代码，双触发只会把自托管 runner 的队列拖死），五段串行：

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
| `pr-policy.yml` | 只在 PR | 规模 ≤400 行 / ≤20 文件 / ≤1 服务、提交信息、分支名、锁文件单独成 PR、PR 描述 |
| `nightly.yml` | 每日定时 | 变异测试、可访问性全站扫描、镜像内容断言。**失败开 issue，不阻断合并** |

E2E、a11y、变异测试不进 PR 闸门是 `testing-standard-*.md` §9 的明确要求——它们太慢，
每个 PR 都等十几分钟的代价大于收益。

---

## 2. 规范 → 闸门

### 结构

| 规范 | 闸门 |
|---|---|
| project-structure-python §7 八条铁律 | `check_structure_python.py`（13 项） |
| project-structure-typescript §7 布局类 | `check_structure_web.py`（8 项） |
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
| 同 §9 openapi 与代码逐字节一致 | `contracts` 作业的 `auth-openapi --check` |
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
| 同 §4.1 增量覆盖 ≥85% | `diff-cover`（只在 PR 上跑） |
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
- **CI 不配置任何重试**（`check_ci_hygiene.py` 扫 `continue-on-error` 与重试 Action）。
  重试会把不确定性藏起来；偶发失败按 P1 缺陷处理。

---

## 4. 本地怎么跑

```bash
scripts/ci-local.sh --fast          # 只跑闸门脚本，秒级，不起容器
scripts/ci-local.sh                 # act 跑第 1–2 段
scripts/ci-local.sh -j server-test  # act 跑指定作业（含服务容器）
scripts/ci-local.sh --all           # act 跑整条 push 流水线
```

`act` 的参数在 `.actrc` 里，三处与默认不同的取值都写了理由：镜像必须是带完整
工具链的那档、串行跑（Docker Desktop 并发建容器会偶发失败）、以及显式补上
node 的 PATH（否则 JS action 的 post 步骤会把一个全绿的作业报成失败）。

⚠ **act 与 GitHub 的唯一实质差异是服务容器的健康检查**：GitHub 会等 `health-cmd`
通过再跑步骤，act 不会。流水线里因此有一步 `wait_for_deps.py` 显式等待——
它在两边都跑，不是只为 act 加的补丁。

---

## 5. 分支保护怎么配

只把 **`5·全部闸门`** 设成必需的状态检查。它 `needs` 全部上游作业，
任一失败**或被跳过**都会让它失败——跳过的闸门不算通过。

另外：禁止直推 `main`、禁止管理员绕过、要求分支为最新再合并。

---

## 6. 自托管运行器的前提

三条流水线都跑在 `runs-on: [self-hosted, Linux, X64]` 上。自托管运行器**不像
GitHub 托管镜像那样什么都预装好**，缺一样就是一条与「闸门真的红了」长得一样的
失败，因此 `hygiene` 作业的第一步就是运行器工具自检。

必须装在运行器上的：

| 工具 | 谁要用 | 缺了会怎样 |
|---|---|---|
| `git` | checkout、PR 规模、覆盖率增量 | 什么都跑不了 |
| `curl` + `tar` | 取 gitleaks 二进制 | 机密扫描起不来 |
| `docker` | 服务容器（Postgres/Redis）、镜像断言 | 第 3 段与每日的镜像作业全废 |
| `node` | 全部 JS 版 Action、pyright | Action 一律跑不起来 |

**不需要**预装 Python、uv、pnpm：流水线自己装，版本也由它钉死。

三处为自托管做的取舍：

1. **闸门脚本用 uv 提供的 3.12，不用运行器自带的 `python3`。**
   ⚠ 闸门脚本用了 3.12 的语法（`type` 别名、`X | Y` 形式的 isinstance）。
   GitHub 托管镜像上 `python3` 恰好是 3.12，自托管上可能是 3.9/3.10——
   这类差异只会在自托管上炸，而且报的是语法错误，看不出是环境问题。
2. **服务容器映射到 55432 / 56379，不是 5432 / 6379。**
   ⚠ 自托管运行器往往就是开发机，本地十有八九已经有一个 Postgres 占着 5432；
   端口冲突会让服务容器起不来，而报错停在「连不上数据库」这一层。
3. **不依赖 `jq`。** pyright 原始输出的切分与逐条报错都在 `check_pyright.py` 里。

⚠ **Actions 缓存一律关掉**（`enable-cache: false`，setup-node 不带 `cache:`）。
`actions/checkout` 默认 `git clean -ffdx`，每轮会清掉工作区里的 `node_modules/`
与 `.venv/`；但真正省时间的是**工作区之外**的 `~/.cache/uv` 与 pnpm store，
它们在常驻运行器上本来就留在盘上，装依赖照样是从本地硬链。再叠一层 Actions
缓存只会把归档解到已经存在的文件上——tar 报 `Cannot open: File exists`
并以退出码 2 结束，每轮留一条红字警告，而它一点也没加速。

⚠ **服务容器的镜像拉取受运行器 Docker 的 registry mirror 影响**。
`Docker pull failed with exit code 1, back off … before retry` 这条警告的来源是
宿主 `/etc/docker/daemon.json` 里配的镜像源超时（runner 会自动重试，所以只是
警告不是失败）。它**修不到仓库里**——换掉不稳的 mirror 或直连 Docker Hub
才是解，见 §7。

---

## 7. 那条 docker pull 警告怎么根治

```
Docker pull failed with exit code 1, back off 1.743 seconds before retry.
Error response from daemon: Head "https://docker.m.daocloud.io/v2/library/redis/…":
  net/http: request canceled (Client.Timeout exceeded while awaiting headers)
```

runner 的 Docker 配了 `docker.m.daocloud.io` 作镜像源，它偶发超时。runner 会
自动重试并成功，所以是**警告不是失败**——但每次起服务容器都赌一次，而输的那次
很贵：实测同一个作业，快的时候 `Initialize containers` 3 秒，慢的时候
**952 秒**（后端测试作业因此从 4m58s 变成 18m25s，其中真正跑测试只有 17 秒）。

⚠ 镜像**已经在本地**也躲不掉：日志里明明是 `Status: Image is up to date`，
那 952 秒仍然花在 `docker pull` 上——Docker 要先向 registry 查一次摘要确认
本地这份是不是最新，卡住的正是这一步。所以「预先 pull 好」不是解。

在**运行器宿主**上处理，仓库里改不到：

```bash
# 看当前配的是哪个源
sudo cat /etc/docker/daemon.json
# 换成可靠的源，或直接删掉 registry-mirrors 直连 Docker Hub
sudo systemctl restart docker
```
