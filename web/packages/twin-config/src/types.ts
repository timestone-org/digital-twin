/**
 * @fileoverview 孪生场景配置的形状。只有类型，没有逻辑——归一化在 `normalize*.ts`。
 *
 * ⚠ 字段一律**非可选**：归一化的输出里不许出现 `undefined`，否则 JSON 往返一趟
 * 形状就变了，而「往返之后少了一个键」这类差异在渲染层表现为某一项忽然回到缺省。
 * 缺省用具体值表达（空串 / 空数组 / null），不用「键不在」。
 */
import type { ModelVariant } from '@dt/contracts'

/** 世界坐标 / 欧拉角三元组。 */
export type Vec3 = [number, number, number]

/** GLB/GLTF 内置动画的播放配置。 */
export interface TwinModelAnimations {
  enabled: boolean
  /** 要播的 clip 名；空数组 = 全播。 */
  clips: string[]
  /** 速度倍率。 */
  speed: number
}

/** 背景星空。 */
export interface TwinStarfield {
  enabled: boolean
  /** 星点密度倍率。 */
  density: number
  /** 旋转速度倍率；0 = 不转。 */
  speed: number
  /** 星云辉光背景。 */
  nebula: boolean
}

/** 底座的反射档。`none` 之外两档更费，低配机器上要能关掉。 */
export const TWIN_PEDESTAL_REFLECTIONS = ['none', 'soft', 'mirror'] as const
export type TwinPedestalReflection = (typeof TWIN_PEDESTAL_REFLECTIONS)[number]

/** 底座舞台：模型脚下那一圈。 */
export interface TwinPedestal {
  enabled: boolean
  /** 主题色规格（`#rrggbb` 或 `--token`）。 */
  color: string
  ring: boolean
  grid: boolean
  gradientGround: boolean
  contactShadow: boolean
  reflection: TwinPedestalReflection
  /** 相对模型底面的占地倍数。 */
  radius: number
}

/** 光柱模式：`beam` 细光柱，`dome` 包裹模型的能量罩。 */
export const TWIN_LIGHT_COLUMN_MODES = ['beam', 'dome'] as const
export type TwinLightColumnMode = (typeof TWIN_LIGHT_COLUMN_MODES)[number]

/** 上升扫描：循环，还是入场一次。 */
export const TWIN_LIGHT_COLUMN_RISES = ['loop', 'once'] as const
export type TwinLightColumnRise = (typeof TWIN_LIGHT_COLUMN_RISES)[number]

/** 包裹光柱 / 能量罩。 */
export interface TwinLightColumn {
  enabled: boolean
  mode: TwinLightColumnMode
  color: string
  intensity: number
  speed: number
  /** 相对模型高度的倍数。 */
  height: number
  rise: TwinLightColumnRise
}

/**
 * 场景特效：暗场科技展示舞台。三类可独立开关、可叠加。
 * ⚠ 三个 `enabled` 都是 false 时渲染层一个对象都不建——特效是零成本可关的。
 */
export interface TwinSceneEffects {
  starfield: TwinStarfield
  pedestal: TwinPedestal
  lightColumn: TwinLightColumn
}

/**
 * 摆放坐标的基准。`model` = 模型自己的坐标系原点；`center` = 模型全部模块的
 * 正中心——只把前后左右挪到中心，高度轴仍与模型坐标系一致。
 *
 * ⚠ 基准只换读数，不动落库：坐标一律以世界坐标存，切基准不会挪动任何已摆好的
 * 东西。反过来做的话，切一下基准整场的锚点集体偏移，而配置里一个字段都没改。
 */
export const TWIN_COORD_FRAMES = ['model', 'center'] as const
export type TwinCoordFrame = (typeof TWIN_COORD_FRAMES)[number]

/**
 * 模型引用与它在场景里的摆放。
 * `asset` 是素材引用 `asset:<uuid>`（ADR-0015 的唯一合法落库形态），空串 = 还没挑模型。
 */
