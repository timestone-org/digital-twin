/**
 * @fileoverview 大屏模块系统的契约：配置字段、绑定槽、模块清单与渲染组件 props。
 * 「新增一个模块 = 1 个目录 + 1 行注册」这条判据见 docs/DASHBOARD_DESIGN.md §5。
 */
// ⚠ 只许 import type：contracts 是 L0 零依赖层，type-only 导入编译后被完全擦除
import type { Component } from 'vue'

import type { ChromeKey } from './chrome'
import type { InteractionEventName } from './interaction'

/** 属性面板按它选控件。新增一档是非破坏的，删一档会让存量配置渲染不出控件。 */
export const CONFIG_FIELD_TYPES = [
  'string',
  'textarea',
  'number',
  'boolean',
  'enum',
  'color',
  'range',
  'array',
  'object',
  'font',
  'style',
  'image',
  'json',
  'dashboard-ref',
] as const
export type ConfigFieldType = (typeof CONFIG_FIELD_TYPES)[number]

/** 字段在两列栅格里占半行还是整行。 */
export const CONFIG_FIELD_SPANS = ['half', 'full'] as const
export type ConfigFieldSpan = (typeof CONFIG_FIELD_SPANS)[number]

/** `type: 'enum'` 的一个可选项。 */
export interface ConfigOption {
  value: unknown
  label: string
}

/** 条件显示：同级字段 `key` 的当前值落在 `in` 里才渲染本字段。 */
export interface ConfigFieldCondition {
  key: string
  in: unknown[]
}

/** 一个配置字段。`array` 用 `itemSchema`、`object` 用 `fields` 递归下去。 */
export interface ConfigField {
  key: string
  label: string
  type: ConfigFieldType
  /**
   * 缺省回退：不落库，渲染时兜底。
   * ⚠ 改它会改变**存量**大屏的渲染——没配过这个键的节点全都跟着变。
   */
  default?: unknown
  options?: ConfigOption[]
  placeholder?: string
  /** 属性面板的分段标题，同名的字段折叠在一起。 */
  group?: string
  /** 标签旁问号气泡里的一句话。 */
  help?: string
  span?: ConfigFieldSpan
  when?: ConfigFieldCondition
  min?: number
  max?: number
  step?: number
  /** `type: 'array'` 每一行的子字段。 */
  itemSchema?: ConfigField[]
  /** `type: 'array'` 用哪个子字段的值做行标题。 */
  itemLabelKey?: string
  minItems?: number
  maxItems?: number
  /** `type: 'object'` 的子表单字段。 */
  fields?: ConfigField[]
}

/** `type: 'font'` 字段落库的值形状，键都可缺席——缺席即「跟随主题」。 */
export interface FontValue {
  family?: string
  /** 设计坐标系像素。 */
  size?: number
  weight?: number | string
  letterSpacing?: number
  color?: string
}

/** `type: 'style'` 字段落库的值形状。与 FontValue 同理，缺席键不写样式。 */
export interface StyleSlotValue {
  color?: string
  background?: string
  border?: string
  borderRadius?: number
  boxShadow?: string
  padding?: string
  opacity?: number
}

/** 绑定槽期望的数据类型。绑点面板据此过滤可选点位。 */
export const BINDING_DATA_TYPES = [
  'number',
  'boolean',
  'string',
  'enum',
] as const
export type BindingDataType = (typeof BINDING_DATA_TYPES)[number]

