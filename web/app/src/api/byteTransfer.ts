/** @fileoverview 文件传输按响应等待与相邻数据块之间的空闲时间计时。 */
export class ByteTransfer {
  readonly signal: AbortSignal
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly timeoutMs: number,
    caller?: AbortSignal,
  ) {
    this.signal = caller
      ? AbortSignal.any([caller, this.controller.signal])
      : this.controller.signal
  }

  async headers(
    send: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    this.arm()
    try {
      return await send(this.signal)
    } finally {
      this.clear()
    }
  }

  async refresh(action: () => Promise<boolean>): Promise<boolean> {
    this.arm()
    const { signal } = this
    let stop: (() => void) | undefined
    try {
      return await new Promise<boolean>((resolve, reject) => {
        stop = () => {
          const reason: unknown = signal.reason
          reject(
            reason instanceof Error
              ? reason
              : new DOMException('文件下载已取消', 'AbortError'),
          )
        }
        signal.addEventListener('abort', stop, { once: true })
        void action().then(resolve, reject)
      })
    } finally {
      if (stop) signal.removeEventListener('abort', stop)
      this.clear()
    }
  }

  monitor(response: Response): Response {
    this.arm()
    if (response.body === null) return response
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (bytes, output) => {
          if (bytes.byteLength) this.arm()
          output.enqueue(bytes)
        },
      }),
      { signal: this.signal },
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  clear(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private arm(): void {
    this.signal.throwIfAborted()
    this.clear()
    this.timer = setTimeout(() => {
      this.controller.abort(
        new DOMException('等待文件数据超时', 'TimeoutError'),
      )
    }, this.timeoutMs)
  }
}