export interface TwinModelRef {
  asset: string
  /**
   * 用哪一档压缩产物。
   * ⚠ 档位不编进 `asset:<uuid>` 引用串：那条语法在服务端、前端与删除时的反查里
   * 各有一份实现，塞进去要同时改三处，漏一处只表现为「取不到」（ADR-0022）。
   * ⚠ 选了一档不代表它已经压好；渲染侧取不到就**回落原件**，否则现场是一块
   * 永远转圈的黑屏。
   */
  variant: ModelVariant
  scale: number
  position: Vec3
  /** 欧拉角，度。 */
  rotation: Vec3
  /** 摆放坐标读数的基准，见 `TWIN_COORD_FRAMES`。 */
  coordFrame: TwinCoordFrame
  autoRotate: boolean
  /** 背景色规格；空串 = 透明。 */
  background: string
  /** 地面网格，给摆放当坐标参考用。 */
  showGroundGrid: boolean
  /** true = 保留 GLB 原始 PBR 材质，不做统一提亮。 */
  originalMaterials: boolean
  animations: TwinModelAnimations
  sceneEffects: TwinSceneEffects
}

/**
 * 距离参考系。
 * `orbit` = 相机到轨道中心；`self` = 相机到本元素位置；
 * `part-center` = 相机到部件包围盒中心。
 * ⚠ 脱离参考系的裸阈值不可类比：同一个「20」在三种参考系下是三个位置，
 * 所以阈值与参考系恒成对出现，没有「默认参考系」这回事。
 */
export const TWIN_DISTANCE_REFS = ['orbit', 'self', 'part-center'] as const
export type TwinDistanceRef = (typeof TWIN_DISTANCE_REFS)[number]

/** 一个距离阈值加它的参考系。 */
export interface TwinDistanceRule {
  ref: TwinDistanceRef
  /** 阈值，世界单位。 */
  value: number
}

/** 淡出的方向：近于阈值时淡，还是远于阈值时淡。 */
export const TWIN_FADE_DIRECTIONS = ['below', 'above'] as const
export type TwinFadeDirection = (typeof TWIN_FADE_DIRECTIONS)[number]

/** 按相机距离调透明：在阈值的 `direction` 一侧时用 `opacity`。 */
export interface TwinVisibilityFade {
  at: TwinDistanceRule
  direction: TwinFadeDirection
  opacity: number
}

/**
 * 一个可视化元素显隐与淡出行为的完整表达；部件与锚点共用同一套。
 * ⚠ `null` 表示这一条没配，不是「配了个零」：`hideBelow` 为 null 是不做近距隐藏，
 * 而 `{ ref: 'orbit', value: 0 }` 是「距离小于 0 时隐藏」——后者永不成立。
 * ⚠ 编辑视口只认 `visible`，不套距离派生的显隐：编辑时镜头到处飞，
 * 套上规则会让人「刚配好的东西一转镜头就不见了」。
 */
export interface TwinVisibilityRule {
  visible: boolean
  /** 相机距离小于它时隐藏（近距剖视）。 */
  hideBelow: TwinDistanceRule | null
  /** 相机距离大于它时隐藏（远距 LOD）。 */
  hideAbove: TwinDistanceRule | null
  fade: TwinVisibilityFade | null
}

/**
 * 部件点击的距离门禁。
 * ⚠ 阈值 ≤ 0 或距离取不到时一律「不限制」，不误杀点击：宁可多响应一次，
 * 也不要让用户点了没反应还找不到原因。
 */
export interface TwinClickDistanceRule {
  /** 近于它不响应。 */
  min: TwinDistanceRule | null
  /** 远于它不响应。 */
  max: TwinDistanceRule | null
  /** 两段式点击的远近分界：远于它先拉近，再点才是真点击。 */
  farThreshold: TwinDistanceRule | null
}

