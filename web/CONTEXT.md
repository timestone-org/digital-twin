# web 上下文

前端整体算**一个上下文**。内部按能力切成若干 `@dt/*` 包，加一个应用壳。

---

## 1. 通用语言

前后端**同一个概念只能有一个名字**：后端 `node_key`，前端就叫 `nodeKey`，不叫 `pointId`。

| 词         | 指什么                                                               |
| ---------- | -------------------------------------------------------------------- |
| **权限码** | 与后端逐字相同的字符串，如 `user:grant`。类型来自 `@dt/contracts`    |
| **闸 3**   | 前端门禁（路由守卫 + `PermGuard`）。**只决定给不给点，不是安全边界** |
| **信封**   | 后端统一响应体 `{code,message,data,trace_id}`                        |
| **令牌对** | access + refresh。刷新一次即轮换两枚                                 |

## 2. 包与依赖方向

结构选择与取舍见 [`web/docs/adr/0001`](docs/adr/0001-前端采用source-only-pnpm-workspace.md)。

```
L0  零依赖     contracts    tokens    security
L1  基础                      ui
L2  应用壳                    app
```

| 包              | 内容                                                          | 依赖              |
| --------------- | ------------------------------------------------------------- | ----------------- |
| `@dt/contracts` | 后端类型、错误码、权限码、控件轴                              | ——                |
| `@dt/tokens`    | 设计 token（`tokens.scss`）、主题预设与注入引擎、运行时读取面 | ——                |
| `@dt/security`  | 权限判定、令牌解析、登录态存储与跨标签同步                    | ——                |
| `@dt/ui`        | 基础组件（DtButton / DtInput / DtField / DtIcon / DtSpinner） | contracts, tokens |
| `@dt/app`       | 应用壳：路由、store、页面                                     | 全部              |

四条铁律：不许成环；`packages/*` 不许依赖 `app/`；只从包的公开出口引用，
不许深链 `@dt/ui/src/...`；零依赖层保持零依赖。

## 3. 样式

**一律 SCSS，不写纯 CSS——只有一个例外：`app/src/styles/tailwind.css`。**

```
app/src/styles/
├── tailwind.css        ← 唯一的纯 CSS：@import 'tailwindcss' + @theme 桥接
├── index.scss          ← Sass 侧入口：@use tokens / base / animations / components
├── _base.scss          ← 包在 @layer base
├── _components.scss    ← 包在 @layer components
├── _animations.scss    ← 同上
└── _tokens-bridge.scss ← 断点与混入
```

`main.ts` 里 **tailwind.css 必须先于 index.scss**，级联层的先后由此确定。

- ⚠ **`@import 'tailwindcss'` 绝不能写进 `.scss`**：Sass 会抢在
  `@tailwindcss/vite` 之前把 node_modules 里那份**静态** CSS 内联掉，插件看不到
  入口、一个工具类都不生成——页面全裸，而 build / lint / typecheck / 测试
  **全绿**。本仓真踩过，现由结构闸挡住。
- ⚠ 全局样式**必须包进 `@layer`**：不分层的规则永远赢过任何 `@layer`，
  会静默压掉页面上的工具类。
- ⚠ `@theme` 桥接与 token 同名的键（`--font-sans` / `--radius-md` …）
  **必须写 `inline`**：普通 `@theme` 会把键写进 `:root`，同名即自引用、整条作废。
- 设计值全部来自 `@dt/tokens` 的 CSS 变量，组件内**不写硬编码色值**——
  换肤时硬编码色是第一个出问题的地方。
- `@dt/ui` 的三档控件尺寸由 `packages/ui/src/styles/_control.scss` 的 mixin 统一给：
  各组件各抄一遍会出现「同一档不同高、不同字号」的静默漂移。
- app 侧的断点与共用混入在 `app/src/styles/_tokens-bridge.scss`。
- ⚠ `@keyframes` 定义在全局 `_animations.scss`，**不放 SFC 的 scoped 块**：
  scoped 会给块内 keyframes 改名加 hash，跨组件复用必然失配。

### 3.1 换肤

```
顶栏 ThemeSwitcher ── setPreference(id | null)
      ↓
useThemePreference（模块级单例，偏好写 localStorage `dt.theme`）
      ↓ resolvedId：null 时按 prefers-color-scheme 解析
useGlobalTheme ── applyTheme(document.documentElement, id)
      ↓ 在文档根写内联 CSS 变量，覆盖 tokens.scss 的 :root
整个应用（含不套壳的登录页与错误页）跟着变
```

