/**
 * @fileoverview 知识库对话的回合门面：反问、资料引用与采集客户端工具。
 * 通用循环见 features/ai/turnLoop.ts，实时卡片契约见 KNOWLEDGE_LIVE_DATA_DESIGN.md。
 */
import type { KnowledgeChatAdvanceIn, KnowledgeCitation } from '@dt/contracts'

import {
  BUILTIN_CLIENT_TOOLS,
  isBuiltinTool,
  runBuiltinTool,
} from '@/features/ai/builtinTools'
import { LIVE_TOOLS, runLiveTool } from './liveTools'
import { UnsupportedTool } from '@/features/ai/surfaces'
import { runLoop, type LoopSink } from '@/features/ai/turnLoop'

export type { LoopSink as KnowledgeRunnerSink } from '@/features/ai/turnLoop'

/** 推进一个回合，逐块交出事件流。 */
export type KnowledgeAdvanceStream = (
  sessionId: string,
  body: KnowledgeChatAdvanceIn,
  signal?: AbortSignal,
) => AsyncGenerator<string>

/**
 * 一次往返的上限。这里的一轮 = 一次反问：检索几次是服务端一个回合里的事，
 * 不占往返。问二十次还没问清，该交还给人了。
 */
export const MAX_ROUNDS = 20

export interface KnowledgeRunnerInput {
  advance: KnowledgeAdvanceStream
  sessionId: string
  userText: string
  signal?: AbortSignal | undefined
  /**
   * 服务端刚给这个会话自动起了标题。
   * ⚠ 只有首轮会来一帧：起过名的会话不再起（后端只在标题为空时起）。
   */
  onTitled?: ((title: string, rowVersion: number) => void) | undefined
  /**
   * 这一轮答案真正用到的那几条依据。
   * ⚠ 一条都没用到时**不会来这一帧**：服务端不发空表。
   */
  onCited?: ((items: readonly KnowledgeCitation[]) => void) | undefined
}

/**
 * 跑完一个回合，中途把每一步交给 `sink`。
 * @param input 从哪推进、说了什么
 * @param sink 事件交给谁
 */
export async function runKnowledgeTurn(
  input: KnowledgeRunnerInput,
  sink: LoopSink,
): Promise<void> {
  await runLoop<KnowledgeChatAdvanceIn>(
    {
      advance: input.advance,
      sessionId: input.sessionId,
      envelope: () => ({
        client_tools: [...BUILTIN_CLIENT_TOOLS, ...LIVE_TOOLS],
      }),
      userText: input.userText,
      signal: input.signal,
      dispatch: (call) => dispatch(call, input.signal),
      maxRounds: MAX_ROUNDS,
      onFrame: (name, data) => {
        if (name === 'session_titled') titled(input, data)
        if (name === 'citations') cited(input, data)
      },
    },
    sink,
  )
}

/**
 * `session_titled` 那一帧摊开交给页面。
 * ⚠ 逐格判类型不写 `as`：这一帧来自后端，而给后端数据写断言是被闸门拦的。
 * @param input 这一次的入参（拿它的回调）
 * @param data 帧里那一坨
 */
function titled(input: KnowledgeRunnerInput, data: Record<string, unknown>) {
  const title = data.title
  const version = data.row_version
  if (typeof title !== 'string' || title === '') return
  input.onTitled?.(title, typeof version === 'number' ? version : 0)
}

/**
 * `citations` 那一帧摊开交给页面。
 * ⚠ 逐格判类型不写 `as`：这一帧来自后端，而给后端数据写断言是被闸门拦的。
 * @param input 这一次的入参（拿它的回调）
 * @param data 帧里那一坨
 */
function cited(input: KnowledgeRunnerInput, data: Record<string, unknown>) {
  const raw = data.items
  if (!Array.isArray(raw)) return
  const made = raw.filter(isCitation)
  if (made.length > 0) input.onCited?.(made)
}

/** 一条依据长得对不对。⚠ 只认必需的那几格：少一格就画不出那一行。 */
function isCitation(one: unknown): one is KnowledgeCitation {
  if (typeof one !== 'object' || one === null) return false
  const row: Record<string, unknown> = { ...one }
  return (
    typeof row.marker === 'string' &&
    typeof row.chunk_id === 'string' &&
    typeof row.document_title === 'string' &&
    typeof row.where === 'string'
  )
}

/** 派发内建反问与已登记的只读采集工具。 */
async function dispatch(
  call: Parameters<typeof runBuiltinTool>[0],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (LIVE_TOOLS.some((name) => name === call.name))
    return runLiveTool(call, signal)
  if (isBuiltinTool(call.name)) return runBuiltinTool(call)
  throw new UnsupportedTool(call.name)
}
