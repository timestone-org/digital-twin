/**
 * @fileoverview 编辑器左右两栏的宽度取值域与本地存档。
 * 纯算术单独成文件：拖拽手感只能靠手试，而「能拖到多宽」是可以钉死的。
 */

/** 哪一侧的栏。 */
export type PaneSide = 'left' | 'right'

/** 两侧栏的像素宽度。 */
export interface PaneWidths {
  left: number
  right: number
}

/** 出厂宽度，与拖拽前的版式一致。 */
export const PANE_DEFAULTS: PaneWidths = { left: 240, right: 320 }

/** 侧栏最窄。再窄模块库的卡片与属性面板的两列栅格都摆不下。 */
export const PANE_MIN_PX = 240

/** 画布至少留这么宽：拖到极限时总得还有块能编辑的地方。 */
export const CANVAS_MIN_PX = 280

/** 分隔条自己占的宽度，算可用空间时要把两条都扣掉。 */
export const SPLITTER_PX = 12

/** 键盘每按一下挪多少；按住 Shift 走粗档。 */
export const NUDGE_PX = 16
export const NUDGE_COARSE_PX = 64

export interface PaneLimits {
  min: number
  max: number
}

/**
 * 这一侧此刻能拖到的范围。
 * 上限取「容器的一半」与「扣掉另一侧和画布下限后还剩多少」里更小的那个——
 * 只卡一半的话，两侧都拖到一半画布就归零了。
 * @param total 容器总宽
 * @param otherWidth 另一侧当前宽度
 */
export function paneLimits(total: number, otherWidth: number): PaneLimits {
  const half = Math.floor(total / 2)
  const spare = total - otherWidth - CANVAS_MIN_PX - SPLITTER_PX * 2
  // ⚠ 下限兜底在最后：窗口窄到连两条 200px 都摆不开时，上限会算出比下限还小，
  // 那样 clamp 出来的值会反过来跳到一个更窄的数上
  return { min: PANE_MIN_PX, max: Math.max(PANE_MIN_PX, Math.min(half, spare)) }
}

/**
 * 把宽度收进取值域；非有限值按「回到下限」处理。
 * @param width 想要的宽度
 * @param limits 当前取值域
 */
export function clampPane(width: number, limits: PaneLimits): number {
  if (!Number.isFinite(width)) return limits.min
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)))
}

const STORAGE_KEY = 'dt.editor.panes'

function readNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : fallback
}

/** 读存档；没存过、存坏了、读不了都回出厂值。 */
export function readPaneWidths(): PaneWidths {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把编辑器带崩
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...PANE_DEFAULTS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...PANE_DEFAULTS }
    }
    const bag = parsed as Record<string, unknown>
    return {
      left: readNumber(bag.left, PANE_DEFAULTS.left),
      right: readNumber(bag.right, PANE_DEFAULTS.right),
    }
  } catch {
    return { ...PANE_DEFAULTS }
  }
}

/** 写存档。存不下就只在本次会话内有效。 */
export function writePaneWidths(widths: PaneWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    /* 同上：无痕模式写入也会抛 */
  }
}
