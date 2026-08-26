/**
 * @fileoverview 2D 孪生文档里全部闭合取值域：图元/摆位/状态/路由/条件/算子等的常量数组
 * 与由它们派生的联合类型。归一化按这些数组做白名单，检查器按它们摆下拉。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4–§6。
 */

/** 图元四档。 */
export const TWIN_2D_PRIM_KINDS = ['box', 'vec', 'ico', 'txt'] as const
export type Twin2dPrimKind = (typeof TWIN_2D_PRIM_KINDS)[number]

/** 摆位五档。 */
export const TWIN_2D_PLACEMENT_KINDS = [
  'flow',
  'fill',
  'abs',
  'anchor',
  'perim',
] as const
export type Twin2dPlacementKind = (typeof TWIN_2D_PLACEMENT_KINDS)[number]

/**
 * 九档锚点。
 * ⚠ 与 `perim` 的法线推移是两套不同的位移数学，不许合并：九档走一张固定的
 * tx/ty 百分比表，`perim` 走法线推出半个自身尺寸（§4.3）。
 */
export const TWIN_2D_ANCHORS = [
  't',
  'b',
  'l',
  'r',
  'tl',
  'tr',
  'bl',
  'br',
  'c',
] as const
export type Twin2dAnchor9 = (typeof TWIN_2D_ANCHORS)[number]

/**
 * 节点状态四档。
 * ⚠ 不含 `hidden`：那是「不画状态点」的样式缺省，不是一个能从数据线上来的状态，
 * 混进来会让 `STATUS_OVERLAY` 多出一个数据永远产不出的档（§10.1）。
 */
export const TWIN_2D_STATUSES = [
  'online',
  'offline',
  'warning',
  'alarm',
] as const
export type Twin2dStatus = (typeof TWIN_2D_STATUSES)[number]

/** 样式缺省状态：四档之外多一个「整个状态点不渲染」。 */
export const TWIN_2D_DEFAULT_STATUSES = [...TWIN_2D_STATUSES, 'hidden'] as const
export type Twin2dDefaultStatus = (typeof TWIN_2D_DEFAULT_STATUSES)[number]

/** 变体条件里可命中的交互态五档。 */
export const TWIN_2D_STATES = [
  'hover',
  'selected',
  'alarm',
  'active',
  'flipped',
] as const
export type Twin2dState = (typeof TWIN_2D_STATES)[number]

/** 标注三档。 */
export const TWIN_2D_MARK_KINDS = ['rect', 'line', 'text'] as const
export type Twin2dMarkKind = (typeof TWIN_2D_MARK_KINDS)[number]

/**
 * 连线走线四档。
 * ⚠ `orthogonal` 与 `step` 指向同一个路由函数，两个档位名都保留是为了与参考项目
 * 的落库取值对得上；合并成一档会让存量取值落不进白名单。
 */
export const TWIN_2D_ROUTE_KINDS = [
  'orthogonal',
  'step',
  'bezier',
  'straight',
] as const
export type Twin2dRouteKind = (typeof TWIN_2D_ROUTE_KINDS)[number]

/** 连线实例上的走线选择：四档加一个「跟随样式」。 */
export const TWIN_2D_EDGE_ROUTES = ['auto', ...TWIN_2D_ROUTE_KINDS] as const
export type Twin2dEdgeRoute = (typeof TWIN_2D_EDGE_ROUTES)[number]

/**
 * 出线方向四档。
 * ⚠ 正交路由只吃这四档，`'auto'` 必须在进路由之前解析掉（§4.4）：流进去会取到一个
 * 隐式的 undefined 分支，表现是这一条线从节点中心横穿出去、其余线全对。
 */
export const TWIN_2D_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type Twin2dSide = (typeof TWIN_2D_SIDES)[number]

/** 端口上可配的出线方向：四档加一个待解析的 `auto`。 */
export const TWIN_2D_PORT_SIDES = [...TWIN_2D_SIDES, 'auto'] as const
export type Twin2dPortSide = (typeof TWIN_2D_PORT_SIDES)[number]

/** `side: 'auto'` 并列时的解析序。 */
export const TWIN_2D_SIDE_PRIORITY = TWIN_2D_SIDES