/** 模块声明的一个数据入口。绑点面板读它摆槽位，服务端读它校验 fieldKey。 */
export interface BindingSpec {
  /** 槽键。落库的 `fieldKey` 就是它，数组槽形如 `rows[0].value`。 */
  key: string
  label: string
  dataType: BindingDataType
  /** 必绑：没配来源时模块状态为 `unbound`。 */
  isRequired?: boolean
  /** `dataType: 'enum'` 的取值映射，例 `{ 0: '离线', 1: '运行' }`。 */
  /**
   * 数值 → 文案的映射，例 `{ '0': '离线', '1': '运行' }`。
   * ⚠ 键是**字符串**，与后端 `enum_map: dict[str, str]` 一致——JSON 的键永远是
   * 字符串。标成 `Record<number, string>` 时下标取值照样能work（JS 会把数字下标
   * 转成字符串），但 `Object.entries` 出来的键与数值点位值比较会静默不相等。
   */
  enumMap?: Record<string, string>
  /**
   * 数组槽：一个槽对应 N 行，各行按 `key[索引].子槽键` 落成 N 条绑定。
   * ⚠ 索引必须连续且从 0 起，服务端会校验（DASHBOARD_DESIGN §4.2）；
   * `isEntityPinned` 的槽除外。
   */
  isArray?: boolean
  /**
   * 数组槽的行**钉在实体上**：第 i 行喂配置里文档序第 i 个实体，行数由配置
   * 决定，不由绑定条数决定。仅 `isArray: true` 时有意义。
   *
   * ⚠ 只有这种槽允许索引留空。绑一部分实体是常态——孪生里有几十个锚点却只有
   * 三个接了点位——空出来的行只表示「这个实体没接数据源」，缝合时按下标读，
   * 不会让后面的整体移位。
   * ⚠ 列表式数组槽（行由用户增删、行数就是数组长度）**必须**连续：那里空一格
   * 会实打实渲染出一串空行。两种槽的差别只在这个标记上，服务端据它分流。
   */
  isEntityPinned?: boolean
  /** 数组槽每一行的子槽，仅 `isArray: true` 时有意义。 */
  arrayFields?: BindingSpec[]
  /**
   * 时序槽：除当前标量外还注入该点位的历史序列（`HistoryPoint[]`）。
   * ⚠ 只有 `opcua` / `archive` 有真实历史，`static` / `computed` 取不到时按
   * 取数失败处理，不许拿空序列冒充「这段时间没数据」（DASHBOARD_DESIGN §4.3）。
   */
  isTimeSeries?: boolean
}

/**
 * 数组绑定槽某一行落在哪个实体上，绑点面板拿它当组标题。
 *
 * ⚠ `id` 与 `title` 都要：光有名字时，两个同名实体在绑点面板上长得一模一样，
 * 而实体清单那边（如孪生的信息牌字段列表）显示的是 id——两边对不上号，
 * 用户就只能靠数行号确认自己绑对了没有。
 */
export interface BindingRowLabel {
  /** 给人看的名字，如「1 号机组 · 温度」。 */
  title: string
  /**
   * 与实体清单里显示的那一份逐字相同的标识；没有稳定标识时给空串。
   * ⚠ 它只用于人工核对，不参与取值对齐——对齐永远按行号（`fieldKey`）走。
   */
  id: string
}

/** 渲染根要不要套大屏的默认卡片框。 */
export const MODULE_CHROMES = ['card', 'bare'] as const
export type ModuleChrome = (typeof MODULE_CHROMES)[number]

/** 钉位区域：每张大屏最多一个同区域的节点，横向与纵向位置由编辑器夹取。 */
export const MODULE_REGIONS = ['header', 'footer'] as const
export type ModuleRegion = (typeof MODULE_REGIONS)[number]

/** 拖进画布时的初始尺寸，与节点的 `w` / `h` 同一套设计坐标系（像素）。 */
export interface ModuleDefaultSize {
  width: number
  height: number
  /** 缩放下限，缺省不限。 */
  minWidth?: number
  minHeight?: number
}

/**
 * 模块级「外观预设」：一次显式写入一整套 config 字段。
 * 与 `ConfigField.default` 的语义刻意不同——default 是不落库的渲染兜底，
 * 预设是用户点了按钮后**浅合并落库**的一笔（一步撤销），未列出的键原样保留。
 * 存在的理由：有些观感是十几个字段的组合，逐个照抄必漏、漏了也看不出漏在哪。
 */
