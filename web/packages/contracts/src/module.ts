/**
 * @fileoverview 大屏模块系统的契约：配置字段、绑定槽、模块清单与渲染组件 props。
 * 「新增一个模块 = 1 个目录 + 1 行注册」这条判据见 docs/DASHBOARD_DESIGN.md §5。
 */
// ⚠ 只许 import type：contracts 是 L0 零依赖层，type-only 导入编译后被完全擦除
import type { Component } from 'vue'

/** 属性面板按它选控件。新增一档是非破坏的，删一档会让存量配置渲染不出控件。 */
export const CONFIG_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'enum',
  'color',
  'range',
  'array',
  'object',
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
   * ⚠ 索引必须连续且从 0 起，服务端会校验（DASHBOARD_DESIGN §4.2）。
   */
  isArray?: boolean
  /** 数组槽每一行的子槽，仅 `isArray: true` 时有意义。 */
  arrayFields?: BindingSpec[]
  /**
   * 时序槽：除当前标量外还注入该点位的历史序列（`HistoryPoint[]`）。
   * ⚠ 只有 `opcua` / `archive` 有真实历史，`static` / `computed` 取不到时按
   * 取数失败处理，不许拿空序列冒充「这段时间没数据」（DASHBOARD_DESIGN §4.3）。
   */
  isTimeSeries?: boolean
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
export interface ModuleManifest {
  /** 唯一类型 id，例 `header` / `twin-view`；节点的 `moduleType` 存的就是它。 */
  type: string
  displayName: string
  /** 模块库的分类标签，例 `页头` / `孪生`。 */
  category: string
  /** 模块库图标的注册名。⚠ 写错不报错也不渲染，只能靠契约测试兜。 */
  icon?: string
  /** 模块库搜索的别名（英文名、拼音、同义词）。 */
  keywords?: string[]
  defaultSize: ModuleDefaultSize
  configSchema: ConfigField[]
  bindings: BindingSpec[]
  /** 缺省 `card`。 */
  chrome?: ModuleChrome
  /** 容器模块：自己只画壳，子节点由运行时按节点树递归注入。 */
  isContainer?: boolean
  region?: ModuleRegion
  /** 清单版本，缺省 1。仅元数据，注册表仍按 `type` 单键索引。 */
  version?: number
  /** ⚠ 只在编辑器画布生效，运行时绝不读取。 */
  preview?: ModulePreview
  /**
   * 异步加载真正的渲染组件。
   * ⚠ 必须异步：不打开孪生模块的大屏不该为 three.js 付首屏包体。
   */
  component: () => Promise<{ default: Component }>
}

/**
 * 模块的运行状态。六档各自对应一种「现在看到的东西为什么长这样」：
 * `loading` 尚无首帧、`connected` 正常、`stale` 通道断了现值可能过期、
 * `empty` 已绑但还没收到值、`unbound` 必绑槽没配来源、`error` 取数或渲染失败。
 */
export const MODULE_STATUSES = [
  'loading',
  'connected',
  'stale',
  'empty',
  'unbound',
  'error',
] as const
export type ModuleStatus = (typeof MODULE_STATUSES)[number]

/** 运行时透传给渲染组件的状态。 */
export interface ModuleMeta {
  status?: ModuleStatus
  /** 节点 id，对应 `DashboardNodePayload.id`。 */
  nodeId?: string
  /**
   * 这批值的采样时刻，UTC 毫秒。
   * ⚠ `status: 'stale'` 时它是**旧值**的时刻，照实显示，不许用当前墙钟顶替。
   */
  valueTimeMs?: number
  /** `status: 'error'` 时的原因。取不到就说取不到，不许静默留白。 */
  errorMessage?: string
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
