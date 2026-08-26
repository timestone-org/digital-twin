# 项目结构：TypeScript / Vue

适用于 `web/` 前端工作区。Python 服务见 [`project-structure-python.md`](project-structure-python.md)。

`web/` 是一个 pnpm workspace，在仓库的上下文划分里**整体算一个上下文**——一份 `CONTEXT.md` 覆盖全部前端。内部则按能力切成若干个 `@dt/*` 包，加一个应用壳。

## 1. 工作区全景

```
web/
├── package.json            ← 工作区根：脚本入口（dev/build/test/lint/format）
├── pnpm-workspace.yaml     ← 成员声明
├── pnpm-lock.yaml          ← 必须提交
├── tsconfig.base.json      ← 共享编译选项，各包 extends 它
├── vitest.config.ts        ← 全仓单一测试配置（含覆盖率口径）
├── eslint.config.js        ← 扁平配置，全仓一份
├── CONTEXT.md              ← 前端通用语言
├── README.md
├── docs/                   ← 前端长篇设计文档
│   └── adr/                ← 前端上下文内的架构决策
│
├── packages/               ← 可复用能力，见 §2
│   ├── contracts/          ← 类型与常量契约（零依赖）
│   ├── tokens/             ← 设计令牌（零依赖）
│   ├── security/           ← 权限判定（零依赖）
│   ├── twin-config/        ← 孪生场景配置
│   ├── datasources/        ← 数据源与 provider 注册
│   ├── ui/                 ← 基础组件库
│   ├── three-core/         ← 3D 渲染内核
│   ├── twin2d/             ← 2D 孪生文档契约与渲染件
│   ├── modules/            ← 大屏组件模块
│   └── runtime/            ← 运行态装配
│
└── app/                    ← @dt/app 应用壳，见 §3
```

## 2. 包的分层与依赖方向

内部依赖是一张**有向无环图**，分四层。箭头表示"允许依赖"，反向即违规：

```
 L0  零依赖          contracts        tokens        security
                        │               │              │
                        ├───────┬───────┤              │
 L1  基础             twin-config   datasources       ui ─┐
                        │                              │  │
                        └──────────┬───────────────────┘  │
 L2  领域能力       three-core ─┬──▶ modules ─────────────┘
                        twin2d ─┘
                                              │
 L3  运行态                                runtime
                                              │
 L4  应用壳                                  app
```

实际依赖表（与代码一致）：

| 包 | 依赖 |
|---|---|
| `@dt/contracts` | —— |
| `@dt/tokens` | —— |
| `@dt/security` | —— |
| `@dt/twin-config` | contracts |
| `@dt/datasources` | contracts |
| `@dt/ui` | contracts, tokens |
| `@dt/three-core` | contracts, tokens, twin-config, ui |
| `@dt/twin2d` | contracts, ui |
| `@dt/modules` | contracts, three-core, tokens, twin-config, twin2d, ui |
| `@dt/runtime` | contracts, modules, security, ui |
| `@dt/app` | 全部 |

四条铁律：

1. **不许成环**。新增依赖前先看上表，只能向上依赖。
2. **`packages/*` 不许依赖 `app/`**。应用壳是终点，任何被包需要的东西都说明它该下沉。
3. **只能从包的公开导出入口引用**（`@dt/ui`），不许深链到内部路径（`@dt/ui/src/components/Foo.vue`）。深链会绕过包的公开面，让重构变成破坏性变更。
4. **零依赖层保持零依赖**。`contracts` / `tokens` / `security` 一旦长出依赖，整张图的底座就塌了。

## 3. 应用壳的内部结构

```
app/src/
├── main.ts             ← 挂载入口，尽量薄
├── App.vue
├── env.d.ts
├── bootstrap/          ← 启动装配：插件注册、provider 注入、全局错误处理
├── router/             ← 路由表与守卫
├── pages/              ← 路由级页面，一个路由一个目录
├── features/           ← 跨页面的业务特性（比 page 大、比 package 小）
├── components/         ← 应用内共用组件（够通用就该下沉到 @dt/ui）
├── composables/        ← 应用内共用组合式函数
├── stores/             ← pinia store
├── api/                ← HTTP 客户端与接口封装
├── runtime/            ← 运行态适配（与 @dt/runtime 对接）
├── config/
├── styles/
├── types/
└── utils/              ← 无状态纯函数
```