预设定义在 `packages/tokens/src/themePresets.ts`，`themeEngine.ts` 的
`TOKEN_CSS_VAR` 是 token 路径到 CSS 变量的唯一桥接表。

四条容易踩的：

1. **默认深色 `dark-tech` 是 `isRootDefault`**：注入时逐项 `removeProperty`
   而不是写一遍相同的值，故默认态下根上一个主题变量都不留 = 与不换肤时逐像素一致。
2. **`-rgb` 伴生变量只在取值是 `#hex` 时同步**。给 `rgba()` 会让
   `rgba(var(--x-rgb), α)` 的消费方静默回落到 `:root` 的深色三元组——页面不报错，
   只是颜色不对。由 `themePresets.contract.spec.ts` 守。
3. **派生变量不用管**（`--card-bg: var(--surface-panel)`、
   `--border-focus: var(--accent-primary)`…）：CSS 自定义属性在取用处解析，
   改了源变量它们自动跟随。反过来，**没有任何主题够得着的颜色是死色**，
   换成浅色后会孤零零留一块深青——同一个契约测试守这条。
4. **`color-scheme` 必须跟着 mode 走**，引擎在根上一并写。不写的话浅色主题下
   原生滚动条、下拉、日期选择器与自动填充底色统统还是深色皮肤，且不报任何错。

### 3.2 单屏主题

大屏的 `themeJson.__base` 保存内置主题 id；缺失、空值或未登记的 id 表示
**跟随系统当前主题**。编辑器「页面」设置修改元数据草稿，点击保存后随大屏持久化。
独立主题只注入画布、预览或运行页的宿主元素，不修改用户偏好与文档根；公开大屏
使用同一份配置。嵌入时，已设置的单屏主题优先，未设置则跟随嵌入页的主题。

局部主题必须完整注入默认值、附加变量和派生别名；不能沿用全局默认主题的
「移除内联值」做法，否则会继承祖先的另一套配色。恢复跟随系统时移除局部覆盖。

### 3.3 字体

应用壳从 `@dt/tokens/fonts.scss` 自托管 HarmonyOS Sans SC，正文与标题的语义
token 都以它为首选；系统等宽体继续只服务代码、密钥、地址与公式等技术文本。
报告正文、文本块与 2D 图元里由用户显式指定的字体属于内容配置，优先于应用缺省。

大屏读数单独消费 `--font-digit`。整屏缺省存
`chromeJson.card.digitFont`，节点可用 `configJson.__cardStyle.digitFont`
覆盖；运行时只在对应 `.dt-module` 内改写读数字体，所以管理页面与相邻模块不受
影响。可用 id、面板标签与字体 token 映射的唯一目录是
`@dt/contracts.DASHBOARD_DIGIT_FONT_OPTIONS`；id 一旦落库不改名，未知 id
回退默认字体，实际字体栈只定义在 `@dt/tokens`。DS-Digital 随包加载且只覆盖
有限字符，缺少的中文、单位与符号逐字回退默认字体；商业交付前必须完成其授权。

## 4. 认证链路

刷新令牌的跨标签并发决策见 [`web/docs/adr/0002`](docs/adr/0002-刷新令牌跨标签串行化.md)。

```
LoginPage → auth store.login → POST /api/v1/auth/sessions
                              ↓ 令牌 + 用户（含权限码）写 localStorage
路由守卫 ── 未登录 → /login?returnUrl=…
        ├─ 令牌将过期 → store.refresh()（标签内合并 + 跨标签排他）
        └─ 权限不足 → /forbidden
api client ── 401 → 先 refresh 再重试一次 → 仍失败才登出
别的标签 ── storage 事件 → 换了令牌跟着换，登出跟着登出
```

四条容易踩的：

1. **轮换必须串行**：刷新令牌一次性，服务端换出新的就把旧的拉黑。标签内靠
   `inFlightRefresh` 合并并发，标签之间靠 `withSessionLock` 排他且进临界区先
   重读存储；少一层就会有标签拿着已作废的那枚去换，被判成重放后静默登出。
2. **别的标签动过登录态要跟上**：`subscribeSessionChange` 收 `storage` 事件。
   事件里的 `newValue` 可能已过时，回调一律重读存储，不信事件载荷。
3. **回跳只允许站内相对路径**（`safeReturnTarget`），否则是开放重定向。
4. **失败提示按错误码分支，不按 message**——文案会改、会翻译。

### 4.1 API Key 嵌入会话

