/**
 * @fileoverview 浏览器 ↔ knowledge-server 的语音输入消息契约（ADR-0038）。
 *
 * ⚠ 常量的唯一真源是后端 `apps/speech/services/protocol.py`，这里是逐字复述，
 * 由 `tests/contract/speech-protocol.contract.spec.ts` 按路径读那份 .py 比对。
 * 信封形状照 docs/agents/api-contract.md §10。
 */
import { KNOWLEDGE_BASE_URL } from '@/config/app'

/** 语音输入的 WebSocket 路径。握手报子协议 `dt.auth` + access token。 */
export const SPEECH_WS_PATH = `${KNOWLEDGE_BASE_URL}/speech/ws`

/** 客户端动作：这一句说完了，要终稿。 */
export const ACTION_STOP = 'stop'
/** 客户端动作：作废，不要终稿。 */
export const ACTION_CANCEL = 'cancel'

/** 转写阶段：在线增量拼出来的整段。 */
export const STAGE_PARTIAL = 'partial'
/** 转写阶段：当前句已用离线整句修正。 */
export const STAGE_FINAL = 'final'

/** 服务端事件：到 FunASR 那条腿已通，可以送音频了。 */
export const EVENT_READY = 'ready'
/** 服务端事件：终稿收齐，随后关 1000。 */
export const EVENT_DONE = 'done'

/** 这套部署没接语音识别，或 FunASR 连不上 / 中途断。 */
export const SPEECH_UNAVAILABLE_CLOSE_CODE = 1013

export type SpeechStage = typeof STAGE_PARTIAL | typeof STAGE_FINAL

/** 服务端一帧文本解出来的样子。 */
export type SpeechServerFrame =
  | { kind: 'ready' }
  | { kind: 'transcript'; stage: SpeechStage; text: string }
  | { kind: 'done' }
  | { kind: 'error'; code: number; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function systemFrame(event: unknown): SpeechServerFrame | null {
  if (event === EVENT_READY) return { kind: 'ready' }
  if (event === EVENT_DONE) return { kind: 'done' }
  return null
}

function transcriptFrame(payload: unknown): SpeechServerFrame | null {
  if (!isRecord(payload) || typeof payload.text !== 'string') return null
  const stage = payload.stage
  if (stage !== STAGE_PARTIAL && stage !== STAGE_FINAL) return null
  return { kind: 'transcript', stage, text: payload.text }
}

function errorFrame(frame: Record<string, unknown>): SpeechServerFrame | null {
  if (typeof frame.code !== 'number' || typeof frame.message !== 'string') {
    return null
  }
  return { kind: 'error', code: frame.code, message: frame.message }
}

/**
 * 解一帧服务端文本；解不出给 null。
 * ⚠ 不认识的帧只能忽略不能抛：抛出去会把整条连接连同正在听的这一句一起掐断。
 * @param raw 文本帧原文
 */
export function parseServerFrame(raw: string): SpeechServerFrame | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed.type === 'system') return systemFrame(parsed.event)
  if (parsed.type === 'data') return transcriptFrame(parsed.payload)
  if (parsed.type === 'error') return errorFrame(parsed)
  return null
}
