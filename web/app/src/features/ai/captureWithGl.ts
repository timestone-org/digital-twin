/**
 * @fileoverview 截当前工作面给助手看，大屏画布与孪生视口共用这一份口径。
 *
 * ⚠ 与保存后的缩略图**不是一回事**：那一张是 best-effort 的装饰，失败就算了；
 * 这一张是模型要看的东西，截不到必须抛，否则助手会对着一张它以为存在的图
 * 开始点评。
 *
 * ⚠ 三维区域（WebGL canvas）截图库直接读不到：渲染器没开
 * `preserveDrawingBuffer`——那是拿每一帧的性能换一次按钮，不换。改走
 * `withGlSubstitutes` 的快照替身（见 `@dt/three-core/glCapture`）。
 */
import { withGlSubstitutes } from '@dt/three-core/glCapture'
import { toPng } from 'html-to-image'

/** 超时上限：节点多时序列化会拖秒，超过就放弃并如实说。 */
const CAPTURE_TIMEOUT_MS = 8000

/** 出图宽度（像素）。够看清版面即可——原尺寸的 base64 有十几兆。 */
const CAPTURE_WIDTH_PX = 1280

/**
 * 截一张当前画布，产出 `data:image/png;base64,...`。截不到就抛。
 * ⚠ 交出去的是**裸的 dataUrl 串**，不是包了一层的对象：服务端按前缀认图，
 * 包一层它就认不出来，于是那张图被当成一段普通文字塞进工具消息里丢掉。
 */
export async function captureCanvas(
  stage: HTMLElement | null,
): Promise<string> {
  if (stage === null) throw new Error('画布还没准备好，截不到图')
  const width = stage.offsetWidth
  if (width === 0) throw new Error('画布此刻没有宽度，截不到图')
  const dataUrl = await withTimeout(
    withGlSubstitutes(stage, () =>
      toPng(stage, {
        pixelRatio: Math.min(1, CAPTURE_WIDTH_PX / width),
        cacheBust: true,
        // ⚠ 舞台身上带着编辑器此刻的缩放，而截图库克隆节点时把计算样式原样复制
        // 过去——留着它，画布仍是设计尺寸而内容只画在左上角那一小块
        style: { transform: 'none' },
      }),
    ),
    CAPTURE_TIMEOUT_MS,
  )
  return dataUrl
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('截图超时，画布上的东西太多了'))
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