/**
 * 过渡属性六档。
 * ⚠ 放开成任意 CSS 属性名会让消毒面变大而收益为零（§4.2）。
 */
export const TWIN_2D_TRANSITION_PROPS = [
  'transform',
  'opacity',
  'background',
  'border-color',
  'box-shadow',
  'filter',
] as const
export type Twin2dTransitionProp = (typeof TWIN_2D_TRANSITION_PROPS)[number]

/** keyframes 动画五档；与 `transition` 的属性补间是两件事。 */
export const TWIN_2D_ANIM_KINDS = [
  'none',
  'pulse',
  'blink',
  'breathe',
  'dash',
] as const
export type Twin2dAnimKind = (typeof TWIN_2D_ANIM_KINDS)[number]

/** 填充五档，多层从下往上叠。 */
export const TWIN_2D_FILL_KINDS = [
  'solid',
  'linear',
  'radial',
  'repeat',
  'image',
] as const
export type Twin2dFillKind = (typeof TWIN_2D_FILL_KINDS)[number]

/** SVG 几何五档。 */
export const TWIN_2D_SHAPE_KINDS = [
  'path',
  'rect',
  'ellipse',
  'line',
  'poly',
] as const
export type Twin2dShapeKind = (typeof TWIN_2D_SHAPE_KINDS)[number]

/** SVG 上色三档。 */
export const TWIN_2D_PAINT_KINDS = ['none', 'color', 'gradient'] as const
export type Twin2dPaintKind = (typeof TWIN_2D_PAINT_KINDS)[number]

/** 局部渐变两档。 */
export const TWIN_2D_GRADIENT_KINDS = ['linear', 'radial'] as const
export type Twin2dGradientKind = (typeof TWIN_2D_GRADIENT_KINDS)[number]

/** 图标来源五档（`sprite` 是内置图标集，§5）。 */
export const TWIN_2D_ICO_SRC_KINDS = [
  'none',
  'name',
  'sprite',
  'asset',
  'draw',
] as const
export type Twin2dIcoSrcKind = (typeof TWIN_2D_ICO_SRC_KINDS)[number]

/** 文本来源四档。 */
export const TWIN_2D_TXT_SRC_KINDS = ['lit', 'slot', 'label', 'id'] as const
export type Twin2dTxtSrcKind = (typeof TWIN_2D_TXT_SRC_KINDS)[number]

/** 槽位两档：`live` 成一行绑定，`derived` 由算式得出、不成行。 */
export const TWIN_2D_SLOT_KINDS = ['live', 'derived'] as const
export type Twin2dSlotKind = (typeof TWIN_2D_SLOT_KINDS)[number]

/** 引脚方向四档。 */
export const TWIN_2D_PORT_DIRS = ['in', 'out', 'both', 'passive'] as const
export type Twin2dPortDir = (typeof TWIN_2D_PORT_DIRS)[number]

/** 引脚落点两档：周长参数或归一坐标。 */
export const TWIN_2D_PORT_AT_KINDS = ['perim', 'xy'] as const
export type Twin2dPortAtKind = (typeof TWIN_2D_PORT_AT_KINDS)[number]

/** 画布底纹四档。 */
export const TWIN_2D_PATTERNS = ['none', 'weave', 'dots', 'lines'] as const
export type Twin2dPattern = (typeof TWIN_2D_PATTERNS)[number]

/** 底图铺法四档。 */
export const TWIN_2D_BACKGROUND_FITS = [
  'cover',
  'contain',
  'stretch',
  'tile',
] as const
export type Twin2dBackgroundFit = (typeof TWIN_2D_BACKGROUND_FITS)[number]

/** 舞台缩放四档（§9.1）。 */
export const TWIN_2D_FIT_MODES = [
  'contain',
  'width',
  'height',
  'stretch',
] as const
export type Twin2dFitMode = (typeof TWIN_2D_FIT_MODES)[number]

/** 显示名位置六档。 */
export const TWIN_2D_LABEL_POSITIONS = [
  'bottom',
  'top',
  'left',
  'right',
  'inside',
  'hidden',
] as const
export type Twin2dLabelPos = (typeof TWIN_2D_LABEL_POSITIONS)[number]

