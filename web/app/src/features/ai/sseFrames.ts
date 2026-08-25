/**
 * @fileoverview 事件流的增量解帧：喂进任意切分的文本块，吐出完整的事件。
 *
 * ⚠ 网络分块会在**任意位置**切断一帧——半个 `data:` 行、甚至半个 UTF-8 字符
 * 都可能落在两块之间。所以必须留一段未完成的缓冲，而不是每块各解各的：
 * 每块各解的话，长回答里偶尔会丢一整步，且只在网络慢的时候复现。
 *
 * ⚠ 认不出的事件名一律**跳过并如实计数**，不静默丢弃：新后端配旧前端时，
 * 「助手做了一步但界面上没有」是这套东西最难查的一类故障。
 */

/** 一个解出来的事件。`data` 的形状随 `name` 变，由调用方分支读。 */
export interface AssistantFrame {
  name: string
  data: Record<string, unknown>
}

export interface FrameReader {
  /** 喂一块文本，拿回这一块里读全了的那些帧。 */
  push: (chunk: string) => AssistantFrame[]
  /** 流结束了：把缓冲里剩下的最后一帧（如果完整）交出来。 */
  flush: () => AssistantFrame[]
  /** 解不出载荷而被跳过的帧数。取数用，不参与渲染。 */
  skipped: () => number
}

const FRAME_SEPARATOR = '\n\n'
const EVENT_PREFIX = 'event: '
const DATA_PREFIX = 'data: '

/** 造一个解帧器。一条流一个，不要跨流复用——缓冲会串味。 */
export function createFrameReader(): FrameReader {
  let buffer = ''
  let skipped = 0

  function parse(block: string): AssistantFrame | null {
    let name = ''
    let payload = ''
    for (const line of block.split('\n')) {
      if (line.startsWith(EVENT_PREFIX)) name = line.slice(EVENT_PREFIX.length)
      if (line.startsWith(DATA_PREFIX)) payload = line.slice(DATA_PREFIX.length)
    }
    if (name === '' || payload === '') return null
    const data = readObject(payload)
    if (data === null) {
      skipped += 1
      return null
    }
    return { name, data }
  }

  function drain(): AssistantFrame[] {
    const found: AssistantFrame[] = []
    let cut = buffer.indexOf(FRAME_SEPARATOR)
    while (cut !== -1) {
      const frame = parse(buffer.slice(0, cut))
      if (frame !== null) found.push(frame)
      buffer = buffer.slice(cut + FRAME_SEPARATOR.length)
      cut = buffer.indexOf(FRAME_SEPARATOR)
    }
    return found
  }

  return {
    push(chunk: string): AssistantFrame[] {
      buffer += chunk
      return drain()
    },
    flush(): AssistantFrame[] {
      const rest = buffer.trim()
      buffer = ''
      if (rest === '') return []
      const frame = parse(rest)
      return frame === null ? [] : [frame]
    },
    skipped(): number {
      return skipped
    },
  }
}

/**
 * 把一行 `data:` 读成对象；读不出给 null。
 * ⚠ 不用 `as` 断言：服务端那侧的载荷形状由契约测试锁，但反代挂了会塞进来
 * 一段 HTML，断言会让它一路流进渲染层。
 */
function readObject(payload: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(payload)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null
    }
    return { ...body }
  } catch {
    return null
  }
}
