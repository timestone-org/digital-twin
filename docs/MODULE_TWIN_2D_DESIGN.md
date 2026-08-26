# 2D 孪生模块（`twin-2d-view`）— 设计

大屏上「把现场的连接关系画出来，再把读数贴到图上」的模块：一块画布上摆 N 个**节点**、
N 条**连线**、若干**标注**，节点长什么样由一组**可配置的图元描述**决定——用户能从零画出
一个新形状、新图标、新配色、新字段布局。它是模块系统那条判据
（[DASHBOARD_DESIGN](DASHBOARD_DESIGN.md) §5：新增一个模块 = 一个目录 + 一行注册）
在「文档型模块」上的第二次兑现（第一次是 `twin-view`），也是
[ADR-0016](adr/0016-复杂config段由清单声明的整页子编辑器接管.md) 的第二个使用者。

参考项目 `DigitalTwinBK` 里对应的模块叫另一个名字，本文只在 §16「与参考项目的对应关系」
一节里为了溯源提一次那个旧名。除那一节以外，全文、全部配置字段、全部 UI 文案里
只出现「2D 孪生 / 节点 / 连线 / 标注 / 样式 / 端口 / 槽位」。

---

## 0. 本设计经过一轮对抗审稿，以下 16 处是审稿后修正的实质结论

只列结论，逐条落在正文里。

| # | 结论 | 落在 |
|---|---|---|
| 1 | 参考项目 11 枚内置图标是一份**手绘 sprite**（11 个 symbol、各自 viewBox、4 个内联渐变、70 个绘图元素），且**分成两档**：4 枚能源源图标是插画式多色、硬编码 hex，另 7 枚是纯 `currentColor` 单色。`ico` 的 name/asset/draw 三档一档都装不下。加第四档来源 `{kind:'sprite', id}`，把 `icons.svg` 原样搬进包里；`ico.color` 对 7 枚单色档生效、对 4 枚多色档无效 | §5 |
| 2 | 实时状态染色必须有自己的数据来源：加第三个实体钉行槽 `nodeStatus`（行数 = 节点数）。归一在 `Component.vue` 里走本仓既有的 `toDeviceStatus`，`unknown` 不覆盖配置里的静态 status | §10 |
| 3 | `nodeStatus` 的子槽**刻意不声明 `enumMap`**：声明了语义键会让 `applyEnumMap` 把 `1` 换成一个词表认不出的串，于是全图状态集体变灰且零报错 | §10.2 |
| 4 | 死字段闸与暗键闸的可达集进不了 `@dt/*` 包。**全部顶层配置键一律在 `packages/modules/src/modules/twin-2d-view/Component.vue` 里读**，再当 props 递给包内渲染件；`manifests.contract.spec.ts` 的 `KEY_CONSTANTS` 要补四个 `TWIN_2D_*` 常量 | §3.2 |
| 5 | 图元基类补 `transition` / `pointerEvents` / `transformOrigin` / `minWidth` / `maxWidth`；hover 由节点根上一对 `@mouseenter` / `@mouseleave` 置本地 ref 驱动，不用 CSS 伪类、不装监听器；hover 抬 z-index；`prefers-reduced-motion` 一次关掉全部 keyframes | §4.2 §9.3 |
| 6 | 子类（4 个源子类 × 4 个源类、3 个末端子类 × 3 个末端类 = 25 种视觉组合）**不取消**：变体条件新增一档 `{kind:'tag', key:'subtype', in:[…]}`，7 个预置样式各带 3–4 条子类变体即可覆盖 | §6.3 |
| 7 | 派生槽的 `expr` 改成**可递归三层的闭合小语言**（`slot`/`lit`/`first`/`ratio`/`sum`/`join`/`scale`），能表达参考项目的 output 三级与 efficiency 三级兜底链 | §9.5 |
| 8 | 数值格式化采用本仓 `shared/format.ts` 的口径（`fmtTrim` / `fmtKwh` / `NO_DATA`，`toLocaleString` 一律钉 `'en-US'`），`@dt/twin2d` 里是第二份副本 + 一条**行为**对齐契约 | §11.3 §17 |
| 9 | `rotate` 与 `flipX/flipY` 的复合顺序写死为 `translate → rotate → scale(flip)`，`portWorldPos()` 与根 transform 用同一个顺序，用二极管这种非对称符号锁 16 组端口坐标 | §4.6 §8 |
| 10 | `xy` 端口没有周长参数，`side: 'auto'` 必须在几何层解析成四档 Side 后才进正交路由；引脚 marker 从「只有形状」补成 `{shape, strokes, fill}` | §4.4 |
| 11 | 流动动画只有一条合成规则：`animateFlow` 是总闸、`flowSpeed` 是全局倍率、`edgeStyle.flow` 只给 dash 与基准时长，最终时长 = `durationMs / flowSpeed` | §7.9 |
| 12 | 连线反向渲染 = 端点互换 + side 互换 + **waypoints 整体 reverse**；`labelAt` 定义成沿**折线点序列**的弧长参数（承认圆角带来的近似） | §8 |
| 13 | 编辑器取数走 `app/src/composables/useRacedFetch.ts`，`useUnsavedGuard` 提取排在最前一轮 | §13.5 §19 |
| 14 | 素材注入槽拆成两个函数（`resolveIcon` / `resolveImage`）：`assetUrl` 的 `kind` 决定对象键前缀，装错一档表现为图标 404 而零报错 | §11.4 |
| 15 | 新建包的理由是首屏包体预算与既有先例，**不是**包体闸的 HEAVY 名单（那是固定的第三方库名单，与 `@dt` 包无关） | §3.1 |
| 16 | 行数量级整体上调 2–3 倍：全程约 **31k 行**、按 400 行/PR 约 **66–81 个 PR**；`paint.ts` 明确拆成四个文件 | §3.4 §19 |

---

## 1. 一页读完

| 问题 | 答案 |
|---|---|
| 模块 type id | `twin-2d-view`（目录同名，图标 `network`，分类「孪生」） |
| 节点长什么样由什么决定 | 文档里的 `styles[]`，一份**图元描述**（四种图元 + 槽位 + 变体 + 端口） |
| 内置库是什么 | `@dt/twin2d/presets` 里的**预置数据**，与用户自建的样式走同一条渲染路径，零代码分支 |
| 配置怎么改 | 一个整页子编辑器（`subEditor`），路由 `/dashboards/:dashboardId/edit/twin-2d/:nodeId` |
| 数据怎么进来 | 三个**实体钉行**数组槽：`nodeValues`（节点 × 槽位）、`nodeStatus`（节点）、`edgeValues`（连线） |
| 新增的包 | `@dt/twin2d`（文档契约 + 归一化 + 几何 + 只读渲染件），照 `@dt/twin-config` / `@dt/three-core` 的先例 |
| 要不要 vue-flow | 不要，画布自绘（§13.2 给了理由） |
| 电路图 | 端口/旋转镜像/正交走线/任意符号几何/8 枚 GB/T 符号**本期做**；跳线、网表、自动避障**不做**（§12） |
| 规模 | 约 31k 行（源 ≈ 19k、测试 ≈ 12k），13 个工作轮、66–81 个 PR（§19） |

---

## 2. 为什么是「图元描述」，不是「形状枚举 + 有限自定义」

参考项目的做法是：`shape` 是一个 5 值枚举（`box` / `cylinder` / `tank` / `square` / `text`），
渲染层为每一档写一个 DOM + CSS 分支；用户自定义类型时只能在这 5 档里挑一个，
颜色只能从 12 个 token 下拉里挑，锚点只有四边中点，图标只能在 11 枚内置 sprite / lucide 名 /
素材引用里挑。**形状本身画不出来**。

这条路走到「后续要画电路图」就断了：电阻、电容、二极管、接地符号没有一个能落进那 5 档，
而每加一个符号就要加一个渲染分支、加一份 CSS、加一档枚举、改一次归一化白名单——
最后是十几个 `v-else-if` 和一份没人敢动的一千行样式表（参考项目那个 SFC 是 1083 行）。

所以本模块把「节点长什么样」整个下沉成**数据**：

```
一个节点样式 = { 尺寸, 端口[], 槽位[], 图元[], 变体[] }
一个图元     = box | vec | ico | txt   （四种，闭合）
```

- **形状**由 `vec` 图元的几何决定（`path` 的 `d` / `rect` / `ellipse` / `line` / `poly`），
  用户在编辑器里点几个点就能画出一个新符号；
- **配色**是图元上的一个 CSS 颜色字符串（可以是 `#62ff8a`、`var(--accent-primary)`、
  `color-mix(in srgb, var(--t2-accent) 40%, transparent)`），不是 12 档下拉；
- **字段布局**是 `box` 图元的 flex 布局 + `txt` 图元的位置，不是「主显 / 次显」两个固定位；
- **锚点**是 `ports[]`，位置任取（周长参数 `t` 或归一坐标 `x/y`），不是四边中点；
- **图标**是 `ico` 图元的四种来源之一，其中 `draw` 一档是用户自己画的路径、
  `sprite` 一档是内置的那份手绘图标集（§5）。

而「内置的 11 种节点类型 / 5 种连线 / 4 种传感器」在新模型里就是
`@dt/twin2d/presets` 里的一批 `Twin2dNodeStyle` 字面量。**它们与用户自建的样式走完全
同一条渲染路径**——`Twin2dNodeBox.vue` 里没有一个 `if (styleId === '…')`。

> ⚠ 这一条要靠测试守：`twin2d-preset-fidelity.spec.ts` 把 §7 那张 100 行对照表逐条写成
> 期望值比对。少了它，「预置数据」会慢慢长回「渲染分支」，而这个退化过程没有任何一步会报错。

### 2.1 type id 与图元 kind 的取名纪律

`twin-view` 是 3D 那块，所以 2D 这块类比着叫 `twin-2d-view`：一眼能看出是同一家族的另一维。

更硬的理由是闸门：`packages/modules/tests/moduleTypeLiterals.contract.spec.ts` 与
`app/tests/contract/dashboard-module-literals.contract.spec.ts` 会把已注册的每个
`manifest.type` 字面量拿去 grep 源码，命中即红。所以 type id 必须是一个不可能出现在别处的字符串。

| 候选 | 评价 |
|---|---|
| `twin-2d-view` | ✅ 采用。带连字符与数字，永不与 HTML 属性/CSS 值/普通名词撞 |
| `twin2d-view` | 可用，但与 `twin-view` 的构词不同族 |
| `diagram` / `graph` / `mimic` / `schematic` | 当前 0 命中但危险：都是普通单词，将来任何一处 `kind: 'graph'` 都会让这道闸红在无关文件上 |

同一条纪律往下延伸到**图元 kind**：取 `box` / `vec` / `ico` / `txt`，
刻意避开 `container` / `header` / `footer` / `text-block` / `image-block` / `metric-card` / `action-button`
这几个**已注册的模块 type**——编辑器页在 `app/src` 里，那里写一个 `kind === 'container'`
会让零字面量闸红在一个与容器模块毫不相干的文件上。`action-button` 不叫 `button` 就是同一条理由
（[MODULE_ACTION_BUTTON_DESIGN](MODULE_ACTION_BUTTON_DESIGN.md) §1）。

---

## 3. 目录与文件

三处落点，各自的理由不同。

### 3.1 新包 `@dt/twin2d`

编辑器页在 `app/src/pages/Twin2dEditor/`，它必须渲染**与运行态逐像素相同**的节点
（所见即所得），也就必须 import 那批渲染件。三条约束合起来指向一个新包：

1. `@dt/modules` 的 `package.json` 现在只导出 `.` 一个入口，而结构闸禁止深链包内部路径
   （`check_no_deep_links`）。放在模块目录里，app 拿不到。
2. 从 `@dt/modules` 的桶导出，会把整包渲染层拉进任何引用它的入口的静态图，
   直接压首屏 300 KB gzip 的预算（`check_bundle_budget.py` 的 `MAX_JS_GZIP_KB = 300`）。
3. 仓里已有同形状的先例：`@dt/twin-config`（文档契约）+ `@dt/three-core`（渲染件）
   正是为 3D 那块拆出来的。2D 这边两者体量都够大但同源，合成一个包。

> ⚠ **不要拿包体闸的 HEAVY 名单当理由**：`check_bundle_budget.py` 的
> `HEAVY = ('three', 'echarts', 'monaco', '@babel', 'moment')` 是固定的第三方库名单，
> 与「某个 `@dt` 包的渲染层」无关。真正卡首屏的是那条 300 KB 预算，与
> `startup-graph.contract.spec.ts` 的「不许静态 import `@dt/three-core`」。
>
> 另一条路是给 `@dt/modules` 加声明式子路径导出（`@dt/three-core` 就有 5 个：
> `.` / `./host` / `./glCapture` / `./panel.scss` / `./testing`）。**不取**：那会让
> `modules` 变成两个入口，与 `twin-config` 的先例不同族，而且把「运行态渲染件」
> 与「编辑器共用件」混在一个包里，依赖表上看不出方向。

```
web/packages/twin2d/
├── package.json                      名 @dt/twin2d，deps: @dt/contracts + @dt/ui，peer vue
├── tsconfig.json
└── src/
    ├── index.ts                      桶：只做 re-export（check_barrels_only_reexport）
    ├── constants.ts                  config key / 文档版本 / 三个槽键 / 行 fieldKey 构造 / TWIN_2D_VIEW_BINDINGS
    ├── types.ts                      文档类型全集（§4 的字面量就是这份）
    ├── kinds.ts                      闭合常量数组：图元 kind / 状态 / 标注 kind / 路由档 / 阈值算子 / 表达式算子 / TWIN_2D_SPRITE_IDS 与 TWIN_2D_FIXED_COLOR_SPRITES
    ├── normalize.ts                  normalizeTwin2dConfig 入口 + canvas
    ├── normalizeStyles.ts            节点样式 / 连线样式 / 端口 / 槽位
    ├── normalizePrims.ts             图元树（递归，深度上限 6）
    ├── normalizeNodes.ts             节点实例 + 覆盖补丁 + 追加图元 + tags
    ├── normalizeEdges.ts             连线 + 端点 + 拐点 + 悬空过滤
    ├── normalizeMarks.ts             标注
    ├── geometry.ts                   周长参数化、反投影、四种路由、圆角折线、箭头（§8）
    ├── transform.ts                  rotate × flip 的复合、portWorldPos、centerBoxOf
    ├── placement.ts                  五种摆位 → CSS；九档锚点表；法线推移
    ├── paintBox.ts                   box：布局 / 多层填充 / 边框 / 圆角 / 阴影 / 裁剪
    ├── paintVec.ts                   vec：五种几何 → SVG 属性、多遍描边、局部渐变
    ├── paintText.ts                  txt / ico：字体、省略、阴影、图标四来源
    ├── paintCommon.ts                基类六项（摆位、z、opacity、rotate、transition、pointerEvents）+ --t2-* 注入
    ├── cssValue.ts                   CSS 值消毒（拒 url( 与控制字符）+ 颜色回退链
    ├── variants.ts                   条件求值 + 变体补丁浅合并
    ├── expr.ts                       派生槽表达式求值（闭合小语言，深度上限 3）
    ├── format.ts                     读数格式化（第二份副本，见 §11.3）
    ├── bindingRows.ts                行 → 实体的映射、行标签/行数、绑定重派、缝合
    ├── issues.ts                     诊断（悬空 styleId / 槽引用 / 端口 / 补丁图元 id / 越界拐点 / 超深树）
    ├── presets/
    │   ├── index.ts                  桶
    │   ├── palette.ts                预置调色板（字面 hex，§6.1）
    │   ├── nodes.ts                  11 种预置节点样式
    │   ├── subtypes.ts               7 组子类变体（§6.3）
    │   ├── edges.ts                  5 种预置连线样式
    │   ├── sensors.ts                4 种预置传感器药丸（可追加进任意节点）
    │   └── circuit.ts                8 枚电路符号（GB/T 4728，§6.2）
    └── render/
        ├── icons.svg                 内置图标 sprite，从参考项目原样搬（§5）
        ├── Twin2dIconSprite.vue      sprite 宿主：每个 DOM 文档挂一次
        ├── Twin2dStage.vue           舞台：等比缩放、层序、图案底、空态
        ├── Twin2dNodeBox.vue         一个节点：根容器、状态类、局部变量注入、旋转镜像、hover
        ├── Twin2dPrim.vue            图元递归渲染（四分支）
        ├── Twin2dVec.vue             SVG 图元层（含渐变 id 加前缀）
        ├── Twin2dGlyph.vue           图标四来源
        ├── Twin2dEdgeLayer.vue       连线层：多遍描边 + 端点标记 + 引脚 marker + 标签
        └── twin2d.scss               固定 keyframes + 结构性样式，全部 var() 驱动
```

依赖表两处副本都要登记：

```python
# scripts/gates/check_web_deps.py
"twin2d": frozenset({"contracts", "ui"}),
"modules": frozenset(
    {"contracts", "three-core", "tokens", "twin-config", "twin2d", "ui"}
),
```

> ⚠ 新增包必须先登记进这张表，否则 `check_packages_declare_their_layer` 当场红；
> 同时要改 [project-structure-typescript](agents/project-structure-typescript.md) §2 的依赖表
> （两份是同一份口径的两处副本）。
> ⚠ `twin2d` 的 deps 里**没有 `tokens`**：包里一处都不 `readCssVar` / 不监听换肤，
> 颜色只做字符串拼接（§6.1）。哪天要读 token 取值，这条表项必须同时加 `tokens`。

### 3.2 模块目录：全部顶层配置键在 `Component.vue` 里读

```
web/packages/modules/src/modules/twin-2d-view/
├── manifest.ts     清单：7 个顶层配置字段 + 3 个数组绑定槽 + subEditor 声明
└── Component.vue   壳：读全部配置键、缝合三个数组槽、状态归一、四档逐槽状态、上抛联动
```

> ⚠ **这不是风格选择，是闸门的硬约束。** `packages/modules/tests/manifests.contract.spec.ts`
> 判「死字段 / 暗键」时的可达集 `reachableFiles()` **只沿相对 import 走**，且要求
> `target.startsWith(packages/modules/src)`——它进不了 `@dt/twin2d`。把 `fitMode` /
> `fitPadding` / `animateFlow` / `flowSpeed` 的消费点画在包内的 `Twin2dStage.vue` 与
> `Twin2dEdgeLayer.vue`，这四个键会被判成「声明了却没人读的死字段」当场红。
> 更严的是「绑定槽键两侧逐一对上」那条：它连可达集都不走，只扫**模块目录本身**
> （`moduleFiles()`）。
>
> 做法照 `twin-view/Component.vue` 的既定形态：`props.config.title` / `showSceneTools` /
> `showStructureTree` / `titlePosition` / `titleFontSize` 全在那一个文件里读，
> 六个槽也显式列一遍再往下递（它自己的注释就写着这条理由）。

配套的两处落地清单：

| 要改的地方 | 改什么 | 不改会怎样 |
|---|---|---|
| `manifests.contract.spec.ts` 的 `KEY_CONSTANTS` | 从 `@dt/twin2d` 导入并登记 `TWIN_2D_CONFIG_KEY` / `TWIN_2D_NODE_BINDING_KEY` / `TWIN_2D_STATUS_BINDING_KEY` / `TWIN_2D_EDGE_BINDING_KEY` | 扫描器把 `values[TWIN_2D_NODE_BINDING_KEY]` 读成字符串「未登记的键常量 …」，「绑定槽键两侧逐一对上」当场红 |
| `Component.vue` 的行数预算 | 从「薄壳」上调到 **≈ 260 行**（读 7 个配置键 + 缝三个槽 + 状态归一 + 四档 + 联动） | 无 |

`manifests.contract.spec.ts` 本身在 `check_pr_policy.py` 的 `MODULE_REGISTRY` 白名单里，
所以这条改动可以留在模块落地那一个 PR 里，不破坏规模豁免（§19 R7）。

### 3.3 编辑器页

```
web/app/src/pages/Twin2dEditor/
├── index.vue                       AppShell + 三栏 + DtPageState
├── components/
│   ├── Twin2dToolbar.vue           保存/撤销/重做/工具切换/吸附/适应/诊断
│   ├── EditorCanvas.vue            视口壳：平移缩放、坐标换算、指针总线
│   ├── CanvasGrid.vue              网格与设计框遮罩
│   ├── CanvasNodeLayer.vue         节点层：拖动、选中、旋转手柄、端口点
│   ├── CanvasEdgeLayer.vue         连线层（复用 Twin2dEdgeLayer）+ 命中带
│   ├── CanvasEdgeHandles.vue       拐点/端点把手（一手势一步撤销）
│   ├── CanvasMarkLayer.vue         标注绘制与八手柄缩放（按 zOrder 分两层）
│   ├── CanvasMarquee.vue           框选
│   ├── CanvasConnectPreview.vue    连线预览虚线
│   ├── NodePalette.vue             样式库调色板（分组 + 拖拽）
│   ├── StyleLibraryDrawer.vue      样式库管理（新建/复制/恢复内置/导入导出）
│   ├── Twin2dOutline.vue           左栏大纲（节点/连线/标注/样式四段）
│   ├── OutlineRow.vue
│   ├── Twin2dInspector.vue         右栏分发
│   ├── inspector/{Node,Edge,Mark,Canvas,Style}Inspector.vue
│   ├── inspector/{PrimTree,PrimFields,VariantFields}.vue
│   ├── fields/{Placement,Geometry,Color,Transition}Field.vue
│   ├── fields/{StrokePassList,FillList,ShadowList,PortList,SlotList,ExprEditor}.vue
│   ├── Twin2dBindingPane.vue       复用 BindingPanel
│   ├── Twin2dRuntimePreview.vue    画中画运行态
│   └── Twin2dDiagnostics.vue
└── scripts/
    ├── types.ts                    页面内选中态等
    ├── twin2dDoc.ts                文档态 + 撤销栈（照 twinDoc.ts）
    ├── useTwin2dEditorPage.ts      取数与落库（整树替换，走 useRacedFetch）
    ├── editorSelection.ts          四条选中轴（节点/连线/标注/样式）
    ├── {node,edge,mark,style,prim,port,waypoint}Ops.ts
    ├── snapping.ts / viewportOps.ts / clipboard.ts / shortcuts.ts
    ├── useCanvasPointer.ts         指针手势状态机
    ├── useTwin2dBindings.ts / useTwin2dLiveValues.ts
    └── stylePackage.ts             样式包导入导出（JSON）
```

结构闸的三条硬约束（`check_page_directories` / `check_page_scripts_in_one_dir`）都遵守：
页面根只有 `index.vue`、私有组件只在 `components/` 且只有 `.vue`、脚本只在 `scripts/` 且只有 `.ts`。
`useUnsavedGuard` **不在这里**——它提到 `app/src/composables/` 与 `TwinEditor` 共用（§19 R0b）。

### 3.4 行数量级（诚实版）

对照实物：`@dt/twin-config` 是比本模型**简单得多**的文档契约（无图元树、无变体、
无多层填充、无 SVG 几何），全包仍有 **4232 行**，光 `types.ts` 就 **672 行**；
`TwinEditor` 整页是 **79 个文件 / 10723 行**（仅源码）。据此：

| 落点 | 源 | 测试 | 合计 |
|---|---|---|---|
| `@dt/twin2d`（含 presets 与 render） | ≈ 7 500 | ≈ 6 500 | ≈ 14 000 |
| `packages/modules/src/modules/twin-2d-view/` | ≈ 500 | ≈ 700 | ≈ 1 200 |
| `app/src/pages/Twin2dEditor/` | ≈ 11 000 | ≈ 4 500 | ≈ 15 500 |
| 跨包契约测试（`app/tests/contract/twin2d-*`，5 条；另 5 条落在 `packages/twin2d/tests/`，已计进第一行，§17.2） | — | ≈ 600 | ≈ 600 |
| **合计** | **≈ 19 000** | **≈ 12 300** | **≈ 31 300** |

> ⚠ `paint.ts` 一个文件装不下：四种 kind × 五档 `fills` × 四边 border × 三形 radius ×
> inset/outset shadows × 六项 flex × 五档摆位 × rotate/keepUpright，加上五种 SVG 几何、
> 多遍描边、局部渐变与 `--t2-*` 注入。所以第一天就拆成
> `paintBox` / `paintVec` / `paintText` / `paintCommon` 四个文件——`.ts` 没有行数闸，
> 但一个两千行的纯函数文件没人改得动，而它正是预置库退化的第一现场。

---

## 4. 文档契约（落在 `configJson.twin2d`）

