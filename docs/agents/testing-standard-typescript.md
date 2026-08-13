# 测试规范：TypeScript / Vue

适用于本仓所有 TypeScript、JavaScript 与 Vue SFC 代码。Python 见 [`testing-standard-python.md`](testing-standard-python.md)，两份的分层、覆盖率口径、闸门策略一致，只是落到各自工具链。

本规范按**公网发布的生产系统**要求编写：任何人在任何时间点从主干拉代码构建出的产物，都应当是可以直接对公网提供服务的。测试是这个承诺的唯一执行机制。

## 0. 工具链基线

| 项 | 取值 |
|---|---|
| 包管理 | `pnpm` workspace（`pnpm-lock.yaml` 必须提交） |
| 测试框架 | `vitest` ≥ 3.2 |
| 组件测试 | `@vue/test-utils` ≥ 2.4 |
| DOM 环境 | `happy-dom`（默认）；`jsdom` 仅在 happy-dom 缺能力时按文件覆盖 |
| 覆盖率 | `@vitest/coverage-v8`，reporter `text-summary` / `html` / `lcov` |
| Lint | `eslint . --max-warnings=0` |
| 类型 | `pnpm -r --if-present typecheck` |
| 组件文档 | Storybook（`@dt/ui`） |

## 1. 测试分层

四层，职责不重叠。

### L1 纯逻辑 —— `*.test.ts`

不依赖 DOM 的逻辑：状态机、求值、坐标换算、协议编解码、store 的纯函数部分。毫秒级。

### L2 组件 —— `*.spec.ts`

挂载真实组件，断言渲染结果与交互行为。

### L3 契约 —— `*.contract.spec.ts`

锁定跨模块、跨包的隐式约定——**违反时类型检查和 lint 都不报错、只会静默失效**的那些。这一层在本仓格外重要，因为 Vue 的几类名字完全没有静态保护：

- **组件 prop 名、事件名、插槽名写错**：typecheck 与 lint 双双放行，运行时静默不生效。
- **图标/组件注册名未登记**：`DtIcon` 传入未注册的名字不报错，只是什么都不渲染。
- **序列化往返**：`pack(unpack(x)) === x`（如绑定配置的 `transform_json`）。
- **后端响应契约**：字段名、可空性、时间格式、数字精度。手写的 TS 类型必须
  逐字段钉在 `openapi.json` 上（见下面的 §5.2.1），否则它只是一份**声称**。
- **持久化字面量**：枚举/常量改名不得改变已落库的值。

### L4 端到端 —— `e2e/`

真实浏览器、真实后端，覆盖关键用户路径，数量控制在两位数以内。

> E2E 框架用 **Playwright**，它同时承担 §7.4 的可访问性检查与 §8 的包体检查。必须在公网发布之前接上。

### 分层配比

参考值：L1 : L2 : L3 : L4 ≈ **60 : 30 : 7 : 3**。E2E 数量超过组件测试是明确的设计问题。

## 2. 布局与命名

**测试一律独立成目录，不与源码同放**，目录镜像 `src/`（去掉 `src/` 这一段）。
理由与结构闸见 [`project-structure-typescript.md`](project-structure-typescript.md) §4.1。

```
web/
├── packages/<pkg>/
│   ├── src/binding.ts
│   ├── src/BindingField.vue
│   ├── src/testing/                ← 测试设施（假 provider 等），已排除出覆盖率统计
│   └── tests/
│       ├── binding.test.ts             ← L1
│       ├── BindingField.spec.ts        ← L2
│       └── binding.contract.spec.ts    ← L3
└── app/
    ├── src/pages/login/LoginPage.vue
    └── tests/pages/login/LoginPage.spec.ts
```

分层靠**文件名后缀**区分，不靠目录：`.test.ts` = L1 纯逻辑，
`.spec.ts` = L2 组件，`.contract.spec.ts` = L3 契约。
E2E 另有 `web/e2e/`（Playwright，不进 vitest）。