### 3.1 pages / features / components 怎么分

这是最容易糊掉的一处，判据是**复用范围**：

| 放哪 | 判据 |
|---|---|
| `pages/<Route>/` | 只服务于一个路由，不被别处引用。主组件 `index.vue`，私有子组件放同目录 `components/` |
| `features/<name>/` | 被两个以上页面共用，且含业务语义与状态 |
| `components/` | 被两个以上位置共用，但**无业务语义**（纯展示/交互） |
| `packages/ui` | 跨应用可复用，且与本项目业务完全解耦 |

一个东西从 `pages/` 升到 `features/` 再下沉到 `packages/`，是正常演进路径。**不要预先建包**——先放在最窄的作用域，出现第二个消费者时再上移。

### 3.2 页面目录

**一个路由一个目录，目录名 `PascalCase`；页面主组件固定叫 `index.vue`；
只服务本页面的子组件放本目录的 `components/`，脚本放本目录的 `scripts/`。**

```
pages/
├── Login/
│   ├── index.vue               ← 路由组件，固定这个名字
│   └── components/
│       └── LoginBrandPanel.vue ← 只服务登录页，不外泄
├── Datasets/
│   ├── index.vue
│   ├── components/             ← 只放 .vue
│   └── scripts/                ← 只放 .ts：组合式函数与纯逻辑都在这里
│       ├── datasetColumns.ts
│       └── useDatasetList.ts
└── NotFound/
    └── index.vue
```

五条约定：

1. **主组件名固定 `index.vue`**。让「路由 → 文件」是一条机械映射：
   路由 `/datasets` 对应 `pages/datasets/index.vue`，不用记这个页面当初
   叫 `DatasetListPage` 还是 `DatasetsPage`。路由表里因此也只写目录，
   `import('@/pages/datasets')` 即可。
2. **页面私有组件只放本目录的 `components/`**。它们出现在 `app/src/components/`
   就等于宣称「可复用」，而实际上没有第二个消费者——下一个人会照着改它，
   然后两个页面一起坏。出现第二个消费者时再上移（§3.1）。
3. **一个目录只服务一个路由**。`pages/Errors/` 里塞 403 与 404 两个页面
   是常见的偷懒，代价是这个目录再也无法与某条路由对应。
   同前缀的一批路由可以放进**分组目录**（`pages/System/Users/`、
   `pages/System/Roles/`）：分组目录自己没有 `index.vue`，只装子页面目录
   与它们共用的 `components/`、`scripts/`。
4. **目录名用 `PascalCase`**——这是 §5「目录一律 kebab-case」的**唯一例外**：
   页面目录代表的是一个组件（`Login/index.vue` 就是 `Login` 组件），
   与 `PascalCase.vue` 的组件文件同一档，写成 `login/` 会让它在文件树里
   与 `composables/`、`components/` 这些「装东西的目录」混成一类。
   路由路径仍是小写连字符（`/not-found` ↔ `pages/NotFound/`）。
5. **页面的 `.ts` 一律收在本目录的 `scripts/`**——组合式函数与纯逻辑同一个
   文件夹，不按 `composables/` 与 `utils/` 再切一刀。判据是**归属**而不是
   形态：这个文件只服务这一个页面。切了之后每加一个文件都要先判一次
   「它算不算组合式函数」，而 `useX.ts` 这个前缀本来就已经把形态说清楚了。
   页面根目录与 `components/` 下都不许再出现 `.ts`：一个页面动辄三四十个
   文件，混在一起时「哪个是组件、哪个是逻辑」只能靠文件名猜。
   分组目录的共用脚本归它自己的 `scripts/`，不塞进任何一个子页面。

