# 跨大屏跳转 — 设计

> 一个项目里有多张大屏，**在联动里给任意控件配一条「跳到另一张屏」的规则**，点一下就切过去。
> 不新增导航模块——跳转是一种**动作**，不是一种模块。
> 前端在 `@dt/contracts`（动作契约）、`@dt/runtime`（联动引擎）与编辑器的联动编辑面；
> 后端只有公开面那一处必须先堵住（`platform-server`）。
> 与 [DASHBOARD_DESIGN](DASHBOARD_DESIGN.md) §5、[ADR-0012](adr/0012-大屏组态以节点为可寻址资源而非整文档替换.md)、
> [ADR-0014](adr/0014-公开大屏是平台唯一的匿名可达面.md) 直接相关。

---

## 1. 边界

联动契约已经有六档动作（`show` / `hide` / `toggle` / `setActive` / `openModal` / `closeModal`），
它们的共同点是**都在本屏内改易失态**。这次加的两档是**离开本屏**，是这套里第一个跨文档的动作。

在范围内：

- 联动编辑面里选「跳转到大屏」，挑一张同项目的屏，点源控件就切过去。
- 按控件上抛的**值**分流：一块摆六个指标的卡片，点第 N 个进第 N 张明细屏。
- 谁能当源沿用既有口径：清单自报 `hostClickable` 或 `emitsInteractions` 的模块，
  目前是 `text-block`、`image-block`、`info-card`、`data-card`、`twin-view`。摆一张图当入口不用写任何代码。

不在范围内：导航菜单模块、项目级导航源、自动轮播、跨项目跳转（见 §9）。

---

## 2. 通用语言

| 词 | 指什么 |
|---|---|
| **目标句柄**（handle） | 「跳到哪张屏」的那个字符串。**登录态是大屏 id，公开态是目标屏的公开令牌**（服务端改写，见 §6） |
| **导航口**（nav port） | 宿主页面在创建联动引擎时传进去的一个函数：`navigate(handle)` |

⚠ 句柄的含义**由宿主决定，联动引擎只搬运不解释**。引擎里一旦出现
「拿句柄跟当前大屏 id 比一比」，公开态那条路（§6）就再也接不上了。

---

## 3. 契约：两档动作

`packages/contracts/src/interaction.ts` 加两个成员：

```ts
/** navigate：跳到另一张大屏。⚠ 目标是**句柄**不是 URL，见 §3.1。 */
export interface InteractionNavigateAction {
  type: 'navigate'
  target: DashboardHandle
}

/**
 * navigateByValue：按控件上抛的值分流跳转。
 * 形状照 `setActive` 的 `groups` 抄：那是本仓已有的「按值分派」口径，
 * 再造一套只会让两处的空值语义各漂各的。
 */
export interface InteractionNavigateByValueAction {
  type: 'navigateByValue'
  routes: { value: string; target: DashboardHandle }[]
}
```

- 两档而不是「一档带可选 map」：一档带两个可选字段等于四种状态，其中一种
  （两个都空）是一条永远不跳的规则——正是本仓最不想要的那类「配了没反应」。
  拆成两档后各自有一个必填字段，解析器写错形状当场丢弃。
- `value` 比对沿用引擎里既有的 `selectedKey()`：字符串/数字/布尔收成字符串，
  空值与对象收成空串**比不中任何一条路由**，于是不跳。这与 `setActive`
  「比不中就整组隐藏」是同一条规则，不另立一套。
- 一条 `navigateByValue` 里 `value` 重复时**取第一条命中**；编辑面要能看出重复
  （否则后面那条永远不生效，且没有任何提示）。

### 3.1 为什么目标不是 URL

一张能配任意 URL 的大屏等于一个站内跳板：开放重定向。
这与 `router/guards.ts` 里 `safeReturnTarget` 只放行站内相对路径是同一个理由。
目标只能是句柄，路由由宿主拼——顺带也让公开态那次改写（§6）成为可能。

---

## 4. 运行时：引擎不实现跳转

`createInteractionRuntime()` 现在不收参数。改成收一个可选的导航口：

```ts
export interface InteractionPorts {
  /** 跳到某张大屏。不传 = 这一档动作静默 no-op（设计态画布、独立渲染、测试）。 */
  navigate?: (handle: DashboardHandle) => void
}

export function createInteractionRuntime(ports: InteractionPorts = {}): InteractionRuntime
```

