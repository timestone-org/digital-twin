/**
 * @fileoverview 附件这条链的纯逻辑：读文件成 base64、把解析结果收成一条
 * 「待发附件」、发送时把附件并进那句话。
 *
 * ⚠ 解析放服务端而不是前端：前端当初拒绝引 xlsx 解析库的理由是「几百 KB 的
 * 包体」（见 pointCsv.ts 的文件头），而那条理由在服务端不成立。
 *
 * ⚠ 分块转码，不能一口气 `String.fromCharCode(...bytes)`：几十万个参数会把
 * 调用栈撑爆，而报出来的是一句与文件毫无关系的 RangeError。
 */
import type { AssistantParsedTable } from '@dt/contracts'

/** 一次转码多少字节。取值只影响栈深，不影响结果。 */
const CHUNK = 8192

/** 后端认得的后缀，file input 的 accept 同一份来源。 */
export const ATTACHMENT_ACCEPT =
  '.csv,.xlsx,.xlsm,.txt,.md,.markdown,.json,.log,.yaml,.yml,.xml,.ini,.toml'

/** 挂在输入区、还没发出去的一份附件。 */
export interface PendingAttachment {
  /** 原文件名，随内容一起进消息，模型才知道自己在看什么。 */
  name: string
  /** 服务端摊平后的正文（表格是竖线表，纯文本是原文，截断说明已在其中）。 */
  text: string
  /** 给人看的一句概况。 */
  meta: string
}

/**
 * 把文件读成 base64。
 * @param file 用户挑的那个文件
 */
export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(start, start + CHUNK)))
  }
  return btoa(parts.join(''))
}

/**
 * 把解析结果收成一条待发附件。
 * @param name 原文件名
 * @param parsed 服务端解析结果
 */
export function toPending(
  name: string,
  parsed: AssistantParsedTable,
): PendingAttachment {
  const isTable = parsed.columns.length > 0
  const shape = isTable
    ? `${parsed.columns.length} 列 × ${parsed.total_rows} 行`
    : `${parsed.total_rows} 行`
  return {
    name,
    text: parsed.text,
    meta: parsed.is_truncated ? `${shape}，已截断` : shape,
  }
}

/**
 * 发送时把附件并进那句话。附件排在正文后面：正文是意图，附件是材料。
 * @param draft 用户敲的正文
 * @param attachments 待发附件
 */
export function withAttachments(
  draft: string,
  attachments: readonly PendingAttachment[],
): string {
  const parts = [draft.trim()]
  for (const one of attachments) {
    parts.push(`参考文件 ${one.name}：\n${one.text}`)
  }
  return parts.filter((part) => part !== '').join('\n\n')
}
