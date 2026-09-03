/**
 * @fileoverview 知识库对话这一侧的回合循环：内核在 `features/ai/turnLoop.ts`，
 * 这里只是知识库的门面。
 *
 * 与助手那个门面的差别只有三处：信封里**没有工作面**（对话不在任何一页上）；
 * 客户端工具只有内建的 `user.ask`（模型看得见的就这一个）；没有计划子系统，
 * 模型收了嘴就是收了嘴，不代用户催。
 *
 * ⚠ 信封里一格都不许多带：知识库那边的入参是 `extra="forbid"`，多一格
 * `surface_kind` 整个回合就是 400。
 */
import type { KnowledgeChatAdvanceIn, KnowledgeCitation } from '@dt/contracts'

import {
  BUILTIN_CLIENT_TOOLS,
  isBuiltinTool,
  runBuiltinTool,
} from '@/features/ai/builtinTools'
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
      envelope: () => ({ client_tools: [...BUILTIN_CLIENT_TOOLS] }),
      userText: input.userText,
      signal: input.signal,
      dispatch,
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

/** 只认内建表。别的名字一律不支持——这一页没有工作面，也就没有别的工具。 */
async function dispatch(call: Parameters<typeof runBuiltinTool>[0]) {
  if (isBuiltinTool(call.name)) return runBuiltinTool(call)
  throw new UnsupportedTool(call.name)
}