`applyAction` 里两档新动作只做一件事：算出句柄，交给 `ports.navigate`。
**引擎不认识路由、不认识登录态与公开态、不判目标存不存在。**

三个宿主的接法：

| 宿主 | 传什么 | 结果 |
|---|---|---|
| 登录运行态 `DashboardView` | `(h) => { if (h === 当前 id) return; router.push({ name:'dashboard-view', params:{ dashboardId:h } }) }` | 真跳 |
| 设计态编辑器 | **不传**（它现在根本不 provide `INTERACTION_KEY`，画布上一切联动本就不触发） | 静默不跳，与显隐类动作现有行为一致 |
| 公开态 `PublicDashboard` | `(h) => { if (h === 当前令牌) return; router.push({ name:'public-dashboard', params:{ publicToken:h } }) }` | 真跳（ADR-0021） |

⚠ **自跳挡在宿主里，不挡在引擎里**：目标就是当前这张屏时直接返回。
不挡的话 `router.push` 到同一路由既不重载也不报错，表现是「点了没反应」，
而 vue-router 还会在控制台留一条重复导航告警把人往错的方向带。

⚠ **弹窗里的跳转**：换屏会让 `DashboardView` 那条 watch 重新 `init()`，
易失显隐与 `activeModal` 一并清零，所以弹窗自己会关。这条要写进注释——
它是「运行态与持久态严格分离」那条铁律顺带给的，不是巧合。

### 4.1 目标已删怎么办：跳过去，让目标页说话

不预先拉一遍同项目大屏列表来置灰。理由三条：

1. 源控件是一张图、一段文字或一块指标卡，它**根本不知道自己身上挂了跳转规则**
   （模块只拿到固定三件套 props，`meta.interactive` 只说"我是某条规则的源"）。
   没有地方画"这个入口失效了"。
2. 目标页 `DashboardView` 本来就有 `DtPageState` 的错误态与「返回工作台」，
   跳进一个已删的屏不会白屏，看得见也回得来。
3. 悬空引用在**配置态**就看得见：`DashboardRefControl` 对不在列表里的 id
   会显示「（列表外 xxx）」。这比运行态多发一次 HTTP 划算得多，
   也不用去碰 DASHBOARD_DESIGN §6.1「运行态零 HTTP」那条线。

---

## 5. 编辑面

改动落在三个既有文件加两个新文件：

- **`scripts/interactionOptions.ts`**：`ACTION_LABELS` 加「跳转到大屏」「按值跳转大屏」，
  `ACTION_TYPES` 排在弹窗之后；`actionForType` 换类型时保住已填的目标
  （`navigate` ↔ `navigateByValue` 互换时把单个 target 收成一条路由 / 取第一条路由）；
  `ruleSummary` 给这两档的摘要——⚠ 摘要要让人一眼看出这条是**走人**，
  它和显隐类动作的后果完全不同。
- **`components/InteractionActionFields.vue`**：加两个分支。`navigate` 就地摆一个
  大屏选择器；`navigateByValue` 的行列表交给新的 `InteractionValueRoutes.vue`
  （.vue ≤500 行的闸门顶着，而它本来就是一段自成一体的列表编辑）。
- **`scripts/rowKeys.ts`**（新）：「落库里没有 id 的行」的本地 key，互斥组与跳转路由共用。
  ⚠ 原本这段只在互斥组那里有一份，路由再抄一遍就是第二份——而里头那个坑是真的：
  拿行内容当 key 会在改字的那一刻整行重挂、输入框丢焦点；删中间一行不连着删 uid
  会让余下各行整体错位。
- **`features/dashboard/interactionRules.ts`**：加两个 `parseXxx`，坏形丢弃、好条目保留。

目标选择器**直接复用已有的 `DashboardRefControl`**（`type: 'dashboard-ref'`）：
它已经会按当前项目拉大屏列表、按项目缓存、拉不到就说出来并退回手填、
并且防了「切项目时慢的那次后返回覆盖新项目候选」的竞态。
联动编辑面挂在 `InspectorPane` / `ChromePanel` 里，而项目 id 由 `useEditorChrome`
provide，所以这个控件在那里开箱即用，一行注入代码都不用加。

另外两处「永远不会命中」在编辑面上当场标出来，不留到运行时才发现：
路由的**值留空**（没带值的事件本就不跳）、**值与上面某条重复**（命中的永远是上面那条）。
⚠ 重复只标后面那条：先来的那条一切正常，两条都标会让人去改一个没毛病的地方。

