/**
 * @fileoverview 「编辑一像素 = 大屏一像素」这件事的判据：从大屏节点上读出缩放档与
 * 四周留白，算出 1:1 该配多大的画布、当前又实际缩了多少。
 *
 * ⚠ 倍率与它的反函数都借 `@dt/twin2d` 的 `stageFit`，这里一个字的算术都不写：
 * 舞台按那一份缩放，编辑器按另一份报数的话，界面上写着 1:1 而大屏上并不是。
 * ⚠ 这两个键住在**模块**的配置里（`fitMode` / `fitPadding`，与 `twin2d` 那一段平级），
 * 所以本页只**读**不写：把它们写回去就得让子编辑器认得自己在编哪个模块，而那是这一页
 * 明确不知道的事。两个字面量与清单声明的键由契约测试逐一对上（`twin2d-host-fit`）。
 */
import {
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_FIT_MODES,
  TWIN_2D_MAX_FIT_PADDING,
  TWIN_2D_MIN_FIT_PADDING,
  clamp,
  finiteOr,
  isRecord,
  oneOf,
  twin2dDesignSize,
  twin2dFitScales,
} from '@dt/twin2d'
import type { Twin2dBox, Twin2dFitView } from '@dt/twin2d'

/**
 * 模块配置里管缩放的那两个键。
 * ⚠ 与本页所编模块的清单声明的键必须逐字相同：拼错时这里静默退回缺省，界面上算出
 * 来的「1:1」于是按一个谁也没配过的档位算，而两侧都不报错。
 */
export const TWIN_2D_HOST_FIT_KEYS = {
  mode: 'fitMode',
  padding: 'fitPadding',
} as const

/**
 * 倍率与 1 的差在多少之内还算 1:1。
 * ⚠ 不能取得比取整误差还小：边长必须是整数，凑不出的那半像素在最小的画布上也有
 * 千分之二三，取 0.001 的话「已经对齐好的」会被判成没对齐，按钮于是永远亮着。
 */
const NEAR_ONE = 0.01

/** 当前配置与大屏格子对不对得上。 */
export interface Twin2dParity {
  /** 1:1 时画布该配多大。 */
  design: Twin2dBox
  /** 当前画布上屏后的两轴倍率。 */
  scale: { x: number; y: number }
  /** 当前就是 1:1（两轴都是 1）。 */
  exact: boolean
  /** 画布读数那一行；照实说当前是几比几。 */
  summary: string
}

/**
 * 从大屏节点的配置里读出这块模块的缩放档与留白。
 * ⚠ 取值口径与模块壳里读这两个键的那一处逐条相同：档位落不到枚举回
 * `contain`、留白夹进 0..20。宽一格窄一格都会让这一页报出模块并不会照做的数。
 * @param configJson 这个大屏节点整袋配置
 */
export function twin2dHostFitView(
  configJson: Record<string, unknown>,
): Twin2dFitView {
  return {
    fitMode: oneOf(
      configJson[TWIN_2D_HOST_FIT_KEYS.mode],
      TWIN_2D_FIT_MODES,
      'contain',
    ),
    fitPadding: clamp(
      finiteOr(
        configJson[TWIN_2D_HOST_FIT_KEYS.padding],
        TWIN_2D_DEFAULT_FIT_PADDING,
      ),
      TWIN_2D_MIN_FIT_PADDING,
      TWIN_2D_MAX_FIT_PADDING,
    ),
  }
}

/**
 * 这块模块在大屏上占的格子；节点还没读出来、或宽高不是正数时给 null。
 * ⚠ 宽高非正时一律 null 而不是拿 0 去算：0 会让倍率变成 Infinity，界面上于是报出一个
 * 荒唐的倍率，而它看起来像「这张图配坏了」。
 * @param node 大屏节点上的宽高
 */
export function twin2dCellOf(
  node: { w: number; h: number } | null,
): Twin2dBox | null {
  if (node === null || node.w <= 0 || node.h <= 0) return null
  return { width: node.w, height: node.h }
}

/**
 * 当前画布与大屏格子差多少。
 * @param cell 大屏上的格子
 * @param view 缩放档与留白
 * @param canvas 当前画布尺寸
 */
export function twin2dParityOf(
  cell: Twin2dBox,
  view: Twin2dFitView,
  canvas: Twin2dBox,
): Twin2dParity {
  const [x, y] = twin2dFitScales(view, canvas, cell)
  const design = twin2dDesignSize(cell, view, canvas)
  // ⚠ 两条都要：尺寸相同才说明「点对齐也不会变」，倍率贴着 1 才说明它真的是 1:1
  // ——格子比画布下限还小时边长被夹住，尺寸看着「已经是答案」而倍率差得远
  const exact =
    design.width === canvas.width &&
    design.height === canvas.height &&
    Math.abs(x - 1) < NEAR_ONE &&
    Math.abs(y - 1) < NEAR_ONE
  return {
    design,
    scale: { x, y },
    exact,
    summary: summaryOf(exact, x, y, clippedBy(cell, canvas, x, y)),
  }
}

/**
 * 渲染出来的图有没有超出格子被裁掉。
 * ⚠ 「原尺寸」那一档倍率恒为 1，画布一旦大过格子就是真的裁掉了一块，而读数上写着
 * 「1:1 与大屏一致」——不点出来的话，用户只会看到图少了一角却不知道为什么。
 * @param cell 大屏上的格子
 * @param canvas 当前画布尺寸
 * @param x 横向倍率
 * @param y 纵向倍率
 */
function clippedBy(
  cell: Twin2dBox,
  canvas: Twin2dBox,
  x: number,
  y: number,
): boolean {
  return (
    canvas.width * x > cell.width + NEAR_ONE ||
    canvas.height * y > cell.height + NEAR_ONE
  )
}

/**
 * 画布读数那一行。
 * @param exact 是不是 1:1
 * @param x 横向倍率
 * @param y 纵向倍率
 * @param clipped 有没有被裁掉一块
 */
function summaryOf(
  exact: boolean,
  x: number,
  y: number,
  clipped: boolean,
): string {
  const head = exact ? '1:1 与大屏一致' : `上屏后 ${percent(x, y)}`
  return clipped ? `${head} · 超出格子的部分会被裁掉` : head
}

/**
 * 这个节点上还没有 2D 孪生配置时，画布的起手尺寸。
 * ⚠ 只在「这一段整个不存在」时给：已经画过的图改尺寸等于把用户摆好的位置整体挪一遍，
 * 而那不该在打开页面这一刻悄悄发生。
 * @param configJson 这个大屏节点整袋配置
 * @param key 2D 孪生那一段存在哪个键下
 * @param cell 这块模块在大屏上的格子
 */
export function twin2dSeedCanvas(
  configJson: Record<string, unknown>,
  key: string,
  cell: Twin2dBox | null,
): Twin2dBox | null {
  if (cell === null || isRecord(configJson[key])) return null
  return twin2dDesignSize(cell, twin2dHostFitView(configJson), cell)
}

/**
 * 两轴倍率写成一句话；读数上一样的两个数不写两遍。
 * @param x 横向倍率
 * @param y 纵向倍率
 */
function percent(x: number, y: number): string {
  const one = (value: number): number => Math.round(value * 100)
  const [px, py] = [one(x), one(y)]
  return px === py ? `${px}%` : `${px}% × ${py}%`
}