任意受支持的业务页面可在原 URL 上带 `token=<API Key>&theme=<主题 id>` 首航。
路由守卫把 API Key 复制进内存并启动
`POST /api/v1/auth/sessions:from-api-key` 后，立即从地址栏移除 `token`，
保留主题并写入非敏感的 `embed=1`；清理后的第二航会等换票结束，
只在拿到五分钟 access token 与用户权限后才放行业务页。完整接入示例见
[`README.md`](README.md)。

嵌入链路有六条不变量：

1. **API Key、短期令牌与用户都只活在当前文档内**，不读、写或删除普通登录态的
   `dt.auth.*` localStorage；嵌入页刷新后凭据已经丢失，必须由宿主重新加载原始地址。
2. `embed=1` 在嵌入态站内跳转时自动保留，防止新路径刷新后误采用同源普通账号。
3. 嵌入续租仍用内存里的 API Key 重走交换端点；失败由全局嵌入错误页接管，绝不跳
   `/login`，也不清同源普通用户的会话。
4. `/profile`、`/system/**`、登录/公开/错误页不支持嵌入；其余业务页仍按 API Key
   所属用户的权限码执行闸 3，后端闸门照常是真正安全边界。
5. 嵌入主题优先于用户偏好，只写当前 iframe 的 `documentElement` 且不持久化；外壳
   隐藏全局导航与主题切换器，但保留页面自己的业务 sidebar。
6. 有限期与永久 API Key 均可嵌入；协议跟随页面环境，HTTP 走 WS，HTTPS 走
   WSS，前端不做 scheme 门禁。完整风险边界见根 ADR-0051。

## 5. 组件与样式约定

- **先用 `@dt/ui`**：页面要用的通用交互件先在库里找，没有就**先扩展库**再用；
  库内部同理（`DtModal` 的关闭按钮用 `DtButton`）。带业务语义的组合件才留在页面。
- **`app/` 可以用 Tailwind，`packages/*` 一律不许**——包要能脱离本应用活着。
- 组件样式一律 **SCSS**，取值只来自 `@dt/tokens` 的 CSS 变量。

## 6. 目录约定

- **测试全部在成员自己的 `tests/` 下**，目录镜像 `src/`，不与源码同放。
- **页面目录 `pages/<Route>/` 用 `PascalCase`**，主组件固定 `index.vue`，
  页面私有组件放同目录 `components/`。
- 两条都由 `scripts/check_structure_web.py` 执行，不靠评审记忆。
- **`@dt/ui` 的 story 全部在 `packages/ui/stories/`**，一个组件一份
  `<组件名>.stories.ts`，与 `src/`、`tests/` 平级——理由同测试：`src/` 下只留
  会被打包的东西，覆盖率与结构闸的口径也不必再分辨哪些文件是给人看的。

理由与完整规则见
[`docs/agents/project-structure-typescript.md`](../docs/agents/project-structure-typescript.md)
§3.2 与 §4.1。

## 7. 前端拦不住的那几类错误

typecheck 与 lint 对下面这些**双双放行**，只能靠契约测试：

- 组件 prop 名、事件名、插槽名写错 → 静默不生效
- `DtIcon` 传入未登记的图标名 → 图标位置空着，控制台无声
  （由 `DtIcon.contract.spec.ts` 扫模板里的字面量名字兜住）
- 后端字段改名 → `@dt/contracts` 的手写类型不会自己变
  （每个出参形状都必须有一条把它钉在 `openapi.json` 上的用例，由
  `scripts/gates/check_wire_shapes.py` 守着「有没有人想到写」，
  见 [ADR-0019](../docs/adr/0019-前端线形先补覆盖闸而不是改成生成.md)）
- 手搓一份竞态防护 → 慢的那次后返回覆盖快的那次，界面显示过期数据且不报错
  （`app/` 下只许用 `useRacedFetch`；要作废在飞的那次用它的 `cancel()`，
  见 [TypeScript 代码规范](../docs/agents/code-style-typescript.md) §7.1）

## 8. 本地命令

```bash
cd web
pnpm install
pnpm dev            # 起开发服务器，/api 代到 127.0.0.1:8004
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm storybook       # @dt/ui 的组件展示，:6006；顶栏可切 7 套主题
pnpm storybook:build # 出静态站到 packages/ui/storybook-static/
python3 ../scripts/check_structure_web.py
```

> Node 经 nvm 安装；非交互 shell 里先补 PATH 再执行 `pnpm`。

## 报告工作面

`pages/Reports` 按模板、编辑、生成记录、定时规则分路由。四类业务节点在结构化
正文中保持身份，编辑器不在浏览器里另造 Word。报告接口类型由 platform OpenAPI
生成到 `@dt/contracts` 的 `report.ts`，字段契约与生成一致性同时校验。
