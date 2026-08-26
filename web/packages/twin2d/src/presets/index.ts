// ⚠ 要发货的那份节点样式是 `TWIN_2D_BUILTIN_NODE_STYLES`。`TWIN_2D_SOURCE_STYLES`
// 与 `TWIN_2D_TERMINAL_STYLES` 是**不带子类变体**的原始那份，拿它渲染只会让 25 种
// 子类组合一条都不生效，而这一步零报错。
export {
  TWIN_2D_CIRCUIT_CAPACITOR,
  TWIN_2D_CIRCUIT_DIODE,
  TWIN_2D_CIRCUIT_GROUND,
  TWIN_2D_CIRCUIT_INDUCTOR,
  TWIN_2D_CIRCUIT_JUNCTION,
  TWIN_2D_CIRCUIT_RESISTOR,
  TWIN_2D_CIRCUIT_SOURCE,
  TWIN_2D_CIRCUIT_STYLES,
  TWIN_2D_CIRCUIT_SWITCH,
} from './circuit'
export {
  TWIN_2D_EDGE_PRESETS,
  TWIN_2D_EDGE_PRESET_DEFS,
  twin2dEdgePreset,
} from './edges'
export type { Twin2dEdgePresetDef, Twin2dEdgePresetId } from './edges'
export {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
} from './nodes'
export { TWIN_2D_MISC_STYLES } from './nodesMisc'
export { TWIN_2D_SOURCE_STYLES, TWIN_2D_SOURCE_STYLE_IDS } from './nodesSource'
export { TWIN_2D_TERMINAL_STYLES } from './nodesTerminal'
export { TWIN_2D_VESSEL_STYLES } from './nodesVessel'
export { TWIN_2D_PALETTE, TWIN_2D_PALETTE_RGB, mixTransparent } from './palette'
export type { Twin2dPaletteKey } from './palette'
export {
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  TWIN_2D_SENSOR_PILLS,
  TWIN_2D_SENSOR_PLACEHOLDER,
  TWIN_2D_SENSOR_SLOTS,
  twin2dSensorIdPrefix,
  twin2dSensorPill,
  twin2dSensorSlot,
} from './sensors'
export type { Twin2dSensorDef, Twin2dSensorId } from './sensors'
export {
  TWIN_2D_SOURCE_GLYPH_PRIM_ID,
  TWIN_2D_SOURCE_SUBTYPE_DEFS,
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  TWIN_2D_SUBTYPE_TAG_KEY,
  TWIN_2D_TERMINAL_GLYPH_PRIM_ID,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
  twin2dSubtypeVariant,
  twin2dWithSubtypes,
} from './subtypes'
export type {
  Twin2dSourceSubtypeId,
  Twin2dSubtypeDef,
  Twin2dTerminalSubtypeId,
} from './subtypes'
