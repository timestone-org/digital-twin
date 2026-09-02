/**
 * @fileoverview 开麦并把声音变成 16 kHz int16 PCM 帧：getUserMedia → AudioContext →
 * AudioWorklet（`pcmCapture.worklet.ts`），主线程只收现成的 ArrayBuffer。
 *
 * ⚠ 麦克风只在安全上下文（HTTPS 或 localhost）里开放，这是浏览器的规矩，与
 * 本站部署无关；http:// 的现场地址要先给边缘配 TLS（ADR-0038）。
 */
import { FRAME_BYTES, PCM_CAPTURE_PROCESSOR, TARGET_SAMPLE_RATE } from './pcm'
// ⚠ 走 `?worker&url` 而不是 `new URL('./x.worklet.ts', import.meta.url)`：后者
// Vite 只当它是静态资源，构建产物里是一段 `data:video/mp2t;base64,…` 的**原始
// TypeScript**，addModule 一执行就是语法错误；`?worker&url` 才会把它打成独立的 JS
import workletUrl from './pcmCapture.worklet.ts?worker&url'

export { downsampleSpan, downsampleToInt16 } from './pcm'

/** 一路开着的采集。 */
export interface PcmCapture {
  /** 断开节点、停掉轨道、关掉上下文。可重复调。 */
  stop: () => Promise<void>
}

export type PcmFrameHandler = (frame: ArrayBuffer) => void

interface CaptureGraph {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
}

/** 这个页面此刻开不了麦的原因；能开给 null。 */
export function microphoneBlocker(): string | null {
  if (window.isSecureContext === false) {
    return `浏览器只在 HTTPS 或 localhost 页面上开放麦克风，这个地址是 ${window.location.protocol}//`
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return '这个浏览器不支持麦克风采集'
  }
  return null
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

async function buildGraph(
  stream: MediaStream,
  onFrame: PcmFrameHandler,
): Promise<CaptureGraph> {
  const context = new AudioContext()
  try {
    await context.audioWorklet.addModule(workletUrl)
  } catch (cause) {
    await context.close()
    throw cause
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, PCM_CAPTURE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions: {
      targetRate: TARGET_SAMPLE_RATE,
      frameBytes: FRAME_BYTES,
    },
  })
  node.port.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) onFrame(event.data)
  }
  source.connect(node)
  // ⚠ 不接到 destination 上，Safari 不会调度这个节点；worklet 从不写输出，
  // 所以接上也听不到自己的回声
  node.connect(context.destination)
  return { context, source, node }
}

/**
 * 开麦。拿到的每一帧是 16 kHz 单声道 int16 小端 PCM，60 ms 一帧。
 * @param onFrame 每攒够一帧调一次
 */
export async function startPcmCapture(
  onFrame: PcmFrameHandler,
): Promise<PcmCapture> {
  const blocker = microphoneBlocker()
  if (blocker !== null) throw new Error(blocker)
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
  let graph: CaptureGraph
  try {
    graph = await buildGraph(stream, onFrame)
  } catch (cause) {
    stopTracks(stream)
    throw cause
  }
  // 由点击触发时它已经是 running；保险起见仍问一句，suspended 的上下文不出帧
  if (graph.context.state === 'suspended') await graph.context.resume()
  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      graph.node.port.onmessage = null
      graph.node.disconnect()
      graph.source.disconnect()
      stopTracks(stream)
      if (graph.context.state !== 'closed') await graph.context.close()
    },
  }
}
