/**
 * @fileoverview 保存后的缩略图截取：把画布舞台渲染成 dataUrl 交给缩略图接口。
 * ⚠ best-effort：截图失败或超时**不算保存失败**——缩略图是锦上添花，
 * 让它挡保存等于让一个装饰把主流程弄挂。
 */
import { toPng } from 'html-to-image'

import { saveDashboardThumbnail } from '@/api/dashboardThumbnail'

/** 超时上限：大屏节点多时序列化可能拖秒，超过就放弃这一次。 */
const CAPTURE_TIMEOUT_MS = 3000

/** 输出宽度（像素）：缩略图卡片显示用，不必全尺寸。 */
const CAPTURE_WIDTH_PX = 640

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('截图超时'))
    }, ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * 截取舞台并上传缩略图；任何失败静默返回 false。
 * @param dashboardId 大屏 id
 * @param stage 画布舞台元素；还没挂载时给 null，直接跳过
 */
export async function captureThumbnail(
  dashboardId: string,
  stage: HTMLElement | null,
): Promise<boolean> {
  if (stage === null) return false
  const width = stage.offsetWidth
  if (width === 0) return false
  try {
    const dataUrl = await withTimeout(
      toPng(stage, {
        pixelRatio: CAPTURE_WIDTH_PX / width,
        cacheBust: true,
        // ⚠ 舞台身上带着编辑器此刻的缩放，而截图库克隆节点时把计算样式原样复制
        // 过去——留着它，画布仍是设计尺寸而内容只画在左上角那一小块，四周全是空。
        // 缩到 640 宽这件事由 pixelRatio 一个人负责。
        style: { transform: 'none' },
      }),
      CAPTURE_TIMEOUT_MS,
    )
    await saveDashboardThumbnail(dashboardId, dataUrl)
    return true
  } catch {
    return false
  }
}
