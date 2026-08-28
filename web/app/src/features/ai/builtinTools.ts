/**
 * @fileoverview 内建客户端工具：不归任何工作面，每一页都有。
 *
 * ⚠ 不许把它们塞进各工作面的 `tools` 数组。塞进去有两个后果：一个工作面都
 * 没登记的页面（纯看板、纯列表页）就用不了，而且每新增一个工作面都要有人
 * 记得加一行——漏了的表现是「助手在那一页从不问，闷头就改」。
 *
 * ⚠ 名字与后端 `client_tool_specs.py` 逐字相同。对不上时模型看得见这个工具、
 * 调用却每次都失败，而失败的样子与「这一页没实现它」一模一样。
 */
import {
  ASSISTANT_ASK_TOOL,
  type AssistantAskOption,
  type AssistantAskRequest,
  type AssistantToolCall,
} from '@dt/contracts'

import { askUser } from './askBridge'
import { UnsupportedTool } from './surfaces'

/** 每一页都自报的那几个。 */
export const BUILTIN_CLIENT_TOOLS: readonly string[] = [ASSISTANT_ASK_TOOL]

/** 这个名字归内建表管。 */
export function isBuiltinTool(name: string): boolean {
  return BUILTIN_CLIENT_TOOLS.includes(name)
}

/**
 * 跑一个内建工具。
 * @param call 模型下发的调用
 */
export async function runBuiltinTool(
  call: AssistantToolCall,
): Promise<unknown> {
  if (call.name !== ASSISTANT_ASK_TOOL) throw new UnsupportedTool(call.name)
  return askUser(askRequestOf(call.arguments))
}

/**
 * 模型给的入参窄化成一次提问。
 * ⚠ 一个选项都没有时**抛**：没有选项的提问就是「自由提问」，而那正是这套
 * 东西要换掉的行为。抛出去模型下一轮会补上选项，静默放行则会让它一路退回去。
 * @param given 模型给的那一坨入参
 */
export function askRequestOf(
  given: Record<string, unknown>,
): AssistantAskRequest {
  const question = readText(given.question)
  const options = readOptions(given.options)
  if (question === '') throw new Error('user.ask 要给一句问题')
  if (options.length === 0) {
    throw new Error('user.ask 要给 2–6 个选项，一个都不给等于没在问')
  }
  const label = readText(given.free_text_label)
  return {
    question,
    options,
    allow_multiple: given.allow_multiple === true,
    allow_free_text: given.allow_free_text === true,
    free_text_label: label === '' ? null : label,
  }
}

/** 认不出的那几项丢掉；`value` 或 `label` 缺一不可（缺了按钮上是一片空白）。 */
function readOptions(given: unknown): AssistantAskOption[] {
  if (!Array.isArray(given)) return []
  // ⚠ 收成 `unknown[]` 再逐项判：`Array.isArray` 把 `unknown` narrow 成
  // `any[]`，直接展开每一项就把 any 放进了业务层（同 turnRunner.readCalls）
  const items: unknown[] = given
  return items.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const shape: Record<string, unknown> = { ...item }
    const value = readText(shape.value)
    const label = readText(shape.label)
    const hint = readText(shape.hint)
    if (value === '' || label === '') return []
    return [{ value, label, ...(hint === '' ? {} : { hint }) }]
  })
}

function readText(given: unknown): string {
  return typeof given === 'string' ? given : ''
}
