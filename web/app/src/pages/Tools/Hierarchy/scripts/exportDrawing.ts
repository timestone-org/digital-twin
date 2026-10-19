/** @fileoverview 整张标准图的 SVG、PNG 下载与矢量 PDF 打印。 */
import type { Drawing } from './types'

export function filename(title: string): string {
  return (
    [...title]
      .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 80) || '层级图'
  )
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
export function svgBlob(drawing: Drawing): Blob {
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', drawing.svg], {
    type: 'image/svg+xml;charset=utf-8',
  })
}
export function ensureRasterSize(drawing: Drawing): number {
  const area = drawing.width * drawing.height
  if (area > 80_000_000 || drawing.height > 20000)
    throw new Error('图纸过大，请使用 SVG 导出完整矢量内容')
  return area <= 20_000_000 ? 2 : 1
}
export async function pngBlob(drawing: Drawing): Promise<Blob> {
  const scale = ensureRasterSize(drawing),
    image = new Image()
  const url = URL.createObjectURL(svgBlob(drawing))
  try {
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(drawing.width * scale)
    canvas.height = Math.ceil(drawing.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建导出画布')
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('PNG 导出失败，请使用 SVG')),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
export async function printDrawing(
  target: Window,
  drawing: Drawing,
  title: string,
): Promise<void> {
  ensureRasterSize(drawing)
  target.document.title = title
  const style = target.document.createElement('style')
  style.textContent = `@page{size:${drawing.width}px ${drawing.height}px;margin:0}html,body{margin:0;padding:0;background:white}svg{display:block}`
  target.document.head.append(style)
  const parsed = new DOMParser().parseFromString(drawing.svg, 'image/svg+xml')
  if (parsed.querySelector('parsererror')) throw new Error('图纸无法打印')
  target.document.body.replaceChildren(
    target.document.importNode(parsed.documentElement, true),
  )
  await target.document.fonts.ready
  target.focus()
  target.print()
}