- 测试名写**断言的契约**，不写来历：
  - ✅ `it('缺少 node_id 时按 trackKey 回退匹配')`
  - ✅ `it('取消弹窗不落库，草稿丢弃')`
  - ❌ `it('修复 #42 的回归用例')`
- 一个测试一个断言主题。`describe` 分组按被测行为，不按方法名。
- 表驱动优先于复制粘贴：`it.each` 并给可读的用例名。

## 3. 必测清单

以下情形**没有测试就不允许合并**：

1. **任何 bug 修复** —— 先写一条能复现的失败测试，修复前必红。
2. **所有错误与空状态** —— 加载中、请求失败、空列表、部分字段缺失、超长文本溢出。只测理想数据等于没测。
3. **所有边界** —— 空数组、单元素、上限、上限 +1、`0`、`null`/`undefined`、非 ASCII 与 emoji（宽字符会影响布局与截断）。
4. **所有用户可见的交互** —— 点击、键盘、焦点管理、禁用态。
5. **所有跨包契约变更** —— 契约测试先于实现更新。
6. **所有竞态防护** —— 请求序号、防抖、快速切换来源时的旧响应丢弃。凡是带序号竞态防护的加载路径，都必须有一条乱序返回的用例。
7. **所有权限相关的条件渲染** —— 无权限时元素不存在（而非仅仅 `display:none`）。
8. **所有涉及 `v-html` / 富文本 / tooltip 的位置** —— 见 §7.1。

### 明确**不需要**测的

纯转发的一行包装、`index.ts` 桶文件、纯样式常量、Storybook story 本身、第三方库自身行为。为凑覆盖率给这些写测试是负资产。

## 4. 覆盖率要求

### 4.1 分级阈值

| 层级 | 行覆盖 | 分支覆盖 |
|---|---|---|
| 核心逻辑包（绑定、求值、坐标、协议、状态机） | ≥ 95% | ≥ 90% |
| 组件（`.vue`，含 `@dt/ui`） | ≥ 85% | ≥ 75% |
| 页面容器 | ≥ 70% | ≥ 60% |
| **整体闸门** | **≥ 80%** | **≥ 75%** |
| **本次改动的增量覆盖** | **≥ 85%** | **≥ 80%** |

**增量覆盖是最硬的一条**。整体数字有历史包袱，新写的代码没有借口。

### 4.2 棘轮：只许上不许下

整体覆盖率不允许低于目标分支基线——哪怕仍在 80% 之上。这条防的是"大量新代码稀释旧的高覆盖"。

基线在比对时按**行 90% / 分支 80%** 封顶（`check_coverage.py` 的 `CEILING`）：覆盖一度冲到 99% 不会把之后每个 PR 的门槛也锁死在 99%——防稀释守的是水位线，不是历史最高点。

### 4.3 ⚠ 两个会让数字失真的口径问题

1. **`**/index.ts` 与 `**/src/testing/**` 已被排除**（现有配置）。
   覆盖率的 `include` 只收 `**/src/**`，`tests/` 天然不在统计里。排除桶文件与测试设施是对的，但**不允许把真实逻辑塞进 `index.ts` 来躲避统计**。评审时检查被排除文件里是否有分支逻辑。
2. **⚠ 函数覆盖率低不要归咎于口径。** v8 会把模板里每个内联事件处理器
   （`@click`、`v-model` 的 setter、`@saved`）各算一个函数，看着虚高；但它掉下去
   几乎总是因为**某条交互路径根本没人点过**——点查询、切筛选、排序、弹窗保存、
   弹窗取消、失败分支。本仓一度把这一档从 80 降到 55 并写了「口径不可比」，
   后来照着未覆盖清单逐条补交互用例，同一份代码从 67% 直接到 90%：
   缺的不是口径，是写操作的测试。**阈值 85，不许再往下调。**