/**
 * 部件常态外观：不随实时值变的那一份。
 *
 * ⚠ `color` 空串 = 不染色，而不是「染成黑色」：一份没配过的部件必须保持模型
 * 自带的材质外观。空串与 `#000000` 分不开的话，新建部件会整片变黑。
 * ⚠ `blend` 与 `glow` 只在**有色**时才起作用（常态色或状态染色命中）：
 * 它们回答的是「染得多浓」，不是「染不染」。
 */
export interface TwinPartLook {
  /** 不透明度倍率 [0,1]，乘在模型自带的不透明度上；1 = 不动它。 */
  opacity: number
  /** 常态色规格 `#rrggbb` 或 `--token`；空串 = 保留模型原色。 */
  color: string
  /** 染色浓度 [0,1]：0 完全是原色，1 完全换成染色。 */
  blend: number
  /** 自发光强度 [0,3]，0 = 不发光；发光色就是当前的染色。 */
  glow: number
}

/**
 * 一档取色的命中方式。
 * `range` 落在 [from, to) 里（两端都可空 = 那一侧不设限），
 * `equals` 与 `equals` 相等（数值可比时按数值比，否则按不分大小写的字符串比）。
 */
export const TWIN_TINT_MATCHES = ['range', 'equals'] as const
export type TwinTintMatch = (typeof TWIN_TINT_MATCHES)[number]

/**
 * 一档取色：命中条件 + 颜色。
 * ⚠ 上界 `to` **不含**：温度档配 `[60,80)` 与 `[80,∞)` 时，80 归后一档。
 * 两档都含 80 的话，边界值归谁取决于档位顺序，而那是用户看不见的。
 */
export interface TwinTintStop {
  id: string
  match: TwinTintMatch
  /** `range` 的下界，含；null = 不设下界。 */
  from: number | null
  /** `range` 的上界，不含；null = 不设上界。 */
  to: number | null
  /** `equals` 的比较值；原样存字符串，数值与状态码共用一个输入框。 */
  equals: string
  /** 命中时的颜色规格 `#rrggbb` 或 `--token`。 */
  color: string
  /** 这一档的说明，图例与诊断上显示；空串 = 只显示颜色。 */
  label: string
}

/** 渐变取色的两端与区间。 */
export interface TwinTintGradient {
  /** 区间下端，对应 `from` 色。 */
  min: number
  /** 区间上端，对应 `to` 色。 */
  max: number
  from: string
  to: string
}

/**
 * 取色方式：`stops` 逐档比对（状态码与数值分档都走它），
 * `gradient` 在区间内连续插值。
 */
export const TWIN_TINT_MODES = ['stops', 'gradient'] as const
export type TwinTintMode = (typeof TWIN_TINT_MODES)[number]

/**
 * 部件按实时值取色的规则。`null`（在 `TwinPart.tint` 上）= 这个部件不取数。
 *
 * ⚠ 配了它的部件才占一行 `partValues` 绑定：没有规则却摆一个绑定槽，
 * 用户绑完点位看到的是「绑了没反应」，比缺一个功能更难查。
 * ⚠ 档位**自上而下取第一个命中的**：区间重叠时靠顺序定胜负，所以档位顺序
 * 是配置的一部分，不许在渲染层重排。
 */
export interface TwinPartTint {
  mode: TwinTintMode
  stops: TwinTintStop[]
  gradient: TwinTintGradient
  /**
   * 一档都没命中、或取不到数时的颜色；空串 = 退回常态色。
   * ⚠ 这一条不是摆设：点位掉线时若不显式回落，部件会停在最后一次命中的颜色上，
   * 而屏幕上没有任何迹象说明那个颜色已经是陈旧的。
   */
  fallback: string
}

/**
 * 远距点击（远于 `clickDistance.farThreshold`）做什么。
 * - `approach` 把这个部件框进画面，不算真点击
 * - `view` 飞到这个部件自己配的取景快照或预设视点
 * - `none` 远距点击什么都不做
 * ⚠ 配了 `view` 却既没有快照也没有视点时**退回 `approach`**：不退的话远距点击
 * 彻底没反应，而用户看不出是少配了一样东西。这一条由 `collectTwinConfigIssues` 报。
 */