```ts
export const TWIN_2D_CONFIG_KEY = 'twin2d'
export const TWIN_2D_CONFIG_VERSION = 1

export interface Twin2dConfig {
  version: number
  canvas: Twin2dCanvas
  /** 节点样式库：**用户新建或改过的**那些。未出现在这里的 id 落回预置库。 */
  styles: Twin2dNodeStyle[]
  edgeStyles: Twin2dEdgeStyle[]
  nodes: Twin2dNode[]
  edges: Twin2dEdge[]
  marks: Twin2dMark[]
}
```

### 4.1 画布

```ts
export interface Twin2dCanvas {
  width: number          // 设计坐标，≥200
  height: number         // ≥200
  grid: number           // 2..200
  showGrid: boolean
  /** 底图：'' | asset:<uuid> | http(s):// | data: | CSS background 简写 */
  background: string
  backgroundFit: 'cover' | 'contain' | 'stretch' | 'tile'
  /** 底纹图案：'none' | 'weave'（45° 双向斜织）| 'dots' | 'lines' */
  pattern: Twin2dPattern
  patternColor: string
  patternGap: number
  patternWidth: number
}
```

> ⚠ 画布尺寸与大屏的 `designWidth/Height` **无关**：这是一张图自己的坐标系，
> 上到大屏后按 §9.1 的等比缩放贴进模块矩形。两者混为一谈的表现是「换了大屏分辨率，
> 图上所有线宽都变了」。

### 4.2 图元：四种，闭合

```ts
export const TWIN_2D_PRIM_KINDS = ['box', 'vec', 'ico', 'txt'] as const
export type Twin2dPrimKind = (typeof TWIN_2D_PRIM_KINDS)[number]

interface Twin2dPrimBase {
  /** 样式内唯一。节点级覆盖、变体补丁都按它寻址；也是 v-for 的 key。 */
  id: string
  at: Twin2dPlacement
  size: Twin2dSize            // { w: Len, h: Len }，Len = number(px) | `${n}%` | `${n}em` | 'auto'
  minWidth: Twin2dLen | null
  maxWidth: Twin2dLen | null
  z: number
  opacity: number
  hidden: boolean
  /** 不满足则整枝不渲染。参考项目「能量三件套」那种条件块靠它表达。 */
  when: Twin2dCondition | null
  /** keyframes 动画。与 transition 是两件事：这一档是循环播放，那一档是属性变化的补间。 */
  anim: Twin2dAnim | null     // { kind:'none'|'pulse'|'blink'|'breathe'|'dash', durationMs }
  /** 属性过渡。缺席 = 瞬变。预置库里逐处填 { durationMs: 180, easing: 'ease' }。 */
  transition: Twin2dTransition | null   // { props: readonly Twin2dTransitionProp[], durationMs, easing }
  rotate: number              // deg，绕 transformOrigin
  /** 等比缩放，缺省 1；与 rotate 共用 transformOrigin。参考项目的 .tnv-box__icon 那处
   *  hover scale(1.08) 落在这里。⚠ 归一化按尺寸类正数收：0 与负数一律回 1。 */
  scale: number
  transformOrigin: string     // 缺省 '50% 50%'；悬浮卡的两档是 '50% 100%' / '50% 0'
  /** 'none' 时整枝不吃指针事件。⚠ 悬浮卡不设它会 hover 自我抖动（§9.3）。 */
  pointerEvents: 'auto' | 'none'
  /** 节点整体旋转时本图元反向旋转保持正立（电路图的元件标号惯例）。 */
  keepUpright: boolean
}
```

> ⚠ **图元自己的 `rotate` 与 `scale` 合成一条 `transform`，顺序与节点级同族**
> （`平移 → 旋转 → 缩放`，§4.6 的 `nodeTransformCss` 是同一族）：CSS 的变换列表从右往左
> 作用到点上，等比缩放排在最右即最先作用，于是摆位的位移量不被它放大，而等比缩放与
> 旋转可交换，`keepUpright` 的反向角也不受它影响。`paintCommon.ts` 的 `transformCss`
> 是唯一实现。

> ⚠ **`transition` 是一个独立字段，不能靠 `anim` 顶。** 参考项目有七处
> `transition: 0.18s ease`（`.tnv-box` / `.tnv-tank` / `.tnv-square__tile` /
> `.tnv-box__icon` / `.tnv-cyl__outline` / `.tnv-energy-pct` / `.tnv-energy-tip`），
> 它们是**属性过渡**；`anim` 那一档是 keyframes 循环。变体走浅合并换内联样式 = 瞬变，
> 少了 `transition` 的表现是「哪儿都能配、就是手感不一样」——没有一处报错。
> `Twin2dTransitionProp` 是闭合的六档：`transform` / `opacity` / `background` /
> `border-color` / `box-shadow` / `filter`（任意 CSS 属性名会让消毒面变大而收益为零）。

```ts
export interface Twin2dBoxPrim extends Twin2dPrimBase {
  kind: 'box'
  layout: Twin2dLayout        // { flow:'row'|'col'|'none', gap, align, justify, wrap, pad:[t,r,b,l] }
  fills: Twin2dFill[]         // 多层，从下往上；solid | linear | radial | repeat | image
  border: Twin2dBorder        // { width, style, color, sides }
  radius: Twin2dRadius        // number | 'pill' | [tl,tr,br,bl]
  shadows: Twin2dShadow[]     // { inset, x, y, blur, spread, color }
  backdropBlur: number
  clip: boolean
  cursor: 'default' | 'help' | 'pointer'
  children: Twin2dPrim[]      // 递归，深度上限 6
}

export interface Twin2dVecPrim extends Twin2dPrimBase {
  kind: 'vec'
  /** 几何。coord='unit' 时坐标是本图元盒的 0..1 归一值，'px' 时是设计像素。 */
  coord: 'unit' | 'px'
  shape: Twin2dShape
  fill: Twin2dPaint           // { kind:'none' } | { kind:'color', color } | { kind:'gradient', id }
  strokes: Twin2dStrokePass[] // 多遍描边，从下往上
  gradients: Twin2dGradient[] // 局部渐变；id 在本图元内唯一
  /** viewBox 是否按 preserveAspectRatio="none" 拉伸（参考项目的圆柱就是拉伸的）。 */
  stretch: boolean
}

export type Twin2dShape =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'poly'; points: readonly (readonly [number, number])[]; closed: boolean }

export interface Twin2dIcoPrim extends Twin2dPrimBase {
  kind: 'ico'
  src:
    | { kind: 'none' }
    | { kind: 'name'; name: string }                 // @dt/ui 的 DtIcon 注册名（lucide 单色线性）
    | { kind: 'sprite'; id: Twin2dSpriteId }         // 内置手绘图标集（§5）
    | { kind: 'asset'; ref: string }                 // asset:<uuid> / URL / data:
    | { kind: 'draw'; viewBox: [number, number]; parts: readonly Twin2dDrawPart[] }
  /** 缺省 'currentColor'。⚠ 对 `sprite` 一档无效——那批图标是硬编码多色的（§5）。 */
  color: string
}

/** `draw` 一档的一笔：一个受限的 vec（无子树、无摆位、无变体）。 */
export interface Twin2dDrawPart {
  shape: Twin2dShape
  fill: Twin2dPaint
  strokes: Twin2dStrokePass[]
}

export interface Twin2dTxtPrim extends Twin2dPrimBase {
  kind: 'txt'
  src:
    | { kind: 'lit'; text: string }                  // 字面量（「输出」「kWh」这类）
    | { kind: 'slot'; slot: string }                 // 读一个槽位的值
    | { kind: 'label' }                              // 节点显示名
    | { kind: 'id' }                                 // 节点 id（兜底）
  font: FontValue             // ★ 直接复用 @dt/contracts 的 FontValue，缺席键=跟随主题
  align: 'start' | 'center' | 'end'
  baseline: 'auto' | 'baseline' | 'center'
  nowrap: boolean
  ellipsis: boolean
  /** 溢出时把完整文本挂到 title 属性上。 */
  titleAttr: boolean
  shadows: Twin2dShadow[]     // → text-shadow
  /** 描边字（标注标签用）：SVG 的 paint-order stroke 那一套。 */
  outline: { width: number; color: string } | null
}
```

四种够不够？逐条验：**角标**是 `box`（绝对定位、pill 圆角、实心底、1.5px 边框、外发光）
套一个 `txt`；**状态圆点**是 7×7 的 `box`（圆角 50%、实心底、外发光）；
**传感器药丸**是 `box`（inline flex、pill、边框、底色、外发光）套三个 `txt`；
**图标底板**是 `box` 套 `ico`；**悬浮卡小箭头**是一个 `vec` 的 `poly`（伪元素在新模型里
没有位置，改成显式图元反而能被编辑器选中和改）。所以角标 / 圆点 / 药丸 / 箭头都不是
一等图元——它们是**预置的图元组合**，这才叫「内置库只是预置数据」。

> ⚠ 图元树深度上限 6，与模板嵌套 ≤6 层的闸门无关（渲染是递归组件，模板只有 3 层），
> 这条限制纯粹是防「用户造出一棵一千层的树把浏览器摁死」。归一化时超深截断并进诊断。

### 4.3 摆位：五档

```ts
export type Twin2dPlacement =
  | { kind: 'flow' }                                              // 参与父级 flex 流
  | { kind: 'fill'; inset: [Len, Len, Len, Len] }                  // 绝对铺满/内缩
  | { kind: 'abs'; left: Len|null; right: Len|null; top: Len|null; bottom: Len|null;
      tx: string; ty: string }                                    // tx/ty 是**自身尺寸**百分比或 px
  | { kind: 'anchor'; anchor: Twin2dAnchor9; dx: number; dy: number }
  | { kind: 'perim'; t: number; gap: number; dx: number; dy: number }
```

> ⚠ `anchor`（九档：t/b/l/r/tl/tr/bl/br/c）与 `perim`（周长参数 + 法线推移）的位移
> 数学**不同**，不许统一：九档用的是一张固定的 tx/ty 百分比表（例如 `t` 是
> `left:50%; top:0; translate(-50%, -115%)`），`perim` 用的是法线把图元整体推出去
> 半个自身尺寸。统一成一种会让贴在角上的药丸整体挪位——而这在「两个都能用」的
> 表面下看不出来。两套都逐值照抄，`placement.test.ts` 各锁一遍。

### 4.4 端口（引脚）

```ts
export interface Twin2dPort {
  id: string                  // 连线按它挂；预置样式沿用 'l' | 'r' | 't' | 'b'
  name: string                // 引脚名：1 / 2 / A / K / VCC / GND
  at: { kind: 'perim'; t: number } | { kind: 'xy'; x: number; y: number }  // xy 是 0..1 归一
  dir: 'in' | 'out' | 'both' | 'passive'
  /** 出线方向，决定贝塞尔控制点与正交首段朝向。 */
  side: 'top' | 'right' | 'bottom' | 'left' | 'auto'
  showName: boolean
  /** 引脚符号：一个受限的 vec，**必须带线宽与颜色**。 */
  marker: Twin2dPinMarker | null
}

export interface Twin2dPinMarker {
  shape: Twin2dShape
  strokes: Twin2dStrokePass[]   // { width, color, dash, cap, join, opacity, nonScaling }
  fill: Twin2dPaint
  /** 沿 side 方向伸出多长（设计像素）。 */
  length: number
}
```

> ⚠ **`marker` 不能只给形状。** 电路图里引脚短横线的**线宽**恰恰是最要紧的一项：
> 只给 `shape` 时线宽落到 SVG 默认的 1px，整张图的引脚粗细与导线对不上，
> 而这既不报错也不像 bug，只像「画得难看」。
>
> ⚠ **`side: 'auto'` 必须在几何层解析掉。** `perim` 端口按 `t` 落在哪条边推；
> `xy` 端口**没有周长参数**，按 `(x, y)` 到四条边的最近边推，并列时按固定序
> `top > right > bottom > left`。正交路由 `orthogonalRoute()` 只吃四档 `Side`——
> 让 `'auto'` 流进去就是 undefined 行为：路由会取到一个隐式的 `undefined` 分支，
> 表现是这一条线从节点中心横穿出去，而其余线全对。
> `geometry.test.ts` 对 `perim` 四段与 `xy` 的四个象限各锁一条。

参考项目的四边中点 = 四个 `{kind:'perim', t: 0.125|0.375|0.625|0.875}`、
`id` 沿用 `l/r/t/b`，所以**预置样式的端口 id 与它一一对得上**。

### 4.5 槽位、派生槽、变体与条件

```ts
export interface Twin2dSlot {
  key: string
  label: string
  /** 'live' = 有数据来源、成一行绑定；'derived' = 由 expr 算出来，不成行。 */
  kind: 'live' | 'derived'
  dataType: BindingDataType   // 复用 @dt/contracts
  unit: string
  /** null = 整数直出、小数走 fmtTrim(v, 1)；给了数就走 fmtFixed。 */
  precision: number | null
  /** ⚠ 键是**字符串**：JSON 的键永远是字符串，标成 number 时 Object.entries
   *  出来的键与数值点位值比较会静默不相等（@dt/contracts 的 BindingSpec 同款注释）。 */
  enumMap: Record<string, string>
  placeholder: string         // 缺省 '—'
  primary: boolean
  /** kind:'derived' 时的算式，见 §9.5。 */
  expr: Twin2dExpr | null
}

export interface Twin2dVariant {
  id: string
  when: Twin2dCondition
  /** primitiveId → 浅覆盖。只覆盖显式给出的键。 */
  patch: Record<string, Twin2dPrimPatch>
  /** 作用在节点根上的覆盖（抬升、等比缩放、外发光、边框色、z、强调色）。
   *  ⚠ 缺席的键 = 不覆盖；`lift` 与 `scale` 是同一条根 transform 上的两段，
   *  `translateY(-3px) scale(1.025)` 那一档两样都要给。 */
  rootPatch: Twin2dRootPatch
}

export type Twin2dCondition =
  | { kind: 'state'; state: Twin2dState }                 // hover|selected|alarm|active|flipped
  | { kind: 'status'; in: readonly Twin2dStatus[] }
  | { kind: 'tag'; key: string; in: readonly string[] }   // ★ 子类靠它（§6.3）
  | { kind: 'slot'; slot: string; op: ThresholdOp; value: number|null; value2: number|null }
  | { kind: 'has'; slots: readonly string[]; mode: 'any' | 'all' }
  | { kind: 'not'; of: Twin2dCondition }
```

`op` 直接复用 `@dt/modules/shared/thresholds` 的八档算子名
（`lt` / `lte` / `gt` / `gte` / `between` / `outside` / `eq` / `neq`）。
⚠ 但**不 import** 那个模块——`@dt/twin2d` 不许依赖 `@dt/modules`（方向反了）。
在 `kinds.ts` 里另立一份同名闭合常量，并由 `twin2d-op-parity.contract.spec.ts`
断言两份逐项相同：两处各写一份、悄悄漂移的表现是「同一条 `between` 在阈值卡片上
成立、在 2D 图上不成立」。

⚠ **取数口径也是同一套**：变体阈值判定、派生槽求值与槽位显示三处都用 `format.ts` 的
`isPresent`——只认真正的有限数。实时点位值那条链路上的 `'60'` 是**脏数据不是笔误**
（`@dt/modules` 的 `shared/config` 写明了这条分工），认它的表现是 `>40` 的变体命中了、
派生槽也拿它算了，而墙上那一格显示的仍是未经格式化的原样文本。手写配置里的数字串
（阈值的 `value`/`value2`、几何数值那些）照旧走宽口径的 `toFiniteNumber`。

变体求值顺序 = 文档序，后者覆盖前者。

### 4.6 节点与连线实例

```ts
export interface Twin2dNode {
  id: string
  styleId: string
  x: number; y: number        // 左上角，设计坐标（落库取 Math.round）
  w: number; h: number
  rotate: 0 | 90 | 180 | 270
  flipX: boolean; flipY: boolean
  label: string
  labelPos: 'bottom' | 'top' | 'left' | 'right' | 'inside' | 'hidden'
  status: Twin2dStatus | ''   // '' = 由样式的 defaultStatus 决定
  accent: string              // '' = 用样式的强调色
  badge: string
  badgeColor: string
  badgeShape: 'round' | 'square' | 'diamond'
  /** ★ 子类等「不改结构只改外观」的维度：变体的 {kind:'tag'} 读它（§6.3）。 */
  tags: Record<string, string>
  /** ★ 这三样让「每一个节点都可定制」：追加槽位、追加图元、覆盖样式里某个图元。 */
  slots: Twin2dSlot[]
  layers: Twin2dPrim[]
  patch: Record<string, Twin2dPrimPatch>
  /** 追加或按 id 覆盖样式里的端口。 */
  ports: Twin2dPort[]
}

export interface Twin2dEdge {
  id: string
  styleId: string
  from: Twin2dEndpoint        // { nodeId, portId: string, t: number | null }
  to: Twin2dEndpoint
  route: 'auto' | 'orthogonal' | 'step' | 'bezier' | 'straight'
  waypoints: readonly { x: number; y: number }[]
  accent: string
  label: string
  labelAt: number             // 0..1 沿折线弧长（§8）
}
```

端点解析优先级（三级）：`t`（周长参数）> `portId` > 朝向对方中心。

**旋转与镜像的复合顺序写死一条**（`transform.ts` 是唯一实现）：

```
根 transform 字符串 = translate(x, y) rotate(θ) scale(sx, sy)
等价的点变换顺序   = 先镜像 → 再旋转 → 最后平移
portWorldPos(p)    = origin + rotate(θ, flip(p))      ← 同一个顺序
```

> ⚠ **先转后镜 ≠ 先镜后转。** 这类顺序错在对称符号上肉眼看不出来，在二极管、
> 三极管这种非对称符号上就是**极性反了**——图画得挺好，接线是错的。
> `transform.test.ts` 用一枚二极管（阳极端口在左、阴极在右、外形不对称）
> 锁 4 档 `rotate` × 4 种 `flip` 共 **16 组端口坐标**。
> ⚠ 节点 `x/y` 是**左上角**，而 `geometry.ts` 的盒以**中心**为参考。换算漏了的表现是
> 全图连线整体偏半个节点，而它看起来像「锚点算错了」。`centerBoxOf()` 是唯一换算入口。
> ⚠ 参考项目里 `fromT/toT`（沿单边参数）这一对字段本身已经是「只能重置不能设」的
> 遗留物，**不搬**：新仓第一天就带一个改不了的字段是纯负债。

### 4.7 标注

```ts
export interface Twin2dMark {
  id: string
  kind: 'rect' | 'line' | 'text'
  x: number; y: number
  w: number; h: number        // rect
  x2: number; y2: number      // line
  text: string
  font: FontValue
  labelPos: 'inside' | 'top' | 'bottom'
  labelAlignH: 'left' | 'center' | 'right'
  labelAlignV: 'top' | 'middle' | 'bottom'
  stroke: string; fill: string; strokeWidth: number; strokeDash: boolean
  opacity: number
  zOrder: 'below' | 'above'
  /** ⚠ 参考项目的标注描边随舞台缩放（连线不随）。这里做成显式开关，
   *  否则「小尺寸模块上线突然变粗」查不出所以然。 */
  nonScalingStroke: boolean
}
```

`kind: 'text'` 是新增的一档（参考项目没有独立文字标注）——画电路图要写网络标号、
图框标题、图例，而把文字硬塞进一个透明矩形里是绕路。

---

## 5. 内置图标：`ico` 的第四档来源 `sprite`

参考项目那 11 枚节点图标**不是** lucide 图标，也不是素材：是一份 10 KB 的
手绘 SVG sprite（`render/icons.svg`）。实地读过的事实：

| 事实 | 值 |
|---|---|
| symbol 数 | 11：`ico-src-waste-heat` / `ico-src-steam` / `ico-src-air-source` / `ico-src-solar` / `ico-vsl-tank` / `ico-vsl-manifold` / `ico-hx` / `ico-term-shower` / `ico-term-radiator` / `ico-term-ac` / `ico-tap` |
| viewBox | **各自不同**：`0 0 240 150` / `0 0 220 180` / `0 0 148 148` / `0 0 240 150`，其余 7 枚是 `0 0 48 48` |
| 内联渐变 | 4 个 `<linearGradient>`：`recoveryFill` / `hxFill` / `pumpFill` / `solarFill` |
| 绘图元素 | 70 个（30 path / 21 line / 12 rect / 7 circle） |
| 颜色 | **分两档**。4 枚能源源图标（`ico-src-*`）是插画式多色，全文件 14 种硬编码 hex 都在它们身上：`#7BD5FF` ×5、`#62DCFF` ×4、`#2FE9FF` ×3、`#0B2738` ×3、`#FF9B54` ×2、`#62FF8A` ×2、`#FFE65C` / `#FF5C7A` / `#D9F7FF` / `#1B4A62` / `#17495D` / `#16445F` / `#15425F` / `#0C2A38` 各 1。另 7 枚（`ico-vsl-*` / `ico-hx` / `ico-term-*` / `ico-tap`）**一个 hex 都没有**，描边与填充清一色 `currentColor`（共 52 处） |

`ico` 原来的三档一档都装不下：`name` 是 lucide 单色线性图标、艺术风格完全不同；
`asset` 要每次部署上传 11 个 SVG 且没有种子；`draw` 是单色受限笔画，
4 枚 `ico-src-*` 的内联渐变与多色它表达不了，另 7 枚单色的虽然画得出，
却要手工重描 52 处笔画（见下）。所以加第四档：

```ts
| { kind: 'sprite'; id: Twin2dSpriteId }
```

落地方式：`icons.svg` **原样搬**进 `@dt/twin2d/src/render/icons.svg`，由
`Twin2dIconSprite.vue` 以 `?raw` 内联挂载，节点内渲成 `<svg viewBox="0 0 48 48"><use href="#ico-…"/></svg>`。

| 契约 / 陷阱 | 说明 |
|---|---|
| `TWIN_2D_SPRITE_IDS` ↔ `icons.svg` 的 symbol id | `twin2d-sprite-ids.contract.spec.ts` 双向对齐：常量多一个 → 那一档永远渲染空白；文件多一个 → 用户永远选不到。两边都零报错 |
| sprite 宿主每个 DOM 文档挂一次 | 运行态挂在 `Twin2dStage.vue` 里，编辑器挂在 `EditorCanvas.vue` 里。⚠ 漏挂时 `<use href="#…">` 解析不到任何东西——**图标静默消失**，devtools 里 `<use>` 元素还在 |
| 外壳 viewBox 固定 `0 0 48 48` | 各 symbol 自带的 viewBox 由 `<use>` 按默认的 `xMidYMid meet` 贴合进来，所以 `240×150` 的那四枚会上下留白。这是参考项目的既有观感，逐值照抄 |
| ⚠ `ico.color` **按 symbol 分档生效** | `icons.svg` 的文件头注释写着「颜色走 currentColor」——**它对 7 枚单色 symbol 成立、对 4 枚 `ico-src-*` 不成立**，别把它当全局口径。7 枚单色档吃 `currentColor`，`ico.color` 直接生效；4 枚能源源图标的颜色是插画的一部分，写死在 sprite 里，`ico.color` 对它们**无效**。那 4 个 id 排成常量 `TWIN_2D_FIXED_COLOR_SPRITES`，检查器按它决定颜色控件禁不禁用，禁用时写明原因 |
| `TWIN_2D_FIXED_COLOR_SPRITES` ↔ `icons.svg` | `twin2d-sprite-ids.contract.spec.ts` 里一条断言：这份名单**逐项等于** `icons.svg` 里「hex 计数 > 0」的 symbol 集合。⚠ 名单少一个 → 那枚多色图标的颜色控件可点、点了没反应；多一个 → 一枚本可染色的图标被白白禁掉。两头都零报错 |
| ⚠ 渐变 id 是文档级的 | `recoveryFill` / `hxFill` / `pumpFill` / `solarFill` 四个 id 会占住整个 DOM 文档的命名空间。`Twin2dVec.vue` 给用户自建的局部渐变一律加实例前缀（`t2g-<instanceId>-<id>`），`twin2d-sprite-ids.contract.spec.ts` 顺带断言这个前缀方案永不产出上面四个名字 |

> ⚠ **不要把这 11 枚改写成 `draw`，连那 7 枚单色的也不要。**
> 多色那 4 枚要先给 `Twin2dDrawPart` 加渐变、把 `gradients` 从 `vec` 提到基类；
> 单色那 7 枚不缺能力，缺的是人——52 处笔画要一笔一笔重描。两边合起来是
> 逐枚手工重画 70 个绘图元素的一整块内容工作，而重画出来的东西与参考项目
> **必然不逐像素相同**，却没有任何一条测试看得出来。
> 拆着搬更糟：11 枚里 4 枚走 `sprite`、7 枚走 `draw`，同一批图标就有了两条渲染路径
> 与两套尺寸口径，而它们本该长得像一家人。

