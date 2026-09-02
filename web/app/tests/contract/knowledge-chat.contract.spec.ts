/**
 * @fileoverview 知识库对话前后端要对上的两样：反问工具的名字、自报的工具清单。
 *
 * ⚠ 名字对不上的表现是模型看得见 `user.ask`、调用却每次都失败，而失败的样子
 * 与「这一页没实现它」一模一样。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSISTANT_ASK_TOOL } from '@dt/contracts'

import { BUILTIN_CLIENT_TOOLS } from '@/features/ai/builtinTools'

const CLIENT_PY = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'knowledge-server',
  'src',
  'knowledge_server',
  'apps',
  'chat',
  'services',
  'tools',
  'client.py',
)

describe('知识库对话的客户端工具', () => {
  it('后端登记的反问工具名与前端实现的逐字相同', () => {
    // ⚠ 不用正则字面量：闸门按文本切用例块，字面量里的引号会把它骗成「没断言」
    const line = readFileSync(CLIENT_PY, 'utf8')
      .split('\n')
      .find((one) => one.startsWith('ASK_TOOL = '))

    expect(line).toBe(`ASK_TOOL = "${ASSISTANT_ASK_TOOL}"`)
  })

  it('这一页自报的客户端工具只有反问那一个', () => {
    // ⚠ 多报一个，模型会调，而这一页渲染不出来；少报了模型就只能在正文里问
    expect([...BUILTIN_CLIENT_TOOLS]).toEqual([ASSISTANT_ASK_TOOL])
  })
})