/** 角标形状三档。 */
export const TWIN_2D_BADGE_SHAPES = ['round', 'square', 'diamond'] as const
export type Twin2dBadgeShape = (typeof TWIN_2D_BADGE_SHAPES)[number]

/**
 * 节点旋转四档。
 * ⚠ 只给四档：任意角度会让正交走线失去意义，且端口吸附点变成无理数（§12）。
 */
export const TWIN_2D_NODE_ROTATIONS = [0, 90, 180, 270] as const
export type Twin2dNodeRotation = (typeof TWIN_2D_NODE_ROTATIONS)[number]

/** 标注标签的三档位置。 */
export const TWIN_2D_MARK_LABEL_POSITIONS = ['inside', 'top', 'bottom'] as const
export type Twin2dMarkLabelPos = (typeof TWIN_2D_MARK_LABEL_POSITIONS)[number]

/** 标注标签横向对齐三档。 */
export const TWIN_2D_MARK_ALIGN_H = ['left', 'center', 'right'] as const
export type Twin2dMarkAlignH = (typeof TWIN_2D_MARK_ALIGN_H)[number]

/** 标注标签纵向对齐三档。 */
export const TWIN_2D_MARK_ALIGN_V = ['top', 'middle', 'bottom'] as const
export type Twin2dMarkAlignV = (typeof TWIN_2D_MARK_ALIGN_V)[number]

/** 标注相对节点层的上下两档。 */
export const TWIN_2D_MARK_Z_ORDERS = ['below', 'above'] as const
export type Twin2dMarkZOrder = (typeof TWIN_2D_MARK_Z_ORDERS)[number]

/** box 的排流三档。 */
export const TWIN_2D_FLOWS = ['row', 'col', 'none'] as const
export type Twin2dFlow = (typeof TWIN_2D_FLOWS)[number]

/** 交叉轴对齐五档。 */
export const TWIN_2D_ALIGNS = [
  'start',
  'center',
  'end',
  'baseline',
  'stretch',
] as const
export type Twin2dAlign = (typeof TWIN_2D_ALIGNS)[number]

/** 主轴分布五档。 */
export const TWIN_2D_JUSTIFIES = [
  'start',
  'center',
  'end',
  'between',
  'around',
] as const
export type Twin2dJustify = (typeof TWIN_2D_JUSTIFIES)[number]

/** 指针事件两档；`none` 时整枝不吃指针事件。 */
export const TWIN_2D_POINTER_EVENTS = ['auto', 'none'] as const
export type Twin2dPointerEvents = (typeof TWIN_2D_POINTER_EVENTS)[number]

/** 光标三档。 */
export const TWIN_2D_CURSORS = ['default', 'help', 'pointer'] as const
export type Twin2dCursor = (typeof TWIN_2D_CURSORS)[number]

/** 文本横向对齐三档。 */
export const TWIN_2D_TEXT_ALIGNS = ['start', 'center', 'end'] as const
export type Twin2dTextAlign = (typeof TWIN_2D_TEXT_ALIGNS)[number]

/** 文本基线三档。 */
export const TWIN_2D_TEXT_BASELINES = ['auto', 'baseline', 'center'] as const
export type Twin2dTextBaseline = (typeof TWIN_2D_TEXT_BASELINES)[number]

/** 边框线型四档。 */
export const TWIN_2D_BORDER_STYLES = [
  'solid',
  'dashed',
  'dotted',
  'none',
] as const
export type Twin2dBorderStyle = (typeof TWIN_2D_BORDER_STYLES)[number]

/** 线端三档。 */
export const TWIN_2D_STROKE_CAPS = ['butt', 'round', 'square'] as const
export type Twin2dStrokeCap = (typeof TWIN_2D_STROKE_CAPS)[number]

/** 折角三档。 */
export const TWIN_2D_STROKE_JOINS = ['miter', 'round', 'bevel'] as const
export type Twin2dStrokeJoin = (typeof TWIN_2D_STROKE_JOINS)[number]

/** vec 的坐标口径两档：`unit` 是本图元盒的 0..1 归一值，`px` 是设计像素。 */
export const TWIN_2D_VEC_COORDS = ['unit', 'px'] as const
export type Twin2dVecCoord = (typeof TWIN_2D_VEC_COORDS)[number]