---

## 6. 预置库：一批**有意不跟随换肤**的取值

### 6.1 `presets/palette.ts` 写字面 hex

参考项目 11 种节点色、4 种子类色、5 种连线色、4 种传感器色、圆柱三种描边的全部来源
是 `--chart-series-1..5`（+`-rgb`）、`--chart-hot`、`--chart-cold` 这一组 token——
**本仓没有这一组**。本仓的系列色板是 `packages/modules/src/shared/chart/theme.ts` 的
`SERIES_VARS`，六个语义 token（`--accent-primary` / `--state-success` / `--state-warning` /
`--state-danger` / `--accent-secondary` / `--state-idle`），六套换肤预设都跟着它走。

**拍板：预置库的配色写成 `presets/palette.ts` 里的字面 hex，不跟随换肤。**

```ts
/** 预置样式的配色。⚠ 这是全仓唯一一批不跟随换肤的取值，理由见 MODULE_TWIN_2D_DESIGN §6.1。 */
export const TWIN_2D_PALETTE = {
  wasteHeat: '#62ff8a',
  steam: '#ff5c7a',
  airEnergy: '#ff9b54',
  solar: '#2fe9ff',
  water: '#7bd5ff',
  alarm: '#ff6b6b',
  // …
} as const
```

这是一处**有意的偏离**，写在这里以免将来被当成疏漏改掉：

| | 说明 |
|---|---|
| 为什么合规 | 硬编码色值闸（`check_ts_style.py` 的 `check_no_hardcoded_colors`）只扫 `.vue` 的 `<style>` 块与各包 `src/` 下的 `.scss` / `.css`，**不扫 `.ts`**。而颜色在新模型里本来就是**文档数据**，不是样式代码 |
| 为什么不提升成 token | 新增 8 个 `--chart-*` token 要扩 `ThemeTokens` 的形状并给 6 套主题预设各配一份值，而且会与 `SERIES_VARS`「系列色从语义 token 派生」打成两个真源 |
| 为什么不映射到语义 token | `--state-success` 与 `#62ff8a` 不是一个颜色，映射过去就直接放弃了「预置样式与参考项目逐像素一致」这条 |
| **用户怎么让它跟随换肤** | 在样式检查器的颜色控件里把那一格改成 `var(--accent-primary)`（或任意 CSS 颜色 / `color-mix()`）即可。改过的样式落在 `config.twin2d.styles[]` 里，同 id 覆盖预置（§13.4）。**这是一个用户动作，不是一次发版** |

> ⚠ 与之配套的一条纪律：`twin2d.scss` 里**一个字面色值都不写**，全是 `var(--t2-*)`。
> 那份文件在包的 `src/` 下，硬编码色值闸扫得到它。
> ⚠ `paintCommon.ts` 注入 `--t2-*` 时只做**字符串拼接**（`var(a, var(b, c))` 这样的兜底链），
> **绝不解析取值**。解析一次就要读 token、就要监听换肤，`@dt/twin2d` 的 deps 里
> 就得加 `tokens`——而那正是这条决定要避开的耦合。
> ⚠ `rgba(var(--x-rgb), .5)` 这种写法**不触发**硬编码色值闸（正则要求 `rgba(` 后紧跟数字），
> 所以它在 scss 里合法。本仓 `tokens.scss` 里有 8 个 `-rgb` 变量可用——
> `--text-title-rgb`（30 行）、`--accent-primary-rgb: 0, 206, 252`（40 行）、
> `--accent-secondary-rgb`（42 行）、`--state-success-rgb`（46 行）、
> `--state-warning-rgb`（48 行）、`--state-danger-rgb`（50 行）、
> `--state-info-rgb`（52 行，转指 `--accent-primary-rgb`）、`--neutral-fg-rgb`（55 行）——
> `packages/ui` 里几十处 focus ring 与 toast 底色就是这么写的。所以参考项目那些
> `rgba(var(--state-danger-rgb), .45)` 形式的取值**原样搬即可**。
> ⚠ 只是本仓没有 `--chart-*` 那一族，所以引用 `--chart-series-5-rgb` 这类**不存在**的
> 变量仍然会让整条声明报废（§11.1）。

### 6.2 电路符号：本期出 8 枚，按 GB/T 4728

**拍板：`presets/circuit.ts` 本期出 8 枚**——电阻、电容、电感、二极管、开关、接地、
电源、接线点。这是「能画出一张最简单的电路图」的下界，也是验证图元模型真能表达
符号几何的最小实证（只给能力不给样例，第一个用户仍然画不出来）。

**符号标准取 GB/T 4728**（《电气简图用图形符号》，国内工程图纸口径）。与 IEC 60617
差异最大的两处，写在这里以免有人拿 IEC 的图去对：

| 符号 | GB/T 4728（本期采用） | IEC 60617 常见画法 |
|---|---|---|
| 电阻 | **空心矩形**，长宽比约 4:1，两端引脚 | 同为矩形（IEC 60617-4 已统一），但北美系常见的是折线锯齿形 |
| 接地 | **三横递减**（保护接地另有圆圈+三横的变体），一竖引下 | 三横递减或实心三角，各版本混用 |

每枚约 40–70 行预置数据（几何 + 两个端口 + 引脚 marker + 一个 `keepUpright` 的标号 `txt`），
`presets/circuit.ts` 合计 ≈ 450 行。

| 符号 | 端口 | 主要几何 |
|---|---|---|
| 电阻 | 2（左右，`xy`） | `rect`（空心）+ 两段 `line` 引脚 |
| 电容 | 2（左右） | 两条 `line`（平行极板）+ 两段引脚 |
| 电感 | 2（左右） | `path` 四个半圆弧 + 两段引脚 |
| 二极管 | 2（A/K，**非对称**） | `poly`（实心三角）+ `line`（阴极横杠）+ 两段引脚 |
| 开关 | 2（左右） | `line`（斜刀）+ 两个 `ellipse`（触点）+ 两段引脚 |
| 接地 | 1（顶） | 三条递减 `line` + 一段竖引脚 |
| 电源 | 2（+/−） | `ellipse` + 两条 `line`（极性号）+ 两段引脚 |
| 接线点 | 4（`perim` 四边中点） | 一个实心 `ellipse`（r=3） |

> ⚠ 二极管是 `transform.test.ts` 的锁具：它的两个端口**方向有意义**（阳极/阴极），
> 而外形也不对称，所以 4 档 `rotate` × 4 种 `flip` 的 16 组端口坐标是唯一能看出
> 「先转后镜还是先镜后转」的用例（§4.6）。

### 6.3 子类：25 种视觉组合怎么落

参考项目有一层「子类覆盖」：`SOURCE_CLASS_ICON`（4 档：`waste-heat` / `solar` /
`air-energy` / `steam`）+ `SOURCE_CLASS_COLOR`（同 4 档）+ `TERMINAL_KIND_ICON`
（3 档：`shower` / `hvac` / `heating`），它们**覆盖节点类型自带的 icon 与 accent**。
4 个源类型 × 4 个源子类 = 16 种、3 个末端类型 × 3 个末端子类 = 9 种，合计 25 种视觉组合。

**这一层不取消。** 落法不是造 25 个样式，而是新增一档变体条件：

```ts
{ kind: 'tag', key: 'subtype', in: ['waste-heat'] }
```

- 节点上多一个 `tags: Record<string, string>`（§4.6），`tags.subtype` 存子类；
- 4 个源类预置样式各带 **4 条**子类变体（`patch['icon'].src` 换 sprite id、
  `rootPatch.accent` 换调色板取值）、3 个末端类各带 **3 条**（只换 icon）；
- 7 个样式 × 3–4 条变体 = **25 条变体数据**，覆盖 25 种组合。

比造 25 个样式好在三处：预置库仍然是 11 个样式（与参考项目的类型数一一对得上）；
用户自建的样式**也能**用同一个机制（参考项目那边自定义类型永远拿不到子类下拉）；
`tag` 这一档同时把「按任意维度换外观」这件事一次做完（相位、介质、电压等级都能用）。

> ⚠ `tag` 的键与值都是**自由字符串**，不是枚举：归一化只做 trim 与长度上限，
> 不做白名单。做了白名单就等于把子类重新钉死成枚举，这一档就白加了。
> `twin2d-slot-refs.contract.spec.ts` 顺带断言预置库里每条 `tag` 变体引用的
> sprite id 都在 `TWIN_2D_SPRITE_IDS` 里。

---

## 7. 「参考项目的视觉件 → 新模型如何表达」逐条对照

这张表是本次迁移的**验收清单**，**100 行**，逐条从参考项目的三份样式块
（`TopologyNodeView.vue` / `TopologyViewer.vue` / `TopologySensor.vue`，约 96 个选择器块）
与 `render/` 下的六个 `.ts` 里数出来。每一行都要有一条对应断言，默认落在
`twin2d-preset-fidelity.spec.ts` 里；实现不在包里的那一行，断言跟着实现走。

> ⚠ 这张表是**清单**，不是穷举的证明。它数的是「已经找到的视觉件」；
> 真正的兜底是那条 fidelity 测试与 §17 的六条契约。任何一处「我们已经列全了」的
> 断言都要先能指着一个把它数出来的命令，否则不许写进文档。

**当前兑现水位：100 行里 99 行有断言。** 98 行落在 `@dt/twin2d` 的
`tests/twin2d-preset-fidelity.spec.ts` 里，用例名带行号（`§7-1` … `§7-100`），红了能直接
对回这张表；#97 的实现按「共享包的入场券是 ≥2 个真实消费方」留在模块目录，断言就跟着
实现走（`packages/modules/tests/modules/twin-2d-view/edgeState.test.ts`）。数法（在 `web/` 下）：
`grep -ohE '§7-[0-9]+' packages/twin2d/tests/twin2d-preset-fidelity.spec.ts | sort -u | wc -l`
得 98，加上模块目录那一行即 99。⚠ 别写 `sort -nu`：这些串不以数字开头，`-n` 会把它们
全判成相等而只剩一条。用例条数比行数大，因为有两行各带两条用例，别拿用例数当行数。
缺的那一行是**依赖尚未落地的东西**，排在对应的轮次里。

| 行 | 眼下锁住了什么 | 缺口与原因 |
|---|---|---|
| **缺** #73 标注标签定位 | 无 | 标注的两层 svg 渲染件还没落地（排 R9），落点算不出来就无从断言 |
| **半** #8 七处 0.18s | 六处载体逐处 180ms + ease、属性表闭合六档 | `.tnv-cyl__outline` 补间的 stroke / stroke-width 在六档属性表里表达不了，本模型那一处只补间 filter |
| **半** #22 悬浮卡翻转档 | `flipped` 这个档位名在状态表里 | 预置库里还没有那条 flipped 变体（`top: calc(100% + 10px)` / `translate(-50%, 4px)` / 基点 `50% 0` / 箭头描边 48%→62%） |
| **半** #71 标注缺省 | strokeWidth 2 / opacity 1 / stroke 与 fill 留空 / zOrder below / nonScalingStroke false | 两层 svg 的 `aria-hidden="true"` 与 `pointer-events: none` 没有断言 |

图例：✅ 逐值复刻｜🔁 复刻但换了实现基底或口径｜➕ 参考项目没有、本期新增｜⛔ 参考项目本身不存在，不做｜⏳ 要复刻但依赖的东西还没落地，排在后面的轮次

### 7.1 `shape=box`（7 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 1 | `.tnv-box` 容器 | flex row / gap 8 / pad 6 10 / border 1.5px accent / radius `--radius-md` / `linear-gradient(150deg, fill-a, fill-b)` / `inset 0 0 14px accent12%` + `0 0 8px accent22%` | `box`：`layout{flow:'row',gap:8,pad:[6,10,6,10]}`、`border{width:1.5,color:'var(--t2-accent)'}`、`radius:8`、`fills:[{kind:'linear',angle:150,stops:[…]}]`、`shadows:[{inset:true,blur:14,color:'color-mix(in srgb, var(--t2-accent) 12%, transparent)'},{blur:8,…22%}]` | ✅ |
| 2 | `.tnv-box__icon` 图标底板 | 34×34 grid place-items center / radius `--radius-sm` / **底色写死** `rgba(var(--accent-primary-rgb), .06)`（不跟节点色）/ border 1px accent40% / color accent；内部 svg 26×26 | `box`（34×34、`layout.flow:'none'`）套 `ico`（26×26）。⚠ 底色那一处**照抄写死值**，不改成 `--t2-accent` 派生——改了就与参考项目不一致，而这一处不一致只在换主题或换节点色时才看得见。`--accent-primary-rgb` 本仓有（§6.1），所以 `rgba(var(--accent-primary-rgb), .06)` **原样保留**，不换成 `color-mix()` | ✅ |
| 3 | `.tnv-box__body` | flex column / gap 2 / min-width 0 | `box{layout:{flow:'col',gap:2}}`（`min-width:0` 由 `box` 恒定输出，§9.4） | ✅ |
| 4 | `.tnv-box__title` | 18px/600 `--text-primary` / nowrap + ellipsis / title 属性挂完整文本 | `txt{src:{kind:'label'},font:{size:18,weight:600,color:'var(--text-primary)'},nowrap:true,ellipsis:true,titleAttr:true}` | ✅ |
| 5 | `.tnv-box__readings` | flex / align baseline / gap 8 | `box{layout:{flow:'row',align:'baseline',gap:8}}` | ✅ |
| 6 | `.tnv-val` 主读数 | `--font-digit` / 32px / ls .5 / color accent / `text-shadow 0 0 3px accent70%` | `txt{src:{kind:'slot',slot:主槽},font:{family:'var(--font-digit)',size:32,letterSpacing:0.5,color:'var(--t2-accent)'},shadows:[{blur:3,…70%}]}`。⚠ `--font-digit` 本仓没有，本期新增一个 token（§11.2） | 🔁 |
| 7 | `tnv--energy` 能量三件套布局 | `space-between` / gap 10 / `.tnv-val` 降到 28px；触发条件写死为 `category==='source' && shape==='box'` 且三个字段任一有限 | **不是分支，是预置样式**：四个源类样式自带这套图元；显示条件 = `when:{kind:'has',slots:['input_kwh','output_kwh','efficiency_pct'],mode:'any'}`。改成罐形不再静默丢功能——形状与内容在新模型里本来就是分开的两件事 | 🔁 |

### 7.2 悬停、过渡与合成层（10 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 8 | 七处 `transition: 0.18s ease` | **4 属性**（border-color / background / box-shadow / transform）：`.tnv-box` / `.tnv-box__icon` / `.tnv-energy-pct`；**3 属性**：`.tnv-tank` 与 `.tnv-square__tile`（border-color / box-shadow / transform）、`.tnv-cyl__outline`（filter / stroke / stroke-width）；**2 属性**：`.tnv-energy-tip`（opacity + transform） | 图元基类的 `transition:{props,durationMs:180,easing:'ease'}`（§4.2），预置数据里逐处填。⚠ 少了它 hover 是硬切——「哪儿都能配、就是手感不一样」。⚠ 六档属性表里没有 stroke / stroke-width，圆柱那一处只补间 filter（差异见 §7 开头的水位表） | ✅ |
| 9 | `.tnv:hover .tnv-box` | `translateY(-3px) scale(1.025)`；border→`color-mix(accent 86%, text-primary)`；**追加**一层 `radial-gradient(circle at 25% 0, accent18%, transparent 54%)` 叠在原渐变上；三重阴影 `inset 18px 18%` / `0 8px 18px rgba(0,0,0,.24)` / `0 0 18px 42%` | 变体 `{when:{kind:'state',state:'hover'}}`：`rootPatch.lift:3` + `rootPatch.scale:1.025`（两段合成同一条根 transform）、`patch['frame'].border.color`、`patch['frame'].fills` **追加**一层 radial、`patch['frame'].shadows` 整组替换。`fills` 是数组，所以「叠一层」是天然可表达的 | ✅ |
| 10 | `.tnv:hover .tnv-box__icon` | `scale(1.08)` / border 62% / `background: color-mix(accent 16%)` / `0 0 12px 34%` | 同一条 hover 变体里对 `patch['icon']` 的四项覆盖：`scale:1.08`（图元自己的等比缩放，§4.2）、`border.color`、`fills`、`shadows` | ✅ |
| 11 | `.tnv:hover .tnv-tank` | `translateY(-3px) scale(1.02)`（⚠ 与 box 的 1.025 **不同**）/ `inset 20px 18%` / `0 8px 18px rgba(0,0,0,.22)`（⚠ 与 box 的 .24 不同）/ `0 0 18px 40%`（⚠ 与 box 的 42% 不同） | 罐形预置样式自己的 hover 变体：`rootPatch.lift:3` + `rootPatch.scale:1.02`，**含那三处逐值差异** | ✅ |
| 12 | `.tnv:hover .tnv-square__tile` | `translateY(-3px) scale(1.04)` / `inset 18px 18%` / `.22` / `18px 42%` | 方块预置样式自己的 hover 变体：`rootPatch.lift:3` + `rootPatch.scale:1.04`（抬升与 box / tank 一样是 3px，只有放大倍数三家各不同）加三条阴影 | ✅ |
| 13 | `.tnv:hover .tnv-cyl__outline` | stroke→accent / width 1.8 / `drop-shadow(0 0 8px accent64%)` | 圆柱预置样式的 hover 变体，`patch` 到那个 `vec` 的 `strokes[0]` 与 `filter` | ✅ |
| 14 | `.topo-node-box:hover { z-index: 30 }` | 节点常态 `z-index:2`，hover 抬到 30 | `rootPatch.z` 在 hover 变体里给 30。⚠ **不抬升的话能量悬浮卡会被右邻节点整块盖住**——而它只在两个节点靠得近时才看得出来 | ✅ |
| 15 | 五处 `pointer-events: none` | `.tnv-energy-tip` / `.tnv-cyl__body` / `.tnv-tank__stubs` / `.tnv-name` / `.tnv-sensor-slot` | 图元基类的 `pointerEvents:'none'`（§4.2）。⚠ 悬浮卡不设它会**hover 自我抖动**：卡片弹出来盖住指针 → 节点失去 hover → 卡片收起 → 指针回到节点 → 再弹出 | ✅ |
| 16 | 三处 `will-change: transform` + `.topo-stage { contain: layout style }` | `.tnv-box` / `.tnv-tank` / `.tnv-square__tile` | `twin2d.scss` 的结构性规则（不是图元字段）：hover 变体作用在根上的图元固定带 `will-change`；舞台带 `contain: layout style`。⚠ 这两样是性能而非观感，不做成可配置项 | ✅ |
| 17 | 两处 `@media (prefers-reduced-motion: reduce)` | 一处关 `.tnv.is-alarm .tnv-{box,tank,square__tile}` 与 `.tnv-dot--pulse`；一处关 `.topo-edge` 流动 | `twin2d.scss` 里**一段**统一关掉：四个节点 keyframes + 连线流动。⚠ 关的是 `animation`，**不关 `transition`**——过渡是对用户操作的直接反馈，关掉反而让人以为卡住了 | ✅ |

### 7.3 能量悬浮卡（7 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 18 | `.tnv-energy-main` / `-label` / `-unit` | inline-flex baseline gap 4；字面量「输出」「kWh」12px `--text-secondary` | `box{layout:{flow:'row',align:'baseline',gap:4}}` + 三个 `txt`，两个是 `{kind:'lit'}` | ✅ |
| 19 | `.tnv-energy-pct` 能效胶囊 | pad 1 6 / border 1px accent52% / radius pill / digit 20px / lh 1.1 / ls .4 / bg accent14% / `0 0 8px accent26%` / transition 4 属性 | `box`（pill、border、fill、shadow、transition）套 `txt` | ✅ |
| 20 | `.tnv-energy-tip` 卡体 | abs left 50% top -10 / z 10 / **min-width 188px** / pad 8 10 / border 1px 62% / radius sm / **底色写死** `rgba(3,16,32,.98)` / 双层 background-image（180deg 渐变 + 50% 0 径向）/ `backdrop-filter blur(8px)` / 三重阴影 / opacity 0 / `transform translate(-50%, calc(-100% - 4px)) scale(.96)` / **`transform-origin: 50% 100%`** / transition opacity+transform | `box{at:{kind:'abs',left:'50%',top:-10,tx:'-50%',ty:'calc(-100% - 4px)'},minWidth:188,transformOrigin:'50% 100%',pointerEvents:'none',backdropBlur:8}` + hover 变体切 opacity/transform。⚠ 写死的 `rgba(3,16,32,.98)` 与 `rgba(0,0,0,.48)` 换成 `var(--surface-overlay)` 与 `var(--fx-shadow-menu)` 的取值——它们是「弹层的底与投影」，本仓已有语义 token | 🔁 |
| 21 | tip 小箭头 `::after` | 8×8 / rotate 45 / 两边 border / 同底色 | 一个 `vec{shape:{kind:'poly'}}`——伪元素在新模型里没有位置，改成显式图元反而能被编辑器选中和改 | 🔁 |
| 22 | tip 翻转档 `tnv--tip-bottom` | 由 `node.y < 120` 触发；tip 改 `top: calc(100% + 10px)` / `translate(-50%, 4px)` / **`transform-origin: 50% 0`**；hover 档 `translate(-50%, 8px)`；⚠ 箭头边框百分比从 48% 变 62% | 状态 `flipped`（运行时按同一条 `y < 120` 判定并注入）+ 一条变体，覆盖 `at` / `transformOrigin` / 箭头描边。**含那个 48%→62% 的差异**，逐值照抄 | ✅ |
| 23 | tip `__title`（**max-width 220px**）/ `__row` / `__row b` | title 12px + 220px 上限；三行 flex space-between gap 14；`b` 是 accent + digit + 15px + text-shadow | 一个 `box` 套三个 `box`，每行两个 `txt`；title 那个 `txt` 的 `maxWidth:220` | ✅ |
| 24 | 悬浮卡整体 `cursor: help` | 根节点加 `.tnv--energy` | `box.cursor:'help'` | ✅ |

### 7.4 `shape=tank`（6 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 25 | `.tnv-tank` 胶囊 | 纯 CSS：radius `--radius-pill` / pad 4 14 / `linear-gradient(180deg,…)`（⚠ 角度与 box 的 150deg 不同）/ `inset 16px 12%` + `0 0 9px 26%` | `box{radius:'pill',fills:[{kind:'linear',angle:180,…}]}`。**不是 SVG** | ✅ |
| 26 | `.tnv-tank__icon` | 30×30，svg 100%/100% | `ico{size:{w:30,h:30}}` | ✅ |
| 27 | `.tnv-tank__body` | flex col / center / text-align center / gap 2 | `box{layout:{flow:'col',align:'center',justify:'center',gap:2}}` | ✅ |
| 28 | `.tnv-tank__title` | 18/600 ellipsis max-width 100% | `txt{maxWidth:'100%'}` | ✅ |
| 29 | `.tnv-tank__reading` | digit 30px / ls .5 / accent / shadow 3px 70%；内容 = 温度 `·` 液位拼接 | `txt{src:{kind:'slot',slot:'reading'}}`，其中 `reading` 是一个**派生槽** `join(['temperature_c','level_pct'], ' · ')`（§9.5） | 🔁 |
| 30 | `.tnv-tank__stubs` 管接头 | abs left 24% right 24% bottom -5 h 5 / `repeating-linear-gradient(90deg, transparent 0 18px, accent 18px 20px)` / opacity .45 / pointer-events none | `box{at:{kind:'abs',left:'24%',right:'24%',bottom:-5},size:{h:5},pointerEvents:'none',fills:[{kind:'repeat',angle:90,stops:[…]}]}`——`fills` 多一档 `repeat` 就够 | ✅ |

