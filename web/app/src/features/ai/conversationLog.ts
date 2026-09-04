/**
 * @fileoverview 对话面板上那一条时间线的状态：用户说的、助手说的、助手想的、
 * 助手做的每一步。纯函数，进出都是新的一份。
 *
 * ⚠ 抽出来不只是为了组合式函数的行数：**流式与分段的规矩全在这里**。
 * 「新来的一小块该接在上一条后面，还是另起一条」错一次的表现是助手的话被
 * 切成几十个气泡，或者两轮的话粘成一大坨——而这两种都只在真模型逐字吐字时
 * 才复现，本地用假件一次都碰不到。
 *
 * ⚠ 一路只有一条在长。步骤一插进来就把两路都**收口**：那一步之后模型说的话
 * 属于新的一段，接在旧气泡后面读起来像它在自言自语中途插了个动作。
 */
import type {
  AssistantAskAnswer,
  AssistantAskRequest,
  AssistantDeltaChannel,
  KnowledgeCitation,
} from '@dt/contracts'

import type { RunnerStep } from './turnRunner'

/**
 * 界面上的一条。
 * `reasoning` 是模型想的过程——⚠ 它**不落库**，重开会话就没有了。
 */
export type ChatRole =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'step'
  /** 助手在问用户拿主意，等他点（`features/ai/askQueue.ts`）。 */
  | 'ask'
  /** 界面自己说的一句话（「已停下」这类），不是模型说的，也不是失败。 */
  | 'note'
  /** 这一轮答案真正用到的那几条依据（知识库对话才有）。 */
  | 'citations'
  | 'error'

/**
 * 时间线上的一次提问。
 * ⚠ `answer` 为 null 才是「还等着」：卡片据它决定摆不摆那排按钮，而回合
 * 也正停在这一条上。答过之后就地收起，只留一行「你选了：…」。
 */
export interface AskEntry {
  request: AssistantAskRequest
  answer: AssistantAskAnswer | null
}

export interface ChatEntry {
  id: string
  role: ChatRole
  text: string
  step?: RunnerStep
  ask?: AskEntry
  /**
   * 答案真正用到的那几条依据。
   * ⚠ 只在 `role === 'citations'` 时有值；空数组不会产生这一条——
   * 「这次没有引用」与「引用是空的」在界面上要是同一件事。
   */
  citations?: readonly KnowledgeCitation[]
  /** 还在逐字长。界面据它画光标、并且**不许折起来**。 */
  isStreaming?: boolean
}

/** 一条时间线，加上两路各自正在长的那一条。 */
export interface ConversationLog {
  entries: readonly ChatEntry[]
  /** 正在长的那一条的 id；没有就是 null。 */
  openText: string | null
  openReasoning: string | null
  /**
   * 这一轮**流出来过**正文的那一条的 id；一个字都没流出来时是 null。
   *
   * ⚠ 与 `openText` 分开是必须的：步骤一来就把 `openText` 收口了（那之后模型
   * 说的话是新的一段），而服务端在最后一次作答之后**必定**发一步「给出答复」，
   * 排在正文之后、`turn.done` 之前。拿 `openText` 判「流没流过字」的表现是
   * 整段答复被又补一遍，界面上同一段话出现两次——而刷新之后反而正常，因为
   * 回放读的是库里那一条。
   */
  saidTextId: string | null
}

let seed = 0

function nextId(): string {
  seed += 1
  return `e${seed}`
}

/**
 * 往时间线上添一条引用。
 * ⚠ 空数组直接原样返回：「这次没有引用」与「引用是空的」在界面上是同一件事，
 * 而多一条空卡片会让用户以为出了什么问题。
 * @param log 当前时间线
 * @param citations 这一轮真正用到的那几条
 */
export function withCitations(
  log: ConversationLog,
  citations: readonly KnowledgeCitation[],
): ConversationLog {
  if (citations.length === 0) return log
  return {
    ...log,
    entries: [
      ...log.entries,
      { id: nextId(), role: 'citations', text: '', citations },
    ],
  }
}

/** 空的时间线。 */
export function emptyLog(): ConversationLog {
  return {
    entries: [],
    openText: null,
    openReasoning: null,
    saidTextId: null,
  }
}

/**
 * 添一条完整的话。
 * ⚠ 先收口再添：正在长的那一条与新添的这一条不是同一段。
 * @param log 当前时间线
 * @param role 谁说的
 * @param text 说了什么
 */
export function withSaid(
  log: ConversationLog,
  role: ChatRole,
  text: string,
): ConversationLog {
  const sealedLog = sealed(log)
  return {
    ...sealedLog,
    entries: [...sealedLog.entries, { id: nextId(), role, text }],
    // 整条添进来的话是回合之外的一段（用户发话、界面提示、补上的整段答复），
    // 「这一轮流过字没有」到此为止
    saidTextId: null,
  }
}

/**
 * 接住模型吐出来的一小块。
 * @param log 当前时间线
 * @param channel 走哪一路
 * @param text 这一小块
 */
export function withDelta(
  log: ConversationLog,
  channel: AssistantDeltaChannel,
  text: string,
): ConversationLog {
  if (text === '') return log
  const openId = channel === 'reasoning' ? log.openReasoning : log.openText
  if (openId === null) return started(log, channel, text)
  return { ...log, entries: appended(log.entries, openId, text) }
}

/**
 * 添一步。
 * ⚠ 步骤会把两路都收口：这一步之后模型说的话是新的一段。
 * @param log 当前时间线
 * @param step 这一步
 */