export const TWIN_PART_FAR_ACTIONS = ['approach', 'view', 'none'] as const
export type TwinPartFarAction = (typeof TWIN_PART_FAR_ACTIONS)[number]

/**
 * 近距点击（近于分界，或没配分界）做什么。
 * ⚠ 联动事件两档都照发：动作是附加的，不是替代——否则给部件配上详情会把同屏
 * 别的模块的联动静默掐掉。
 */
export const TWIN_PART_NEAR_ACTIONS = ['detail', 'none'] as const
export type TwinPartNearAction = (typeof TWIN_PART_NEAR_ACTIONS)[number]

/** 一个部件远近两档的点击动作。 */
export interface TwinPartClick {
  far: TwinPartFarAction
  near: TwinPartNearAction
  /** `far: 'view'` 的取景快照；null = 退回 `cameraId`。 */
  view: TwinFocusView | null
  /** `far: 'view'` 且没有快照时切到这个预设视点；空串 = 不切。 */
  cameraId: string
}

/**
 * 部件详情弹窗：近距点击弹出来的那一个，只讲这一个部件。
 *
 * ⚠ 弹窗里那块 3D **只装这一个部件**：它自己起一套场景与相机，把部件的对象克隆
 * 一份摆进去，与画布上那棵模型树互不干扰。所以「只看这一个」不需要去动主场景。
 * ⚠ 字段用的是信息牌那一套 `TwinPanelField`，八种画法与阈值档全通用；但它走的是
 * **另一个绑定槽**（`partFieldValues`），与信息牌的行互不干扰。
 * ⚠ 字段一律占绑定行，与 `near` 配成什么无关：按动作过滤会让用户在下拉里翻一下
 * 就把这个部件已经绑好的点位整片丢掉。配了字段却不弹窗由诊断报出来。
 */
export interface TwinPartDetail {
  /** 弹窗标题；空串 = 用部件名。 */
  title: string
  /** 标题下那行小字；空串 = 不画。 */
  subtitle: string
  fields: TwinPanelField[]
  /** 弹窗里画不画这个部件的三维模型。 */
  showModel: boolean
  /** 模型在弹窗里自转。 */
  autoRotate: boolean
  /** 模型那一块的高度 px。 */
  modelHeight: number
  /** 弹窗宽度 px。 */
  width: number
  /** 数据卡片的风格，与信息牌同一套八种变体。 */
  variant: TwinPanelVariant
  /** 主题色规格；空串 = 跟随大屏主题色。 */
  accent: string
  /** 字段分几列排。 */
  columns: number
}

/**
 * 部件：模型内一组节点的唯一可寻址单元，显隐、外观与染色都指向它。
 * ⚠ `nodes` 是模型文件里的对象名，本包看不见模型——模型里改了名字，
 * 这个部件就静默地什么都不再命中。
 */
export interface TwinPart {
  id: string
  name: string
  nodes: string[]
  visibility: TwinVisibilityRule
  look: TwinPartLook
  /** 按实时值取色；null = 不取数，也不占绑定行。 */
  tint: TwinPartTint | null
  clickDistance: TwinClickDistanceRule
  /** 远近两档点击各做什么。 */
  click: TwinPartClick
  /** 近距点击弹出的详情卡片。 */
  detail: TwinPartDetail
}

/**
 * 一个部件这一刻该染什么色。
 * ⚠ 渐变给的是**两端加插值位置**而不是算好的颜色：两端可以是 `--token`，
 * 而 token 的取值只有在有 CSS 级联的宿主里才解析得出来（本包无 DOM）。
 * 在这里退回「只认 hex」的话，配了 token 的渐变会静默地一直用同一个色。
 */