### 7.5 `shape=cylinder`（10 件，全 SVG）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 31 | `.tnv-cyl__svg` | `viewBox="0 0 W H"` + `preserveAspectRatio="none"` + abs inset 0 + overflow visible | `vec` 图元统一渲在一层 `<svg>` 里，`stretch:true` 即 `preserveAspectRatio="none"` | ✅ |
| 32 | `__outline` | `<rect x=10 y=0 width=W-20 height=H>`（**无 rx，直角**）/ fill `--topo-cyl-fill` = `var(--surface-panel)` / stroke `rgba(series-5-rgb, .62)` / 1.2 / non-scaling | `vec{coord:'px',shape:{kind:'rect',x:10,y:0,w:W-20,h:H,rx:0},fill:{kind:'color',color:'var(--surface-panel)'},strokes:[{width:1.2,color:'color-mix(in srgb, <palette.water> 62%, transparent)',nonScaling:true}]}` | 🔁 |
| 33 | `__cap` ×2 的**填充** | `--topo-cap-fill: var(--surface-overlay)`——**端盖与体身不同色**（体身是 `--surface-panel`） | 两个 `vec` 的 `fill` 取 `var(--surface-overlay)`。⚠ **圆柱的立体感全在这一处**：抄成同色就变成一个平的矩形加两个椭圆边，而每一项数值都"对" | ✅ |
| 34 | `__cap` ×2 的几何与描边 | `<ellipse cx=10 / cx=W-10 cy=H/2 rx=10 ry=H/2>`（横半径固定 10、竖半径 = 半高）/ stroke `series-5 .7` | 两个 `vec{shape:{kind:'ellipse'}}` | ✅ |
| 35 | `__line--warm` | `y = cy-3`，x 14→W-14，stroke `series-2 .6`，1.2，round，non-scaling | `vec{shape:{kind:'line'}}` | ✅ |
| 36 | `__line--cool` | `y = cy+6`（⚠ 与 warm 的 -3 **不对称**），stroke `series-4 .6` | 同上，**含那个不对称的 -3 / +6** | ✅ |
| 37 | cyl `selected` / `alarm` | selected：stroke-width 2.5 + drop-shadow；alarm：stroke `--state-danger` + drop-shadow | 两条变体 | ✅ |
| 38 | `__icon` | abs left 7% top 50% ty -50% / 26×26 / z 2 | `ico{at:{kind:'abs',left:'7%',top:'50%',ty:'-50%'},z:2}` | ✅ |
| 39 | `__body` | abs `inset 0 14% 0 24%` / flex col center / z 2 / **pointer-events none** | `box{at:{kind:'fill',inset:[0,'14%',0,'24%']},z:2,pointerEvents:'none'}` | ✅ |
| 40 | `__title` / `__reading` | title 18/600 + `text-shadow 0 0 4px var(--topo-node-fill-b)`（⚠ 用**背景色**描边，不是 accent）；reading digit 30px | 两个 `txt`；title 的 `shadows[0].color` 取 `var(--t2-fill-b)`。⚠ 抄成 accent 会让标题在深色底上发绿光 | ✅ |

> ⚠ 圆柱几何是 `W = node.width ?? def.defaultSize.w`，且尺寸为 0/负数时
> **回退到样式默认而不是 0**（防 viewBox 除零）。归一化里 `posDim()` 照抄：
> 写成 `?? fallback` 只挡 `undefined`，挡不住显式的 `0`。

### 7.6 `shape=square` / `text`（5 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 41 | `.tnv-square` 外壳 + `__tile` | 外层 grid place-items center；tile 100%×100% / border 1.5 / radius md / gradient 150deg / `inset 14px 14%` + `8px 24%`；`svg` 宽高 **50%/50%**（不是固定 px） | 一个 `box{layout:{flow:'none'}}` 套 `box{at:{kind:'fill'}}` 套 `ico{size:{w:'50%',h:'50%'}}`——`Len` 支持百分比正是为这一件 | ✅ |
| 42 | `.tnv-square__label` | abs left 50% bottom -2 translate(-50%,100%) / **17px**（= 18−1）/ 600 / shadow 4px 50% | `txt{at:{kind:'abs',left:'50%',bottom:-2,tx:'-50%',ty:'100%'},font:{size:17}}` | ✅ |
| 43 | `.tnv-text__bar` | 3px 宽 × 1em 高 / bg accent / `0 0 6px accent` / **无圆角** | `box{size:{w:3,h:'1em'},radius:0,fills:[…],shadows:[…]}`。⚠ `Len` 要支持 `'1em'`，归一化白名单里加这一档 | ✅ |
| 44 | `.tnv-text__label` | 18/600 nowrap shadow 5px 45% | `txt` | ✅ |
| 45 | shape 兜底 | 模板里 `text` 分支是 `v-else`：任何未识别 shape 落这里 | 归一化里 `styleId` 找不到 → 落 `__fallback` 预置样式（一条 3px 竖条 + 显示名），**并进诊断**。静默兜底但说得出来；参考项目那边是纯静默 | 🔁 |

### 7.7 根容器、角标、状态点、显示名（11 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 46 | `.tnv` 根 | 100%×100% / box-sizing border-box / **font-family 写死** `'PingFang SC','Microsoft YaHei',sans-serif`（不是 token）/ 6 个局部变量 | `Twin2dNodeBox.vue` 的根：结构性样式在 scss 里，`--t2-accent` / `--t2-status` / `--t2-badge` / `--t2-fill-a` / `--t2-fill-b` / `--t2-anim-dur` 由 `paintCommon.ts` 注入。⚠ 字体族改走 `var(--font-sans)`——写死的那串在本仓是硬编码，而 `--font-sans` 的回退链里正好就有 PingFang / 雅黑，取值等价 | 🔁 |
| 47 | 内联 `--accent: var(${def.colorVar})` | **无二级兜底**：colorVar 拼错就整条无效，且内联优先级更高会遮蔽根上的兜底 → 描边/发光/读数色/角标兜底色一起丢 | `cssValue.ts` 的 `resolveAccent(node, style)` 拼出带兜底链的字符串（节点 accent → 样式 accent → `var(--accent-primary)`），注入的永远是有效值。参考项目连线侧有兜底、节点侧没有，两处不一致——这里统一成有 | 🔁 |
| 48 | `is-selected` | `box-shadow 0 0 0 2px accent, 0 0 16px accent45%`，作用在 box / tank / square-tile 三者 | 变体 `{state:'selected'}` → `rootPatch.shadows` | ✅ |
| 49 | `is-alarm` | `border-color: var(--state-danger) !important` + `animation tnv-alarm 1s infinite`（阴影 .45↔.9） | 变体 `{state:'alarm'}` + `anim:{kind:'breathe',durationMs:1000}`；keyframes 在 `twin2d.scss` 里是**固定的四个**，由 `--t2-anim-dur` 驱动。⚠ 新模型里没有 `!important`——变体补丁本来就是最后一层 | 🔁 |
| 50 | `.tnv-badge` 盒 | abs tl / `translate(-40%,-40%)` / min-w 18 h 18 / pad 0 3 / radius pill / bg `--badge-color` / border 1.5 `color-mix(text-primary 35%, badge)` / shadow `0 0 7px 75%` | 预置的 `box`，`--t2-badge` = `node.badgeColor \|\| accent` | ✅ |
| 51 | `.tnv-badge` 字 | 15px / 700 / **`color: var(--text-primary)`** / `place-items: center` / **`line-height: 1`** / font `'DIN Alternate'…` | 一个 `txt{font:{size:15,weight:700,lineHeight:1,color:'var(--text-primary)',family:'var(--font-display)'}}`，父 `box` 的 `layout{flow:'none',align:'center',justify:'center'}`。⚠ `line-height:1` 少了角标会被行高撑成椭圆；字体族改走 `var(--font-display)`（Chakra Petch，同为数字向的窄体） | 🔁 |
| 52 | `badgeStyle` 两档 | `circle-number` / `circle-letter` —— ⚠ 两个 modifier 类**没有任何 CSS 规则**，视觉完全相同 | `badgeShape` 三档 `round` / `square` / `diamond`。参考项目那两档**都映射到 `round`**，所以预置逐像素不变；`square` / `diamond` 是新增 | ➕ |
| 53 | `.tnv-dot` 状态点 | abs r5 b5 / 7×7 / 50% / bg `--dot-color` / shadow 6px / z 5；alarm 加 `tnv-dot-pulse`（scale 1↔1.35, opacity .75↔1） | 预置的 `box`（radius 50%）+ `anim:{kind:'pulse'}` | ✅ |
| 54 | status 五档配色 | online→`--state-success` / offline→**`--state-idle`**（⚠ 不是 `--state-offline`）/ warning→`--state-warning` / alarm→`--state-danger` + 脉冲 + 根 `is-alarm` / hidden→整点不渲染 | `paintCommon.ts` 的 `statusColor()` 逐档照抄，**含 offline 用 `--state-idle` 这一条** | ✅ |
| 55 | status 缺省两种行为 | 未声明 + `category==='label'` → 不渲染；未声明 + 其他 → `--state-success` | 样式上一个 `defaultStatus: Twin2dStatus \| 'hidden'` 字段。装饰类预置给 `'hidden'`，设备类给 `'online'`。**分类不再参与渲染判断**——`category` 在新模型里只是调色板分栏用的字符串 | 🔁 |
| 56 | `labelPos` 六档 | `bottom` = 各形状内部的「自然名位」；`top/left/right/inside` 走外置 `.tnv-name`（abs 四档定位，shadow 4px 50%，pointer-events none；max-width **按档不同**：`.tnv-name` 基线 160px，`inside` 那一档被 `.tnv-name--inside` 覆盖成 **92%**）；`hidden` 两边都不渲染 | 样式里两个 `txt` 图元：`id:'label-natural'` 与 `id:'label-outer'`（后者 `maxWidth:160`、`pointerEvents:'none'`）。`paintCommon.ts` 的 `labelVisibility(labelPos)` 决定哪个显示、外置那个用哪套 abs 值。四档 abs 值逐值照抄，上限跟着分档：`top/left/right` 三档 160px、`inside` 一档 92% | ✅ |

### 7.8 传感器药丸（4 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 57 | `.topo-sensor` 药丸 | inline-flex baseline / gap .28em / pad .12em .5em / radius pill / bg `--topo-node-fill-a` / border 1px `--sensor-color` / color 同 / shadow 6px 55% / lh 1.1 / nowrap / **16px**（其余尺寸都是相对它的 em） | 一个预置**图元组合** `SENSOR_PILL(kind)`：`box`（pill + border + fill + shadow，`font.size:16`）套三个 `txt`。四种传感器（TT/FT/PT/LT）= 四份预置数据，颜色/单位/默认槽各不同 | ✅ |
| 58 | `__kind` / `__val` / `__unit` | kind：700 / ls .04em / DIN 字体；val：digit / 700 / `text-shadow 0 0 5px currentColor`；unit：.78em / opacity .82，**unit 缺省时整个 span 不渲染** | 三个 `txt`；unit 那个由归一化按「`slot.unit` 是否为空」置 `hidden`。⚠ `Len` 支持 `em` 正是为这里的 `.78em` | ✅ |
| 59 | 药丸定位：`perimT` 分支 | 用节点盒构中心盒 → `perimeterPoint` 取点与法线 → `left/top` 用百分比，`transform` 用法线把药丸推出半个自身尺寸（`GAP` 常量 = 0） | `at:{kind:'perim',t,gap,dx,dy}`，`placement.ts` 逐行照抄那个 translate 表达式 | ✅ |
| 60 | 药丸定位：`anchor` 九档 | 一张固定的 tx/ty 百分比表；缺省/未知 → `'t'`；**外层 `.tnv-sensor-slot` 是 pointer-events none** | `at:{kind:'anchor',anchor,dx,dy}` + `pointerEvents:'none'`，九档表逐值照抄。⚠ 参考项目的**编辑器**只让选 4 档（l/r/t/b），渲染层支持 9 档——手写 `'c'` 能渲染但下拉里选不到，一改就丢。本仓的检查器**九档全给**，由 `twin2d-inspector-coverage.contract.spec.ts` 守住 | 🔁 |

### 7.9 连线（10 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 61 | 连线颜色 | `edgeKindMap.get(kind)?.colorVar ?? '--accent-primary'`，最终 `var(${colorVar}, var(--accent-primary))`（有二级兜底） | `edge.accent \|\| edgeStyle.accent`，`cssValue.ts` 同一条兜底链 | ✅ |
| 62 | `.topo-edge` 描边 | stroke-width 2 / `dasharray 10 10` / fill none / round / **`vector-effect: non-scaling-stroke`** | 一个 `Twin2dStrokePass{width:2,dash:[10,10],cap:'round',join:'round',nonScaling:true}` | ✅ |
| 63 | 四种路径 | `waypoints` 非空 → 圆角折线（r=8）**优先于** `pathType`；否则 `straight` / `bezier`（off = `max(40, hypot*0.4)`，控制点按端口方向，`points` 故意带 c2 让箭头相切）/ `orthogonal` ≡ `step`（同一分支） | `geometry.ts` 逐行搬。`route:'auto'` = 参考项目的缺省（走正交）。⚠ `orthogonal` 与 `step` 在参考项目里是**同一个实现**，新仓保留两个档位名但都指同一函数，并在 help 里写明 | ✅ |
| 64 | 圆角折线 | 每个内点 `rr = min(r, lenIn/2, lenOut/2)`；`rr<0.5` → 直角；方向点积 >0.999（约 <2.6°）→ 直角（防近共线时弧退化成半圆凸包）；坐标 `toFixed(1)` | 照抄，含那两条退化保护 | ✅ |
| 65 | 箭头 | 末两点求角 / size 10 / 展开 ±0.42 rad / polygon fill = 边色 / **属性 `opacity="0.82"`** / `v-show="e.arrow !== false"` | `marker:{kind:'arrow',size:10,spread:0.42,filled:true,opacity:0.82}`；`{kind:'none'}` 即无箭头 | ✅ |
| 66 | **方向反转的几何后果** | `reversed === true` 时：start/end 互换、sSide/tSide 互换、**并把 `waypoints` 整体 `reverse()`**，之后才进 `edgePath` | `geometry.ts` 的 `edgeGeom()` 里同一顺序。⚠ **只换端点不 reverse 拐点，带拐点的路径会自己交叉**——而它看起来像「拐点算错了」。`geometry.test.ts` 与 `Twin2dEdgeLayer.spec.ts` 各锁一条**带 waypoints** 的用例 | ✅ |
| 67 | 流动动画 | 只在 `config.animateFlow === true` 时给舞台加类；`--topo-flow-duration = (0.8/flowSpeed)s`；keyframes 终点 `stroke-dashoffset: -20`（= 一个完整 dash 周期 10+10） | 合成规则**只有一条**：`config.animateFlow` 是总闸（关掉时全部不动）→ `edgeStyle.flow{enabled, dash, durationMs}` 决定这条线动不动与基准时长 → 最终时长 = `durationMs / flowSpeed`。**dashoffset 终点由 `dash` 求和算出**，不写死 -20。⚠ 改了 dasharray 忘改 -20 会出现肉眼可见的抽动 | 🔁 |
| 68 | 非活跃边 | 运行时 `.topo-edge.is-inactive`：`dasharray 0`（变实线）+ `animation none` + `opacity .5`，线体与箭头都**照常渲染**；编辑器版 `.topo-flow-edge.is-inactive` **同样**是 `dasharray 0` + `animation none`，两处真正的差别是：① 它不压 opacity，而把描边整根换成 `var(--border-strong, #3a4a60)`；② `visibleEdge = active \|\| selected` + `v-if="visibleEdge"`——非活跃边**只在没被选中时才不渲染**，选中时照常画出来（连同箭头与把手） | `edgeStyle.inactive{opacity,dashOff,color}`；**编辑器与运行态共用同一份**（参考项目那两边差在「压透明度还是换灰描边」以及那条 `active \|\| selected` 的隐身规则，本仓没有存量，第一天就统一） | 🔁 |
| 69 | 双线 / 母线加粗 / 铁路线 | **不存在** | `strokes: StrokePass[]` 多遍描边：双线 = 宽底色 + 窄芯色；母线 = 单遍大 width；铁路线 = 宽实线 + 窄虚线。⚠ 不做「沿法线偏移整条路径」（那要做 path offsetting，对折线+圆角是一整块几何工作） | ➕ |
| 70 | 连线标签 | **不存在**：`edgePath` 返回的 label 锚点无人消费，落库形状里也没有 label 字段 | `edge.label` + `labelAt`（0..1 沿折线弧长，§8）+ `edgeStyle.label{font,box}`。可以是字面量，也可以绑 `edgeValues[i].value`。电路图的网络标号、工艺图的流量标注都靠它 | ➕ |

### 7.10 标注、舞台、底板（8 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 71 | 标注 rect / line | 两块**完全相同**的 svg 按 `zOrder` 分流到节点上/下；svg 上有 `aria-hidden="true"` + `pointer-events: none`；stroke/fill/width/dash/opacity 各有缺省；⚠ **没有** non-scaling-stroke（与连线相反） | `marks[]` + `nonScalingStroke` 显式开关（缺省 false = 与参考项目一致）；两层 svg 同样带 `aria-hidden` 与 `pointer-events:none` | ✅ |
| 72 | 标注标签排版 | 16px/600/ls .02em / **`paint-order: stroke`** / stroke = `color-mix(surface-base 80%)` 3px（描边字） | `txt.outline{width:3,color:'color-mix(in srgb, var(--surface-base) 80%, transparent)'}` → `paint-order: stroke`。⚠ 少了 `paint-order` 描边会盖在字上，字变虚 | ✅ |
| 73 | 标注标签定位 | rect 设了任一对齐 → 框内 9 宫格（pad 10）；否则按 labelPos 三档，且**框外档带 ±8 偏移**（top: `y-8` / bottom: `y+h+8`）；line 三档偏移 `-10` / `+14` / 居中；`dominant-baseline` 三档取值 | 逐值照抄，含 9 宫格的 pad 10、框外的 ±8、line 的 −10/+14 与三档 baseline | ✅ |
| 74 | 标注 zOrder 在编辑器里不生效 | 运行时分 below/above 两层，编辑器把全部标注塞进一个 `z-index:3` 的屏幕坐标浮层 → 配 below 的在编辑器里看着在上面、上大屏跑到下面（所见即所得在这一项上是假的） | 编辑器的标注层**也按 zOrder 分两层**，与运行态同一份组件。这是本次必须一起修的口径 | 🔁 |
| 75 | 舞台等比缩放 | `scale = min(bw/cw, bh/ch) * 0.96`（4% 安全留白硬编码）；居中偏移；`transform-origin 0 0`；`bw/bh ≤ 0`（首帧/隐藏）→ 只给宽高并 `visibility:hidden`（不产生 NaN transform） | `fitMode` 四档 + `fitPadding`（range 0–20，default **4**）。⚠ 首帧那条保护照抄——少了它首帧会写出 `translate(NaN,NaN)` 而画面只是空白 | 🔁 |
| 76 | 模块底板四层背景 | `.topo-module__body` 的 background-image 四层：中心径向光 `radial-gradient(ellipse 60% 60%, rgba(series-4-rgb, .1))` + 45° 与 −45° 双向斜织（1px 线宽 / 26px 间距，`--topo-weave` 兜底 `color-mix(accent-primary 5%)`）+ 竖向渐变；另有 `::before{content:none}` 显式关掉继承的伪元素 | `canvas.pattern:'weave'` + `patternColor` + `patternGap`（缺省 26）+ `patternWidth`（缺省 1）；中心径向光与竖向渐变落在 `canvas.background` 的 CSS 值上（它本来就吃 background 简写）。⚠ 参考项目里 `--topo-weave` / `--topo-bg-top` / `--topo-bg-bottom` **全仓无定义、只活在 `var()` 的 fallback 位**——所以实际生效的就是 fallback 表达式，照抄 fallback 即可 | 🔁 |
| 77 | 空态 | abs inset 0 / 居中 / `--text-secondary` / 0.9rem / 一句「未配置…数据」 | `Twin2dStage.vue` 的空态：一行字，文案「这张 2D 孪生还没有画任何节点」。⚠ 文案里不出现旧名 | 🔁 |
| 78 | 可点外观 | `.topo-node-box.is-clickable { cursor: pointer }`，由 `config.clickable` 开关驱动 | 由 `meta.interactive`（真配了联动规则才为真）驱动，**不设 `clickable` 开关**（§15.1） | 🔁 |

### 7.11 内置图标 sprite（11 件）

11 枚全部是 `ico{src:{kind:'sprite', id}}`（§5），外壳 `viewBox 0 0 48 48`。
`ico.color` **对 #79–#82 这 4 枚无效**（颜色是插画的一部分，写死在 sprite 里，
名单即 `TWIN_2D_FIXED_COLOR_SPRITES`）、**对 #83–#89 这 7 枚生效**（纯 `currentColor`）。
逐枚列出是为了让 fidelity 测试能一枚一条断言。

| # | symbol id | 自带 viewBox | 内联渐变 | 颜色（文件里的真实取值） | 预置样式里谁用 |
|---|---|---|---|---|---|
| 79 | `ico-src-waste-heat` | `0 0 240 150` | `recoveryFill`（`#17495D`→`#0C2A38`） | 6 色写死：`#0C2A38` `#17495D` `#2FE9FF` `#62FF8A` `#FF5C7A` `#FF9B54` | 余热源；子类 `waste-heat` 的变体目标 |
| 80 | `ico-src-steam` | `0 0 220 180` | `hxFill`（`#15425F`→`#0B2738`） | 6 色写死：`#0B2738` `#15425F` `#2FE9FF` `#62DCFF` `#7BD5FF` `#FF9B54` | 蒸汽源；子类 `steam` |
| 81 | `ico-src-air-source` | `0 0 148 148` | `pumpFill`（`#16445F`→`#0B2738`） | 5 色写死：`#0B2738` `#16445F` `#62DCFF` `#7BD5FF` `#D9F7FF` | 空气能源；子类 `air-energy` |
| 82 | `ico-src-solar` | `0 0 240 150` | `solarFill`（`#1B4A62`→`#0B2738`） | 6 色写死：`#0B2738` `#1B4A62` `#2FE9FF` `#62DCFF` `#7BD5FF` `#FFE65C` | 太阳能源；子类 `solar` |
| 83 | `ico-vsl-tank` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），5 处 | 储热水箱（罐形）。⚠ 图标里那条 `fill-opacity .25` 的波形是**静态图标的一部分**，不是液位 |
| 84 | `ico-vsl-manifold` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），10 处 | 分集水器（圆柱形） |
| 85 | `ico-hx` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），8 处 | 换热器 |
| 86 | `ico-term-shower` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），7 处 | 洗浴末端；子类 `shower` |
| 87 | `ico-term-radiator` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），10 处 | 采暖末端；子类 `heating` |
| 88 | `ico-term-ac` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），7 处 | 空调末端；子类 `hvac` |
| 89 | `ico-tap` | `0 0 48 48` | — | `currentColor`（跟随 `ico.color`），5 处 | 取水点 / 阀门 |

### 7.12 取值、格式化、状态归一与派生（11 件）

