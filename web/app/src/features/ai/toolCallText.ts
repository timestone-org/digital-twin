/**
 * @fileoverview 把模型写进正文的工具调用块从**显示**里摘掉。
 *
 * 端点该做的是解析出结构化的调用。可现场那几路小模型会退化成照训练时的写法
 * 打进正文：`<tool_call><function=kb.search><parameter=query>…`。服务端会把
 * 认得的那些捡回成真调用并从消息里摘掉（`llmcore/textcalls.py`），所以走到
 * 这里的是**它没捡的那些**——发下去的工具名里没有的、或者写在思考那一路的。
 *
 * ⚠ 摘的是显示，不是数据：`entry.text` 一个字都不动。改数据的话，回放与直播
 * 会各摘一遍，而两次摘的规矩一旦漂开就再也对不上。
 *
 * ⚠ **没闭合的也摘**。逐字流出来的那几秒里，块一直是半截的——不摘的话用户会
 * 眼睁睁看着一串尖括号一个字一个字地长出来，而那正是最难看的一段。
 */

/** 成对的那种。⚠ 非贪婪：一条消息里可能有好几块。 */
const PAIRED = /<tool_call>[\s\S]*?<\/tool_call>/g
/** 还没闭合的那一段（正在流，或者流被截断了）。 */
const UNCLOSED = /<tool_call>(?![\s\S]*?<\/tool_call>)[\s\S]*$/

/**
 * 一段正文去掉工具调用块之后剩下的样子。
 * ⚠ 没有块时**原样返回同一个字符串**：每来一个字都重算一遍，多造一份只是
 * 让流式那一条每帧都换引用。
 * @param text 原文
 */
export function withoutToolCallBlocks(text: string): string {
  if (!text.includes('<tool_call>')) return text
  return text.replace(PAIRED, '').replace(UNCLOSED, '').trim()
}
