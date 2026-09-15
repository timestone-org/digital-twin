/** @fileoverview 信息牌 DOM 的局部边界测量与透明纹理绘制。 */
import { toCanvas } from 'html-to-image'

export interface PanelRaster {
  canvas: HTMLCanvasElement
  x: number
  y: number
  width: number
  height: number
}

export type PanelRasterizer = (
  element: HTMLElement,
) => Promise<PanelRaster | null>

/** 阴影与装饰留白，CSS px。 */
const BLEED_PX = 16

/** 测量挂点子元素在牌面内的边界，不受相机透视影响。
 * @param element 零尺寸挂点
 */
export function panelBounds(
  element: HTMLElement,
): Omit<PanelRaster, 'canvas'> | null {
  const points: DOMPoint[] = []
  for (const child of element.children) {
    if (!(child instanceof HTMLElement) || child.offsetWidth === 0) continue
    const style = getComputedStyle(child)
    const matrix =
      style.transform === 'none'
        ? new DOMMatrix()
        : new DOMMatrix(style.transform)
    const [originX = 0, originY = 0] = style.transformOrigin
      .split(' ')
      .map(Number.parseFloat)
    for (const [x = 0, y = 0] of [
      [0, 0],
      [child.offsetWidth, 0],
      [0, child.offsetHeight],
      [child.offsetWidth, child.offsetHeight],
    ]) {
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

/** 将牌面绘成透明画布，保留零尺寸挂点与引线的相对位置。
 * @param element 牌面挂点
 */
export async function rasterizePanel(
  element: HTMLElement,
): Promise<PanelRaster | null> {
  const bounds = panelBounds(element)
  if (bounds === null) return null
  const canvas = await toCanvas(element, {
    width: bounds.width,
    height: bounds.height,
    pixelRatio: 2,
    skipFonts: true,
    style: {
      width: '0px',
      height: '0px',
      position: 'relative',
      left: '0px',
      top: '0px',
      opacity: '1',
      visibility: 'visible',
      transform: `translate(${-bounds.x}px, ${-bounds.y}px)`,
      transformOrigin: '0 0',
    },
  })
  return { canvas, ...bounds }
}