| # | 视觉件 | 参考项目的实现 | 新模型如何表达 | |
|---|---|---|---|---|
| 90 | 两套占位符 | 节点侧 `'—'`（em dash），传感器侧 `'--'`（两个 ASCII 连字符）。看着像不一致，但两处都有测试锁定 | `Twin2dSlot.placeholder`，预置数据里节点槽给 `'—'`（= `NO_DATA`）、传感器槽给 `'--'`。**差异保留**，因为它是槽位上的数据而不是代码里的常量——用户想统一自己改就行 | ✅ |
| 91 | 数值格式 | 整数 `String(v)`；小数 `toFixed(1)`；末尾拼 `unit`（空格分隔） | `format.ts`：`precision === null` 时整数直出、小数走 `fmtTrim(v, 1)`；给了数走 `fmtFixed(v, n)`。⚠ 与 `toFixed(1)` 的差别是**尾随零**：`63.40` → `63.4`。本仓 `fmtTrim` / `fmtDecimal` 的分工注释写明了这一取舍，本模块跟本仓口径 | 🔁 |
| 92 | `enum` 值 | 查数字表 `{0:'离线',1:'运行',2:'待机',3:'报警'}` | `Twin2dSlot.enumMap`（键是**字符串**）。⚠ 这与 API 契约「禁数字枚举」不冲突：那条约束的是**接口出参**，这里是一张展示映射表 | ✅ |
| 93 | kWh 短档 | `abs>=1000` → `(v/1000).toFixed(abs>=10000?0:1)+'k'`，否则 `String(Math.round(v))` | `fmtKwh(v, 2)`（本仓口径）。⚠ 判档用的是**取整后**的绝对值，所以 `999.6` 参考项目显 `1000`、本仓显 `1k`——这是本仓刻意的（同一屏上不并排出现两种写法），差异写在这里 | 🔁 |
| 94 | kWh 全档 | `Math.round(v).toLocaleString('zh-CN') + ' kWh'` | `fmtNumber(Math.round(v), 0) + ' kWh'`。⚠ `toLocaleString` **必须钉 `'en-US'`**（本仓全仓口径）：自托管 runner 是中文 locale、开发机是 en-US，不钉的话本地绿 CI 红。⚠ `.vue` 里禁 `toLocaleString(`（`check_formatting_is_centralised`），所以它只能待在 `.ts` 里 | 🔁 |
| 95 | 能效百分比 | `${fmtTrim(v, 2)}%`（**不是** `toFixed(1)`） | 同样 `fmtTrim(v, 2)`。⚠ 这是参考项目内部两种数值格式并存的一处：主读数走 `toFixed(1)`、能效走 `fmtTrim(,2)`，抄错了不会报错，只是小数位不同 | ✅ |
| 96 | 设备状态词表归一 | `toStatus` 先 `String(raw).trim().toLowerCase()`，再查**四组词表**：`running/run/on/ok/normal/good/1/true`、`warning/warn/uncertain/degraded/standby/idle/2`、`alarm/alert/fault/error/bad/critical/3`、`offline/off/down/disconnected/0/false`；都不中 → `unknown`，且 `unknown` **不覆盖**配置里的 status | 归一走本仓既有的 `@dt/modules/shared/status.ts` 的 `toDeviceStatus`（§10）。⚠ 两边差的**不只是 2 号档的名字**（本仓叫 `standby`、参考项目叫 `warning`），而是**整套词表**：本仓的 `toDeviceStatus` 只有 `NUMERIC_STATUSES = {0:offline,1:running,2:standby,3:alarm}` 加一个对五个字面档名的 `readEnum`（精确匹配、不 trim、不降大小写），现场返回 `"on"` / `"ok"` / `"normal"` / `"1"`（字符串）的点位在本仓一律落进 `unknown`，图上表现为「状态永远不亮」且零报错。**处置：给 `toDeviceStatus` 加一张同义词表**，排成独立小 PR R0d（§19） | 🔁 |
| 97 | 连线的活跃/方向词表 | `boolFromValue` 11 真词 / 12 假词，未知非空 → fallback；`reverseFromValue`：**boolean 一律 false**（设备 on/off 不表方向）、number `<0`、字符串先 `Number()` 再查词表 | 模块目录的 `edgeState.ts`：11 真词 / 12 假词逐词照搬（查表前 `trim().toLowerCase()`）、未知非空回落调用方给的缺省；`reverseFromValue` 三条判据照抄，含「boolean 不表方向」这条反直觉的规矩。⚠ **不进 `@dt/twin2d`**：包的类型面上只有已归一的 `Twin2dEdgeState`，而共享包的入场券是「已有 ≥2 个真实消费方」，眼下只有 2D 孪生有连线。断言在 `packages/modules/tests/modules/twin-2d-view/edgeState.test.ts` | ✅ |
| 98 | 容器读数拼接 | `温度 · 液位` 两个字段拼串 | 派生槽 `join(['temperature_c','level_pct'], ' · ')`（§9.5） | 🔁 |
| 99 | 能量三级兜底链 | `output = firstNumber(['output_kwh','outputKwh','today_kwh'])`；`efficiency = efficiency_pct → cop*100 → (output/input)*100`，⚠ 第三级带 **`input > 0`** 这个前置条件（`TopologyNodeView.vue:145`）——分母非正就整档不算，`efficiency` 留 `null`；`input = firstNumber(['input_kwh','inputKwh'])` | 派生槽的**可递归表达式**（§9.5）：`first([slot(a), slot(b), slot(c)])` 与 `first([slot(e), scale(slot('cop'),100), ratio(<output>, slot('input_kwh'), 100)])`。⚠ `input > 0` 不在派生槽里另写条件——`expr.ts` 的 `ratioValue` 自带等价守卫 `den === null \|\| den <= 0 → null`，分母 0 与负数都直接出 `null` | 🔁 |
| 100 | `legacyPrimaryFieldKey` | 主显键 `today_kwh` 在 `category==='source'` 时改读 `power_kw` 的绑定、`terminal` 时改读 `demand_kw` | **不做**。它是参考项目为自己的存量绑定留的兼容垫片，本仓没有存量文档；照搬等于第一天就带一条谁也解释不清的隐式改绑规则（§18） | ⛔ |

**逐条数完：100 件。** 其中 89 件带结论标记：✅ 逐值复刻 59、🔁 换基底或换口径 26、
➕ 参考项目没有 3、⛔ 不做 1；余下 11 件是 §7.11 的内置图标，
整份 sprite 原样搬（§5），不逐枚标。
数法：`awk '/^## 7\./,/^## 8\./' docs/MODULE_TWIN_2D_DESIGN.md | grep -cE '\| ✅ \|$'`
（其余标记同理）——⚠ 别用「grep 这个字符出现几次」来数，正文里也会出现它。

> ⚠ 三处「参考项目里根本不存在」的东西，照着它的类型定义做会做出多余功能：
> **罐形没有液位填充**（那条波形是静态图标的一部分，见 #83）、
> **次显数值（`secondaryField`）解析了但模板一次都没渲染**、
> **连线标签的 label 锚点算出来没人消费**。前两条本期不做，第三条本期做但记为新增。

---

## 8. 几何：一处真源

`geometry.ts` + `transform.ts` 从参考项目逐行搬，因为那套数学已经是对的，
而且有五个地方一改就错。

**周长参数化 `perimT ∈ [0,1)`**：顺时针绕节点盒一圈，原点在左上角，四等分
`top[0,.25) → right[.25,.5) → bottom[.5,.75) → left[.75,1)`。四个角点是精确值
（`t=0` 左上，法线 `(-√½,-√½)`；`t=.25` 右上；`t=.5` 右下；`t=.75` 左下）。

> ⚠ **`bottom` 与 `left` 两段是反向参数化的**（用 `1-local`）才构成顺时针闭环。
> 写成正向的表现是：只有下边和左边的药丸/端点左右（上下）镜像，其余三段全对——
> 这种「只在两条边上错」的 bug 靠肉眼看图基本发现不了。
> `geometry.test.ts` 对四段各取三个点断言。

**反投影 `projectToPerimT`**：取四条边中最近者，候选 t 分别是
`0+0.25*((cx-left)/W)`、`0.25+0.25*((cy-top)/H)`、`0.5+0.25*((right-cx)/W)`、
`0.75+0.25*((bottom-cy)/H)`，距离用 `Math.hypot`，最后 `wrap01`。
`wrap01(t) = ((t%1)+1)%1`，非有限 → 0。

**正交路由**：`|dx|<0.5` 或 `|dy|<0.5` → 直连；两端都横向面 → 竖中线四点；
两端都纵向面 → 横中线四点；混合 → 单拐点 L（横向端先横走）。
⚠ 它只吃四档 `Side`，所以 `side:'auto'` 必须在进这个函数**之前**解析掉（§4.4）。

**变换复合**：`transform.ts` 是 `rotate × flip` 的唯一实现，顺序 = 先镜像 → 再旋转 →
最后平移（§4.6）。根 transform 与 `portWorldPos()` 共用同一个顺序，
`transform.test.ts` 用二极管锁 16 组坐标。

**`labelAt` 的定义**：**沿折线点序列的弧长参数**，与参考项目的 `midPointAlong` 同源
（先按各段长度累加求总长，再取 `labelAt × 总长` 落在哪一段上做线性插值）。

> ⚠ 这是一个**近似**，写在这里以免有人当成 bug 去"修"：真正渲染出来的路径是
> `roundCorners()` 产出的**带 `A` 圆弧**的 path，圆角处比折线短一点点，
> 所以标签位置与"沿真实路径的百分比"有几像素的偏差。
> 另一条路是 `SVGGeometryElement.getPointAtLength()`，但那要真 DOM，
> happy-dom 下测不了——为了一个几像素的偏差换掉整块可测性，不值。

---

## 9. 渲染行为

### 9.1 舞台

| `fitMode` | 缩放 | 用在哪 |
|---|---|---|
| `contain`（缺省） | `min(bw/cw, bh/ch) * (1 - fitPadding/100)`，居中 | 整张图都要看见（参考项目唯一档，`fitPadding` 缺省 4 即它的 `*0.96`） |
| `width` | `bw/cw`，顶端对齐 | 宽幅工艺流程图，上下可裁 |
| `height` | `bh/ch`，左对齐 | 竖排系统图 |
| `stretch` | 两轴各自缩放 | 明知会变形但要填满（电路图别用） |

⚠ 首帧或被隐藏时容器宽高是 0：这时只输出宽高并 `visibility:hidden`，**不输出 transform**。
少了这条保护，`translate(NaN, NaN)` 会让整块空白，而 devtools 里看什么都正常。

层序（自下而上）：底图 → 图案 → `zOrder:'below'` 的标注 → 连线 → 节点 → `zOrder:'above'` 的标注。
sprite 宿主（`Twin2dIconSprite.vue`）挂在舞台根上，`position:absolute; width:0; height:0; overflow:hidden`。

### 9.2 一个节点的渲染管线

```
样式（预置库 ∪ 文档 styles，同 id 以文档为准）
  ↓ 合并节点级：patch（按图元 id 覆盖）+ layers（追加）+ ports/slots（追加）
  ↓ 求值变体：state（hover/selected/alarm/active/flipped）、status、tag、slot 阈值、has
  ↓ paint*：图元 → 内联样式对象 / SVG 属性对象；--t2-* 注入根
  ↓ 变换：根 translate → rotate → scale(flip)；图元同序 平移 → rotate → scale；
    keepUpright 的图元反向旋转
```

⚠ 变体产出的是**补丁**而不是新的图元树：整树重建会让每一帧都换掉所有子组件的
props 引用，hover 一个节点就重绘整张图。补丁走浅合并，只有被改的图元换引用。

### 9.3 hover 与 transition

参考项目的 hover 是纯 CSS 伪类（`.tnv:hover` 往下选 5 个子元素）。新模型的变体
产出的是**内联补丁**，伪类写不进内联样式，所以 hover 必须自己检测。**定死一条**：

```
Twin2dNodeBox.vue 的根元素上一对 @mouseenter / @mouseleave，
置一个本地 ref（hovered），变体按 { kind:'state', state:'hover' } 命中。
```

| 为什么不用别的 | |
|---|---|
| CSS 伪类 | 变体补丁是内联样式，伪类进不去；而且样式是**数据**，写不进一份静态 scss |
| `addEventListener` | 40 个节点 × 2 个监听器要自己清理，`check_unmount_cleans_up` 认 `addEventListener` 并要求配 `onUnmounted`。模板事件绑定由 Vue 自己摘，零清理代码 |
| 全局 pointermove + 命中测试 | 一次移动要遍历全部节点求包围盒，比浏览器自己的 hover 慢且不准（旋转后的盒） |

⚠ 悬浮卡必须 `pointerEvents:'none'`（#20）：卡片弹出来盖住指针会让节点失去 hover，
于是卡片收起、指针回到节点、再弹出——**每秒抖十几次**，而每一帧的样式都是"对"的。

⚠ hover 变体同时抬 `rootPatch.z`（#14），否则悬浮卡被右邻节点整块盖住。

`transition` 是图元字段（§4.2），由 `paintCommon.ts` 输出成一条 `transition` 声明；
`prefers-reduced-motion` 只关 keyframes，不关 transition（#17）。

### 9.4 `box` 恒定输出的三样

`min-width: 0` / `box-sizing: border-box` / `min-height: 0`。理由是 flex 子项的
默认 `min-width:auto` 会让 `ellipsis` 静默失效——文字不省略而是把父级撑破，
而这看起来像「宽度算错了」。这三样不做成可配置项；`minWidth` 字段是**另一件事**
（悬浮卡的 188px 下限），显式给了才覆盖这个恒定值。

### 9.5 派生槽：一门可递归三层的闭合小语言

「不是一个点位，而是几个槽位算出来的显示值」用派生槽表达（`slot.kind: 'derived'`）：

```ts
export type Twin2dExpr =
  | { kind: 'slot'; slot: string }
  | { kind: 'lit'; value: number | string }
  | { kind: 'first'; of: readonly Twin2dExpr[] }              // 取第一个有限值
  | { kind: 'ratio'; num: Twin2dExpr; den: Twin2dExpr; scale: number }
  | { kind: 'sum'; of: readonly Twin2dExpr[] }
  | { kind: 'scale'; of: Twin2dExpr; by: number }
  | { kind: 'join'; of: readonly Twin2dExpr[]; sep: string }
```

参考项目那两条兜底链因此能逐字表达：

```ts
// output = output_kwh → outputKwh → today_kwh
{ kind: 'first', of: [slot('output_kwh'), slot('outputKwh'), slot('today_kwh')] }

// efficiency = efficiency_pct → cop*100 → (output/input)*100
{ kind: 'first', of: [
  slot('efficiency_pct'),
  { kind: 'scale', of: slot('cop'), by: 100 },
  { kind: 'ratio', num: slot('output_kwh'), den: slot('input_kwh'), scale: 100 },
]}

// 容器读数 = 温度 · 液位
{ kind: 'join', of: [slot('temperature_c'), slot('level_pct')], sep: ' · ' }
```

规矩四条：

| 规矩 | 为什么 |
|---|---|
| 算子闭合七档，**不是表达式语言** | 可以求值的表达式语言在文档里就是一台解释器，而本仓已经有一台（台账公式）。真需要复杂计算时用绑定的 `computed` 来源——那才是平台指定的地方 |
| 递归**深度上限 3**，超深截断进诊断 | 上面那条 efficiency 链正好是 3 层。给到无限深就要考虑成环 |
| `ratio` 的分母 `<= 0` 或非有限 → 整式为空 | 参考项目的 `input != null && input > 0` 那条判断，照抄 |
| 派生槽**不出现在绑定行里** | 它没有数据来源。`bindingRows.ts` 的 `effectiveSlots()` 过滤掉 `kind:'derived'`。⚠ 漏了这一步的表现是绑点面板多出几行永远喂不到东西的槽 |

⚠ `expr` 里的槽引用可能悬空（引了一个不存在的 key）。`issues.ts` 出一条诊断，
`twin2d-slot-refs.contract.spec.ts` 保证**预置库里**一条悬空都没有——
悬空的表现是那一格永远显示占位符，看起来像「点位没绑上」。

### 9.6 逐槽状态四档（`ownsStatusDisplay: true`）

一张 2D 图上有几十个读数，坏掉一个不能让整块被「取数失败」盖住。所以模块自报
`ownsStatusDisplay: true`，四档自己画：

| 档 | 判据 | 画什么 |
|---|---|---|
| 未配来源 | 这一行有 `fieldKey`，但它不在 `meta.slots` 里 | 槽位的 `placeholder`（`'—'` / `'--'`），`--text-disabled` 色 |
| 等首帧 | `meta.slots[k].state === 'pending'` | 同占位符 + `opacity .45` + 一次 `breathe` 呼吸 |
| 取不到 | `state === 'error'` | 占位符 + `--state-danger` 色 + `title` 属性挂原因 |
| 有值 | `state === 'ok'` | 值 + 单位；`meta.valueTimeMs` 由标题条右侧的时刻显示交代 |

⚠ 前两档都显示同一个占位符，**只靠颜色与透明度区分**——所以这两条不是装饰，
是唯一的区分手段；`packages/twin2d/tests/render/Twin2dSlotState.spec.ts` 与模块侧的
`Component.spec.ts` 里各有一条专门钉「两档的字一样、样式不一样」。
⚠ `unbound` 那一档仍归运行时浮层，但本模块**没有 `isRequired` 的槽**（一张纯静态
工艺图是合法用法），所以浮层实际永不出现在这个模块上。

**这四档最终落在哪儿（R7b 定稿）。** `@dt/twin2d` 的公开面上开了一条**逐槽状态通道**，
但它不是第二条 props：`Twin2dSlotRead` 在口径（`slot`）与读数（`value`）之外多带
`state`（四档）与 `reason`（`error` 档的原因），仍由**同一个**
`readSlot(nodeId, key)` 回，`Twin2dStage` → `Twin2dNodeBox` → `Twin2dPrimView`
一路照旧往下递，一个 prop 名都没新增。落点两处：

- **文字**：`resolveTxtContent` 的 `slot` 一档在非 `ok` 三档按**无值**格式化，
  于是出这个槽位自己的占位符（`formatSlotValue` 那一份口径，不另写第二份）。
- **观感**：`paintSlotState` 按档出 `color` / `opacity` / `t2-anim-breathe` /
  `title`，由 `paintText` 叠在**最后一层**——排在字体之后才盖得住样式数据里配的
  `font.color`，排前面的话「配了字色的读数坏了也照旧是原色」，一处报错都没有。
  呼吸那一档必须连 `--t2-anim-dur` 一起注入：`animation` 简写解析不到 `var()`
  会**整条报废**，表现是「类挂上了却一动不动」。

> ⚠ **不许再开第二条取数路径。** 档位与读数分两条 props 递下去时，同一格的文字与它的
> 颜色会来自不同的一帧——图上完全看不出来，而那正是这四档要解决的那类静默错。
> 同理，「非 `ok` 三档把值抹成 null」**只在包里做一次**（`resolveTxtContent`），
> 模块壳只报档位、不再自己抹一遍：两处都抹就是两份口径，漂了只表现为
> 「这一格的字与它的颜色对不上」。

⚠ 两处判据在模块壳（`Component.vue` 的 `gearOf`）里，写反了都不报错：
**整袋 `meta.slots` 缺席**时（设计态、独立挂载）按**有值**算，不按未配来源——否则
编辑器预览里整张图是灰的而运行态一切正常；**派生槽**不进绑定行、因而查不到 `fieldKey`，
同样按有值算——它的值是就地算出来的，判成未配来源的话整条派生链在墙上永远是占位符。

**角上那枚汇总角标留着，与逐格上色分工不重复。** 逐格上色回答「**哪一格**」，
角标（`.dt-twin2d__readout`）回答「**整块有几格**非 ok」——一眼知道这块图值不值得信，
不必逐格去找。本模块自报 `ownsStatusDisplay`，运行时不会再盖一层整格浮层，
这两处不说就没有第三处会说。

### 9.7 联动

```ts
emitsInteractions: true,
interactionEvents: ['select'],
```

点节点上抛 `{ event: 'select', value: node.id }`，**不上抛显示名**（名字随时会改，
而联动规则里存的那份不会跟着改，改完只表现为「点了没反应」）。

> ⚠ **`interactionEvents` 显式声明，不靠缺省。** 缺省是 `['click']`
> （`@dt/contracts` 的 `ModuleManifest.interactionEvents` 注释），而本模块上抛的是
> `'select'`——不声明的话编辑器的「触发事件」下拉里只有 `click`，用户配出来的规则
> 永远不触发，两侧都不报错。`INTERACTION_EVENTS = ['click','change','select']`
> 三档都合法，所以类型也挡不住。

`hostClickable` **刻意不开**：画布里有拖拽（运行态虽不可编辑，但底图上的滑动/触屏
平移手势将来会加），整块可点会让每次松手都派发一次事件。

模板上 `@click.stop`，且**只在配了联动规则时吞**（`meta.interactive === true`）。
两边都吞或都不吞，toggle 类动作会当场自我抵消。

---

## 10. 实时状态：从绑定到染色的一条管线

### 10.1 管线

参考项目的状态点五档配色、`is-alarm` 边框、报警呼吸、状态点脉冲，**全部**由
`nodeValues[i].status` 这个子槽驱动——状态是一条独立的数据线，不是从读数里推出来的。
本模块的 `nodeValues` 行是「节点 × 槽位」扁平，一个节点有几个槽就有几行，
状态挂在它的子槽上会变成「一个节点几份状态」，所以状态另起一个**按节点钉行**的槽：

```
nodeStatus[i].status（第 i 行 ↔ nodes[i]，行数 = nodes.length）
  ↓ Component.vue：toDeviceStatus(raw)        ← @dt/modules/shared/status.ts，已有
  ↓ STATUS_OVERLAY：DeviceStatus → Twin2dStatus | null
  ↓ 逐节点得到 statusOverride: (Twin2dStatus | null)[]，按 props 递给 Twin2dStage
  ↓ Twin2dStage：effectiveStatus = override ?? node.status ?? style.defaultStatus
  ↓ 变体 { kind:'status', in:[…] } 求值 + statusColor() 注入 --t2-status
```

```ts
// Component.vue 里的映射；null = 不覆盖
const STATUS_OVERLAY: Record<DeviceStatus, Twin2dStatus | null> = {
  running: 'online',
  standby: 'warning',
  alarm: 'alarm',
  offline: 'offline',
  unknown: null,
}
```

> ⚠ **`unknown` 不覆盖配置里的静态 status。** `toDeviceStatus` 的注释已经写死了
> 「缺值恒为 `unknown`，连 `fallback` 都不给用：把没有数据的设备显示成运行，
> 是这套系统里代价最大的一种谎」。这里再加一层：`unknown` 也**不许**把一个配置成
> `alarm` 的节点洗成灰的。`Component.spec.ts` 里一条用例专门锁这条。
>
> ⚠ 归一放在 `Component.vue` 里做（不是包里）有两个好处：一是复用本仓既有的
> `toDeviceStatus`，**零第二份副本、零 parity 契约**；二是 `@dt/twin2d` 只收
> 已归一的值，它的类型面上根本没有「原始点位值」这个概念。
>
> ⚠ **前提是 `toDeviceStatus` 先补上同义词表**（§19 的 R0d）。它现在只认
> `NUMERIC_STATUSES` 的 0/1/2/3 与五个字面档名（`readEnum` 精确匹配，不 trim、
> 不降大小写），现场很常见的 `"on"` / `"ok"` / `"normal"` / `"Running"` / 字符串 `"1"`
> 一律落 `unknown`。落 `unknown` 又刚好**不覆盖**静态 status，所以表现是
> 「绑了状态点位，图上一点变化都没有」——零报错的那一类（#96）。

建议补进真源的词表，按参考项目的四组逐词搬，映射到本仓五档：

```ts
// @dt/modules/shared/status.ts —— 先 String(raw).trim().toLowerCase() 再查这张表
const STATUS_WORDS: Record<string, DeviceStatus> = {
  running: 'running', run: 'running', on: 'running', ok: 'running',
  normal: 'running', good: 'running', '1': 'running', true: 'running',

  standby: 'standby', idle: 'standby', warning: 'standby', warn: 'standby',
  uncertain: 'standby', degraded: 'standby', '2': 'standby',

  alarm: 'alarm', alert: 'alarm', fault: 'alarm', error: 'alarm',
  bad: 'alarm', critical: 'alarm', '3': 'alarm',

  offline: 'offline', off: 'offline', down: 'offline',
  disconnected: 'offline', '0': 'offline', false: 'offline',
}
```

**第二组整组归 `standby`，不归 `alarm`。** 两条理由：一是本仓 `NUMERIC_STATUSES`
已经把 `2` 钉在 `standby` 上，而参考项目那一组的注释明说它就是「2 号档」——
把 `warn` / `degraded` 单独提到 `alarm`，同一组取值就会因为「现场发的是数字还是词」
分裂成两档，那正是这张表要消灭的东西；二是方向上宁可少报一次红：
`alarm` 档在本模块要染红 + 报警呼吸（本节开头那条 `is-alarm` 链路），把一条降级提示升格成红色报警，
代价是整屏报警的可信度。真要区分「告警」与「待机」，那是给 `DeviceStatus`
加第六档的事，得单独拍板，不能在一张同义词表里顺手做掉。

### 10.2 ⚠ `nodeStatus` 的子槽刻意**不声明 `enumMap`**

```ts
{
  key: TWIN_2D_STATUS_BINDING_KEY,   // 'nodeStatus'
  label: '节点状态',
  dataType: 'enum',
  isArray: true,
  isEntityPinned: true,
  // ⚠ 刻意不给 enumMap：求值层的 applyEnumMap 只对 number 生效，会把 1 换成
  //   映射表里的那个串；换成语义词表之后 toDeviceStatus 认不出来，于是全图
  //   状态集体退回 unknown（灰），而没有任何一处报错。数值原样进来才对。
  arrayFields: [{ key: 'status', label: '状态', dataType: 'enum' }],
}
```

这条是实地读 `packages/runtime/src/moduleValues.ts` 得出的：

```ts
function applyEnumMap(value: unknown, spec: BindingSpec | undefined): unknown {
  const enumMap = spec?.enumMap
  if (enumMap === undefined || typeof value !== 'number') return value
  return enumMap[String(value)] ?? value
}
```

| 如果声明了…… | 结果 |
|---|---|
| 中文语义键 `{'0':'离线','1':'运行',…}` | `1` → `'运行'` → `toDeviceStatus('运行')` 走 `readEnum` 找不到 → `unknown` → **不覆盖** → 全图灰，零报错 |
| 英文语义键 `{'0':'offline','1':'running',…}` | 能工作，但数值表就有了两份真源（清单里一份、`NUMERIC_STATUSES` 一份），漂移后同样静默 |
| **不声明**（本设计） | 数值原样到达 `toDeviceStatus`，走它自己的 `NUMERIC_STATUSES`；字符串走同义词表（R0d 补）。**一份真源** |

