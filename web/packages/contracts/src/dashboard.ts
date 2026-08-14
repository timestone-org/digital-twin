/**
 * @fileoverview 大屏文档的四层形状，逐字段对应 platform schema 的
 * `dashboard_projects` / `dashboards` / `dashboard_nodes` / `dashboard_bindings`
 * 四张表（docs/DASHBOARD_DESIGN.md §2.1），列名到前端一律转成 camelCase。
 */
import type {
  ArchiveBindingDetail,
  BindingSourceKind,
  BindingTransform,
  ComputeSpec,
} from './binding'

/** 一组大屏的容器，持有主题与品牌。 */
export interface ProjectPayload {
  id: string
  name: string
  description: string | null
  /** 项目级主题 token 覆盖；`{}` 表示回退内置默认。 */
  themeJson: Record<string, unknown>
  /** 品牌覆盖（标题、logo 等）。 */
  brandJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 一张大屏：一个设计坐标系加一棵节点树。 */
export interface DashboardPayload {
  id: string
  projectId: string
  name: string
  description: string | null
  /** 设计坐标系宽度（像素），默认 1920。节点坐标都在这套坐标系里。 */
  designWidth: number
  /** 设计坐标系高度（像素），默认 1080。 */
  designHeight: number
  /** 屏级主题 token 覆盖，盖在项目主题之上。 */
  themeJson: Record<string, unknown>
  /** 屏级卡片框与模块外观默认值。 */
  chromeJson: Record<string, unknown>
  /**
   * 行版本，乐观锁用：整树替换必须带上它，与库里不符即 409。
   * ⚠ 与 `schemaVersion` 是**两个**字段，不许合并——一个管并发，一个管格式。
   */
  rowVersion: number
  /**
   * 文档格式版本，决定加载时要不要做坐标迁移。
   * ⚠ 只认这个显式整数：靠「坐标是不是整数」这类启发式判断，会把合法文档
   * 误判成旧格式并把每个坐标乘上栅格宽（ADR-0012 六）。
   */
  schemaVersion: number
  isPublic: boolean
  /** 公开访问令牌；未公开时为 null。 */
  publicToken: string | null
  createdAt: string
  updatedAt: string
  /**
   * 全部节点，**扁平**一维数组，树由 `parentId` 重建。
   * 顺序钉死在 `(parentId, zIndex, id)`：两次读取同一张未修改的大屏逐字节相同。
   */
  nodes: DashboardNodePayload[]
}

/**
 * 渲染一个节点要用到的字段。
 *
 * ⚠ 单抽这一层是因为**公开面比管理面窄**：按公开令牌读到的节点没有
 * `dashboardId` / `createdAt` / `updatedAt`（公开面不回内部信息，ADR-0014）。
 * 两边共用同一套渲染，所以渲染入口一律收这个子集，而不是收管理面的整形状
 * ——收整形状的后果不是编译报错，是公开页上那三个字段悄悄变成 `undefined`。
 */
export interface DashboardNodeView {
  /** 一经创建永不改变，整树替换也按 id 三路比对（ADR-0012 二）。 */
  id: string
  /** 父节点 id。⚠ `null` 是「顶层节点」这个明确语义，不是「还不知道」。 */
  parentId: string | null
  /** 编辑器的本地稳定键，`(dashboardId, clientKey)` 唯一，撞键 409 而不是先到先得。 */
  clientKey: string | null
  /** 模块类型，对应 `ModuleManifest.type`；未注册的类型服务端拒收。 */
  moduleType: string
  /** 设计坐标系左上角横坐标（像素）。 */
  x: number
  /** 设计坐标系左上角纵坐标（像素）。 */
  y: number
  /** 宽（像素）。 */
  w: number
  /** 高（像素）。 */
  h: number
  zIndex: number
  /** 初始显隐（持久态）。运行时联动产生的显隐是易失的，绝不写回这里。 */
  isVisible: boolean
  /** 用户配置，键对应该模块 `configSchema` 里的 `ConfigField.key`。 */
  configJson: Record<string, unknown>
  /** 该节点的全部绑定，顺序钉死在 `(fieldKey, id)`。 */
  bindings: BindingView[]
}

/** 画布上的一个渲染单元。容器也是节点——万物皆节点，节点可套节点。 */
export interface DashboardNodePayload extends DashboardNodeView {
  dashboardId: string
  createdAt: string
  updatedAt: string
  bindings: BindingPayload[]
}

/**
 * 求值一条绑定要用到的字段。
 *
 * ⚠ 与 `DashboardNodeView` 同一个理由单抽一层：公开面的绑定没有 `nodeId` /
 * `createdAt` / `updatedAt`（它已经嵌在所属节点下面了）。求值与渲染一律收这个
 * 子集——收整形状的后果不是编译报错，是公开页上那三个字段悄悄变成 `undefined`。
 */
export interface BindingView {
  /** 一经创建永不改变：实时推送以它作关联键，重生成会让关联每次保存断一次。 */
  id: string
  /**
   * 绑定槽键，必须是该模块声明过的 `BindingSpec.key`，
   * 数组槽形如 `rows[0].value`。`(nodeId, fieldKey)` 唯一。
   */
  fieldKey: string
  sourceKind: BindingSourceKind
  /**
   * 点位身份 `{sourceId}:{pointCode}`，⚠ 按**第一个**冒号切分
   * （`sourceId` 是无冒号的 UUID，见 docs/COLLECT_DESIGN.md §2）。
   * 非 `opcua` 来源为 null。
   */
  nodeKey: string | null
  /** `sourceKind: 'static'` 的常量值。 */
  staticValueJson: unknown
  /** `sourceKind: 'computed'` 的派生规格。 */
  computeJson: ComputeSpec | null
  /** `sourceKind: 'archive'` 的取数说明；其余来源为 null。 */
  detailJson: ArchiveBindingDetail | null
  /** 取到值之后的定值变换。 */
  transformJson: BindingTransform | null
}

/**
 * 管理面读到的一条绑定。
 * ⚠ `nodeId` 是**画布节点**的 id，`nodeKey` 是**采集点位**的身份——两个 node
 * 不是一回事（DASHBOARD_DESIGN §1），当成同一个东西会绑出永不产数据的槽。
 */
export interface BindingPayload extends BindingView {
  /** 所属画布节点。 */
  nodeId: string
  createdAt: string
  updatedAt: string
}