export interface ConfigPreset {
  /** 稳定 id，用于 key 与测试断言，不展示。 */
  id: string
  /** 按钮文案，2–6 字为宜。 */
  label: string
  /** 一句话说明这套预设把模块变成什么样。 */
  hint?: string
  /** 逐键浅合并进 config 的值，可含 schema 之外的段。 */
  config: Record<string, unknown>
}

/** 设计态预览：拖进画布立刻看得到像样的排版，不落库、不参与保存。 */
export interface ModulePreview {
  /** 用户尚未配置的键注入的演示配置。 */
  config?: Record<string, unknown>
  /** 尚未绑点的槽注入的演示值，键对应 `BindingSpec.key`。 */
  values?: Record<string, unknown>
}

/**
 * 一个模块的清单，也是注册单元。
 * 与渲染无关的那部分由前端在构建期导出给服务端，两侧一致性靠契约测试锁死
 * （ADR-0012 五）。
 */
/**
 * 某个 config 键由一个整页子编辑器接管。
 *
 * ⚠ 这是「按类型分支」的替代品，不是它的补充：属性面板只读这份声明来决定
 * 要不要出入口按钮，绝不写 `if (type === 'twin-view')`。写了那一句，
 * 第三方模块就永远开不出自己的子编辑器，而且既不报错也不失败。
 */
export interface ModuleSubEditor {
  /** 接管这个键；属性面板在这个字段的位置出入口，不再画通用控件。 */
  configKey: string
  /** 跳去哪个路由。⚠ 路由须接 `dashboardId` + `nodeId` 两个参数。 */
  routeName: string
  /** 入口按钮上的字。 */
  label: string
  /** 按钮下的一行说明；讲清楚这段配置为什么不在这里改。 */
  hint?: string
}