`manifest.test.ts` 里一条用例断言 `nodeStatus` 的 `arrayFields[0].enumMap === undefined`，
并在注释里写明理由——否则将来有人"顺手补全"就把它填上了。

---

## 11. 与本仓既有 token / 工具的差异（不处理就静默变色）

### 11.1 参考项目依赖、本仓没有的 token

| token | 参考项目里谁在用 | 本仓怎么办 |
|---|---|---|
| `--chart-series-1..5`（+`-rgb`）、`--chart-hot`、`--chart-cold` | 11 种节点类型主色、4 种子类色、5 种连线色、4 种传感器色、圆柱三种描边 | **不新增 token**：预置库配色写成 `presets/palette.ts` 的字面 hex（§6.1），由 `paintCommon.ts` 拼成 `--t2-*` 内联变量 |
| `--topo-node-fill-a` / `-b`、`--topo-weave`、`--topo-bg-top` / `-bottom` | 节点渐变两端、底板斜织与竖向渐变 | ⚠ 这几个在参考项目里**全仓无定义、只活在 `var()` 的 fallback 位**——实际生效的就是 fallback 表达式，照抄 fallback。本仓落成 `--t2-fill-a` / `--t2-fill-b` 与 `canvas.pattern*` 字段 |
| `--font-digit` | 五处数字（主读数 / 罐与圆柱读数 / 能效胶囊 / 悬浮卡数值 / 药丸读数） | **新增一个 token**，见 §11.2 |
| `--space-*`、`--text-accent`、`--card-title-*` 一族、`--theme-transition` | 参考项目模块里零散引用 | 一律不引：间距写 px（在预置数据里，是可配置的值），`--theme-transition` 改 `--fx-transition` |

> ⚠ CSS 里引用不存在的变量**不报错**：`border-color` 退到 `currentColor`、SVG `stroke`
> 退到默认，而 `rgba(var(--x-rgb), .62)` 这种形式会让整条声明直接报废。零红灯、零告警，
> 只是颜色全不对。而 `app/tests/contract/css-variables.contract.spec.ts` 的
> `SCAN_ROOTS` 只有 `app/src` 与 `packages/ui/src`，**扫不到 `packages/twin2d/src`**——
> 所以本包自带一条 `twin2d-css-vars.contract.spec.ts`：`paintCommon.ts` 产出的每个
> `--t2-*` 都要在 `twin2d.scss` 里被 `var()` 消费，反之亦然。

### 11.2 `--font-digit`：确切的一行

加在 `web/packages/tokens/src/tokens.scss` 的「字体族」那一段里，紧挨 `--font-mono`：

```scss
  /* 数字读数：等宽数字优先，逐项回退到已有字体族，不引 @font-face。
     ⚠ 只给字体族，`font-variant-numeric: tabular-nums` 要消费处自己配——
     它不是字体族的一部分，塞进 font shorthand 会被丢掉。 */
  --font-digit:
    'Chakra Petch', ui-monospace, 'Cascadia Code', 'HarmonyOS Sans SC',
    'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
```

取值就是把已有两条回退链拼起来：前两跳来自 `--font-display`（`'Chakra Petch'`）与
`--font-mono`（`ui-monospace`, `'Cascadia Code'`），其余照 `--font-sans` 的中文回退。

| 为什么这样 | |
|---|---|
| 零主题预设连带 | 字体族不在 `ThemeTokens` 的形状里（换肤只管颜色），所以这是**一行改动** |
| 零 `@font-face` | 本仓全仓零 `@font-face`。引 webfont 是一整块独立工作（挑字体、评许可证、算首屏字体体积、定 `font-display` 策略），而且它影响的是全站排版而非本模块 |
| 代价说清楚 | 数字字形与参考项目**不逐像素相同**——这是本仓「零 webfont」这个既成事实带来的，不是这个模块的取舍 |
| `tabular-nums` 在哪配 | `twin2d.scss` 里 `.t2-digit { font-variant-numeric: tabular-nums; }`，由 `paintText.ts` 在 `font.family` 含 `--font-digit` 时挂上。仓里已有 **12 处同款 + 1 处反例**（共 13 处、12 个文件）：`MetricCell.vue`（2 处）、`three-core` 的 `TwinHierCard.vue` / `TwinViewpointBar.vue` / `TwinHierDrill.vue` / `panel.scss` / `anchorLayer.ts`（JS 侧 `fontVariantNumeric`）、`DtSlider.vue` / `DtProgress.vue`、`AiPlanCard.vue` / `TwinRuntimePreview.vue`、`OutlineRow.vue`（Tailwind 类）。⚠ 第 13 处是 `DtDigits.vue` 里一条**反向**注释——它明说自己不用 `tabular-nums`，别把它数成先例 |

⚠ `css-variables.contract.spec.ts` 是**单向**的（每个 `var(--…)` 必须有定义处），
没有「定义了却没人用」的反向检查，所以新增这一行不会因为暂时无人消费而红。

### 11.3 数值格式化：第二份副本 + 一条**行为**对齐契约

本仓的格式化真源是 `packages/modules/src/shared/format.ts`
（`NO_DATA` / `isPresent` / `fmtFixed` / `fmtNumber` / `fmtTrim` / `fmtKwh` / `fmtDecimal` / `fmtClock`），
但 `@dt/twin2d` **不许依赖 `@dt/modules`**（方向反了），而这些函数被调用的位置在
图元渲染的最深处（一个 `txt` 读一个槽），提到 `Component.vue` 去做是不现实的。

所以 `@dt/twin2d/src/format.ts` 是**第二份副本**，配一条契约：
`app/tests/contract/twin2d-format-parity.contract.spec.ts`——它住在 `app/tests/`，
所以能同时 import 两个包，对同一张输入表逐项断言两边**行为**相同（不是比源码文本）。

| 对齐项 | 表里至少要有 |
|---|---|
| `NO_DATA` | `'—'` 本身；`null` / `undefined` / `''` / `NaN` / `Infinity` 各一条 |
| `fmtTrim` | `63.40` → `63.4`；`-0` → `0`；`1234.5678` 在 `max=2` 下 |
| `fmtKwh` | `999.6` → `1k`（取整后判档）；`999.4` → `999`；负数带号 |
| `fmtFixed` / `fmtDecimal` | 位数越界钳到 `[0,100]`；补零与抹零的分工 |
| locale | 三个函数的 `toLocaleString` 都钉 `'en-US'` |

> ⚠ **locale 必须钉死。** 自托管 runner 是中文 locale、开发机是 en-US——不钉的
> `toLocaleString` / `localeCompare` 本地绿、CI 红，而红出来的报错跟格式化毫无关系。
> ⚠ `.vue` 里禁 `toLocaleString(` / `new Date(`（`check_formatting_is_centralised`
> 扫的是组件），所以这批函数只能待在 `.ts` 里。

同一条纪律还有一处：`twin2d-op-parity`（八档阈值算子 ↔ `shared/thresholds` 的
`THRESHOLD_OPS`：`lt/lte/gt/gte/between/outside/eq/neq`）。
状态归一**没有**这条——它在 `Component.vue` 里直接用真源（§10.1）。

### 11.4 素材注入槽：两种 kind 分开

`@dt/contracts` 的 `assetUrl(base, kind, ref)` 里 `kind ∈ {model, image, icon}`，
对象键分别是 `models/<id>/original` / `images/<id>` / `icons/<id>`；
`bootstrap/dashboard.ts` 里的 `configureAssetImages` 把 kind 写死成 `'image'`。

本模块有**两个**素材落点：`ico.src = {kind:'asset'}` 要的是 `'icon'`，
`canvas.background` 的 `asset:<uuid>` 要的是 `'image'`。所以注入槽收两个函数：

```ts
// @dt/twin2d
export interface Twin2dAssetPorts {
  resolveIcon: (assetRef: string) => string
  resolveImage: (assetRef: string) => string
}
export function configureTwin2dAssets(ports: Twin2dAssetPorts): void
export function __resetTwin2dAssets(): void      // 只给测试

// app/src/bootstrap/dashboard.ts —— 紧挨 installAssetImages() 的邻居
configureTwin2dAssets({
  resolveIcon: (ref) => assetUrl(ASSET_BASE_URL, 'icon', ref),
  resolveImage: (ref) => assetUrl(ASSET_BASE_URL, 'image', ref),
})
```

> ⚠ 一个函数服务两种 kind 时，装错的表现是**图标 404**（碎图或空白），零报错——
> 正是本节要避开的那类故障。`twin2d-asset-injection.test.ts` 两种 kind 各一条用例。
> ⚠ 未注入时 `resolve` 返回空串 → 图元 `src` 落成 `{kind:'none'}` → **图标静默消失**。
> 用例断言未注入时的行为是「空 + 进诊断」，不是静默。
> ⚠ 编辑器页直接刷新进来时，`installDashboardModules()` 必须在 `index.vue` 顶层调
> （`TwinEditor` 就是因为漏了这一步，模型地址解析恒回空串）。

### 11.5 CSS 值消毒

文档里的颜色/渐变/阴影是用户可填的 CSS 字符串。经 `:style` 对象注入时 `;` 与 `}`
无法逃逸，但 `url(...)` 能把请求打到外部（指纹回传）。`cssValue.ts`：

```
拒：url(  |  @import  |  \\  |  控制字符  |  长度 > 200
放：任意其它 CSS 值（含 var() / color-mix() / calc()）
```

被拒的值回落到该字段的缺省，并进诊断面板（不静默）。

---

## 12. 电路图：本期做什么、不做什么

| 电路图的额外需求 | 本期 | 怎么落 / 为什么不做 |
|---|---|---|
| **元件符号库** | ✅ 做 | `vec` 图元的任意 `path`/`poly`/`ellipse` 就是符号几何；编辑器里「在画布上取点」直接画。`presets/circuit.ts` 出 8 枚 GB/T 4728 种子（§6.2） |
| **引脚而非四锚点** | ✅ 做 | `ports[]`：位置任取、有名字、有方向、有带线宽的引脚 marker（§4.4）。四边中点只是四条预置端口 |
| **导线正交走线** | ✅ 做 | `route:'orthogonal'` + 网格吸附（拐点与端点落点都先吸网格）。⚠ `side:'auto'` 必须先解析成四档 Side |
| **旋转 / 镜像** | ✅ 做 | `node.rotate ∈ {0,90,180,270}` + `flipX/flipY`，复合顺序写死（§4.6）。三处连带：端口位置在 `transform.ts` 里跟着转（不是 CSS）、连线端点因此跟着变、`txt` 图元默认 `keepUpright:true`（元件标号永远正立）。⚠ 只给四档：任意角度会让正交走线失去意义，且端口吸附点变成无理数 |
| **总线 / 母线** | ✅ 做 | 多遍描边（#69）：宽底窄芯 = 双线，单遍大 width = 母线 |
| **分支 / 汇合点** | ✅ 做（显式） | 「接线点」预置样式（实心圆点 r=3，四条 `perim` 端口）。**不做「三线相交自动画点」**：那要判定「相交」还是「跨过」，正是跳线那一题的另一半 |
| **网络标号（net label）** | 一半 | 连线标签 ✅（`edge.label`，可绑数据）；**同名即同网的 netlist 语义 ❌**——那需要一个连通性求解器与「这张图能不能导出成网表」的整套语义，属于 EDA 而不是大屏 |
| **图框 / 标题栏 / 图例** | ✅ 够用 | `marks` 的 `rect` + 新增的 `text` 一档 |
| **交叉跳线（hop / gap）** | ❌ 不做 | 要在渲染时求**全图两两线段交点**（O(n²)），并且判定哪条让路需要一个全局约定；任一条线移动都要重算整图。⚠ `edgeStyle.crossing` 这个字段**现在不加**（本仓有「不留没人消费的字段」这条纪律），做的时候连字段带渲染一起加 |
| **自动避障走线** | ❌ 不做 | 手工拐点在电路/工艺图里本来就是常规做法；避障的结果不可预测，用户会花更多时间跟它打架 |

---

## 13. 关键实现决策

### 13.1 混合渲染基底：HTML + SVG 叠在同一坐标盒

`box` / `txt` / `ico` 渲成 HTML（因为要 `linear-gradient` 多层、`inset box-shadow`、
`backdrop-filter`、`text-overflow: ellipsis`、`align-items: baseline`、`color-mix` ——
这些在纯 SVG 里要么做不到要么要手算），`vec` 渲成一层 `<svg>`（因为要任意路径几何、
描边宽度、虚线、线端样式、`non-scaling-stroke`）。两者在节点根里按 `z` 混排。

否决的两个替代：**全 SVG**（省一层，但上面六样全要重做，第一版就得写自己的文字排版）；
**全 HTML + `clip-path`/`mask`**（任意路径能画，但描边宽度、虚线、线端样式、
`non-scaling-stroke` 全都没有对应物——而参考项目的圆柱正好全靠这些）。

### 13.2 不引入 vue-flow，画布自绘

vue-flow 能给的：节点拖动 / 框选 / 平移缩放 / 连线手势 / 小地图 / 网格背景。
本次需要但它给不了的：图元树节点渲染、连线路由（多遍描边 + 自定义 marker + 沿路径标签）、
端点周长参数、标注双层、图元级选中、旋转手柄 —— 六样里五样都要自定义组件。

代价对比：

- **引入**：一个锁文件 PR + 4 份 CSS 手工引入 + 一个按 flowId 建在全局的 store（必须
  `onScopeDispose(() => vf.$destroy())`，否则来回进出子编辑器跨导航泄漏）+
  `:delete-key-code=null`、`:select-nodes-on-drag=false`、把手上的 `nodrag nopan` 这三条
  「少了就会在拖把手时平移画布」的必需配置 + 「节点 position 是左上角而几何盒以中心
  为参考」的换算 + 自定义组件 props 与 `NodeProps` 不匹配要靠 `as unknown as` 断言过关
  ——**本仓 eslint 直接禁这个写法**。
- **自绘**：`useCanvasPointer.ts` + `viewportOps.ts` + `snapping.ts` + `CanvasMarquee.vue`
  ≈ 700 行，且 `DashboardEditor` 里已有同类实现可照。

按依赖判据「少于 200 行且没有隐藏复杂度就自己写」——这里超过 200 行，但隐藏复杂度
是在**引入**那一侧（那条 `as unknown as` 直接撞 lint）。所以自绘。

### 13.3 样式库存在文档里，不建后端表

**拍板：样式库是文档的一部分**（`config.twin2d.styles[]`），随大屏整树替换落库，
不建后端表、不加端点；跨大屏复用靠**导出/导入样式包 JSON**（`stylePackage.ts`）。

参考项目把自定义类型库存在后端两张项目级表里（全局模板 + 项目库）并配了 8 个端点。
**而运行时一处都不消费**：store 里加载后无人读，渲染层写死用内置库——所以用户自建的
类型在编辑器里长得对，上大屏一律退化成兜底（box、无图标、`fields=[]` 故主显读数消失）。
**这个教训写在这里，是为了让「以后要不要建表」这件事从一开始就带着前提。**

| | 文档内（本设计） | 项目级后端表（参考项目） |
|---|---|---|
| 运行时取得到吗 | ✅ 配置就在手里 | 需要额外一次请求；公开大屏还要匿名可读 |
| 公开大屏 | ✅ 天然可用 | 要给匿名口子 |
| 新增端点/表/迁移 | 零 | 2 张表 + 8 个端点 + 迁移 + RBAC |
| 跨大屏复用 | 导出/导入样式包（JSON） | 一处改、多屏跟着变 |
| 一张图自包含 | ✅ 复制大屏即复制样式 | ❌ 跨项目复制就散架 |
| PR 范围 | 只碰 `web/` | 碰 platform-server + 迁移 + 契约 + RBAC，规模翻倍 |

真需要项目级共享时再加，**前提是先把运行时消费点接上**。

### 13.4 内置库是引用式、可覆盖，不 materialize

渲染时 `styleMap = merge(BUILTIN_STYLES, config.styles)`，同 id 以文档为准。
用户改内置样式 → 文档里落一份同 id 的覆盖；点「恢复内置」→ **删掉那份覆盖**（不是写死内置数据）；
点「另存为自定义」→ materialize 一份带新 id 的副本。

> ⚠ 这意味着**改预置库会改存量大屏的渲染**（所有没覆盖过该样式的节点跟着变），
> 与 `ConfigField.default` 是同一条口径。不许为了「兼容」而反过来搞成
> 「文档里的内置条目一律丢弃、改用代码里的最新定义」——参考项目就是那么做的，
> 后果是通过整库替换写进去的改动被静默还原，用户以为自己没保存成功。

### 13.5 编辑器取数必须防竞态

`useTwin2dEditorPage.ts` 按 `:dashboardId` / `:nodeId` 取数，而路由参数**能在同一个
组件实例上变**（从属性面板反复进出不同节点的子编辑器）。所以它走
`app/src/composables/useRacedFetch.ts`：

```ts
const raced = useRacedFetch()
raced.run(
  (signal) => fetchDashboard(dashboardId, { signal }),
  { ok: (doc) => applyDoc(doc), fail: (e) => showError(e), settled: () => (loading.value = false) },
)
onBeforeUnmount(() => raced.cancel())
```

> ⚠ `check_ts_style.py` 的 `check_race_guards_come_from_one_place` 认「领号 + 比号」
> 这一对手搓写法并要求改用 `useRacedFetch`；CLAUDE.md 也点名「可被快速切换触发的
> 加载必须防竞态」。漏了的表现是**界面显示上一次的文档**，零报错。
> §17 的编辑器用例里有一条「快速切 nodeId 时旧响应不覆盖新文档」。

### 13.6 未保存守卫提取共用

`TwinEditor/scripts/useUnsavedGuard.ts` 已经有一份（37 行：只在脏着时才挂
`beforeunload`，常驻会让页面进不了 bfcache；`onBeforeUnmount` 必摘，留着的话
离开编辑器后整站都被这一页拦）。第二个整页编辑器不再抄一份，提到
`app/src/composables/useUnsavedGuard.ts`（**这个目录已经存在**，不是新建）。

⚠ 这次提取排在**最前面一轮**（§19 的 R0b），在本模块任何一行代码之前：
排在后面的话，第一个用到它的分片 PR 就得连带把提取一起带进来，而那会让
那个 PR 的规模豁免整体失效。验收里带一条「顺手跑 `TwinEditor` 的既有用例」。

---

## 14. 数据绑定

### 14.1 清单声明

```ts
export const TWIN_2D_NODE_BINDING_KEY = 'nodeValues'
export const TWIN_2D_STATUS_BINDING_KEY = 'nodeStatus'
export const TWIN_2D_EDGE_BINDING_KEY = 'edgeValues'

export const TWIN_2D_VIEW_BINDINGS: readonly BindingSpec[] = [
  {
    key: TWIN_2D_NODE_BINDING_KEY,
    label: '节点读数',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
  {
    key: TWIN_2D_STATUS_BINDING_KEY,
    label: '节点状态',
    dataType: 'enum',
    isArray: true,
    isEntityPinned: true,
    // ⚠ 刻意不给 enumMap，理由见 §10.2
    arrayFields: [{ key: 'status', label: '状态', dataType: 'enum' }],
  },
  {
    key: TWIN_2D_EDGE_BINDING_KEY,
    label: '连线读数',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [
      { key: 'active', label: '有流 / 通电', dataType: 'boolean' },
      { key: 'direction', label: '流向（负数 = 反向）', dataType: 'number' },
      { key: 'value', label: '标签读数', dataType: 'number' },
    ],
  },
]
```

### 14.2 行 → 实体

| | `nodeValues` | `nodeStatus` | `edgeValues` |
|---|---|---|---|
| 一行是什么 | 一个**节点的一个槽位** | 一个**节点** | 一条连线 |
| 行数 | `Σ 各节点的有效槽位数` | `nodes.length` | `edges.length` |
| 有效槽位 | `style.slots ∪ node.slots`，去掉 `kind:'derived'`，再**只留被有效图元真正引用到的**（`txt.src.kind==='slot'`、`when`/变体条件、或某个派生槽的 `expr` 里出现） | —— | —— |
| 行顺序 | 节点文档序 × 该节点槽位文档序，扁平 | 节点文档序 | 连线文档序 |
| `fieldKey` | `nodeValues[i].value` | `nodeStatus[i].status` | `edgeValues[i].{active\|direction\|value}` |
| 行标签 | `{ title: '锅炉房 · 出水温度', id: nodeId }` | `{ title: '锅炉房', id: nodeId }` | `{ title: '锅炉房 → 换热站', id: edgeId }` |

这与 `twin-view` 的 `panelValues`（信息牌 × 字段扁平）是同一套口径，所以**绑点面板
与 3D 孪生完全一致**：同一个 `BindingPanel`、同一种行标签、同一条「绑一部分实体是常态」
的规矩。`isEntityPinned: true` 让索引可以留空（一张图上四十个槽位只接三个点位是常态）。

> ⚠ `bindingRowCounts` **三个键都必须给，一个实体都没有时给 0**。漏掉键会被面板
> 当成「行数由用户手工增删」，于是摆出一个加了也喂不到任何东西的「新增一行」。
> ⚠ 「只留被图元真正引用到的槽位」这条筛选让面板短得多，但代价是**改样式会改行数**：
> 删掉一个 `txt` 图元，它之后每一行的绑定都会改喂别的槽位。所以——

### 14.3 唯一写入口，无条件重派绑定

`twin2dDoc.ts` 的 `commit()` 是配置的唯一写入口，且**无条件**调
`remapTwin2dBindings(prevConfig, nextConfig, prevBindings)`：按 `(nodeId, slotKey)`、
`(nodeId)`、`(edgeId, sub)` 这三个稳定键把绑定搬到新的行号上。

放开让各处自己写配置的话，总会有一个动作忘了重派，之后每条绑定都接错对象，
而界面上一切正常。`twin-view` 已经踩过这条并定下同一个规矩。

### 14.4 参考项目三档来源怎么落

| 参考项目 | 本仓 | 注意 |
|---|---|---|
| `source_kind: 'opcua'` + `server_id` + `node_id` 二元组 | `sourceKind: 'opcua'` + `nodeKey = '{sourceId}:{pointCode}'`（按第一个冒号切） | 二元组拼成一个串，通用绑点面板管 |
| `source_kind: 'static'` + `static_value` **存在图文档里** | `sourceKind: 'static'` + `staticValueJson` **存在绑定上** | ⚠ 口径变了：**文档里不存任何数值**。文档是「图长什么样」，绑定是「数从哪来」。混在一起就是同一个值有两个真源，改一处不生效 |
| `source_kind: 'dataset'`，台账键 `ds:{code}:{col}` 塞在 `node_id` 位 | `sourceKind: 'dataset'` + `detailJson: DatasetBindingDetail` | ⚠ 见下 |
| —— | `computed`（同屏派生） | 白拿，同步就地算 |
| —— | `archive`（历史） | ⚠ 与台账**同一条分支**、同样取不到值，见下 |

> ⚠ **台账与历史这两档绑定在本模块上都会以「取数失败」呈现，这是设计如此，不是坏了；
> 而且两档是同一条分支、同一句文案，不存在「台账不行、历史白拿」这回事。**
> 标量模块的取数走 `app/src/runtime/bindingReader.ts`（由 `useDashboardValues`
> 装进 `provideRuntimeData`），那是一个**同步**读取器，它对序列类来源直接诚实拒绝：
>
> ```ts
> // app/src/runtime/bindingReader.ts
> const SERIES_MESSAGE = '序列要异步取数，画布上不展开'
> // …
> if (kind === 'archive' || kind === 'dataset') {
>   return { state: 'error', message: SERIES_MESSAGE }
> }
> ```
>
> 所以这条链路压根走不到 provider：`bootstrap/dashboard.ts` 里的
> `createHistoryProvider` / `createDatasetProvider` 服务的是**声明了 `isTimeSeries`
> 的时序模块**那条异步取数路径，本模块三个槽都是标量、没有 `isTimeSeries`，
> 一次都不会碰到它们的 `subscribe`。
> 表现是那一格进 §9.6 的 error 档：占位符 + `--state-danger` + `title` 挂
> 「序列要异步取数，画布上不展开」这句原文。
> `Component.spec.ts` 里两条用例（`archive` 一条、`dataset` 一条）断言这句文案
> 真的挂到了 `title` 上——只在 help 里写一句「取不到数」是不够的，用户在图上看不见 help。
> ⚠ 断言写**字面文案**而不是 `toContain('序列')`：文案改了要当场红一条，
> 而不是让一句改过的话继续被半匹配放行。

参考项目那套自造 `field_key`（`ns=2;s=A` / `ds:code:col` / `topology.edge.<id>.active`）
在本仓会被服务端 `field_key_unknown` 硬拦（422）——`field_key` 必须是清单里声明的槽键。
上表就是把它换成实体钉行槽的全部工作。

