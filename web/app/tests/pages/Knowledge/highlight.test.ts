/**
 * @fileoverview 召回高亮切片：空句、中文无空格、重叠、大小写、标点，以及拼回原文不丢字。
 */
import { describe, expect, it } from 'vitest'

import { splitByQuery } from '@/pages/Knowledge/scripts/highlight'

function joined(text: string, query: string): string {
  return splitByQuery(text, query)
    .map((one) => one.text)
    .join('')
}

function hits(text: string, query: string): string[] {
  return splitByQuery(text, query)
    .filter((one) => one.isHit)
    .map((one) => one.text)
}

describe('splitByQuery', () => {
  it('空句或全是空白时整段一片、不亮', () => {
    expect(splitByQuery('主蒸汽压力 9.8 MPa', '')).toEqual([
      { text: '主蒸汽压力 9.8 MPa', isHit: false, start: 0 },
    ])
    expect(splitByQuery('主蒸汽压力', '   ')).toEqual([
      { text: '主蒸汽压力', isHit: false, start: 0 },
    ])
  })

  it('空正文出空数组，模板一片都不渲染', () => {
    expect(splitByQuery('', '压力')).toEqual([])
  })

  it('中文没有空格，按整句命中', () => {
    expect(splitByQuery('主蒸汽压力上限 9.8 MPa', '主蒸汽压力')).toEqual([
      { text: '主蒸汽压力', isHit: true, start: 0 },
      { text: '上限 9.8 MPa', isHit: false, start: 5 },
    ])
  })

  it('没命中就整段一片', () => {
    expect(splitByQuery('给水温度', '锅炉')).toEqual([
      { text: '给水温度', isHit: false, start: 0 },
    ])
  })

  it('两个词的命中区间重叠时并成一片，不出两个挨着的 mark', () => {
    expect(hits('主蒸汽压力上限 9.8 MPa', '蒸汽压力 压力上限')).toEqual([
      '蒸汽压力上限',
    ])
  })

  it('同一个词自身重叠也只亮一片', () => {
    expect(hits('aaa', 'aa')).toEqual(['aaa'])
  })

  it('忽略大小写，亮的是原文的写法', () => {
    expect(hits('额定压力 9.8 MPa，试验 12 mpa', 'mpa')).toEqual(['MPa', 'mpa'])
  })

  it('标点只用来切词，本身不算词', () => {
    expect(hits('压力上限与温度上限', '压力，温度！')).toEqual(['压力', '温度'])
    expect(hits('a. b', '.')).toEqual([])
  })

  it('整句优先于逐词：能整句命中的地方不被切碎', () => {
    expect(splitByQuery('a b a', 'a b')).toEqual([
      { text: 'a b', isHit: true, start: 0 },
      { text: ' ', isHit: false, start: 3 },
      { text: 'a', isHit: true, start: 4 },
    ])
  })

  it('多处命中逐个亮，片段拼回去就是原文', () => {
    const text = '压力高时先降压力，再看温度；压力回落后复位'
    const parts = splitByQuery(text, '压力 温度')
    expect(parts.filter((one) => one.isHit)).toHaveLength(4)
    expect(joined(text, '压力 温度')).toBe(text)
    expect(parts.map((one) => one.start)).toEqual(
      parts.map((one) => text.indexOf(one.text, one.start)),
    )
  })

  it('宽字符不丢：emoji 与全角混着也拼得回原文', () => {
    const text = '🔥 锅炉 Ａ 段超温，联锁动作'
    expect(joined(text, '锅炉 超温')).toBe(text)
    expect(hits(text, '锅炉 超温')).toEqual(['锅炉', '超温'])
  })
})
