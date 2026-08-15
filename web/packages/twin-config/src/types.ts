/**
 * @fileoverview 孪生场景配置的形状。只有类型，没有逻辑——归一化在 `normalize*.ts`。
 *
 * ⚠ 字段一律**非可选**：归一化的输出里不许出现 `undefined`，否则 JSON 往返一趟
 * 形状就变了，而「往返之后少了一个键」这类差异在渲染层表现为某一项忽然回到缺省。
 * 缺省用具体值表达（空串 / 空数组 / null），不用「键不在」。
 */

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
export type TwinPedestalReflection =
  (typeof TWIN_PEDESTAL_REFLECTIONS)[number]

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
 * 模型引用与它在场景里的摆放。
 * `asset` 是素材引用 `asset:<uuid>`（ADR-0015 的唯一合法落库形态），空串 = 还没挑模型。
 */
export interface TwinModelRef {
  asset: string
  scale: number
  position: Vec3
  /** 欧拉角，度。 */
  rotation: Vec3
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
 * 部件：模型内一组节点的唯一可寻址单元，显隐指向它。
 * ⚠ `nodes` 是模型文件里的对象名，本包看不见模型——模型里改了名字，
 * 这个部件就静默地什么都不再命中。
 */
export interface TwinPart {
  id: string
  name: string
  nodes: string[]
  visibility: TwinVisibilityRule
  clickDistance: TwinClickDistanceRule
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
] as const
export type TwinPanelVariant = (typeof TWIN_PANEL_VARIANTS)[number]

/** 卡片相对锚点的偏移方向；非 `center` 时画引线与锚点光环。 */
export const TWIN_PANEL_ORIENTS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
] as const
export type TwinPanelOrient = (typeof TWIN_PANEL_ORIENTS)[number]

/** 朝向：始终朝相机，还是钉死在世界坐标系里。 */
export const TWIN_BILLBOARD_MODES = ['face', 'fixed'] as const
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
  /** 字号缩放。 */
  fontScale: number
  animate: boolean
  /** 锚点光环脉冲。 */
  pulse: boolean
}

/**
 * 信息牌上的一个字段：一个标签配一个值。
 * ⚠ 值来自数组绑定，按**扁平化后的文档序**对齐：第 i 行喂给「把所有信息牌的
 * 字段按顺序摊平之后」的第 i 个字段。插一个字段会让它之后的每一行整体后移一格，
 * 这正是编辑器改完必须重派绑定行的原因。
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
  /** 锚定的锚点 id；空串 = 用 `position`。 */
  anchorId: string
  position: Vec3
  /** 相对锚点或位置的偏移。 */
  offset: Vec3
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

/** 一份孪生场景配置。 */
export interface TwinConfig {
  version: number
  model: TwinModelRef
  parts: TwinPart[]
  anchors: TwinAnchor[]
  cameras: TwinCamera[]
  viewpoints: TwinViewpointSwitcher
  panels: TwinPanel[]
  arrows: TwinArrow[]
  flows: TwinFlowLink[]
}

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
