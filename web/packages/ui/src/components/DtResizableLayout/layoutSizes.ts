/** @fileoverview 可调整布局的尺寸分配、相邻区块约束与份额存档。 */
export type LayoutDirection = 'horizontal' | 'vertical'

export interface ResizablePane {
  id: string
  label?: string
  size?: number
  minSize?: number
}

export const HANDLE_SIZE_PX = 12

export function initialShares(panes: readonly ResizablePane[]): number[] {
  return panes.map((pane) => positiveNumber(pane.size, 1))
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

/** 分配可用空间，空间不足时同比收缩所有下限。 */
export function allocateSizes(
  shares: readonly number[],
  panes: readonly ResizablePane[],
  availablePx: number,
): { sizes: number[]; minimums: number[] } {
  const available = Math.max(0, availablePx)
  const requested = panes.map((pane) => positiveNumber(pane.minSize, 120))
  const minimumTotal = requested.reduce((total, size) => total + size, 0)
  const scale = minimumTotal > available ? available / minimumTotal : 1
  const minimums = requested.map((size) => size * scale)
  const maximum = shares.reduce(
    (largest, share) => Math.max(largest, positiveNumber(share, 1)),
    1,
  )
  const weights = panes.map(
    (_, index) => positiveNumber(shares[index], 1) / maximum,
  )
  const sizes = panes.map(() => 0)
  let pending = panes.map((_, index) => index)
  let remaining = available
  while (pending.length > 0) {
    const weight = pending.reduce(
      (total, index) => total + (weights[index] ?? 0),
      0,
    )
    const below = pending.filter(
      (index) =>
        (remaining * (weights[index] ?? 0)) / weight < (minimums[index] ?? 0),
    )
    if (below.length === 0) {
      for (const index of pending)
        sizes[index] = (remaining * (weights[index] ?? 0)) / weight
      break
    }
    for (const index of below) {
      sizes[index] = minimums[index] ?? 0
      remaining -= sizes[index] ?? 0
    }
    pending = pending.filter((index) => !below.includes(index))
  }
  return { sizes, minimums }
}

export function pairLimits(
  sizes: readonly number[],
  minimums: readonly number[],
  index: number,
): { min: number; max: number } {
  return {
    min: minimums[index] ?? 0,
    max: Math.max(
      minimums[index] ?? 0,
      (sizes[index] ?? 0) +
        (sizes[index + 1] ?? 0) -
        (minimums[index + 1] ?? 0),
    ),
  }
}

export function resizePair(
  sizes: readonly number[],
  minimums: readonly number[],
  index: number,
  wanted: number,
): number[] {
  if (index < 0 || index >= sizes.length - 1 || !Number.isFinite(wanted))
    return [...sizes]
  const limits = pairLimits(sizes, minimums, index)
  const next = Math.min(limits.max, Math.max(limits.min, wanted))
  return sizes.map((size, at) =>
    at === index
      ? next
      : at === index + 1
        ? (sizes[index] ?? 0) + size - next
        : size,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readShares(
  panes: readonly ResizablePane[],
  key: string | undefined,
): number[] {
  const defaults = initialShares(panes)
  if (!key) return defaults
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!isRecord(raw)) return defaults
    return panes.map((pane, index) =>
      positiveNumber(raw[pane.id], defaults[index] ?? 1),
    )
  } catch {
    return defaults
  }
}

export function writeShares(
  panes: readonly ResizablePane[],
  shares: readonly number[],
  key: string | undefined,
): void {
  if (!key) return
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        Object.fromEntries(
          panes.map((pane, index) => [
            pane.id,
            positiveNumber(shares[index], 1),
          ]),
        ),
      ),
    )
  } catch {
    // ⚠ 偏好存储不可用时仍须允许当前页面调整尺寸。
  }
}