对应的测试在 `app/tests/pages/<Route>/`（目录名同样 `PascalCase`，镜像 `src/`），
**不与源码同目录**，见 §4.1。

## 4. 包的内部结构

```
packages/<pkg>/
├── package.json        ← name: @dt/<pkg>，exports 定义公开面
├── tsconfig.json       ← extends ../../tsconfig.base.json
├── src/
│   ├── index.ts        ← 唯一公开出口，桶文件，不写逻辑
│   ├── <domain>.ts
│   ├── <Component>.vue
│   └── testing/        ← 供其它包消费的测试设施（假 provider 等）
└── tests/              ← 本包的**全部**测试，目录镜像 src/，见 §4.1
```

关于 `src/testing/`：它住在 `src/` 下是为了能被其它包经包导出复用，但它是**测试设施而非被测代码**——已在覆盖率统计中排除，生产代码引用它由 ESLint 拦截。

`@dt/ui` 另有两处只服务于组件展示的目录，同样**不进 `src/`**：`.storybook/`（Storybook 装配与画布皮肤）与 `stories/`（一个组件一份 `<组件名>.stories.ts`）。理由与 §4.1 的测试同构：`src/` 下只留会被打包的东西。⚠ story 里的组件与 args 在 typescript-eslint 眼里是 `any`（`.vue` 的模块只有 vue-tsc 解析得出来），所以 `eslint.config.js` 对 `**/stories/**` 关掉了 `no-unsafe-*` 那一族——真正的类型检查由 `pnpm typecheck` 里的 vue-tsc 做，`stories/` 已并入 `packages/ui/tsconfig.json` 的 `include`。

关于 `index.ts`：**只做转出，不写逻辑**。它已被排除出覆盖率统计，往里塞逻辑等于把代码藏进统计盲区。

### 4.1 测试一律独立成目录，不与源码同放

每个成员（包与应用壳）把自己的测试全部收在自己的 `tests/` 下，
**目录结构镜像 `src/`**（去掉 `src/` 这一段）：

```
packages/security/
├── src/permissions.ts
└── tests/permissions.test.ts

packages/ui/
├── src/components/DtIcon/DtIcon.vue
└── tests/components/DtIcon.contract.spec.ts

app/
├── src/pages/login/LoginPage.vue
└── tests/pages/login/LoginPage.spec.ts
```

理由：

- **`src/` 下只剩会被打包的东西**。同放时「哪些文件进产物」要靠构建工具的
  glob 排除来回答，排除写漏就是把测试连同它 import 的 fixture 一起打进产物。
- **覆盖率与结构闸的口径变简单**：`include: src/**` 与 `exclude: tests/**` 各管一边，
  不必在同一棵目录树里用文件名后缀区分被测代码与测试代码。
- **与后端左右对称**。Python 侧本来就是 `tests/` 镜像被测包路径
  （见 [`testing-standard-python.md`](testing-standard-python.md) §2），
  两边同构，人在两个世界之间切换时不用换一套习惯。

⚠ 这条由结构闸执行：`src/` 下出现 `*.test.ts` / `*.spec.ts` 即失败。

### 4.2 先用 `@dt/ui`，缺了先扩展组件库

**页面与应用内组件要用的通用交互件，一律先在 `@dt/ui` 里找；没有就先把它加进
`@dt/ui`，再在页面里用。不许在页面里手搓一个本该通用的控件。**

判据是**这个东西是否带业务语义**：

| 要写的东西 | 去哪 |
|---|---|
| 按钮、输入、下拉、勾选、弹窗、标签、空态、加载态 | `@dt/ui`，页面直接用 |
| 「用户表单弹窗」「角色权限树」这类**带业务语义**的组合件 | 页面自己的 `components/` |

这条同样约束 `@dt/ui` **内部**：`DtModal` 的关闭按钮用 `DtButton`，
不要在里面另写一个 `<button>`。库内自造一个只有它自己用的按钮，
意味着同一套焦点环、禁用态、按压反馈在仓里出现第二份，
而两份之间的差异只有把它们摆在一起才看得出来。