3. **v8 provider 对 `.vue` 模板的分支计数存在已知口径差异**——模板里的 `v-if`/`v-for` 经编译后再由 sourcemap 映射回来，分支数可能偏乐观。某个组件的分支覆盖数字与直觉严重不符时，用 `--coverage.provider=istanbul` 复核一次再下结论。

### 4.4 配置

阈值写进 `vitest.config.ts`，让本地与 CI 口径一致，不写在命令行里：

```ts
coverage: {
  provider: 'v8',
  reporter: ['text-summary', 'html', 'lcov'],
  reportsDirectory: './coverage',
  include: ['packages/**/src/**/*.{ts,vue}', 'app/src/**/*.{ts,vue}'],
  exclude: [
    '**/tests/**',
    '**/*.stories.ts',
    '**/index.ts',
    '**/*.d.ts',
    '**/src/testing/**',
  ],
  thresholds: {
    lines: 80,
    branches: 75,
    functions: 85,
    statements: 80,
    // 核心逻辑包单独抬高
    'packages/*/src/**/*.ts': { lines: 95, branches: 90 },
  },
},
```

### 4.5 豁免

`/* v8 ignore next */` **必须在同一行或上一行写明理由**。无理由的豁免在评审中直接打回。

## 5. 覆盖率不等于测试质量

覆盖率只证明代码**被执行过**。挂载一个组件不写任何断言就能拿到很高的数字。

### 5.1 禁止的写法

- **无断言测试** —— 只 `mount()` 不检查。
- **快照当断言用** —— 大颗粒快照（整个组件的 DOM）证明不了任何契约，改一点就整体失效，然后被无脑 `-u` 更新。快照只允许用于**小而稳定**的输出，且必须提交进仓、评审时逐行看。行为断言一律显式写。
- **同义反复** —— 用被测逻辑本身算期望值。期望值必须是手写字面量。
- **过度 mock** —— 把协作方全 mock 掉，测的就只剩 mock 配置。mock 只用于**进程外**依赖与真正的重量级装配点。
- **断言实现细节** —— 断言内部方法调用次数、私有 ref 的值。用用户可观察的行为断言（渲染结果、emit、路由变化）。
- **`await nextTick()` 堆叠** —— 靠反复 tick 碰运气等异步完成。用显式等待（`vi.waitFor`、`flushPromises` + 明确的完成信号）。

### 5.2 mock 约定（全仓一套，不要另起）

- **ECharts** 在内部装配点 `shared/chart/echarts` 上 mock，`init` 返回 spy。不要去 mock `echarts` 包本身。
- **store** 用**真 pinia**，通过 `@dt/datasources` 的 `registerProvider` / `__resetProviders` 注入假 provider。不要 mock 整个 store。
- **DtModal** 用 `stubs: { teleport: true }`。
- 每个测试文件头按 [`comment-style-typescript.md`](comment-style-typescript.md) 的规格，一到三行**锁定这个文件在守什么契约**。

### 5.2.1 ⚠ 假件不许比真接口宽松

**造假数据时，只给真接口真的会返回的字段。多给一个都不行。**

宽松的假件是本仓最贵的一类测试谎言：它让「代码读了一个后端根本不返回的字段」
这件事在测试里看不出来，直到线上整页崩掉。真实案例——`GET /users` 的列表项
**不含**权限码数组（只给条数），而假件顺手补上了 `direct_permissions: []`，
于是页面写 `user.direct_permissions.length` 一路绿灯，跑起来 undefined 崩在渲染里。

两条一起做，缺一不可：

1. **手写类型钉在 openapi 上**。用 `Record<keyof T, true>` 把键在**类型层**枚举
   一遍（漏写或多写都过不了 typecheck），再把这份键集与 `openapi.json` 的
   `properties` 比对。类型改了必须改声明，声明改了必须对得上后端，中间漂不了。
   见 `app/tests/contract/openapi-shapes.contract.spec.ts`。
