/** @fileoverview 将旧编辑器像素宽度偏好迁移为统一布局份额，保留旧键供旧版本读取。 */
interface LegacyEditorLayout {
  previousKey: string
  nextKey: string
  paneIds: readonly [string, string, string]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function widthOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

/** 一次性转换旧宽度偏好，保留旧键且不覆盖新存档。
 * @param options 旧键、新键与目标区块标识
 */
export function migrateLegacyEditorLayout(options: LegacyEditorLayout): void {
  try {
    const targetKey = `${options.nextKey}.horizontal.${options.paneIds.join(',')}`
    if (localStorage.getItem(targetKey) !== null) return
    const previous = localStorage.getItem(options.previousKey)
    if (previous === null) return
    const raw: unknown = JSON.parse(previous)
    if (!isRecord(raw)) return
    const left = widthOr(raw['left'], 240)
    const right = widthOr(raw['right'], 320)
    // ⚠ 新布局按比例缩放，迁移时用当前窗口扣除原导航、正文边距与分隔条作为画布参考。
    const center = Math.max(320, window.innerWidth - left - right - 124)
    localStorage.setItem(
      targetKey,
      JSON.stringify(
        Object.fromEntries(
          options.paneIds.map((id, index) => [
            id,
            [left, center, right][index],
          ]),
        ),
      ),
    )
  } catch {
    // ⚠ 偏好损坏或浏览器禁止存储时仍须能打开编辑器。
  }
}