⚠ 这条闸不好自动化（「本该通用」是判断题），因此它是**评审项**：
PR 里出现新的 `<button>` / `<input>` / `<select>` 原生标签，
要么说明它为什么不通用，要么改成扩展 `@dt/ui`。

#### 列表一律走 `DtDataView`，不许手写 `<table>`

**页面里不许再出现 `<table>`。** 列表统一用 `@dt/ui` 的 `DtDataView`：
一套列定义 + 一套 `cell-<key>` 插槽，喂给表格与卡片两种呈现，用户可就地切换。

| 要什么 | 用什么 |
|---|---|
| 一份数据、要能表格 / 卡片切换 | `DtDataView` |
| 只要表格（外面已有别的容器与三态） | `DtTable` |
| 面板外框（底色 + 描边 + 圆角，可选四角角标） | `DtCard` |
| 取数三态（加载 / 出错 / 空 + 重试） | `DtPageState` |
| 行内提示（操作反馈、失败原因） | `DtNotice` |
| 同一块内容的呈现切换（**不是导航**） | `DtSegmented` |

理由：手写表格必然各写各的——列宽、表头字号、行分隔、hover、sticky、空态
在四张表上会长出四个样子，而这种参差要把两页并排才看得出来。卡片视图更是如此：
两种呈现各写一份，一定会出现「表格里改了、卡片里忘了改」。

⚠ **`cell-<key>` 插槽名拼错不会报错**：多出来的插槽 Vue 直接忽略，缺掉的那一列
静静渲染成 `—`。由 `app/tests/contract/data-view-slots.contract.spec.ts` 双向锁死
（插槽必须对得上列、每一列必须有插槽）。

⚠ 展示方式要**按页记住**（`useViewMode`），否则切换器每次进页面都弹回默认值。

#### 页面一律铺满可用宽度

**`AppShell` 的主内容区没有「限宽居中」开关，页面不许自己再套一层 `max-w-*` 收窄整页。**

有开关就一定会出现一半页面限宽、一半页面铺满：在同一套导航下来回切换时，
整块内容会左右跳一下，而这种不一致在单看某一页时完全看不出来——本仓就是这么
攒出「用户管理铺满、角色管理不铺满」的。

要控制可读行宽，在**页面自己的栅格里**做：加列（`lg:grid-cols-2`、`xl:grid-cols-3`）、
或只给某个卡片限宽。不要收窄整页。

⚠ 由结构闸执行（§7 第 11 条）：`AppShell` 上出现宽度类 prop、或页面根上出现
`max-w-` 即失败。

#### 页面自己吃满高度，滚动在列表内部

`AppShell` 的 `<main>` 是 `overflow-hidden`，**它不再是滚动容器**。整条链路：

```
AppShell <main>            flex 列 + overflow-hidden
  └ 页面根节点              h-full flex flex-col min-h-0   ← 页面自己写
      └ DtDataView          flex-1 min-h-0，表体/卡片网格内部滚动
          └ 分页器           固定在底部，不跟着滚
```

⚠ 页面根节点漏了 `h-full` 或 `min-h-0`，表格就拿不到有界高度：不是滚动而是
一路撑长，超出的部分被 `main` 裁掉，**页面上任何位置都没有滚动条**，
后面的行永远够不着。由结构闸执行（§7 第 12 条）。

⚠ 一页里若干个分组各一张小表（权限目录那种）要给 `:fill="false"`，
否则每张小表都去抢高度；滚动改由页面自己那层容器承担。

#### 反馈一律走两个全局模块

| 场景 | 用什么 |
|---|---|
| 写操作成功 / 失败、会话过期这类**瞬时**反馈 | `useToast()`（`DtToastHost` 已挂在 App.vue） |
| 删除、停用这类**不可逆或影响他人**的操作 | `await useConfirm().ask({ danger: true, … })` |
| 表单**就地**的校验与结果（紧挨着输入框） | `DtNotice` |

