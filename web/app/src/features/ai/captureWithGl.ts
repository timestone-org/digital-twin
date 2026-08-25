/**
 * @fileoverview 截当前工作面给助手看，大屏画布与孪生视口共用这一份口径。
 *
 * ⚠ 与保存后的缩略图**不是一回事**：那一张是 best-effort 的装饰，失败就算了；
 * 这一张是模型要看的东西，截不到必须抛，否则助手会对着一张它以为存在的图
 * 开始点评。
 *
 * ⚠ 三维区域（WebGL canvas）截图库直接读不到：渲染器没开
 * `preserveDrawingBuffer`——那是拿每一帧的性能换一次按钮，不换。改走替身：
 * 场景在快照登记处登记了「先画一帧、当场拷进 2D 画布」的快照，截图前把它
 * 临时插进 DOM 顶掉 WebGL canvas，截完恢复。某一处快照失败（上下文丢了 /
 * 被污染）就让那一块空白，不让整张截图跟着失败。
 */
import { glSnapshotsWithin } from '@dt/three-core/glCapture'
import { toPng } from 'html-to-image'

/** 超时上限：节点多时序列化会拖秒，超过就放弃并如实说。 */
const CAPTURE_TIMEOUT_MS = 8000

/** 出图宽度（像素）。够看清版面即可——原尺寸的 base64 有十几兆。 */
const CAPTURE_WIDTH_PX = 1280

/** 一处已插进 DOM 的替身，恢复时要还的三样。 */
interface PlacedSubstitute {
  host: HTMLElement
  substitute: HTMLCanvasElement
  /** host 原来的内联 visibility；恢复时原样放回。 */
  visibility: string
}

/**
 * 对 root 下每处登记过的 WebGL 画布取快照并插替身，跑完 run 再恢复原状。
 * 替身照抄 WebGL canvas 的内联样式（它们是 absolute + inset:0 铺满宿主），
 * 插成相邻兄弟；原 canvas 只临时隐藏，不动它的位置与内容。
 * @param root 截图的根元素
 * @param run 在替身就位期间要跑的截图动作
 */
export async function withGlSubstitutes<T>(
  root: HTMLElement,
  run: () => Promise<T>,
): Promise<T> {
  const placed: PlacedSubstitute[] = []
  for (const source of glSnapshotsWithin(root)) {
    const parent = source.host.parentElement
    if (parent === null) continue
    // 快照取不到就跳过，保持原状——宁可那一块空白也不能让整张截图失败
    const substitute = source.snapshot()
    if (substitute === null) continue
    substitute.style.cssText = source.host.style.cssText
    parent.insertBefore(substitute, source.host.nextSibling)
    placed.push({
      host: source.host,
      substitute,
      visibility: source.host.style.visibility,
    })
    source.host.style.visibility = 'hidden'
  }
  try {
    return await run()
  } finally {
    for (const one of placed) {
      one.substitute.remove()
      one.host.style.visibility = one.visibility
    }
  }
}

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