2. **同一资源的不同形状各造各的假件**，命名区分（`listItem()` / `user()`），
   不要一个「全字段」假件通吃列表与详情——那正是宽松假件的来源。

### 5.3 ⚠ 不要盲目打桩宿主 API

**happy-dom 自带 `ResizeObserver` 与 `matchMedia`**——给它们打哑桩是纯冗余，而且这种桩往往带着一句写反了事实的注释，长期误导后来的人。

规则：给任何宿主 API 打桩之前，先确认当前 DOM 环境**是否已经提供**。确实需要的，区分两种意图并写清楚——**哑桩**（只为不报错）与 **spy**（要断言调用）。只有后者有存在价值。

### 5.4 变异测试

核心逻辑包每季度或每次重大改动后跑一轮，验证测试是否真能抓错。存活的变异体要么补测试，要么书面说明为何不值得（如：无公开入口，上锁需为测试改公开接口）。

> ⚠ **安全铁律**：工作区常年有未提交改动。变异流程**绝对不允许**用
> `git checkout` / `restore` / `stash` / `reset` 还原——会抹掉未提交的工作。
> 正确做法：`cp` 备份 → 变异 → 跑 → `cp` 回来 → **立刻复跑确认全绿**，并独立核验还原结果。

## 6. 确定性与隔离

不稳定的测试比没有测试更糟——它训练所有人忽略红灯。

- **时间**：不允许 `Date.now()` / `new Date()` 直接进被测路径。用 `vi.useFakeTimers()` 或注入时钟。
- **随机**：`Math.random` 注入或 `vi.spyOn` 固定。
- **动画/过渡**：不用真实等待，推进假时钟。
- **网络**：测试进程**不允许发起任何真实请求**。CI 中主动阻断，让越界的测试直接失败而不是偶发超时。
- **测试间隔离**：`afterEach` 中 `vi.restoreAllMocks()`、重置 pinia、`__resetProviders()`。测试必须能任意乱序执行。
- **零容忍 flaky**：偶发失败按 **P1** 处理，当天定位；修不了就删掉或 `it.fails` 挂 issue，不允许留在主干靠重跑通过。**CI 不配置自动重试。**

## 7. 面向公网的必测项

### 7.1 XSS 与内容转义

前端是 XSS 的主要落点，以下每处都必须有自动化测试：

- 所有 `v-html` 使用点——注入 `<img src=x onerror=...>`、`<script>`、`javascript:` URL，断言不执行。**每一个 `v-html` 都必须有对应用例**，没有就不允许存在。
- **图表 tooltip 的 formatter**：ECharts tooltip 默认按 HTML 渲染，点位名/单位等用户可控文本直接拼进去即为注入点——这是最容易被漏掉的一处，必须有转义用例。
- 用户可控的 URL（图片地址、跳转链接）：断言 `javascript:` / `data:text/html` 被拒。
- 富文本渲染路径与后端清洗的口径一致性，用契约测试锁定。

### 7.2 认证与权限的前端表现

- 无权限时元素**不存在于 DOM**，而不是仅仅隐藏——隐藏元素仍可被读取和触发。
- token 过期 / 401 / 403 的处理路径各有用例（跳登录、提示、不无限重试）。
- WebSocket 鉴权：token 经子协议传递，与 HTTP 头路径不同，必须单独覆盖；断线重连不得丢失鉴权。

### 7.3 输入与资源上限

- 表单校验的每条拒绝路径至少一条用例。
- 上传体积/类型限制、分页上限、表达式长度与递归深度上限——每条都要有超限被拒的用例。
- 超长文本、宽字符、RTL 文本不破坏布局。

### 7.4 可访问性（公网发布的硬性要求）