⚠ **不许用 `window.confirm` / `alert`**：它们是浏览器皮肤，和这套深色工业风格格不入，
文案也塞不下「会发生什么、能不能撤销」。确认文案要写清后果，`确认删除？` 等于没写。

⚠ `useConfirm().ask()` 返回 Promise，**除「确定」外的所有关闭路径都 resolve 为 false**。
自己写弹窗时漏掉某条关闭路径，表现是「点了删除没反应」——调用方的 await 永远挂着。

### 4.3 Tailwind 只在应用壳里用

**`app/` 可以用 Tailwind 工具类写样式；`packages/*` 一律不许，
组件的皮肤只能是 scoped SCSS + `@dt/tokens` 的 CSS 变量。**

| 位置 | 样式手段 |
|---|---|
| `app/src/pages/**`、`app/src/components/**` | Tailwind 工具类为主，写不出来的（伪元素、关键帧、复杂渐变）落 scoped SCSS |
| `packages/ui/**` 及其它包 | **只有** scoped SCSS，取值一律 `var(--…)` |

理由：

- **包要能脱离本应用活着**。`@dt/ui` 挂进 Storybook 或别的宿主时，那边不一定
  装 Tailwind、也不一定是同一份配置；组件一旦依赖工具类，换个宿主就是裸奔。
- **页面侧相反**：页面本来就只服务这个应用，用工具类能少写大量一次性的
  scoped 样式块——那些块每多一个，产物里就多一段只用一次的 CSS。
- 两边的**设计值是同一份**：Tailwind 的颜色/字体/圆角由 `app/src/styles/tailwind.css`
  的 `@theme inline` 桥接到同一批 `--…` 变量上，所以换肤对两边同时生效。

⚠ 由结构闸执行：`packages/` 下出现 `@tailwind` / `@apply` / `tailwindcss` 依赖即失败。

#### Tailwind 入口必须是独立的 `.css`

样式表一律 SCSS，**只有一个例外**：`app/src/styles/tailwind.css`。

```
app/src/styles/
├── tailwind.css        ← 唯一的纯 CSS：@import 'tailwindcss' + @theme 桥接
├── index.scss          ← Sass 侧入口：@use tokens / base / animations / components
├── _base.scss          ← 整份包在 @layer base 里
├── _components.scss    ← 整份包在 @layer components 里
├── _animations.scss    ← 同上
└── _tokens-bridge.scss ← 断点与混入，不含设计值
```

`main.ts` 里 **`tailwind.css` 必须先于 `index.scss`**。

⚠ **`@import 'tailwindcss'` 绝不能写进 `.scss`。** Sass 会把它当成自己的导入，
直接把 `node_modules` 里那份**静态** CSS 内联进来，`@tailwindcss/vite` 于是根本
看不到入口、一个工具类都不生成——页面全裸，而 `build` / `lint` / `typecheck` /
测试**全部照常通过**，只有肉眼能发现。

⚠ **全局样式必须包进 `@layer`。** 不分层的规则在级联里永远赢过任何 `@layer`，
`_base.scss`／`_components.scss` 会静默压掉页面上的 Tailwind 工具类，
而 devtools 里看不出是谁赢的。层的先后由**首次出现**决定，这就是上面那条
import 顺序的意义。

⚠ **`@theme` 桥接同名 token 时必须写 `inline`。** 普通 `@theme` 会把键原样写进
`:root`，而字体与圆角的键名和 `@dt/tokens` 的 token 同名
（`--font-sans` / `--radius-md` …），写进去就是自引用、整条声明作废——
字体回落到浏览器默认、圆角变直角，同样没有任何报错。

⚠ 上面四条由结构闸执行（§7 第 9 条）。

## 5. 命名约定