export function withStep(
  log: ConversationLog,
  step: RunnerStep,
): ConversationLog {
  const sealedLog = sealed(log)
  return {
    ...sealedLog,
    entries: withImagesCapped([
      ...sealedLog.entries,
      { id: nextId(), role: 'step', text: step.title, step },
    ]),
  }
}

/**
 * 摆一次提问，等用户点。
 * ⚠ 与步骤同样先收口：问题之后模型说的话是新的一段。
 * ⚠ id 由调用方给（`askQueue` 那边要拿它认回自己等的是哪一次），所以
 * 它走的是 `a…` 而不是这里的 `e…`，两个序列撞不到一起。
 * @param log 当前时间线
 * @param id 这一次提问的 id
 * @param request 问题与选项
 */
export function withAsk(
  log: ConversationLog,
  id: string,
  request: AssistantAskRequest,
): ConversationLog {
  const sealedLog = sealed(log)
  return {
    ...sealedLog,
    entries: [
      ...sealedLog.entries,
      {
        id,
        role: 'ask',
        text: request.question,
        ask: { request, answer: null },
      },
    ],
  }
}

/**
 * 把用户的回答落到那一条提问上；找不到就原样返回。
 * ⚠ 只落一次：第二次落进来的会被挡掉——挂着的提问被掐掉的同时用户正好点了
 * 一下时，两条答案会一起到，而回合只收得下第一条。
 * @param log 当前时间线
 * @param id 哪一次提问
 * @param answer 用户给的回答
 */
export function withAnswered(
  log: ConversationLog,
  id: string,
  answer: AssistantAskAnswer,
): ConversationLog {
  return {
    ...log,
    entries: log.entries.map((entry) =>
      entry.id === id && entry.ask !== undefined && entry.ask.answer === null
        ? { ...entry, ask: { ...entry.ask, answer } }
        : entry,
    ),
  }
}

/**
 * 时间线上最多留几张截图的原图。
 * ⚠ 有上限：一张 1280 宽的截图 base64 之后是几百 KB，而一次「看图提建议」
 * 常常连截好几张。不封顶的话，开着聊半小时的标签页会吃掉几百兆。
 */
export const MAX_KEPT_IMAGES = 6

/** 从最新往回数，超出上限的那些图丢掉，只留一句「已释放」。 */
function withImagesCapped(entries: ChatEntry[]): ChatEntry[] {
  let seen = 0
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry?.step?.image === undefined) continue
    seen += 1
    if (seen <= MAX_KEPT_IMAGES) continue
    entries[at] = { ...entry, step: withoutImage(entry.step) }
  }
  return entries
}

function withoutImage(step: RunnerStep): RunnerStep {
  // ⚠ 真的把这一格摘掉，而不是赋 undefined：`exactOptionalPropertyTypes` 下
  // 「有这一格但值是 undefined」与「没有这一格」不是一回事，而那几百 KB
  // 只有真摘掉才会被回收
  const next: RunnerStep = { ...step, isImageDropped: true }
  delete next.image
  return next
}

/** 模型收了嘴却一个字都没说时，界面上留的那句话。 */
export const SAID_NOTHING = '模型这一轮没有给出答复，再问一次试试。'

/**
 * 回合结束：把没长完的收口，并在**一个字都没流出来**时补上整段答复。
 * ⚠ 流出来过就不补：补了会让同一段话在界面上出现两遍，而这只在真模型上
 * 才看得见——假件是一次性回全的，两条路在本地长得一模一样。
 * ⚠ 一个字都没流出来、整段答复又是空的时候**要留一句话**：回合确实结束了
 * （等浏览器那一档走的是另一帧），而界面上什么都不添的表现是「问完之后什么
 * 也没发生」——用户分不清是它在想、是坏了、还是自己没点上。实测小模型会把
 * 话全说进思考那一路然后收嘴。
 * @param log 当前时间线
 * @param reply 服务端给的整段答复
 */
export function withReply(
  log: ConversationLog,
  reply: string,
): ConversationLog {
  if (log.saidTextId !== null) return { ...sealed(log), saidTextId: null }
  if (reply === '') return withSaid(log, 'note', SAID_NOTHING)
  return withSaid(log, 'assistant', reply)
}

/** 把正在长的那两条都收口。 */
export function sealed(log: ConversationLog): ConversationLog {
  if (log.openText === null && log.openReasoning === null) return log
  const open = new Set([log.openText, log.openReasoning])
  return {
    ...log,
    entries: log.entries.map((entry) =>
      open.has(entry.id) ? { ...entry, isStreaming: false } : entry,
    ),
    openText: null,
    openReasoning: null,
  }
}

function started(
  log: ConversationLog,
  channel: AssistantDeltaChannel,
  text: string,
): ConversationLog {
  const id = nextId()
  const role: ChatRole = channel === 'reasoning' ? 'reasoning' : 'assistant'
  const entries = [...log.entries, { id, role, text, isStreaming: true }]
  // ⚠ 正文那一路要同时记进 `saidTextId`：收口之后 `openText` 就没了，而
  // 回合收尾时要问的是「这一轮流过字没有」
  return channel === 'reasoning'
    ? { ...log, entries, openReasoning: id }
    : { ...log, entries, openText: id, saidTextId: id }
}

function appended(
  entries: readonly ChatEntry[],
  id: string,
  text: string,
): ChatEntry[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, text: entry.text + text } : entry,
  )
}

/** 只给测试用：让条目 id 回到起点。 */
export function __resetEntryIds(): void {
  seed = 0
}
