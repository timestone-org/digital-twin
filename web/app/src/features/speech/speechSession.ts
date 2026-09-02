/**
 * @fileoverview 一句语音输入的状态机：连线、攒帧、转写、收口，全部写成对着一个
 * `SpeechSession` 状态包的自由函数（同 `pages/KnowledgeChat/scripts` 的写法）；
 * 组合式函数 `useSpeechInput` 只负责把它绑到作用域上（ADR-0038）。
 *
 * ⚠ 不重连：一句话的连接断了就是断了，重连上去在 FunASR 那边是一段新语境，
 * 前半句永远回不来；如实报错让用户再按一次。
 * ⚠ 开麦与连线并行，ready 之前的帧攒在内存里：浏览器开麦比中继连 FunASR 快是常态。
 */
import type { Ref } from 'vue'
import {
  REALTIME_AUTH_SUBPROTOCOL,
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
} from '@dt/contracts'

import { createFrameQueue, type FrameQueue } from './frameQueue'
import { startPcmCapture, type PcmCapture } from './pcmCapture'
import {
  ACTION_CANCEL,
  ACTION_STOP,
  parseServerFrame,
  SPEECH_UNAVAILABLE_CLOSE_CODE,
  SPEECH_WS_PATH,
} from './protocol'

export type SpeechStatus =
  'idle' | 'connecting' | 'listening' | 'finishing' | 'error'

/** 一句话从开麦到收口手上的全部东西。 */
export interface SpeechSession {
  status: Ref<SpeechStatus>
  /** 到目前为止的整段转写；每帧整体替换，不在这里拼。 */
  transcript: Ref<string>
  /** 一句给人看的失败原因；空串 = 没出错。 */
  error: Ref<string>
  queue: FrameQueue
  socket: WebSocket | null
  capture: PcmCapture | null
  isReady: boolean
  /** ready 还没到就按了 stop：等攒的帧送完再说 stop。 */
  stopWanted: boolean
  finishTimer: ReturnType<typeof setTimeout> | null
}

/** ready 之前最多攒 5 s：16000 × 2 × 5。 */
const QUEUE_MAX_BYTES = 160_000
/** stop 之后等终稿的兜底；服务端自己的终稿超时是 5 s，这里要比它宽。 */
const FINISH_TIMEOUT_MS = 8_000
const LOGIN_EXPIRED = '登录态失效，重新登录后再试'

const CLOSE_MESSAGES: Record<number, string> = {
  [REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE]: LOGIN_EXPIRED,
  [SPEECH_UNAVAILABLE_CLOSE_CODE]: '这套部署的语音识别此刻不可用',
}

/**
 * 造一个空闲的状态包。
 * @param status 状态
 * @param transcript 转写
 * @param error 失败原因
 */
export function createSession(
  status: Ref<SpeechStatus>,
  transcript: Ref<string>,
  error: Ref<string>,
): SpeechSession {
  return {
    status,
    transcript,
    error,
    queue: createFrameQueue(QUEUE_MAX_BYTES),
    socket: null,
    capture: null,
    isReady: false,
    stopWanted: false,
    finishTimer: null,
  }
}

function speechUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${SPEECH_WS_PATH}`
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== ''
    ? cause.message
    : '开不了麦克风'
}

function sendAction(session: SpeechSession, action: string): void {
  if (session.socket?.readyState !== WebSocket.OPEN) return
  session.socket.send(JSON.stringify({ action }))
}

function releaseMicrophone(session: SpeechSession): void {
  const mic = session.capture
  session.capture = null
  void mic?.stop()
}

function release(session: SpeechSession): void {
  if (session.finishTimer !== null) clearTimeout(session.finishTimer)
  session.finishTimer = null
  session.isReady = false
  session.stopWanted = false
  session.queue.clear()
  // 先把引用摘掉再关：关闭事件回来时按引用认得出这是自己关的
  const open = session.socket
  session.socket = null
  open?.close()
  releaseMicrophone(session)
}

function fail(session: SpeechSession, message: string): void {
  release(session)
  session.error.value = message
  session.status.value = 'error'
}

function finish(session: SpeechSession): void {
  release(session)
  session.status.value = 'idle'
}

function onFrame(session: SpeechSession, frame: ArrayBuffer): void {
  if (session.isReady && session.socket?.readyState === WebSocket.OPEN) {
    session.socket.send(frame)
  } else {
    session.queue.push(frame)
  }
}

function onReady(session: SpeechSession): void {
  session.isReady = true
  for (const frame of session.queue.drain()) session.socket?.send(frame)
  if (session.stopWanted) sendAction(session, ACTION_STOP)
  else if (session.status.value === 'connecting') {
    session.status.value = 'listening'
  }
}

function onMessage(session: SpeechSession, raw: string): void {
  const frame = parseServerFrame(raw)
  if (frame === null) return
  if (frame.kind === 'ready') onReady(session)
  else if (frame.kind === 'transcript') session.transcript.value = frame.text
  else if (frame.kind === 'done') finish(session)
  else fail(session, frame.message)
}

function onClose(
  session: SpeechSession,
  closed: WebSocket,
  code: number,
): void {
  if (closed !== session.socket) return
  if (session.status.value === 'finishing') finish(session)
  else fail(session, CLOSE_MESSAGES[code] ?? '语音识别连接断了')
}

function connect(session: SpeechSession, token: string): void {
  const opened = new WebSocket(speechUrl(), [REALTIME_AUTH_SUBPROTOCOL, token])
  session.socket = opened
  opened.addEventListener('message', (event: MessageEvent<string>) => {
    if (opened === session.socket) onMessage(session, event.data)
  })
  opened.addEventListener('close', (event: CloseEvent) => {
    onClose(session, opened, event.code)
  })
}

async function openMicrophone(session: SpeechSession): Promise<void> {
  try {
    const opened = await startPcmCapture((frame) => onFrame(session, frame))
    // 等麦克风授权的这段时间里用户可能已经取消了
    if (session.socket === null) void opened.stop()
    else session.capture = opened
  } catch (cause) {
    if (session.socket !== null) fail(session, messageOf(cause))
  }
}

/**
 * 开始听：连线与开麦并行。
 * @param session 状态包
 * @param accessToken 此刻的登录态；null 直接报登录态失效
 */
export async function startSession(
  session: SpeechSession,
  accessToken: string | null,
): Promise<void> {
  const { status } = session
  if (status.value !== 'idle' && status.value !== 'error') return
  session.error.value = ''
  session.transcript.value = ''
  if (accessToken === null) {
    fail(session, LOGIN_EXPIRED)
    return
  }
  status.value = 'connecting'
  connect(session, accessToken)
  await openMicrophone(session)
}

/**
 * 这一句说完了：送 stop、停麦、等终稿。
 * @param session 状态包
 */
export function stopSession(session: SpeechSession): void {
  const { status } = session
  if (status.value !== 'connecting' && status.value !== 'listening') return
  // ready 还没到就先记下：到了先把攒的帧送完再说 stop，否则开头的字全丢
  if (session.isReady) sendAction(session, ACTION_STOP)
  else session.stopWanted = true
  releaseMicrophone(session)
  status.value = 'finishing'
  session.finishTimer = setTimeout(() => finish(session), FINISH_TIMEOUT_MS)
}

/**
 * 作废：送 cancel、全部清理、转写清空。
 * @param session 状态包
 */
export function cancelSession(session: SpeechSession): void {
  if (session.status.value === 'idle') return
  sendAction(session, ACTION_CANCEL)
  release(session)
  session.transcript.value = ''
  session.status.value = 'idle'
}