---

## 15. 模块清单草案

```ts
export default defineModule({
  type: 'twin-2d-view',
  displayName: '2D 孪生',
  category: '孪生',
  icon: 'network',
  keywords: ['2d', 'twin', 'luansheng', '孪生', '流程', '系统图', '接线', '电路'],
  defaultSize: { width: 1280, height: 480, minWidth: 240, minHeight: 120 },
  // 套框：一张图配上统一卡片外观与标题条，40 个 chrome 键全吃
  chrome: 'card',
  configSchema: [ /* 见 §15.1 */ ],
  bindings: [...TWIN_2D_VIEW_BINDINGS],
  // 一张图几十个读数，坏一个不能盖住整块
  ownsStatusDisplay: true,
  // 点节点上抛 { event:'select', value: 节点 id }
  emitsInteractions: true,
  interactionEvents: ['select'],
  // ⚠ hostClickable 刻意不开：画布内有手势，整块可点会让每次松手派发一次事件
  subEditor: {
    configKey: TWIN_2D_CONFIG_KEY,
    routeName: 'twin-2d-editor',
    label: '打开 2D 孪生编辑器',
    hint: '节点、连线、标注与节点样式都在那里画。',
  },
  bindingRowLabels: (config) =>
    twin2dRowLabels(normalizeTwin2dConfig(config[TWIN_2D_CONFIG_KEY])),
  bindingRowCounts: (config) =>
    twin2dRowCounts(normalizeTwin2dConfig(config[TWIN_2D_CONFIG_KEY])),
  preview: { config: { [TWIN_2D_CONFIG_KEY]: PREVIEW_SCENE } },
  component: () => import('./Component.vue'),
})
```

### 15.1 configSchema 逐字段

| 键 | 标签 | type | default | group | span | when | help |
|---|---|---|---|---|---|---|---|
| `title` | 标题 | `string` | ⚠ **不给**（缺省空串 = 不显示标题条） | 标题 | full | — | 留空则不显示标题条 |
| `twin2d` | 2D 孪生画面 | `object` | ⚠ **不给 `fields`** | 画面 | full | — | 节点、连线、标注与节点样式都由 2D 孪生编辑器写入。 |
| `fitMode` | 缩放方式 | `enum` | `'contain'` | 画面 | half | — | `contain` 完整显示 / `width` 按宽 / `height` 按高 / `stretch` 拉满（会变形） |
| `fitPadding` | 四周留白 (%) | `range` 0–20 step 1 | `4` | 画面 | half | `fitMode in ['contain']` | 只在「完整显示」下有意义 |
| `showSprite` | 使用内置图标集 | `boolean` | `true` | 画面 | half | — | 关掉后 `sprite` 档的图标不渲染（自带图标集的项目可以省这 10 KB） |
| `animateFlow` | 连线流动动画 | `boolean` | ⚠ **不给**（缺省 false） | 运行态 | full | — | 总闸：关掉时所有连线都不动，不论样式里怎么配 |
| `flowSpeed` | 流动速度 | `range` 0.5–5 step 0.1 | `1` | 运行态 | half | `animateFlow in [true]` | 全局倍率：最终时长 = 样式里的基准时长 ÷ 这个值 |

七个键，**全部在 `Component.vue` 里读**（§3.2），且读的键全部声明过（暗键闸）。

⚠ **不设 `clickable` 开关**（参考项目有）：本仓的可点外观由 `meta.interactive`
（真配了联动规则才为真）决定。两个开关只开其一必然是「点了没反应」。

⚠ **`unsupportedChromeKeys` 一个都不声明**：套框模块吃全部 40 个 chrome 键，
`manifest.test.ts` 里一条用例断言它是 `undefined`（照 `metric-card` 的先例）。
参考项目那边是 `chrome:'bare'` + 自绘标题栏 + 自绘四层背景；本仓的统一标题条已经成熟，
套框能白拿全套外观配置与一致的观感，同时少一份自绘代码，而那四层背景改成
`canvas.pattern*` 字段（#76）比写死在模块 CSS 里更可配。

### 15.2 为什么必须走 subEditor

[ADR-0016](adr/0016-复杂config段由清单声明的整页子编辑器接管.md) 给的三条判据，
这段配置**全部命中**（`twin-view` 只命中前两条半）：

1. **元组**：`waypoints: {x,y}[]`、`ports[].at.{x,y}`、`poly.points: [number,number][]`、
   `Twin2dRadius` 的四角数组、`pad: [t,r,b,l]` —— 两列通用表单表达不了定长数组；
2. **跨集合 id 互引**（八处）：`edge.from.nodeId` → `nodes[].id`；`edge.from.portId` →
   该节点有效端口的 id；`node.styleId` → `styles[].id` ∪ 预置库；`node.patch` 的键 →
   该样式的图元 id；`txt.src.slot` → 该节点有效槽位的 key；`variant.when.slot` 同上；
   `vec.fill.id` → 本图元的渐变 id；`ico.src.id` → `TWIN_2D_SPRITE_IDS`；
3. **必须靠画布视口才配得准的几何**：节点摆位、连线拐点、端点 `perimT`、药丸贴边、
   `vec` 的路径点 —— 全是「拖到看着对为止」，用数字框配是折磨。

属性面板那一侧的**事实口径**（实地读过 `PropertyPanel.vue` / `ObjectControl.vue`）：

| 情形 | 面板画什么 |
|---|---|
| `type:'object'` **无** `fields`，且**没有** subEditor | `ObjectControl` 转 `JsonControl` —— 一个 JSON 文本框（任意形状都存得下，但没人改得对） |
| `type:'object'` 无 `fields`，且 `subEditor.configKey === field.key`（本模块） | `PropertyPanel` **在字段这一层就换掉控件**，画 `SubEditorEntry`：入口按钮 + 「已配置 / 尚未配置」+ `hint`。它对被接管的那段 config **一无所知**，只判空非空 |

所以本模块那一格永远不会变成 JSON 文本框——这正是 ADR-0016 要消灭的状态。

### 15.3 路由

```ts
{
  path: '/dashboards/:dashboardId/edit/twin-2d/:nodeId',
  name: 'twin-2d-editor',
  component: () => import('@/pages/Twin2dEditor/index.vue'),
  meta: { title: '2D 孪生编辑器', permissions: [PERMISSION_CODES.dashboardEdit] },
}
```

⚠ 路径必须**同时**含 `:dashboardId` 与 `:nodeId`
（`app/tests/contract/sub-editor-routes.contract.spec.ts` 按字面量 `toContain` 检查）。
参考项目用的是 `:moduleId`，照抄会红——而红的是模块那侧的契约测试，不是路由文件。

⚠ `routeName` 写错既不报错也不失败：属性面板照样画按钮，`router.push` 抛的异常
被 `useSubEditorEntry` catch 掉并只弹一句提示，表现是「点了没反应」。只有那条契约测试兜。

⚠ 页面顶层必须调 `installDashboardModules()`：直接刷新进这条路由时大屏那三页
一个都没跑过，不装的话素材解析恒回空串、图标全部消失。

---

## 16. 与参考项目的对应关系（溯源）

**本节是全文唯一提及旧名的地方。** 参考仓 `DigitalTwinBK` 里这块功能叫「拓扑」
（模块 `topology-view`、页面 `pages/editor/topology`）。本仓改名「2D 孪生」的理由有三：
它与 3D 孪生是同一件事的两个维度（同一批设备、同一批点位、同一套绑定口径）；
「拓扑」在图论里指的是连接关系而不含几何，而这个模块的一半价值恰恰在几何摆位；
以及将来要画的电路图、工艺流程图、系统接线图都不是「拓扑图」。

| 参考项目 | 本仓 | 变化性质 |
|---|---|---|
| 模块 `topology-view` | `twin-2d-view` | 改名 |
| `config_json.topology` | `configJson.twin2d` | 改名（存量文档不导入，§18） |
| `render/`（6 文件 + 1083 行的 `TopologyNodeView.vue`） | `@dt/twin2d/src/{geometry,transform,paint*,placement,variants,expr,format}.ts` + `render/*.vue` | 拆分 |
| `builtinLibrary.ts`（11 类型 / 5 边 / 4 传感器，代码分支的配套数据） | `presets/`（同样 11 / 5 / 4，但是**可配置系统的预置数据**） | 语义变了 |
| `render/icons.svg`（11 枚手绘 sprite） | `@dt/twin2d/src/render/icons.svg`，**原样搬** | 照搬（§5） |
| `TopologyIconSprite.vue` / `TopologyNodeGlyph.vue` | `Twin2dIconSprite.vue` / `Twin2dGlyph.vue` | 改名 + `ico` 多一档来源 |
| `NodeShape` 5 值枚举 | 不存在——形状是 `vec` 图元的几何 | 取消 |
| `NodeTypeDef.subtypeKey` + `SOURCE_CLASS_ICON/COLOR` + `TERMINAL_KIND_ICON` | `node.tags.subtype` + 变体条件 `{kind:'tag'}`，7 组共 25 条变体 | 泛化（§6.3。也就取消了「自定义类型永远拿不到子类下拉」这个死角） |
| `anchors: ('l'\|'r'\|'t'\|'b')[]` | `ports: Twin2dPort[]`，预置样式沿用 `l/r/t/b` 四个 id | 泛化（端口 id 兼容） |
| `fields: NodeFieldDef[]` + `bindings[].fieldKey` | `slots: Twin2dSlot[]` + `nodeValues[i].value` | 改名 + 换绑定口径 |
| `nodeValues[i].{value,status}`（行 = 节点） | `nodeValues[i].value`（行 = 节点 × 槽位）+ `nodeStatus[i].status`（行 = 节点） | 拆成两个槽（§10） |
| `deviceStatus.ts` 的 `toStatus`（四组词表 + `trim().toLowerCase()`）+ `STATUS_OVERLAY` | `@dt/modules/shared/status.ts` 的 `toDeviceStatus` + `Component.vue` 里的 `STATUS_OVERLAY` | 换成本仓真源，**并给真源补上参考项目那四组同义词**（R0d）：本仓的 `toDeviceStatus` 只认 0/1/2/3 与五个字面档名，整套词表是缺的（#96）。五档 2 号位在本仓叫 `standby` |
| `sensors: TopoSensor[]`（节点上的独立实体） | `node.layers` 里追加的预置药丸图元 + `node.slots` 里追加的槽位 | 归并（传感器不再是特殊实体） |
| `annotations` | `marks`（多一档 `text`） | 改名 + 扩档 |
| `emit('interaction', { event: 'select', … })` | 同样 `'select'`，但在清单里**显式声明** `interactionEvents: ['select']` | 沿用 + 补声明（§9.7） |
| `config.clickable` 开关 | 不做，可点外观由 `meta.interactive` 决定 | 取消（§15.1） |
| `dt_node_type_templates` / `dt_project_node_type_libraries` 两张表 + 8 个端点 | 不做，样式库存文档（§13.3） | 取消 |
| `deriveBindings.ts`（`field_key = node_id` 或台账键） | `bindingRows.ts`（清单声明的实体钉行槽） | 必须换：旧口径在本仓会被服务端 422 拒 |
| `migrate.ts` 的「`.binding` 与平铺镜像双写」 | 不存在——本仓只有一种绑定形状 | 取消（也取消了「只写一份就静默失效」这个最大的坑） |
| `legacyPrimaryFieldKey`（`today_kwh` 在源类改读 `power_kw`） | 不做 | 取消（§18） |
| `useTopologyEditor.ts` 699 行 | `twin2dDoc.ts` + 7 个 `*Ops.ts` + 3 个 `use*.ts` | 拆分（组合式 ≤200 行是闸门） |
| vue-flow | 自绘画布（§13.2） | 取消依赖 |
| `TopologyViewer.vue` 的 `enable3d` / `defaultView` / 内嵌 `TwinConfig` | 不做：3D 是 `twin-view` 那块的事 | 取消（跨屏/同屏联动走平台的联动规则） |
| `twinLink: {partId, anchorId, panelId, tintId, cameraId}` | 不做 | 取消（它在参考项目里也只给同一模块内的 3D 分支用） |

---

## 17. 测试与闸门

### 17.1 分层清单

| 层 | 文件 | 守什么 |
|---|---|---|
| 单元 | `packages/twin2d/tests/geometry.test.ts` | 周长四段（含 bottom/left 反向参数化）、四个角点法线、`projectToPerimT` 取最近边、四种路由、`side:'auto'` 的两种推法、圆角折线两条退化保护、箭头三顶点、`wrap01` 非有限 → 0、**带 waypoints 的反向渲染**、`labelAt` 弧长采样 |
| 单元 | `.../transform.test.ts` | **二极管的 4 档 rotate × 4 种 flip = 16 组端口坐标**；`keepUpright` 的反向角；`centerBoxOf` 的左上角 ↔ 中心换算 |
| 单元 | `.../placement.test.ts` | 九档锚点表逐值、`perim` 法线推移的 translate 表达式、`fill/abs/flow` 三档、`Len` 四形态（px/%/em/auto） |
| 单元 | `.../paint*.test.ts` | 四种图元 → 内联样式；多层 `fills` 的顺序（从下往上）；`shadows` 的 inset 与非 inset 拼接顺序；`transition` 六档属性名；`pointerEvents` / `transformOrigin` / `minWidth` / `maxWidth` 各一条；`--t2-*` 注入齐全；`box` 恒定输出那三样 |
| 单元 | `.../cssValue.test.ts` | `url(` / `@import` / 反斜杠 / 控制字符 / 超长 被拒并回落缺省；`var()` / `color-mix()` / `calc()` 放行；accent 三级兜底链是**字符串拼接**而非取值解析 |
| 单元 | `.../variants.test.ts` | 六种条件求值（含新的 `tag`）；文档序覆盖；`has` 的 any/all；`not` 嵌套；补丁是浅合并（不是整树重建） |
| 单元 | `.../expr.test.ts` | 七档算子；`first` 跳过非有限值；`ratio` 分母 ≤0 → 空；递归深度 3 与超深截断；悬空槽引用出诊断 |
| 单元 | `.../format.test.ts` | 两套占位符；整数/小数/enum/单位；kWh 短与全；`reverseFromValue` 的「boolean 一律 false」；locale 钉 `'en-US'` |
| 单元 | `.../normalize*.test.ts` | 数字 id 要 `String()` 化（否则节点换自动 id、引用它的连线被静默丢掉）；`posDim` 挡 0 与负数；白名单外的枚举值忽略而非报错；图元树超深截断进诊断；悬空连线过滤；`tags` 的 trim 与长度上限 |
| 单元 | `.../bindingRows.test.ts` | 三个槽的行数与行顺序；派生槽不成行；未被引用的槽不成行；`rowCounts` **三键都在且可为 0**；`remapTwin2dBindings` 按三个稳定键搬家；删中间节点后其后行号整体前移 |
| 单元 | `.../issues.test.ts` | 悬空 styleId / 槽引用 / 端口 / 渐变 id / sprite id、**节点级覆盖补丁与变体补丁各自的悬空图元 id**（两条 code 分开）、越界拐点、超深图元树、被消毒拒掉的 CSS 值，各出一条诊断 |
| 组件 | `.../render/Twin2dNodeBox.spec.ts` | 11 种预置样式各挂载一次，断言根类、`--t2-*` 值、关键内联样式；**hover 变体命中时 5 个子图元各自的补丁值**；旋转 90° 后 `keepUpright` 的 `txt` 反向旋转；六档 `labelPos` 各自哪个 `txt` 在渲染 |
| 组件 | `.../render/Twin2dPrim.spec.ts` | 四种 kind 各渲对元素；`hidden` / `when` 不成立时整枝不渲染；递归深度；`transition` 输出成一条声明 |
| 组件 | `.../render/Twin2dVec.spec.ts` | 五种几何各出对的 SVG 元素；渐变 id 加了实例前缀（同页两份不撞、且永不撞 sprite 的四个 id）；`stretch` → `preserveAspectRatio="none"`；`nonScaling` → `vector-effect` |
| 组件 | `.../render/Twin2dGlyph.spec.ts` | 四档来源各渲对元素；`sprite` 档的外壳 `viewBox` 是 `0 0 48 48`；**`ico.color` 在单色 sprite 上落到 `color` 样式、在 `TWIN_2D_FIXED_COLOR_SPRITES` 那 4 枚上不落**（两条用例，各挑一枚）；`asset` 档未注入 resolver 时空 + 进诊断 |
| 组件 | `.../render/Twin2dEdgeLayer.spec.ts` | 多遍描边的元素数与顺序；四种 marker + 引脚 marker 的线宽；`flow` 的 dashoffset 终点 = dash 求和的负值；**`animateFlow=false` 时 `edgeStyle.flow.enabled=true` 也不动**；非活跃档；**带 waypoints 的反向渲染路径不自交**；标签沿路径位置 |
| 组件 | `.../render/Twin2dStage.spec.ts` | 四档 fitMode 的 transform；容器 0 尺寸时不输出 transform 而是 `visibility:hidden`；层序（below 标注在连线下、above 在节点上）；hover 抬 z；sprite 宿主挂了一次 |
| 清单 | `packages/modules/tests/modules/twin-2d-view/manifest.test.ts` | 身份（type/category/chrome/icon）；`ownsStatusDisplay`/`emitsInteractions` 为真、`interactionEvents === ['select']`、`hostClickable` 缺席；`unsupportedChromeKeys === undefined`；三个槽的 `isArray`+`isEntityPinned`+`arrayFields`；**`nodeStatus` 的子槽 `enumMap === undefined`**；`bindingRowCounts` 三键都在（含空配置给 0）；`bindingRowLabels` 的 `{title,id}`；`subEditor` 四个字段；`when` 指着真字段；`preview.config` 只含 `twin2d` |
| 挂载 | `.../twin-2d-view/Component.spec.ts` | 七个配置键各有一条读到的用例；逐槽四档各自可辨（未配 / pending 半透明 / error 变色带 title / ok 有值）；**`archive` 与 `dataset` 两档各一条：`title` 上挂着字面文案「序列要异步取数，画布上不展开」**（§14.4）；**实时 status 覆盖静态 status，且 `unknown` 不覆盖**；配了联动才吞冒泡（`attachTo: document.body` + body 上装 spy）；空文档不留白而是一句话 |
| 编辑器 | `app/tests/pages/Twin2dEditor/*.spec.ts` | 文档态与撤销栈（一手势一步）；保存把同屏其余节点原样带回；`expectedVersion` 冲突走重新加载；**快速切 `nodeId` 时旧响应不覆盖新文档**；离开守卫两道；快捷键让位表单 |

### 17.2 「写错了双双放行」那一类——只能靠契约测试兜

模板里的 prop / 插槽 / 注册名写错，typecheck 与 lint **双双放行**：多的 prop Vue 忽略，
少的 prop 是 `undefined`，未登记的图标名什么都不画。本模块把这类风险集中在**十条契约**上。

落点只有两处，判据是**这条契约要扫几个包**：只读 `packages/twin2d/` 自己的，就放包内
`packages/twin2d/tests/`；要跨包读（`app/src` 或 `packages/modules/src`），就放
`web/app/tests/contract/`——那个目录里的用例按 `process.cwd()` 取绝对路径，
**能同时读到 `app/src` 与任意 `packages/*/src`**（先例是 `twin-inspector-coverage.contract.spec.ts`：
它同时扫 `packages/twin-config/src/types.ts` 与 `app/src/pages/TwinEditor/components`。
⚠ 别拿 `twin-config-consumed` 当先例——它的 `SCAN_ROOTS` 只有
`packages/{three-core,modules,twin-config}/src` 三个包，一处都不读 `app/src`）。
反过来，放在 `packages/modules/tests/` 里的那套扫描器跟不进 `@dt/*` 包（§3.2），
所以一条都不放那儿。「轮」列与 §19 的轮次表一一对应。

| 契约 | 落在 / 轮 | 守什么 | 不守会怎样（且不报错） |
|---|---|---|---|
| `twin2d-prim-kinds.contract.spec.ts` | `packages/twin2d/tests/`｜R4 | `TWIN_2D_PRIM_KINDS` 常量 ↔ `Twin2dPrim.vue` 模板里的 `kind === 'x'` 分支，逐档双向对上 | 加了第五种图元忘了加分支 → 那类图元静默不画，编辑器里能配、画布上没有 |
| `twin2d-sprite-ids.contract.spec.ts` | `packages/twin2d/tests/`｜R4 | `TWIN_2D_SPRITE_IDS` ↔ `icons.svg` 的 `<symbol id>` 双向对齐；`TWIN_2D_FIXED_COLOR_SPRITES` ↔ 文件里「hex 计数 > 0」的 symbol 集合逐项相等（§5）；顺带断言实例渐变前缀永不产出 sprite 的四个渐变 id | 常量多一个 → 那一档渲染空白；文件多一个 → 用户永远选不到；固定色名单错一个 → 颜色控件该禁的没禁（点了没反应）或不该禁的禁了；渐变撞名 → 图标底色变成另一枚图标的 |
| `twin2d-css-vars.contract.spec.ts` | `packages/twin2d/tests/`｜R4 | `paintCommon.ts` 产出的每个 `--t2-*` 都在 `twin2d.scss` 里被 `var()` 消费，反之亦然 | 改了变量名 → 那条声明失效，颜色/尺寸静默回落。⚠ 全局的 `css-variables` 契约扫不到 `packages/twin2d` |
| `twin2d-slot-refs.contract.spec.ts` | `packages/twin2d/tests/`｜R5 | 预置库里每个 `txt.src.slot`、`when.slot`、派生槽 `expr` 引用的 key 都在该样式的 `slots` 里；每条 `tag` 变体引用的 sprite id 都在白名单里 | 悬空引用 → 永远显示占位符，看起来像「点位没绑上」 |
| `twin2d-preset-fidelity.spec.ts` | `packages/twin2d/tests/`｜R5 | §7 那张 100 行表逐条对应一条断言 | 「预置数据」慢慢长回「渲染分支」，而退化过程每一步都不报错 |
| `twin2d-op-parity.contract.spec.ts` | `app/tests/contract/`｜R3 | 「两份表不许漂移」：`kinds.ts` 的八档阈值算子 ↔ `@dt/modules/shared/thresholds` 的 `THRESHOLD_OPS` | 同一条 `between` 在阈值卡片与本模块上判出两种结果 |
| `twin2d-format-parity.contract.spec.ts` | `app/tests/contract/`｜R3 | 「两份表不许漂移」：`@dt/twin2d/format.ts` 的**行为** ↔ `@dt/modules/shared/format`（§11.3） | 同一个读数在指标卡与图上显示成两个数 |
| `twin2d-render-props.contract.spec.ts` | `app/tests/contract/`｜R4 建，随编辑器长 | 扫 `packages/twin2d/src/render/*.vue` 与 `app/src/pages/Twin2dEditor/**` 里对这些组件的每一处使用，把传的 attr 名（kebab→camel）与该组件 `defineProps` 的键集合双向比对 | 传 `:status-override` 而组件收别的名字 → 那一路数据永远不到，画面上是「绑了没反应」 |
| `twin2d-inspector-coverage.contract.spec.ts` | `app/tests/contract/`｜R10 | 文档类型里每个字段都在 OWNERS 表里指名一个检查器组件负责（照 `twin-inspector-coverage` 先例） | 出现「schema 有、面板无」的字段（参考项目就有 12 个这样的字段：per-node 形状、`badgeColor`、节点 x/y 数字输入、传感器 `perimT`/`dx`/`dy`/`label`、连线 `fromT`/`toT`、`subtypeKey`、`fields[].primary`、传感器 color） |
| `twin2d-consumed.contract.spec.ts` | `app/tests/contract/`｜R10 | 反向：文档契约里的字段必须被渲染层读到（照 `twin-config-consumed` 先例） | 配了永远不生效的开关 |

> ⚠ `twin2d-render-props` 在 R4 就建，那时 `app/src/pages/Twin2dEditor/` 还不存在——
> 它的第二个扫描根**匹配到零个文件**，用例照样绿。这是有意的：等 R8 起编辑器长出来，
> 每一处新用法当天就被它扫上，不必再想起来「该补一条契约了」。
> 对应地，那条用例里要有一句断言「第一个扫描根至少扫到一个文件」——
> 否则哪天两个根都空了（比如目录改名），它会变成一条永远绿的空转用例。

### 17.3 被哪些既有全局闸覆盖