/** 连线端点标记两档。 */
export const TWIN_2D_EDGE_MARKER_KINDS = ['none', 'arrow'] as const
export type Twin2dEdgeMarkerKind = (typeof TWIN_2D_EDGE_MARKER_KINDS)[number]

/** 变体条件六档。 */
export const TWIN_2D_CONDITION_KINDS = [
  'state',
  'status',
  'tag',
  'slot',
  'has',
  'not',
] as const
export type Twin2dConditionKind = (typeof TWIN_2D_CONDITION_KINDS)[number]

/** `has` 条件的判定两档。 */
export const TWIN_2D_HAS_MODES = ['any', 'all'] as const
export type Twin2dHasMode = (typeof TWIN_2D_HAS_MODES)[number]

/**
 * 派生槽算子七档。
 * ⚠ 这是闭合算子表而不是表达式语言：本仓已经有一台解释器（台账公式），
 * 真需要复杂计算走绑定的 `computed` 来源（§9.5）。
 */
export const TWIN_2D_EXPR_KINDS = [
  'slot',
  'lit',
  'first',
  'ratio',
  'sum',
  'scale',
  'join',
] as const
export type Twin2dExprKind = (typeof TWIN_2D_EXPR_KINDS)[number]

/**
 * 阈值算子八档，与 `@dt/modules/shared/thresholds` 的 `THRESHOLD_OPS` 逐项同名。
 * ⚠ 本包不许依赖 `@dt/modules`（方向反了），所以这里另立一份，由
 * `twin2d-op-parity.contract.spec.ts` 断言两份逐项相同：悄悄漂移的表现是
 * 同一条 `between` 在阈值卡片上成立、在 2D 图上不成立（§4.5）。
 */
export const TWIN_2D_THRESHOLD_OPS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'outside',
  'eq',
  'neq',
] as const
export type Twin2dThresholdOp = (typeof TWIN_2D_THRESHOLD_OPS)[number]

/**
 * 内置图标集的 11 枚 symbol id，与 `render/icons.svg` 逐一对应。
 * ⚠ 常量多一个 → 那一档永远渲染空白；文件多一个 → 用户永远选不到。两边都零报错，
 * 只有 `twin2d-sprite-ids.contract.spec.ts` 的双向对齐拦得住（§5）。
 */
export const TWIN_2D_SPRITE_IDS = [
  'ico-src-waste-heat',
  'ico-src-steam',
  'ico-src-air-source',
  'ico-src-solar',
  'ico-vsl-tank',
  'ico-vsl-manifold',
  'ico-hx',
  'ico-term-shower',
  'ico-term-radiator',
  'ico-term-ac',
  'ico-tap',
] as const
export type Twin2dSpriteId = (typeof TWIN_2D_SPRITE_IDS)[number]

/**
 * 颜色写死在 sprite 里的 4 枚能源源图标。
 * ⚠ `ico.color` 对它们无效——那批图标是插画式多色的，`currentColor` 只对另外 7 枚
 * 单色 symbol 成立。检查器按这份名单禁用颜色控件并写明原因：名单少一个 → 颜色控件
 * 可点、点了没反应；多一个 → 一枚本可染色的图标被白白禁掉（§5）。
 */
export const TWIN_2D_FIXED_COLOR_SPRITES = [
  'ico-src-waste-heat',
  'ico-src-steam',
  'ico-src-air-source',
  'ico-src-solar',
] as const
export type Twin2dFixedColorSprite =
  (typeof TWIN_2D_FIXED_COLOR_SPRITES)[number]

/**
 * `icons.svg` 里四个文档级渐变 id。
 * ⚠ 它们占住整个 DOM 文档的命名空间，用户自建的局部渐变一律加实例前缀，
 * 前缀方案永不许产出这四个名字（§5）。
 */
export const TWIN_2D_SPRITE_GRADIENT_IDS = [
  'recoveryFill',
  'hxFill',
  'pumpFill',
  'solarFill',
] as const
export type Twin2dSpriteGradientId =
  (typeof TWIN_2D_SPRITE_GRADIENT_IDS)[number]