export interface ModuleManifest {
  /** 唯一类型 id，例 `header` / `twin-view`；节点的 `moduleType` 存的就是它。 */
  type: string
  displayName: string
  /** 模块库的分类标签，例 `页头` / `孪生`。 */
  category: string
  /**
   * 给**模型**读的一段说明（3–6 句）：这是什么、什么时候别用它该用哪个兄弟模块、
   * 数据槽怎么喂、这个模块真有的那条坑。经 `catalog.ts` 序列化进服务端目录，
   * AI 助手的模块名片读它。
   *
   * ⚠ 类型上可选只为让测试夹具与第三方清单不必逐个补；内建模块**必须**有，
   * 由 `tests/description.contract.spec.ts` 兜——没有它的模块，模型只能靠名字猜。
   * ⚠ 不是界面文案：写「用于展示实时数值」这种正确的废话等于没写。
   */
  description?: string
  /** 模块库图标的注册名。⚠ 写错不报错也不渲染，只能靠契约测试兜。 */
  icon?: string
  /** 模块库搜索的别名（英文名、拼音、同义词）。 */
  keywords?: string[]
  defaultSize: ModuleDefaultSize
  configSchema: ConfigField[]
  /** 属性面板顶部的一排预设按钮，缺省不显示。只放「整套观感」级的组合。 */
  configPresets?: ConfigPreset[]
  /**
   * 新建节点时种入 config 的初始值（深克隆落库）。与 `ConfigField.default` 的
   * 区别同 `ConfigPreset` 注释：这里是显式落库的出厂配置，用于 schema 之外的段，
   * 保证属性面板显示与实际渲染一致。只影响新节点，存量不变。
   */
  defaultConfig?: Record<string, unknown>
  bindings: BindingSpec[]
  /** 缺省 `card`。 */
  chrome?: ModuleChrome
  /**
   * 允许在属性面板配置统一卡片外观，缺省 true。
   * 个别纯装饰/控件模块显式置 false 退出外观配置。
   */
  chromeConfigurable?: boolean
  /**
   * 模块壳**不消费**的统一卡片外观键：自绘标题条/外壳的模块声明它，编辑器把
   * 对应字段从模块级外观面板里藏掉（大屏级缺省面板不受影响）。
   * 只收「结构上画不出来」的键；被别的开关暂时关掉的键归面板的禁用逻辑。
   */
  unsupportedChromeKeys?: readonly ChromeKey[]
  /**
   * 该模块可能上抛的联动事件集合，**缺省视为 `['click']`**。
   * 编辑器按它过滤「触发事件」选项——列出模块发不出的事件，配出来的规则永远不触发。
   */
  interactionEvents?: readonly InteractionEventName[]
  /**
   * 模块自己 `emit('interaction', InteractionEvent)` 上抛事件（控件类，或按
   * 子项带 value 上抛的展示类：图表点图元、列表点行）。
   * ⚠ 按子项上抛的模块必须同时吞掉冒泡（`@click.stop`）：否则同一次点击会再被
   * `hostClickable` 的整块兜底捕获一次，toggle 类动作当场自我抵消。
   */
  emitsInteractions?: boolean
  /**
   * 整块可点：由渲染宿主统一接管点击与键盘上抛 `{ event: 'click' }`，模块本身
   * 零改动。与 `emitsInteractions` 正交、可同时开；都只在真配了联动规则时生效。
   * ⚠ 内部有拖拽手势的模块（3D 孪生/地图漫游）不要开：拖拽松手也会派发 click。
   */
  hostClickable?: boolean
  /** 容器模块：自己只画壳，子节点由运行时按节点树递归注入。 */
  isContainer?: boolean
  /**
   * 模块自己逐格交代取数状态，运行时因此不给它盖整格状态浮层。
   *
   * ⚠ 一格一个点位的模块**不要开**：那时「取不到」确实没有别的东西可画，
   * 盖住整格并说明原因才是对的。
   * ⚠ 多点位模块**必须开**：不开的话，十个指标里坏掉一个就会让整块被
   * 「取数失败」盖住，另外九个明明有值却一个都看不见。
   * ⚠ 开了就得自己把四档都画出来（没配来源／等首帧／取不到／有值），
   * 逐槽结论由 `ModuleMeta.slots` 下发。少画一档就是静默留白。
   * ⚠ `unbound` 一档仍归浮层：必绑槽一条都没配时模块连布局都摆不出来。
   */
  ownsStatusDisplay?: boolean
  /** 有一段 config 复杂到两列表单表达不了，交给一个整页子编辑器。 */
  subEditor?: ModuleSubEditor
  /**
   * 数组绑定槽每一行对应哪个实体：键是该行第一个子槽的 `fieldKey`。
   * 只有模块自己知道第 3 行对应的是哪个实体（孪生的第 3 个锚点、表格的第 3 列），
   * 绑点面板不认识任何具体模块，故由清单自述。
   * ⚠ 不给就退回「第 N 行」——十几行的配置在绑点时就全靠数数认，
   * 那是这套面板最容易接错对象的地方。
   * @param config 该节点落库的配置（未铺清单缺省）
   */
  bindingRowLabels?: (
    config: Record<string, unknown>,
  ) => Readonly<Record<string, BindingRowLabel>>
  /**
   * 数组绑定槽各应有几行，键是槽键。声明了就表示**行与实体一一对应**：
   * 行数跟着配置里的实体走，绑点面板不摆手工增删键。
   * ⚠ 一个实体都没有的槽也要给 0，别把键漏掉——漏掉的槽会被面板当成
   * 「行数由用户手工增删」，于是摆出一个加了也喂不到任何东西的「新增一行」。
   * 不给这一支就是老口径：行由用户手工增删。
   * @param config 该节点落库的配置（未铺清单缺省）
   */
  bindingRowCounts?: (
    config: Record<string, unknown>,
  ) => Readonly<Record<string, number>>
  region?: ModuleRegion
  /** 清单版本，缺省 1。仅元数据，注册表仍按 `type` 单键索引。 */
  version?: number
  /**
   * 被哪个新 type 取代。设置后模块库隐藏本模块，但注册照常、
   * 已存大屏照常渲染——行为完全不变，只挡新增。
   */
  replacedBy?: string
  /** ⚠ 只在编辑器画布生效，运行时绝不读取。 */
  preview?: ModulePreview
  /**
   * 异步加载真正的渲染组件。
   * ⚠ 必须异步：不打开孪生模块的大屏不该为 three.js 付首屏包体。
   */
  component: () => Promise<{ default: Component }>
}