⚠ 选择器里还该把**当前这张屏**标出来（「（当前大屏）」）——最容易配出来的错误配置
就是自跳，而自跳的表现正好是「点了没反应」。眼下自跳挡在宿主里（§4），
编辑面的这层标注尚未做。

---

## 6. 公开面：一期必须先堵住的泄露

联动规则存在 `chrome_json.interactions` 里，而公开面是**逐字段透传** `chrome_json` 的
（`share_service.to_public_dashboard_out`）。所以一旦有人配了跳转规则又把这张屏发布出去：

- 匿名载荷里会出现内部大屏 id，与 ADR-0014「公开面不回任何能定位它在库里位置的信息」直接冲突；
- 而拿着 id 在公开态也跳不动（公开路由要的是令牌）。

一期做法：**公开载荷里整段不下发 `interactions`**。三行代码，零新耦合，且是实话——
公开页当时本来就不 provide 联动引擎，一条联动规则都不跑。

**（2026-08-19）二期做完了，见 [ADR-0021](adr/0021-公开大屏的匿名实时订阅与跨屏跳转.md)**：

- 公开载荷**照常下发** `interactions`，公开页也装联动引擎（显隐、互斥、弹窗一并生效）；
- `navigate` / `navigateByValue` 的句柄由服务端改写成**目标屏当前的公开令牌**
  （`services/public_interactions.py`），令牌是现查的，目标一撤回或重新发布当场跟着变；
- ⚠ 目标没发布时**整条规则不下发**，而不是把目标改成空串——留着规则，源控件仍摆出
  可点击外观、点下去什么也不发生，正是 §4 一路在躲的那种「点了没反应」；
- ⚠ 代价：一条公开链接会把它联动指向的、**且同样已发布**的那些屏的令牌一并交出去。
  这是「联动」本身的语义（作者显式配了跳转、目标也被显式发布过），但影响面不止一张屏。

---

## 7. 基础设施必修（先于功能）

这两条不是为跳转加的，是**跳转把它们暴露出来了**：同一个路由内换 `dashboardId`
这条路径，此前只有「首次挂载」跑过。跳转一上线，它就成了每天走几十遍的主路。

### 7.1 换屏必须换订阅 —— 真缺陷

`usePointSamples` 只在**点位键表变了**时退订重订：

```ts
watch(() => keys().join(' '), () => resubscribe(keys()))
```

而订阅的主题是 `createPointSubscribe` 在**订阅那一刻**从 `topicOf()` 取的
（`app/src/runtime/pointStream.ts`）。两张屏绑的点位集合恰好相同
（一个现场的总览屏与明细屏，很常见）时，键表字符串不变 ⇒ **不重订** ⇒
人已经在 B 屏，订阅还挂在 `dashboard:A` 上。

后果不是画面空白（同一批点位的值照样从 A 的帧里来），而是更难查的两样：
hub 那边观看者永远算在 A 头上，**publisher 为一张没人看的屏一直合并推送**；
A 一旦被删或改了绑定，B 屏当场没数据，且现场看不出这跟改 A 有什么关系。

修法：把**主题**并进重订依据，并在主题变化时清空快照缓存——
`useDashboardValues(nodes, scope)`，`scope` 由宿主给（`() => dashboard.id`）。

⚠ 清缓存**只在 scope 变时清，不在键表变时清**：编辑器里改一次绑定键表就变一次，
跟着清会让整屏的值闪一下。
⚠ 这条要先有一条**修复前必红**的用例：两张屏点位集合相同 → 断言退订与重订各发生一次。

### 7.2 换屏不该白一下

`DashboardView` 的模板是 `loading || error` 就整屏换成 `DtPageState`，
而 `docIo` 在新文档到手之前一直留着旧文档。于是每跳一次，墙上先白一下再亮。

修法：有旧文档时继续渲染旧的，只在角上摆一条细进度；
`DtPageState` 只留给「手上一张都没有」的首次加载与错误。
⚠ 不许悄悄留着旧屏不作声——那就成了「看起来在跑、实际停在上一张」。

### 7.3 用 `push` 不用 `replace`

浏览器/触摸屏的返回键回到上一张屏符合直觉。悬浮的「返回工作台」照旧，两者不冲突。

---

## 8. 能当入口的控件