export type TwinPartColor =
  | { kind: 'none' }
  | { kind: 'solid'; spec: string }
  | { kind: 'mix'; from: string; to: string; t: number }

/** 一个部件这一刻的完整外观，渲染层照着套。 */
export interface TwinPartAppearance {
  opacity: number
  color: TwinPartColor
  blend: number
  glow: number
}

/** 锚点：世界坐标上的一个读数标签。 */
export interface TwinAnchor {
  id: string
  name: string
  position: Vec3
  /** 读数前缀；空串 = 只显示数值。 */
  label: string
  unit: string
  /** 小数位；null = 不定位数，按原值上屏。 */
  decimals: number | null
  visibility: TwinVisibilityRule
}

/** 信息牌风格变体。 */
export const TWIN_PANEL_VARIANTS = [
  'card',
  'hud',
  'glass',
  'bracket',
  'tag',
  'precision',
  'forge',
  'matrix',
] as const
export type TwinPanelVariant = (typeof TWIN_PANEL_VARIANTS)[number]

/** 版式密度：只改内边距与行距，不改字号。 */
export const TWIN_PANEL_DENSITIES = ['compact', 'normal', 'loose'] as const
export type TwinPanelDensity = (typeof TWIN_PANEL_DENSITIES)[number]

/** 卡片相对锚点的偏移方向；非 `center` 时画引线与锚点光环。 */
export const TWIN_PANEL_ORIENTS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
] as const
export type TwinPanelOrient = (typeof TWIN_PANEL_ORIENTS)[number]

/**
 * 牌的朝向。
 * - `face` 始终正对相机，怎么转都看得清
 * - `horizontal` 只绕竖轴跟随：牌永远是竖着的，俯视时不会躺下去
 * - `fixed` 钉死在世界坐标系里，转到侧面就看成一条线
 */
export const TWIN_BILLBOARD_MODES = ['face', 'horizontal', 'fixed'] as const
export type TwinBillboardMode = (typeof TWIN_BILLBOARD_MODES)[number]

/** 信息牌外观。 */
export interface TwinPanelStyle {
  variant: TwinPanelVariant
  orient: TwinPanelOrient
  /** 主题色规格。 */
  accent: string
  /** 背景色规格；空串 = 跟随变体自带的底。 */
  background: string
  /** 卡片宽度 px；0 = 按内容自适应。 */
  width: number
  /**
   * 卡片最小高度 px；0 = 按内容自适应。
   * ⚠ 是**最小**高度不是固定高度：定死高度会让加一个字段就溢出裁切，
   * 而 CSS3D 的牌没有滚动条，被裁掉的那几行在画面上不留任何痕迹。
   */
  height: number
  /** 字段分几列排。 */
  columns: number
  /** 版式密度。 */
  density: TwinPanelDensity
  /** 横扫光带。 */
  scan: boolean
  /** 四角括号叠加，与变体自带的边框叠着画。 */
  corners: boolean
  /** 底纹网格。 */
  grid: boolean
  /** 字号缩放。 */
  fontScale: number
  /**
   * 牌在 3D 里的整体大小倍率。
   * ⚠ 与 `width` / `fontScale` 是两个层次：那两个决定卡片这张 DOM 长什么样
   * （多宽、字多大），这个决定那张 DOM 摆进三维世界后占多大地方。默认按模型
   * 体量自动定，倍率在此之上乘——换模型时不用重调，场景需要时又调得动。
   */
  scale: number
  animate: boolean
  /** 锚点光环脉冲。 */
  pulse: boolean
}

/**
 * 字段的画法。
 * - `text` 一行标签配一个读数，最省地方
 * - `hero` 大号主指标，一张牌上挑一两个量用
 * - `bar` 读数下面压一条量程进度条
 * - `gauge` 环形仪表，一眼看出占量程几成
 * - `sparkline` 迷你趋势线，攒的是**本次会话内**收到的读数
 * - `bars` 迷你柱群，与趋势线同一份序列，看节拍比看走势清楚
 * - `dot` 状态灯，配阈值档时最有用
 * - `delta` 读数带一个与上一次相比的升降角标
 */
