/**
 * @fileoverview 附件纯逻辑：解析结果收成待发条目、发送时并进那句话。
 * 并的格式是模型侧契约的一半——「参考文件 <名>：」这个抬头变了，
 * 老会话回放里的消息就与新发的长得不一样。
 */
import { describe, expect, it } from 'vitest'
import type { AssistantParsedTable } from '@dt/contracts'

import { toPending, withAttachments } from '@/features/ai/attachment'

function parsed(part: Partial<AssistantParsedTable>): AssistantParsedTable {
  return {
    columns: [],
    rows: [],
    is_truncated: false,
    total_rows: 0,
    text: '',
    ...part,
  }
}

describe('toPending', () => {
  it('表格给「列 × 行」的概况', () => {
    const one = toPending(
      '点表.csv',
      parsed({ columns: ['a', 'b'], total_rows: 40, text: 'a | b' }),
    )
    expect(one.meta).toBe('2 列 × 40 行')
  })

  it('纯文本给行数概况', () => {
    const one = toPending('巡检.txt', parsed({ total_rows: 12, text: '…' }))
    expect(one.meta).toBe('12 行')
  })

  it('截断了要在概况里说出来', () => {
    const one = toPending(
      '大表.xlsx',
      parsed({ columns: ['a'], total_rows: 999, is_truncated: true }),
    )
    expect(one.meta).toContain('已截断')
  })
})

describe('withAttachments', () => {
  it('正文在前、附件在后，各自隔一个空行', () => {
    const text = withAttachments('照这张表绑', [
      { name: '点表.csv', text: 'a | b', meta: '' },
    ])
    expect(text).toBe('照这张表绑\n\n参考文件 点表.csv：\na | b')
  })

  it('没有正文时只发附件，不带空头', () => {
    const text = withAttachments('  ', [
      { name: '巡检.txt', text: '一切正常', meta: '' },
    ])
    expect(text).toBe('参考文件 巡检.txt：\n一切正常')
  })

  it('没有附件时就是那句话本身', () => {
    expect(withAttachments('帮我绑点', [])).toBe('帮我绑点')
  })
})