- 关键页面接入自动化 a11y 扫描（`axe-core`，可在组件测试或 Playwright 中运行），**严重级问题即失败**。
- 键盘可达：所有交互元素可 Tab 到达，弹窗有焦点陷阱与 Esc 关闭，关闭后焦点归还触发元素。
- 对比度：文本与背景对比度满足 WCAG AA（正文 4.5:1，大字 3:1）。**两个主题下各验一次**——只在一个主题下达标是常见的漏网形态。
- 图标按钮有可访问名称（`aria-label`）。

## 8. 性能与包体

- **首屏包体预算**：设定明确上限（如首屏 JS gzip ≤ 300 KB），CI 中超限即失败。**没有闸门，包体只会单调增长**——它是那种每次只多几 KB、半年后翻倍的指标。
- 重依赖（3D、图表、编辑器）必须异步加载，有测试或构建产物断言证明其不在首屏 chunk 中。
- 长列表/大数据量渲染走虚拟化，有对应用例。

## 9. CI 闸门

> ⚠ **CI 必须在第一次对外发布之前建立。** 在那之前，上述所有阈值都只是约定——而只是约定的阈值等于没有阈值。

合并到主干前，以下检查**全部**必须通过，任一失败即阻断：

| 闸门 | 命令 | 失败即阻断 |
|---|---|---|
| 格式 | `pnpm format:check` | ✅ |
| Lint | `pnpm lint`（`--max-warnings=0`） | ✅ |
| 类型 | `pnpm typecheck` | ✅ |
| 单元 + 组件 + 契约 | `pnpm test` | ✅ |
| 覆盖率阈值 | `pnpm test:coverage` | ✅ |
| 覆盖率棘轮（不低于基线，基线按 90%/80% 封顶） | 与目标分支基线比对 | ✅ |
| 增量覆盖 ≥ 85% | `diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=85` | ✅ |
| 构建 | `pnpm build` | ✅ |
| 包体预算 | 产物体积比对 | ✅ |
| 依赖漏洞 | `pnpm audit --audit-level=high` | ✅ 高危 |
| 机密扫描 | `gitleaks detect` | ✅ |

⚠ **`pnpm build` 不能省，它是 SFC 里 `<style lang="scss">` 的唯一编译者。**
vitest 挂载组件时不编译 scoped 样式块，所以一段花括号不配对的 SCSS 能一路通过
format / lint / typecheck / 全部用例，只在 build 时才炸。本仓真踩过。

E2E、a11y 全站扫描、变异测试不进 PR 闸门（太慢），进**每日定时**流水线，失败开 issue。

本仓已有 `web/.githooks`（`prepare` 脚本会设置 `core.hooksPath`）。钩子用于快速反馈，**不能替代 CI**——钩子可被 `--no-verify` 绕过。

### 本地命令速查

> Node 经 nvm 安装，非交互 shell 中需先补 PATH 前缀再执行 `pnpm`。

```bash
# 全量
pnpm test

# 覆盖率
pnpm test:coverage

# 单个文件
pnpm vitest run packages/binding/src/binding.test.ts

# 单条用例
pnpm vitest run -t '缺少 node_id 时按 trackKey 回退匹配'

# 监听
pnpm test:watch

# 覆盖率口径复核（v8 数字可疑时）
pnpm vitest run --coverage.enabled --coverage.provider=istanbul
```

## 10. 定义完成（DoD）

一处改动算完成，当且仅当：

1. 新增/修改的行为都有对应层级的测试，且测试名说明的是契约。
2. 若为缺陷修复，存在一条修复前必红的用例。
3. 增量覆盖 ≥ 85%，整体覆盖率不低于基线（封顶后）。
4. 错误态、空态、边界、权限分支均已覆盖。
5. 新增的 `v-html` 与 tooltip formatter 均有转义用例。
6. 无新增 `skip` / 无理由的 `v8 ignore` / 无新增大颗粒快照。
7. 全部 CI 闸门绿灯，且**未使用重试**。
8. 若改动触及跨包契约，契约测试已同步更新，且更新在实现之前。