export const TWIN_PANEL_FIELD_KINDS = [
  'text',
  'hero',
  'bar',
  'gauge',
  'sparkline',
  'bars',
  'dot',
  'delta',
] as const
export type TwinPanelFieldKind = (typeof TWIN_PANEL_FIELD_KINDS)[number]

/** 阈值档的色轴；`accent` 就是牌自己的主题色。 */
export const TWIN_PANEL_TONES = [
  'accent',
  'success',
  'warning',
  'danger',
] as const
export type TwinPanelTone = (typeof TWIN_PANEL_TONES)[number]

/**
 * 一个阈值档：读数 ≥ `at` 就进这一档。
 * ⚠ 命中的是**满足条件里 `at` 最大的那一档**，与档在数组里的先后无关：
 * 按数组序取第一个满足的，会让用户把「危险」写在「预警」前面时，
 * 超了危险线的读数只显示预警色。
 */
export interface TwinPanelLevel {
  /** 稳定 id，编辑器拿它当列表键；不参与取档。 */
  id: string
  at: number
  tone: TwinPanelTone
}

/**
 * 信息牌上的一个字段：一个标签配一个值。
 * ⚠ 值来自数组绑定，按**扁平化后的文档序**对齐：第 i 行喂给「把所有信息牌的
 * 字段按顺序摊平之后」的第 i 个字段。插一个字段会让它之后的每一行整体后移一格，
 * 这正是编辑器改完必须重派绑定行的原因。
 * ⚠ 换画法**不改行数**：八种画法都只吃一个值，所以既有绑定不会因为把某一行
 * 改成仪表盘而整体错位。
 */
export interface TwinPanelField {
  /** 牌内唯一键，供编辑器定位；不参与取值对齐。 */
  key: string
  label: string
  unit: string
  /** 数值前缀。 */
  prefix: string
  /** 小数位；null = 不定位数，按原值上屏。 */
  decimals: number | null
  /** 没有实时值时显示的静态文本。⚠ 与「常量绑定」不同：它纯展示，不进求值。 */
  staticText: string
  kind: TwinPanelFieldKind
  /** 图形量程下限；进度条、仪表、趋势线按 `[min, max]` 归一。 */
  min: number
  /** 图形量程上限。 */
  max: number
  /** 阈值档；空数组 = 不按读数换色，一律用牌的主题色。 */
  levels: TwinPanelLevel[]
}

/**
 * 信息牌：锚定在锚点或世界坐标上的一张浮层卡片。
 * ⚠ `anchorId` 与 `position` 二选一，前者优先：两个都给时按锚点走，
 * 而 `position` 那份会静默不生效——编辑器要把这一点摆明。
 */
export interface TwinPanel {
  id: string
  /** 卡片标题；空串 = 不画标题行。 */
  name: string
  /** 标题上方那行小字标识；空串 = 不画。 */
  subtitle: string
  /** 卡片底栏文案；空串 = 不画底栏。 */
  footnote: string
  /** 锚定的锚点 id；空串 = 用 `position`。 */
  anchorId: string
  position: Vec3
  /** 相对锚点或位置的偏移。 */
  offset: Vec3
  /** 欧拉角，度。只在 `billboard: 'fixed'` 档生效——另两档朝向每帧被相机接管。 */
  rotation: Vec3
  fields: TwinPanelField[]
  billboard: TwinBillboardMode
  style: TwinPanelStyle
  visibility: TwinVisibilityRule
}

