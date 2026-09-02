/**
 * @fileoverview 服务端说 ready 之前先攒着的 PCM 帧：有字节上限，满了丢最旧。
 * 浏览器开麦比中继连上 FunASR 快是常态，不攒会丢开头的字；攒而不设上限，
 * 中继卡住时内存会一直涨。
 */

export interface FrameQueue {
  push: (frame: ArrayBuffer) => void
  /** 按序取走全部，队列随之清空。 */
  drain: () => ArrayBuffer[]
  clear: () => void
  byteLength: () => number
}

/**
 * 造一个有上限的帧队列。
 * @param maxBytes 最多攒多少字节；超了从最旧的丢起，但至少留最新那一帧
 */
export function createFrameQueue(maxBytes: number): FrameQueue {
  let frames: ArrayBuffer[] = []
  let bytes = 0
  return {
    push: (frame) => {
      frames.push(frame)
      bytes += frame.byteLength
      while (bytes > maxBytes && frames.length > 1) {
        const dropped = frames.shift()
        if (dropped === undefined) break
        bytes -= dropped.byteLength
      }
    },
    drain: () => {
      const out = frames
      frames = []
      bytes = 0
      return out
    },
    clear: () => {
      frames = []
      bytes = 0
    },
    byteLength: () => bytes,
  }
}