| 对象 | 约定 | 例 |
|---|---|---|
| 包名 | `@dt/<kebab-case>` | `@dt/three-core` |
| 组件文件 | `PascalCase.vue` | `PointPickerPanel.vue` |
| 页面目录 | `PascalCase`，一个路由一个 | `pages/NotFound/` |
| 页面主组件 | 固定 `index.vue` | `pages/Login/index.vue` |
| 组合式函数 | `useXxx.ts` | `useBrowseTree.ts` |
| 纯逻辑模块 | `camelCase.ts` | `pickerState.ts` |
| store | `<domain>.ts`，导出 `useXxxStore` | `datasources.ts` |
| 类型/契约 | `<domain>.ts`，只出类型与常量 | `binding.ts` |
| 纯逻辑测试 | `<被测>.test.ts` | `pickerState.test.ts` |
| 组件测试 | `<被测>.spec.ts` | `PointPickerPanel.spec.ts` |

目录用 `kebab-case`（`point-binding/`），组件文件用 `PascalCase`；
**`pages/<Route>/` 是唯一例外，用 `PascalCase`**（§3.2）。
**测试文件一律放在成员自己的 `tests/` 下**，目录镜像 `src/`，见 §4.1。

## 6. 放置决策树

新写一段代码时，从上往下问：

1. 它是**类型或常量**、且被多方共享吗 → `@dt/contracts`
2. 它是**颜色/间距/字号**等设计值吗 → `@dt/tokens`
3. 它与本项目业务无关、可给别的产品用吗 → `@dt/ui` 或对应能力包
4. 它被**多个页面**使用且带业务语义吗 → `app/src/features/`
5. 它被多处使用但**没有业务语义**吗 → `app/src/components/`
6. 以上都不是 → 放在使用它的那个 `pages/<route>/` 里

**默认放最窄的作用域**。上移的代价是一次移动，预先放宽的代价是一个没人敢改的公共模块。

## 7. 结构自检

以下应有自动化检查，失败即阻断合并：

1. **依赖成环检测**：`madge --circular` 或等价物。
2. **分层违规**：ESLint `import/no-restricted-paths` 禁止 `packages/*` 引用 `app/`，禁止跨层反向依赖。
3. **禁止深链**：ESLint 规则禁止 `@dt/*/src/**` 形式的 import。
4. **生产代码不得引用 `src/testing/**`**。
5. **`src/` 下不得出现 `*.test.ts` / `*.spec.ts`**（§4.1）。
6. **`pages/` 下每个目录都是 `PascalCase` 且含 `index.vue`**（§3.2）。
7. **`packages/*` 不得使用 Tailwind**（§4.3）。
8. **`index.ts` 无逻辑**：桶文件只允许 `export` 语句。
9. **Tailwind 入口独立成 `.css`**：`.scss` 里不得出现 `@import 'tailwindcss'`，
   除入口外不得有别的 `.css`，且 `main.ts` 里入口排在 `index.scss` 之前（§4.3）。
10. **`app/src/pages/**` 不得出现 `<table>`**：列表一律走 `DtDataView`（§4.2）。
11. **页面不得收窄整页**：`content-width` 之类的 prop 与页面根上的 `max-w-` 都不许有；
    也不许用 `window.confirm` / `alert`（§4.2）。
12. **套了 `AppShell` 的页面根节点必须 `h-full` + `min-h-0`**（§4.2）。

## 8. 反模式

- **`utils/` 变垃圾场**：无法归类就丢进 `utils`。一个函数若带业务语义，它属于某个 feature 或包，不属于 `utils`。
- **预先建包**：为"将来可能复用"先建一个 `@dt/xxx`。没有第二个消费者的包只是多了一层目录和一份 tsconfig。
- **深链绕过公开面**：`import Foo from '@dt/ui/src/...'`。包的公开面失效后，任何内部重构都变成破坏性变更。
- **桶文件里写逻辑**：`index.ts` 顺手加个 helper——它在覆盖率盲区里。
- **组件里直接发请求**：HTTP 调用集中在 `app/src/api/` 与 store，组件只消费。
- **按技术类型建顶层目录**：不要出现 `all-components/`、`all-types/`。`app/src/` 下的技术分层是既有约定，**包内**则按领域切。
- **样式散落**：设计值一律来自 `@dt/tokens`，组件内不写硬编码色值——主题切换时硬编码色是第一个出问题的地方。