/** 立体方向箭头：指示走向，并把实时值拼进标签。 */
export interface TwinArrow {
  id: string
  name: string
  position: Vec3
  /** 朝向向量；渲染前会 normalize，零向量当没配。 */
  direction: Vec3
  length: number
  width: number
  /** 标签固定文本；与实时值拼在一起。 */
  labelText: string
  /** 值的前缀、单位与小数位。 */
  prefix: string
  unit: string
  decimals: number | null
  /** 箭头与标签的主题色规格。 */
  color: string
  visibility: TwinVisibilityRule
}

/**
 * 能量流：沿一串锚点流动的粒子带。
 * ⚠ `pathAnchors` 少于两个点就画不出一条线——不足两点的条目由
 * `collectTwinConfigIssues` 报出来，渲染层不猜。
 */
export interface TwinFlowLink {
  id: string
  name: string
  /** 能源种类，决定配色 token。空串 = 用缺省色。 */
  kind: string
  /** 路径经过的锚点 id，按顺序。 */
  pathAnchors: string[]
  /** 线宽因子，也影响粒子大小。 */
  width: number
  /** 允许负强度反向流动。 */
  reversible: boolean
  visibility: TwinVisibilityRule
}

/**
 * 视点：一个存下来的机位。
 * ⚠ `position` 与 `target` 都是**世界坐标**，与「方位角/俯仰角」那套不通用：
 * 两套混着填不会报错，只会让镜头飞到一个谁也没想到的地方。
 */
export interface TwinCamera {
  id: string
  name: string
  position: Vec3
  /** 注视点。 */
  target: Vec3
  /** 透视视野，度。 */
  fov: number
  /** 打开大屏时用哪个机位；多个都标了只认文档序第一个。 */
  isDefault: boolean
}

/** 视点切换控件的形态。 */
export const TWIN_VIEWPOINT_MODES = ['buttons', 'dropdown'] as const
export type TwinViewpointMode = (typeof TWIN_VIEWPOINT_MODES)[number]

/** 运行态的视点切换控件。 */
export interface TwinViewpointSwitcher {
  enabled: boolean
  mode: TwinViewpointMode
  /** 数字键与方向键切换。 */
  keyboard: boolean
  /**
   * 要显示的视点 id 与顺序；空数组 = 按 `cameras` 的文档序全显示。
   * ⚠ 这里列到的 id 如果在 `cameras` 里不存在，那一项直接不显示——
   * 悬空引用由 `collectTwinConfigIssues` 报出来，渲染层不猜。
   */
  items: string[]
}

/**
 * 取景快照：一个机位加一个注视点。部件远距点击飞过去用它。
 * ⚠ 与 `TwinCamera` 同形却不是同一个东西：视点是场上共享的预设、能在切换条上
 * 露面，这一份只属于某个部件、不进切换条。共用一个类型会让「删掉一个视点」
 * 顺手把某个部件的取景也删了。
 */
export interface TwinFocusView {
  position: Vec3
  /** 注视点。 */
  target: Vec3
  /** 透视视野，度。 */
  fov: number
}

/**
 * 一段漫游的时长覆盖。
 * ⚠ `null` 表示这一项没覆盖、用轨迹的全局值，不是「覆盖成 0」：后者是
 * 「这一段瞬移过去 / 到站不停」，两者的画面完全不同。
 */
export interface TwinRoamTourSegment {
  /** 本段飞行时长 ms。 */
  segmentMs: number | null
  /** 本段到站后的停留时长 ms。 */
  pauseMs: number | null
}

/**
 * 自动漫游：镜头按一串视点连续飞过去。
 * ⚠ `items` 里指向已删视点的 id 一律留着，由 `collectTwinConfigIssues` 报出来，
 * 运行态跳过那一站——与视点切换控件同一个口径，归一化不做静默清理。
 */
