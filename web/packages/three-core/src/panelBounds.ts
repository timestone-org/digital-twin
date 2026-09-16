/** @fileoverview 原生信息牌的局部覆盖范围，包含引线与阴影。 */
export interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
}
const BLEED_PX = 48

export function measurePanelBounds(element: HTMLElement): PanelBounds | null {
  const points: DOMPoint[] = []
  for (const child of element.children) {
    if (!(child instanceof HTMLElement) || child.offsetWidth === 0) continue
    const width = Math.max(child.offsetWidth, child.scrollWidth)
    const height = Math.max(child.offsetHeight, child.scrollHeight)
    const style = getComputedStyle(child)
    const matrix =
      style.transform === 'none'
        ? new DOMMatrix()
        : new DOMMatrix(style.transform)
    const [originX = 0, originY = 0] = style.transformOrigin
      .split(' ')
      .map(Number.parseFloat)
    const corners: readonly [number, number][] = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]
    for (const [x, y] of corners) {
      const point = new DOMPoint(x - originX, y - originY).matrixTransform(
        matrix,
      )
      point.x += child.offsetLeft + originX
      point.y += child.offsetTop + originY
      points.push(point)
    }
  }
  if (points.length === 0) return null
  const x = Math.floor(Math.min(...points.map((point) => point.x))) - BLEED_PX
  const y = Math.floor(Math.min(...points.map((point) => point.y))) - BLEED_PX
  return {
    x,
    y,
    width:
      Math.ceil(Math.max(...points.map((point) => point.x))) - x + BLEED_PX,
    height:
      Math.ceil(Math.max(...points.map((point) => point.y))) - y + BLEED_PX,
  }
}
