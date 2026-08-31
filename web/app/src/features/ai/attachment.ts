/**
 * @fileoverview 附件这条链的纯逻辑：读文件成 base64、把结果收成一条「待发附件」、
 * 发送时把文本类并进那句话、图片类单独交给视觉档。
 *
 * ⚠ 文本解析放服务端：前端当初拒绝引 xlsx 解析库的理由是「几百 KB 的包体」
 * （见 pointCsv.ts 的文件头），而那条理由在服务端不成立。
 *
 * ⚠ 图**不上传去解析**：它是几兆字节，上去再原样下来纯属浪费——浏览器手里
 * 本来就有那份字节。图随消息走，白名单在 `:advance` 那条路上按**字节**判
 * （服务端 `perception/decoders/image`）。这里这道只管界面提示，
 * 拦不住直接打端点的调用方，所以它不是安全边界。
 *
 * ⚠ 分块转码，不能一口气 `String.fromCharCode(...bytes)`：几十万个参数会把
 * 调用栈撑爆，而报出来的是一句与文件毫无关系的 RangeError。
 */
import type { AssistantParsedAttachment } from '@dt/contracts'

/** 一次转码多少字节。取值只影响栈深，不影响结果。 */
const CHUNK = 8192

/**
 * 认得的图片后缀。⚠ 只用来决定「这一份走图那条路还是走解析那条路」，
 * 真正收不收由服务端按字节判——改个后缀就能骗过的检查不算检查。
 */
const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.webp']

/**
 * 服务端还没答上来时的兜底 accept。
 * ⚠ 它只是兜底，不是第二份真源：正常路径一律用 `/capabilities` 下发的那一份
 * （`acceptOf`），两份漂开的表现是「选得中的文件传上去被拒」。
 */
export const FALLBACK_ACCEPT = IMAGE_SUFFIXES.join(',')

/** 挂在输入区、还没发出去的一份附件。 */
export interface PendingAttachment {
  /** 原文件名，随内容一起进消息，模型才知道自己在看什么。 */
  name: string
  /** 给人看的一句概况。 */
  meta: string
  /** 文本类：服务端摊平后的正文；图片类为空串。 */
  text: string
  /** 图片类：完整的 data URI；文本类为空串。 */
  dataUri: string
}

/** 这一条是图还是文本。 */
export function isImage(one: PendingAttachment): boolean {
  return one.dataUri !== ''
}

/**
 * file input 的 accept；服务端没答上来时退到兜底。
 * @param suffixes `/capabilities` 下发的那一份
 */
export function acceptOf(suffixes: readonly string[]): string {
  return suffixes.length > 0 ? suffixes.join(',') : FALLBACK_ACCEPT
}

/**
 * 这个文件名该走图那条路吗。
 * @param name 原文件名
 */
export function looksLikeImage(name: string): boolean {
  const lowered = name.toLowerCase()
  return IMAGE_SUFFIXES.some((one) => lowered.endsWith(one))
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
 * 把服务端的解析结果收成一条待发附件。
 * @param name 原文件名
 * @param parsed 服务端解析结果
 */
export function toPending(
  name: string,
  parsed: AssistantParsedAttachment,
): PendingAttachment {
  return { name, meta: parsed.summary, text: parsed.text, dataUri: '' }
}

/**
 * 把一张图收成一条待发附件。
 * ⚠ meta 里明说「只这一轮看得见」：下一轮模型只剩一句占位，而用户不知道这件事
 * 的话，第二句「再看看那张图」会得到一个它自己都解释不了的答复。
 * @param file 用户挑的那个文件
 * @param base64 已经转好的 base64
 */
export function toPendingImage(file: File, base64: string): PendingAttachment {
  const type = file.type === '' ? 'image/png' : file.type
  return {
    name: file.name,
    meta: '图片 · 只这一轮看得见',
    text: '',
    dataUri: `data:${type};base64,${base64}`,
  }
}

/**
 * 发送时把**文本类**附件并进那句话。附件排在正文后面：正文是意图，附件是材料。
 * @param draft 用户敲的正文
 * @param attachments 待发附件
 */
export function withAttachments(
  draft: string,
  attachments: readonly PendingAttachment[],
): string {
  const parts = [draft.trim()]
  for (const one of attachments) {
    if (!isImage(one)) parts.push(`参考文件 ${one.name}：\n${one.text}`)
  }
  return parts.filter((part) => part !== '').join('\n\n')
}

/**
 * 发送时把图片类挑出来，单独随消息走。
 * @param attachments 待发附件
 */
export function imagesOf(attachments: readonly PendingAttachment[]): string[] {
  return attachments.filter(isImage).map((one) => one.dataUri)
}