export interface TwinRoamTour {
  enabled: boolean
  /** 进运行态就开播。 */
  autoplay: boolean
  /** 用户不操作到点后自动开播。 */
  idleAutoplay: boolean
  /** 闲置多久才自动开播，ms。 */
  idleAutoplayDelayMs: number
  /** 走完最后一站回到第一站接着飞。 */
  loop: boolean
  /** 运行态显示播放控件。 */
  showControls: boolean
  /** 轨迹经过的视点 id，按顺序。 */
  items: string[]
  /** 每段飞行时长 ms。 */
  segmentMs: number
  /** 每站停留时长 ms。 */
  pauseMs: number
  /**
   * 逐段覆盖，键 = 该段**起始**视点 id。
   * ⚠ 停留算在飞完那一段的尾巴上，所以「到 B 停 5 秒」配在 A→B 那段、也就是
   * 键 A 上；配到 B 上改的是 B→C 那段的停留。
   */
  segmentSettings: Record<string, TwinRoamTourSegment>
}

/** 可分夹的实体集合名，与 `TwinConfig` 上六个实体数组字段逐字对应。 */
export const TWIN_FOLDER_KINDS = [
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
] as const
export type TwinFolderKind = (typeof TWIN_FOLDER_KINDS)[number]

/**
 * 大纲文件夹：编辑器左栏的纯展示分组，渲染层不读。
 * ⚠ 它不动文档序：成员进出文件夹时实体数组一字不变，数组绑定的对齐位次
 * （`anchorValues[i]` 喂第 i+1 行）因此与文件夹完全无关。
 */
export interface TwinOutlineFolder {
  id: string
  kind: TwinFolderKind
  name: string
  /** 成员实体 id；悬空与跨夹重复在归一化时剔除。 */
  itemIds: string[]
}

/** 一份孪生场景配置。 */
export interface TwinConfig {
  version: number
  model: TwinModelRef
  parts: TwinPart[]
  anchors: TwinAnchor[]
  cameras: TwinCamera[]
  viewpoints: TwinViewpointSwitcher
  roamTour: TwinRoamTour
  panels: TwinPanel[]
  arrows: TwinArrow[]
  flows: TwinFlowLink[]
  folders: TwinOutlineFolder[]
}

/** 一个部件的实时值，状态染色按它取色。 */
export interface TwinPartValue {
  value: unknown
}

/** 部件实时值，按部件 id 索引。 */
export type TwinPartValues = Readonly<Record<string, TwinPartValue>>

/** 一个锚点的实时值。 */
export interface TwinAnchorValue {
  value: unknown
}

/** 锚点实时值，按锚点 id 索引。 */
export type TwinAnchorValues = Readonly<Record<string, TwinAnchorValue>>

/** 一个信息牌字段的实时值。 */
export interface TwinPanelValue {
  value: unknown
}

/**
 * 信息牌字段的实时值，按 `<牌 id>::<字段 key>` 索引。
 * ⚠ 键里必须带牌 id：两张牌上都有一个叫 `temp` 的字段是常事，
 * 只用字段 key 会让后一张牌的值盖掉前一张的。
 */
export type TwinPanelValues = Readonly<Record<string, TwinPanelValue>>

/** 一个箭头的实时值。 */
export interface TwinArrowValue {
  value: unknown
}

/** 箭头实时值，按箭头 id 索引。 */
export type TwinArrowValues = Readonly<Record<string, TwinArrowValue>>

/** 一条能量流的实时值。 */
export interface TwinFlowValue {
  /** 强度，驱动粒子速度与方向。 */
  intensity: unknown
  /** 激活；假值时静止灰显。 */
  active: unknown
}

/** 能量流实时值，按流 id 索引。 */
export type TwinFlowValues = Readonly<Record<string, TwinFlowValue>>

/** 一个部件详情字段的实时值。 */
export interface TwinPartFieldValue {
  value: unknown
}

/**
 * 部件详情字段的实时值，按 `<部件 id>::<字段 key>` 索引。
 * ⚠ 键里必须带部件 id：两个部件上都有一个叫 `power` 的字段是常事，
 * 只用字段 key 会让后一个部件的值盖掉前一个的。
 */
export type TwinPartFieldValues = Readonly<Record<string, TwinPartFieldValue>>
