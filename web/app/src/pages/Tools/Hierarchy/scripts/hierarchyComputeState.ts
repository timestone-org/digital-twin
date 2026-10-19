/** @fileoverview 可取消且有超时的图纸计算，卸载时终止 Worker。 */
import { useRacedFetch } from '@/composables/useRacedFetch'
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type {
  ComputeRequest,
  ComputeResponse,
  ComputeResult,
} from './computeProtocol'
import { DomainError } from './graph'
import type { Issue } from './types'

export function createState() {
  const busy = ref(false),
    error = ref(''),
    issues = shallowRef<Issue[]>([])
  const request = useRacedFetch()
  return { busy, error, issues, request }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {
    onBeforeUnmount(this.state.request.cancel)
  }
  runWorker = (
    input: ComputeRequest,
    signal: AbortSignal,
  ): Promise<ComputeResult> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('./computeWorker.ts', import.meta.url),
        { type: 'module' },
      )
      const timer = setTimeout(
        () => finish(new Error('计算超时，请减少图中元素后重试')),
        30000,
      )
      function cleanup() {
        clearTimeout(timer)
        worker.terminate()
        signal.removeEventListener('abort', abort)
      }
      function finish(reason: Error) {
        cleanup()
        reject(reason)
      }
      function abort() {
        finish(new DOMException('计算已取消', 'AbortError'))
      }
      worker.onmessage = (event: MessageEvent<ComputeResponse>) => {
        cleanup()
        if (event.data.ok) resolve(event.data.result)
        else
          reject(
            new DomainError(event.data.message, 'COMPUTE', event.data.issues),
          )
      }
      worker.onerror = () => finish(new Error('图纸计算不可用，请刷新页面'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else worker.postMessage(input)
    })
  }
  run = async (input: ComputeRequest): Promise<ComputeResult | null> => {
    this.state.busy.value = true
    this.state.error.value = ''
    this.state.issues.value = []
    let result: ComputeResult | null = null
    await this.state.request.run((signal) => this.runWorker(input, signal), {
      ok: (value) => {
        result = value
      },
      fail: (caught) => {
        this.state.error.value =
          caught instanceof Error ? caught.message : '计算失败'
        this.state.issues.value =
          caught instanceof DomainError ? caught.issues : []
      },
      settled: () => {
        this.state.busy.value = false
      },
    })
    return result
  }
}