/**
 * 模块的运行状态。五档各自对应一种「现在看到的东西为什么长这样」：
 * `loading` 尚无首帧、`connected` 正常、`empty` 已绑但还没收到值、
 * `unbound` 必绑槽没配来源、`error` 取数或渲染失败。
 * ⚠ 没有「值过期」这一档：值有多旧由 `valueTimeMs` 照实说，模块自己决定
 * 要不要显示——一个一天变一次的点位不该因为时刻旧就被整格降档。
 */
export const MODULE_STATUSES = [
  'loading',
  'connected',
  'empty',
  'unbound',
  'error',
] as const
export type ModuleStatus = (typeof MODULE_STATUSES)[number]

/** 实时通道的连接态，connection-status 这类指示型模块据此画在线/离线。 */
export const MODULE_CONNECTION_STATES = [
  'connecting',
  'open',
  'reconnecting',
  'closed',
  'error',
] as const
export type ModuleConnectionState = (typeof MODULE_CONNECTION_STATES)[number]

/**
 * 一条绑定槽此刻的取数结论。
 *
 * ⚠ 三档缺一不可。模块光看 `values` 分不出这三种情况——它们在注入袋里长得
 * 一模一样（键都不存在）：这一行**没配来源**、配了但**还没首帧**、配了但
 * **取不到**。整块状态那一档说不出是哪一格坏了，所以逐格交代的模块必须拿到
 * 这份逐槽结论（DASHBOARD_DESIGN §4.3）。
 */
export interface ModuleSlotMeta {
  state: 'ok' | 'pending' | 'error'
  /** `state: 'error'` 时的原因。 */
  message?: string
  /** 采样时刻，UTC 毫秒；只有 `ok` 档有。 */
  timestampMs?: number
}

/** 运行时透传给渲染组件的状态。 */
export interface ModuleMeta {
  status?: ModuleStatus
  /** 节点 id，对应 `DashboardNodePayload.id`。 */
  nodeId?: string
  /**
   * 逐槽的取数结论，键是绑定的 `fieldKey`（数组槽形如 `itemValues[0].value`）。
   * ⚠ 只在模块自报 `ownsStatusDisplay` 时下发：其余模块的状态由整格浮层交代，
   * 逐槽细节读了也没有地方画，白算一遍还多一份响应式依赖。
   */
  slots?: Readonly<Record<string, ModuleSlotMeta>>
  /**
   * 这批值的采样时刻，UTC 毫秒。
   * ⚠ 是**采样**的时刻而不是收到帧的时刻，照实显示，不许用当前墙钟顶替：
   * 它是界面上唯一能看出「现场还动不动」的东西。
   */
  valueTimeMs?: number
  /** `status: 'error'` 时的原因。取不到就说取不到，不许静默留白。 */
  errorMessage?: string
  /** 实时通道连接态；设计态与独立渲染时缺席。 */
  connectionState?: ModuleConnectionState
  /**
   * 本节点是否真配了以它为 source 的联动规则（由运行时按规则表推导）。
   * `emitsInteractions` 的展示型模块据此决定要不要摆出可点击外观——配了规则才像
   * 能点。之所以不另给模块加「可点击」配置开关：两个开关只开其一必然是
   * 「点了没反应」。无联动运行时缺席。
   */
  interactive?: boolean
}

/**
 * 渲染组件的全部 props，固定三件套。
 * ⚠ 不许扩第四个：运行时只认识这三样才能渲染它编译期并不知道的模块，
 * 多一个 prop 就意味着运行时要认识某个具体模块（DASHBOARD_DESIGN §5.1）。
 */
export interface ModuleComponentProps {
  /** 用户配置，键对应 `configSchema` 里的 `ConfigField.key`。 */
  config: Record<string, unknown>
  /** 求值后的绑定值，键对应 `bindings` 里的 `BindingSpec.key`。 */
  values: Record<string, unknown>
  meta?: ModuleMeta
}
