/**
 * @fileoverview 任意来源的 JSON → 合法 `Twin2dConfig`：一块画布加五张表。
 * 渲染层、编辑器与绑定重派共用这一个入口，口径见
 * docs/MODULE_TWIN_2D_DESIGN.md §4（文档契约）与 §4.1（画布）。
 */
import {
  TWIN_2D_CONFIG_VERSION,
  TWIN_2D_DEFAULT_CANVAS_HEIGHT,
  TWIN_2D_DEFAULT_CANVAS_WIDTH,
  TWIN_2D_DEFAULT_GRID,
  TWIN_2D_DEFAULT_PATTERN_GAP,
  TWIN_2D_DEFAULT_PATTERN_WIDTH,
  TWIN_2D_MAX_CANVAS_SIZE,
  TWIN_2D_MAX_GRID,
  TWIN_2D_MIN_CANVAS_SIZE,
  TWIN_2D_MIN_GRID,
} from './constants'
import { TWIN_2D_BACKGROUND_FITS, TWIN_2D_PATTERNS } from './kinds'
import { normalizeEdges } from './normalizeEdges'
import { normalizeMarks } from './normalizeMarks'
import { normalizeNodes } from './normalizeNodes'
import { normalizeEdgeStyles, normalizeNodeStyles } from './normalizeStyles'
import {
  boolOr,
  clamp,
  intIn,
  isRecord,
  oneOf,
  posDim,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import type { Twin2dCanvas, Twin2dConfig } from './types'

/** 最早的文档版本 */
const FIRST_VERSION = 1

/** 画布边长：先按尺寸类正数收，再夹进上下界。 */
function canvasSide(value: unknown, fallback: number): number {
  return clamp(
    posDim(value, fallback),
    TWIN_2D_MIN_CANVAS_SIZE,
    TWIN_2D_MAX_CANVAS_SIZE,
  )
}

/**
 * 文档版本：正整数原样留下，其余（缺失 / 非数 / 小数 / 非正）回本版。
 * ⚠ 比本版新的号码**不压回本版**：压回去等于对着一份读不懂的文档宣称「这是我这版
 * 写的」，而升级探测只有这一个显式字段可依据（§4）。
 */
function configVersion(value: unknown): number {
  const parsed = toFiniteNumber(value)
  if (parsed === null || !Number.isInteger(parsed) || parsed < FIRST_VERSION) {
    return TWIN_2D_CONFIG_VERSION
  }
  return parsed
}

/**
 * 画布：一张图自己的坐标系、底图与底纹。
 * ⚠ 与大屏的 `designWidth/Height` 无关，上到大屏后按 §9.1 等比缩放贴进模块矩形。
 * ⚠ `width` / `height` 夹进 [200, 20000] 而不是只取正数：一张宽 3 的画布缩放后
 * 整图糊成一个点，而它在配置面板上看着是个正经数字。
 * ⚠ `grid` 走整数并夹进 [2, 200]：吸附是 `Math.round(x / grid) * grid`，步长 0 会让
 * 每个坐标都算成 NaN，而 NaN 的位移在浏览器里是「这一层整个不见了」，不报错。
 * ⚠ `background` / `patternColor` 只 trim，不在这里消毒 CSS——消毒连同「被拒的值
 * 回落到缺省并进诊断」是渲染层 `cssValue.ts` 的事（§11.5），在这里丢会让用户
 * 看不出自己填的值哪里不合口径。
 * @param raw 原始画布
 */
export function normalizeCanvas(raw: unknown): Twin2dCanvas {
  const source = isRecord(raw) ? raw : {}
  return {
    width: canvasSide(source.width, TWIN_2D_DEFAULT_CANVAS_WIDTH),
    height: canvasSide(source.height, TWIN_2D_DEFAULT_CANVAS_HEIGHT),
    grid: intIn(
      source.grid,
      TWIN_2D_MIN_GRID,
      TWIN_2D_MAX_GRID,
      TWIN_2D_DEFAULT_GRID,
    ),
    // 缺省不画：运行态大屏上多出一层网格没人要，编辑器自己显式开
    showGrid: boolOr(source.showGrid, false),
    background: trimmedString(source.background),
    backgroundFit: oneOf(
      source.backgroundFit,
      TWIN_2D_BACKGROUND_FITS,
      'cover',
    ),
    pattern: oneOf(source.pattern, TWIN_2D_PATTERNS, 'none'),
    patternColor: trimmedString(source.patternColor),
    patternGap: posDim(source.patternGap, TWIN_2D_DEFAULT_PATTERN_GAP),
    patternWidth: posDim(source.patternWidth, TWIN_2D_DEFAULT_PATTERN_WIDTH),
  }
}

/**
 * 任意来源的 JSON → 合法 `Twin2dConfig`。
 * ⚠ 与 `@dt/twin-config` 的 `normalizeTwinConfig` 同一条口径：舞台**按引用比对**这份
 * 配置，所以同一份输入必须只归一一次、始终交出同一个对象。调用方把它包进
 * `computed`（只在上游 config 换了对象时才产出新引用），在渲染里反复新建等于每次
 * 求值都换一份引用、整张图全量重画；反过来就地改字段则一次都不重画。
 * ⚠ 幂等：`normalizeTwin2dConfig(normalizeTwin2dConfig(x))` 与一次的结果逐字段相同，
 * 输出里没有 `undefined`，JSON 往返也不变形。
 * ⚠ 数组绑定行的文档序以它的输出为准：`nodeStatus[i]` 钉的是这里输出的第 i 个节点，
 * 派生绑定行与缝合读值必须喂同一份输出（§14.2）。
 * @param raw 落库的 `configJson.twin2d` 配置块
 */
export function normalizeTwin2dConfig(raw: unknown): Twin2dConfig {
  const source = isRecord(raw) ? raw : {}
  // ⚠ 先节点后连线：悬空过滤要拿归一化**之后**仍在的 id 集合，拿原始节点会把
  //   「id 脏到被丢掉的节点」上的连线当成合法的留下来，画出一条通向不存在处的线
  const nodes = normalizeNodes(source.nodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  return {
    version: configVersion(source.version),
    canvas: normalizeCanvas(source.canvas),
    styles: normalizeNodeStyles(source.styles),
    edgeStyles: normalizeEdgeStyles(source.edgeStyles),
    nodes,
    edges: normalizeEdges(source.edges, nodeIds),
    marks: normalizeMarks(source.marks),
  }
}