`manifests.contract`（目录名数组、两个文件名、props 严格三件套、槽键与 `values[...]`
取法逐一对上、图标名、preview 键、死字段/暗键、`interactionEvents` 只登记契约里的名）、
`catalog.contract`（`module_types.json` 快照，**必须 `-u` 重生成**）、两份零类型字面量、
`sub-editor-routes`、`chromeKeyCatalog`、`startup-graph`（不许静态 import `@dt/three-core`
——本模块压根不碰 3D）、`icon-names`、`check_web_deps`（新包登记 + 方向 + 零环）、
`check_structure_web`（页面目录形态、桶只 re-export、禁深链）、
`check_web_styles`（`packages/*` 不许 Tailwind、页面根要 `h-full`+`min-h-0`）、
`check_ts_style`（SFC ≤500 / `use*` ≤200 / props ≤10 / 模板 ≤6 层 / 卸载必清理 /
`:key` 不许索引 / 不许硬编码色值 / `.vue` 里禁 `new Date(` 与 `toLocaleString(` /
竞态只许用 `useRacedFetch`）、`check_comments`（`@fileoverview` 必有、禁变更史叙事）。

### 17.4 覆盖率：最紧的一条

全局阈值里 `functions 85%` 是本次最容易红的一档：v8 把模板里每个内联事件处理器
都算一个函数，而一个整页编辑器动辄新增几百个。所以**每个分片 PR 自带交互用例**，
把点击、切筛选、弹窗确认、弹窗取消、失败分支逐条点过。

⚠ `packages/*/src/**/*.ts` 另有一档 **95/90**（`vitest.config.ts` 的 thresholds 里
按 glob 单列），所以 `@dt/twin2d` 里那批纯函数要基本测满——好在它们全是纯函数，好测。
`.vue` 不在这一档，走 85/75 的组件线。

---

## 18. 本期明确不做

| 不做 | 为什么 / 真要做的前提 |
|---|---|
| **参考项目存量图 JSON 的导入器** | 结构映射看着机械（5 档形状 → 5 份预置样式、`anchors` → `ports`、`sensors` → 追加图元 + 槽位、`annotations` → `marks`），但**绑定翻译是一整块独立工作**：要同时处理「`server_id`+`node_id` 二元组 → `nodeKey` 拼串」「`static_value` 从文档搬到绑定的 `staticValueJson`」「台账键 `ds:code:col` 从 `node_id` 位搬到 `detailJson`」三种，而其中台账与历史那两档翻译对了也取不到值（§14.4），反而会让人以为导入坏了。**前提**：等历史/台账的异步取数链路接通、且确认真有几张值得搬的存量图；届时先做「结构 + opcua 绑定」两档，静态值与台账各出一条诊断让人工补 |
| `legacyPrimaryFieldKey` | 参考项目为自己的存量绑定留的兼容垫片（`today_kwh` 在源类改读 `power_kw`、末端类改读 `demand_kw`）。本仓没有存量文档，照搬等于第一天就带一条谁也解释不清的隐式改绑规则 |
| 交叉跳线（hop / gap） | 要全图两两求交 O(n²) + 一个「谁让路」的全局约定，任一条线动一下要重算整图。前提：先有一个稳定的「线段集合」缓存与增量求交 |
| 网表语义（同名即同网、导出 netlist） | 那是 EDA 而不是大屏。前提：先确定这张图要不要成为电气设计的真源 |
| 自动避障走线 | 手工拐点在电路/工艺图里本来就是常规做法；避障的结果不可预测，用户会花更多时间跟它打架 |
| 三线相交自动画接线点 | 与跳线同一题（要先判「相交」还是「跨过」）。现在给显式的「接线点」预置样式 |
| 项目级样式库（跨大屏共享） | 参考项目建了库却没接运行时消费点，用户自建类型上大屏一律退化。前提：先把消费点接上，再谈端点与表（§13.3） |
| 液位填充 / 动态波形 | 参考项目里也不存在（那条波形是静态图标的一部分，#83）。新模型天生能做（一个 `vec` 的高度绑槽位 + 变体），所以它是用户自己能加的东西 |
| 「次显数值」 | 参考项目里 `secondaryField` 解析了但模板一次都没渲染。照着类型定义做会加出参考项目没有的元素 |
| 任意角度旋转 | 只给 0/90/180/270。任意角度让正交走线失去意义，端口吸附点变成无理数 |
| 沿法线偏移的真双线 | 要对「折线 + 圆角」做 path offsetting。宽底窄芯两遍描边在视觉上就是双线 |
| 3D 联动（`enable3d` / `twinLink`） | 3D 是 `twin-view` 那块。两块之间的联动走平台的联动规则（`navigate` / `show` / `setValue`），不在模块内部开后门 |
| 表达式语言（图元属性绑公式） | 本仓已有一台解释器（台账公式）。派生槽给七档闭合算子够用；真要复杂计算走绑定的 `computed` 来源 |
| 小地图（minimap） | 自绘画布下它是第二套渲染路径。等真有人抱怨「大图找不着北」再说 |
| 引 webfont 补数字字形 | `--font-digit` 只给回退链（§11.2）。引 `@font-face` 要挑字体、评许可证、算首屏字体体积、定 `font-display` 策略，而且影响的是全站排版 |

---

## 19. 实施轮次表

**行数是诚实值**（§3.4），含测试。按 [engineering-workflow](agents/engineering-workflow.md)
§3.1 的 400 行上限，全程约 **66–81 个 PR**；下表的「轮」是**工作单元**，一轮拆几个 PR
写在最后一列。规模例外的处理照
[AC_DATA_LANDING](AC_DATA_LANDING.md) §0 的三条出路，由用户拍板，本文不替他决定。

本地过闸一律用 `scripts/ci-local.sh`：`--fast` 是秒级子集（含 black + prettier），
`--all` 走 act 跑整条 `ci.yml`（覆盖率棘轮、`diff-cover --fail-under=85`、包体预算、
gitleaks 只有这条路径才跑得到）。⚠ **跑 act 期间不要动工作树**。
⚠ 开发期不要推分支等 GitHub 的 CI——分支与 PR 上根本不触发流水线。

| 轮 | 范围 | 产出文件 | 行数量级 | 过闸命令 | 验收标准 | PR 数 |
|---|---|---|---|---|---|---|
| **R0a** 前置·依赖表与 token | 把「新增包」的闸门前置条件先落平。此时 `packages/twin2d/` 还不存在，多一条表项无害 | `scripts/gates/check_web_deps.py`、`docs/agents/project-structure-typescript.md`、`web/packages/tokens/src/tokens.scss` | ≈ 40 | `scripts/ci-local.sh --fast` | `check_web_deps` 认得新表项且不因目录缺席而红；`--font-digit` 落在字体族段里；`css-variables` 契约照旧绿 | 1 |
| **R0b** 前置·`useUnsavedGuard` 提取 | 从 `TwinEditor/scripts/` 提到 `app/src/composables/`（**目录已存在**），`TwinEditor` 改引用，测试跟着搬 | `web/app/src/composables/useUnsavedGuard.ts`、`web/app/src/pages/TwinEditor/index.vue`、`web/app/tests/composables/useUnsavedGuard.spec.ts`（原 `tests/pages/TwinEditor/scripts/` 那份删除） | ≈ 90 | `scripts/ci-local.sh --fast`；`pnpm --dir web vitest run app/tests` | `TwinEditor` 的既有守卫用例逐条照旧绿；`check_structure_web` 的「测试镜像源码」不红 | 1 |
| **R0c** 前置·锁文件（**单独成 PR，硬约束**） | 建 `packages/twin2d/package.json`（名 `@dt/twin2d`、deps `contracts`+`ui`、peer vue，⚠ **先不写 `typecheck` 脚本**，否则 `pnpm -r --if-present typecheck` 会因缺 tsconfig 失败）+ `packages/modules/package.json` 加一条依赖 + 锁文件 | `web/packages/twin2d/package.json`、`web/packages/modules/package.json`、`web/pnpm-lock.yaml`、本文件（占位一节） | 手写 ≈ 30（锁文件不计） | `scripts/ci-local.sh --fast` | `check_lockfile_stands_alone` 绿——它只允许锁文件与 `*.md` 及 basename ∈ {package.json, pyproject.toml} 同批，本 PR 正好合法。⚠ **顺序必须在 R0a 之后**，否则目录存在而不在 ALLOWED 表里会让 `check_web_deps` 在 main 上红 | 1 |
| **R0d** 前置·`toDeviceStatus` 补同义词表（**独立小 PR**） | 给 `@dt/modules/shared/status.ts` 的 `toDeviceStatus` 加一张字符串同义词表：`String(raw).trim().toLowerCase()` 后先查词表，查不到再走现有的 `readEnum`。**纯扩宽**——表里这些取值今天一律落 `unknown`（fallback），加了不改变任何一条现有行为。理由是「一份真源」：状态归一在本仓只该有一处，不在本模块里另起一份（§10.1）。⚠ `shared/status.ts` + `StatusBadge.vue` 今天**一个生产消费方都没有**（只有它们自己的用例），本模块是第一个——所以现在补是改一处，等信息卡片、设备列表这些同样要吃 `toDeviceStatus` 的模块进来之后再补，就是改一片，且期间各家很可能各自贴一张本地词表 | `web/packages/modules/src/shared/status.ts`、`web/packages/modules/tests/shared/status.test.ts`（已存在，追加用例）| ≈ 25 源 + ≈ 60 测试 | `scripts/ci-local.sh --fast`；`pnpm --dir web vitest run packages/modules/tests/shared` | 四组词表逐词各一条用例；大小写与前后空格各一条；**现有用例一条不改照旧绿**（这是「纯扩宽」的机械证明）；`packages/*/src/**/*.ts` 那一档 95/90 不掉 | 1 |
| **R1** 契约与归一化 | tsconfig + typecheck 脚本；`constants` / `kinds` / `types`；`normalize` 六件；`issues.ts` | `packages/twin2d/{tsconfig.json,package.json}`、`src/{index,constants,kinds,types,normalize,normalizeStyles,normalizePrims,normalizeNodes,normalizeEdges,normalizeMarks,issues}.ts`、`tests/normalize*.test.ts`、`tests/issues.test.ts` | ≈ 3 400（源 1 600 / 测试 1 800） | `pnpm --dir web vitest run packages/twin2d --coverage`；`scripts/ci-local.sh --fast` | `packages/*/src/**/*.ts` 那一档 95/90 达标；`check_comments` 每个 `.ts` 有 `@fileoverview` 且**无变更史叙事**（迁移注释里最容易写「原实现是…」）；`posDim` 挡 0 与负数、数字 id `String()` 化、超深截断三条各有用例 | 9 |
| **R2** 几何与变换 | `geometry.ts`（周长参数化含 bottom/left 反向、四角精确法线、`projectToPerimT`、四种路由、`side:'auto'` 解析、圆角折线两条退化保护、箭头、反向渲染、`labelAt` 弧长）+ `transform.ts` | `src/{geometry,transform}.ts`、`tests/{geometry,transform}.test.ts` | ≈ 1 600（源 700 / 测试 900） | 同上 | 四段周长各三点、四角法线、四种路由、两条退化保护、**带 waypoints 的反向渲染**、**二极管 16 组端口坐标**逐条有断言 | 4 |
| **R3** 绘制层（纯函数） | `placement` / `paintBox` / `paintVec` / `paintText` / `paintCommon` / `variants` / `expr` / `cssValue` / `format` | `src/{placement,paintBox,paintVec,paintText,paintCommon,variants,expr,cssValue,format}.ts`、对应 `tests/*.test.ts`、`app/tests/contract/{twin2d-op-parity,twin2d-format-parity}.contract.spec.ts` | ≈ 2 600（源 1 300 / 测试 1 300） | 同上 + `pnpm --dir web vitest run app/tests/contract/twin2d-format-parity.contract.spec.ts` | 九档锚点与 `perim` 法线两套数学各锁一遍；`transition` 六档、`pointerEvents`/`transformOrigin`/`minWidth`/`maxWidth` 各一条；`expr` 七档 + 深度 3；`cssValue` 拒放两侧；format 与 `shared/format` 行为逐项相同且 locale 钉 `'en-US'` | 7 |
| **R4** 渲染件 + sprite | `render/` 八件 + `twin2d.scss` + `icons.svg` 原样搬 | `src/render/{icons.svg,Twin2dIconSprite.vue,Twin2dStage.vue,Twin2dNodeBox.vue,Twin2dPrim.vue,Twin2dVec.vue,Twin2dGlyph.vue,Twin2dEdgeLayer.vue,twin2d.scss}`、`tests/render/*.spec.ts`、`tests/{twin2d-prim-kinds,twin2d-css-vars,twin2d-sprite-ids}.contract.spec.ts`、`app/tests/contract/twin2d-render-props.contract.spec.ts` | ≈ 2 400（源 1 300 / 测试 1 100） | 同上 | SFC ≤500 行逐个核；`twin2d.scss` 里**零硬编码色值**；`.vue` 里禁 `new Date(` / `toLocaleString(`；`:key` 不许索引（StrokePass/Fill/Shadow/Gradient 都要有 id）；`Twin2dStage` 的 ResizeObserver 卸载必清理；四条契约全绿；hover 与 `prefers-reduced-motion` 各有用例 | 6 |
| **R5** 预置库 | `palette` / `nodes`（11 种）/ `subtypes`（7 组 25 条）/ `edges`（5 种）/ `sensors`（4 种）/ `circuit`（8 枚 GB/T） | `src/presets/*.ts`、`tests/presets/*.test.ts`、`tests/twin2d-preset-fidelity.spec.ts`、`tests/twin2d-slot-refs.contract.spec.ts` | ≈ 3 200（源 1 900 / 测试 1 300） | 同上 | **§7 那张 100 行表 98 行有断言**（用例名带行号 `§7-1` … `§7-100`；当时缺的 #73 / #97 与只覆盖一半的 #8 / #22 / #71 逐条列在 §7 开头的水位表里，两条缺的分别依赖 R9 的标注渲染件与 R7 的连线取值归一）——这张表是「内置库只是预置数据、不会退化成渲染分支」的唯一机械保证；`slot-refs` 保证预置里零悬空槽/零悬空 sprite id；`palette.ts` 的字面 hex 不触发硬编码色值闸 | 8 |
| **R6** 绑定行与缝合 | `bindingRows.ts`：有效槽位筛选、行 → 实体映射、`twin2dRowLabels`/`RowCounts`、`remapTwin2dBindings`、`twin2dValues` 缝合 | `src/bindingRows.ts`、`tests/bindingRows.test.ts` | ≈ 900（源 350 / 测试 550） | 同上 | 三个槽的行数与顺序；派生槽与未被引用的槽都不成行；`rowCounts` 三键都在且可为 0；删中间节点后其后行号整体前移 | 3 |
| **R7** 模块落地（**走机械化豁免，必须只有这一个新模块目录**） | `manifest.ts`（7 个配置字段 + 3 个槽，⚠ **此时先不声明 `subEditor`**，见 R13）+ `Component.vue`（读全部键、缝三槽、状态归一、四档、`@click.stop`）+ 测试 + 六处花名册 + 本文件 | `packages/modules/src/modules/twin-2d-view/{manifest.ts,Component.vue}`、`packages/modules/tests/modules/twin-2d-view/{manifest.test.ts,Component.spec.ts}`、`packages/modules/tests/manifests.contract.spec.ts`（`KEY_CONSTANTS` 加四项）、`packages/modules/tests/registerBuiltins.test.ts`、`server/services/platform-server/src/platform_server/apps/dashboard/module_types.json`、`server/services/platform-server/tests/{contract,unit,integration}/…`、`docs/MODULE_TWIN_2D_DESIGN.md` | ≈ 1 200（含快照 json） | ⚠ 先 `pnpm --dir web vitest run packages/modules/tests/catalog.contract.spec.ts -u` 重生成 `module_types.json` 并提交，否则服务端按过期目录校验、新绑定被拒；然后 `scripts/ci-local.sh --all` | `_is_module_landing()` 豁免成立——⚠ 本 PR **绝不能**顺手改 `packages/modules/src/shared/`、`packages/modules/package.json`、`packages/ui/**`、`app/src/**`，任一处都会让豁免整体失效；⚠ 也**绝不能**与另一个新模块合并（`len(fresh)==2` 时豁免直接消失）；`nodeStatus` 的 `enumMap === undefined` 有断言 | 1 |
| **R7b** 逐槽状态通道（**必须与 R7 分开**） | 给 `Twin2dSlotRead` 加 `state` / `reason` 两项——仍由**同一个** `readSlot` 回，不新增 props；`paintSlotState` 按四档出 `color`/`opacity`/`breathe`/`title` 并叠在 `paintText` 最后一层；`resolveTxtContent` 的 slot 档在非 `ok` 三档按无值格式化；模块壳只报档位（`gearOf`）、不再自己抹值，角上那枚汇总角标留着（分工见 §9.6） | `packages/twin2d/src/{paintText,paintCommon,bindingValues,index}.ts`、`packages/twin2d/src/render/{Twin2dStage,Twin2dNodeBox,Twin2dPrimView}.vue`、`packages/twin2d/tests/render/Twin2dSlotState.spec.ts`、`packages/twin2d/tests/paintText.test.ts`、`packages/modules/src/modules/twin-2d-view/Component.vue`、`packages/modules/tests/modules/twin-2d-view/Component.spec.ts`、`docs/MODULE_TWIN_2D_DESIGN.md` | ≈ 550（源 150 / 测试 400） | `pnpm --dir web vitest run packages/twin2d packages/modules/tests/modules/twin-2d-view`；`scripts/ci-local.sh --fast` | 四档各一条渲染用例；**「等首帧与未配来源只靠颜色与透明度分得开」单独一条**（本轮要害，两档的字必须相等、样式必须不等）；档位按 (节点 id, 槽键) 各查各的有一条（按下标取会串到隔壁节点上）；模块侧一条端到端钉「`error` 时**那一格**真的变色，不是只有角标变色」；`packages/twin2d` 覆盖率维持语句/函数/行 100%、分支 99.9%（`edgeView.ts` 与 `Twin2dStage.vue` 那两条构造上走不到的空值守卫除外） | 1 |
| **R8** 编辑器骨架 | 路由一条；`index.vue`（AppShell + `h-full`/`min-h-0` + 三栏 + `DtPageState` + `installDashboardModules()`）；`twin2dDoc.ts`（帧 = 配置 + 绑定，`commit` 无条件重派）；`useTwin2dEditorPage.ts`（整树替换、其余节点原样带回、`expectedVersion` 冲突、**`useRacedFetch`**）；工具栏；两道未保存守卫 | `app/src/router/index.ts`、`app/src/pages/Twin2dEditor/index.vue`、`components/Twin2dToolbar.vue`、`scripts/{types,twin2dDoc,useTwin2dEditorPage}.ts`、`app/tests/pages/Twin2dEditor/*.spec.ts` | ≈ 1 800 | `scripts/ci-local.sh --fast`；`pnpm --dir web vitest run app/tests` | `check_structure_web` 的页面形态三条；`check_web_styles` 的 AppShell 必带 `h-full`+`min-h-0`；`use*` ≤200 行；`check_race_guards_come_from_one_place` 绿；**「快速切 nodeId 旧响应不覆盖新文档」有用例**；每个内联 handler 都有用例 | 5 |
| **R9** 画布与手势 | `EditorCanvas` / `CanvasGrid` / `CanvasNodeLayer` / `CanvasEdgeLayer` / `CanvasEdgeHandles` / `CanvasMarkLayer`（⚠ 按 `zOrder` 分两层与运行态一致）/ `CanvasMarquee` / `CanvasConnectPreview`；`viewportOps` / `snapping` / `useCanvasPointer` / `editorSelection` / `waypointOps` / `portOps` | 见 §3.3 | ≈ 3 400 | 同上 | 卸载必清理（window 上的 `pointermove`/`pointerup`、ResizeObserver）；手势期间只做纯变更、`pointerup` 才 `commit` 一次（一手势一步撤销）；拖拽中卸载要补一次 commit；sprite 宿主在画布里挂了一次 | 9 |
| **R10** 检查器四件 | `Twin2dInspector` 分发 + Node/Edge/Mark/Canvas 四个 + `PlacementField`/`ColorField`/`TransitionField`/`ShadowList`/`StrokePassList`/`FillList`；`nodeOps`/`edgeOps`/`markOps`；两条覆盖契约 | 见 §3.3 + `app/tests/contract/{twin2d-inspector-coverage,twin2d-consumed}.contract.spec.ts` | ≈ 3 200 | 同上 | 传感器锚点**九档全给**（参考项目编辑器只给 4 档，手写 `'c'` 能渲染但选不到、一改就丢）；文本类输入走合并撤销；两条覆盖契约全绿 | 8 |
| **R11** 样式编辑器与样式库 | `StyleInspector`（尺寸/端口/槽位/图元树/变体）+ `PrimTree` + `PrimFields` + `VariantFields` + `GeometryField`（画布上取点画路径）+ `PortList` + `SlotList` + `ExprEditor` + `StyleLibraryDrawer` + `NodePalette` + `Twin2dOutline`；`styleOps`/`primOps`/`stylePackage`/`clipboard`/`shortcuts` | 见 §3.3 | ≈ 3 800 | 同上 | 快捷键必须让位表单（`isFormFocused` 按最近可交互祖先判，含 `role=combobox/listbox/dialog`——只看 `tagName` 会让键盘翻下拉时把节点静默 nudge 进撤销栈）；「恢复内置」是**删覆盖**而不是写死内置数据；样式包导出/导入往返一致 | 10 |
| **R12** 绑定页 + 运行态预览 + 诊断 | `Twin2dBindingPane`（复用 `BindingPanel`，喂 rowLabels/rowCounts）、`Twin2dRuntimePreview`（画中画，走模块注册表而非类型字面量）、`Twin2dDiagnostics`、`useTwin2dBindings`/`useTwin2dLiveValues`（自己装 `installDashboardDataSources`）、`bootstrap/dashboard.ts` 注入 `configureTwin2dAssets` | 见 §3.3 + `app/src/bootstrap/dashboard.ts` + `packages/twin2d/tests/twin2d-asset-injection.test.ts` | ≈ 1 500 | 同上 | ⚠ 运行态预览里**不许出现模块 type 字面量**（两份零字面量闸都扫 `app/src`）——照 `TwinEditor` 的做法用 `getModule(node.moduleType)?.subEditor?.configKey`；素材两种 kind 各一条用例；未注入时「空 + 进诊断」有用例 | 4 |
| **R13** 接线 `subEditor` + ADR + 收尾 | `manifest` 补 `subEditor` 四个字段（此时 `sub-editor-routes` 契约才会绿）；ADR-0026 / 0027；本文件定稿；`DASHBOARD_DESIGN` §5 补一段；按实际水位补交互用例把 `functions` 顶回 85+ | `packages/modules/src/modules/twin-2d-view/manifest.ts`、`docs/adr/0026-*.md`、`docs/adr/0027-*.md`、`docs/MODULE_TWIN_2D_DESIGN.md`、`docs/DASHBOARD_DESIGN.md`、补覆盖的测试 | ≈ 800 | **`scripts/ci-local.sh --all`** | `sub-editor-routes.contract` 四条全绿（`routeName` 存在、path 含 `:dashboardId` 与 `:nodeId`、`configKey` 在自己的 schema 里、至少一个模块声明了子编辑器）；覆盖率棘轮（90/80 封顶）与 `diff-cover --fail-under=85` 全过 | 3 |

两个 ADR 的题目（[engineering-workflow](agents/engineering-workflow.md) 的四条触发条件里
命中「引入/否决一个跨模块的结构性做法」）：

- **ADR-0026 · 2D 孪生的节点与连线样式是可配置图元文档** —— 记「形状从枚举下沉成数据」
  这条判断、内置库只是预置数据、以及「改预置库会改存量渲染」这条与 `ConfigField.default`
  同源的口径。
- **ADR-0027 · 2D 编辑画布自绘而不引入图编辑框架** —— 记 §13.2 那笔账，特别是
  `as unknown as` 撞 lint 这条硬约束。

⚠ 顺序上有四处不能换：R0a 必须在 R0c 之前（否则新目录不在 ALLOWED 表里）；
R0b 必须在 R8 之前（否则第一个用到守卫的 PR 要连带把提取带进来）；
R0d 必须在 R7 之前（`Component.vue` 落地时词表就该在真源里，否则那个 PR 要么带着
一份本地词表副本、要么顺手改 `packages/modules/src/shared/` —— 后者会让 R7 的机械化
豁免整体失效）；
R7 必须是**独占一个 PR** 且 `subEditor` 留到 R13（在编辑器路由存在之前声明它，
`sub-editor-routes` 契约当场红）。

⚠ R7b 只能排在 R7 之后，且**不能与 R7 合成一个 PR**：R7 走的机械化豁免不允许碰
`packages/twin2d/**`（见 R7 那一行的三条禁改），而 R7b 改的正是那个包。