| 模块 | 怎么触发 | 上抛的值 |
|---|---|---|
| `action-button` | 原生 `<button>`，`emitsInteractions`（含 Enter/Space 与禁用语义） | 配了「联动值」就有 |
| `text-block` / `image-block` | 清单 `hostClickable`，整块可点由渲染宿主接管（含 Enter/Space） | 无 → 只能配 `navigate` |
| `info-card` / `data-card` | 整块可点 + 逐格 `rowClickEmitter` 上抛 `{event:'click', value}` | 有 → `navigateByValue` 的主要用户 |
| `twin-view` | `emitsInteractions`（3D 里点对象） | 有 |

配了以某节点为源的规则，`meta.interactive` 会为真，展示类模块自动摆出可点击外观——
「配了规则才像能点」这条既有口径对跳转一样成立，不用另加开关。
⚠ 按钮不走这条：可点是它的本性，没配规则时点了没反应属于配置没写完，
在右栏的联动页当场看得见。

一个"看起来就是按钮"的入口用 `action-button`，设计见
[MODULE_ACTION_BUTTON_DESIGN](MODULE_ACTION_BUTTON_DESIGN.md)。

---

## 9. 待拍板

1. ~~**公开态跨屏切换**~~ —— 已做，见 §6 与 ADR-0021。
2. **跨项目跳转**。`dashboard-ref` 只列本项目的屏；跨项目技术上跳得动（句柄就是 id），
   但没有选择器。建议维持「项目 = 一组可互跳的大屏」这条边界。
3. **陈旧路由的清理**。`setActive` 有一个 `reconcileSetActiveGroups`，
   因为陈旧组会**错误隐藏**目标；`navigateByValue` 的陈旧路由只是永不命中，不会错杀，
   所以一期不清，只要求编辑面看得出来。
4. **自动轮播 / 导航菜单模块**。都能架在同一条动作上，但都是另一次讨论。

---

## 10. 闸门与测试

| 守什么 | 落在哪 |
|---|---|
| 引擎不认识路由 | `packages/runtime/tests/interactionRuntime.test.ts` 加：不传口时两档动作是 no-op；传假口时收到的是**原样**句柄 |
| 自跳不发 push | `app/tests/pages`（或宿主组合式的单测）：目标 = 当前屏时 router 一次都不调 |
| 坏形规则不拖垮整屏 | `interactionRules.ts` 的既有口径加两档：缺 `target` / `routes` 不是数组 → 丢弃，同表里的好规则照常保留 |
| 值分流的空值语义 | 空值、对象、数字值各一条，断言与 `setActive` 的 `selectedKey` 同口径 |
| 公开面不含大屏 id | 后端用例：配了跳转规则的屏发布后，公开载荷里的句柄是目标屏的令牌，整份载荷搜不到目标屏的 id（`test_public_interactions.py` 与 `test_dashboard_share_api.py`） |
| 公开态跳的是公开路由 | `app/tests/pages/PublicDashboard/navigate.spec.ts`：点一下 push 的是 `public-dashboard`，自跳一次都不 push |
| 换屏必须换订阅 | §7.1 的必红用例 |
| 运行时/编辑器里零模块类型字面量 | 既有 `moduleTypeLiterals.contract.spec.ts`（这次改动本就不需要任何类型判断，它会一直绿） |

## 11. 分期与 PR 切分

对齐 `pr-policy`（≤400 行、≤20 文件、一个 PR 只碰一个服务）：

| # | 内容 | 服务 | 状态 |
|---|---|---|---|
| P0 | §7.1 换屏换订阅（含必红用例）+ §7.2 不白屏 | web | ✅ 已落地 |
| P1 | 公开载荷不下发 `interactions` | platform-server | ✅ 已落地 |
| P2 | 契约两档动作 + 解析 + 引擎导航口 + `DashboardView` 接线 | web | ✅ 已落地 |
| P3 | 联动编辑面两个分支 + 选项/摘要/换类型 | web | ✅ 已落地 |
| P4 | 公开面改写句柄为令牌 + 公开页装联动引擎（ADR-0021） | platform-server / web | ✅ 已落地 |

P1 排在功能前面：**先堵住泄露，再让人配得出这种规则**。
P2 落地后功能其实已经能用（规则可以由 API 直接写），P3 才是让人在界面上配得出来。

要不要 ADR：**不需要**。这次没有跨服务契约、没有难以逆转的存储口径，
也没有违反既有规范——它是既有联动契约上加两个成员。
真正值一次 ADR 的是 §6 那条「公开面把句柄改写成令牌」，等到要做时再写。
