/**
 * @fileoverview 勾中的节点 → 待建点位草稿：推编码、判合法、装成提交体。
 *
 * ⚠ 这里钉住的是「中文命名的现场也建得出点位」：编码推不出来时留空等人填，
 * 绝不把节点丢掉——丢掉的表现是用户勾了 10 个、一个也没进去。
 */
import { describe, expect, it } from 'vitest'
import type { CollectBrowseItem } from '@dt/contracts'

import {
  toNodes,
  variableIndex,
} from '@/pages/Collect/Opcua/scripts/browseTree'
import {
  codeProblems,
  toDrafts,
  toPointItems,
} from '@/pages/Collect/Opcua/scripts/importDrafts'
import type { ImportDraft } from '@/pages/Collect/Opcua/scripts/importDrafts'

function browsed(
  address: string,
  overrides: Partial<CollectBrowseItem> = {},
): CollectBrowseItem {
  return {
    address,
    name: address,
    has_children: false,
    is_variable: true,
    data_type: null,
    ...overrides,
  }
}

const NODES = toNodes([
  browsed('ns=2;s=A.Temp', { name: '温度', data_type: 'float' }),
  browsed('ns=2;s=B.Temp', { name: '温度二', data_type: 'float' }),
  browsed('ns=2;s=测试.出口温度', { name: '出口温度' }),
  browsed('ns=2;s=C.Note', { name: '备注', data_type: 'string' }),
])
const INDEX = variableIndex(NODES)

/** 只认得这两个词的转写，够用来钉口径。 */
function romanize(text: string): string {
  return text === '出口温度' ? 'chu_kou_wen_du' : ''
}

function draft(code: string, address = 'ns=2;s=A.Temp'): ImportDraft {
  return { address, name: '温度', code, fieldType: 'float' }
}

describe('勾中的节点转成草稿', () => {
  it('名字来自节点、寻址串原样带过去、类型来自现场', () => {
    expect(toDrafts(['ns=2;s=C.Note'], INDEX, new Set())).toEqual([
      {
        address: 'ns=2;s=C.Note',
        name: '备注',
        code: 'note',
        fieldType: 'string',
      },
    ])
  })

  it('同批里撞码时挂序号，不让整批被 400 打回', () => {
    const drafts = toDrafts(
      ['ns=2;s=A.Temp', 'ns=2;s=B.Temp'],
      INDEX,
      new Set(),
    )
    expect(drafts.map((one) => one.code)).toEqual(['temp', 'temp_2'])
  })

  it('与库里已有的编码撞了同样挂序号', () => {
    const drafts = toDrafts(
      ['ns=2;s=A.Temp'],
      INDEX,
      new Set(['temp', 'temp_2']),
    )
    expect(drafts[0]?.code).toBe('temp_3')
  })

  it('⚠ 中文名的节点照样进草稿，编码按转写推出来', () => {
    const drafts = toDrafts(
      ['ns=2;s=测试.出口温度'],
      INDEX,
      new Set(),
      romanize,
    )
    expect(drafts.map((one) => one.code)).toEqual(['chu_kou_wen_du'])
  })

  it('⚠ 转写不出来时编码留空，但节点**不许**被丢掉', () => {
    const drafts = toDrafts(['ns=2;s=测试.出口温度'], INDEX, new Set())
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.code).toBe('')
  })

  it('现场没读到类型时留 null，由整批那一档兜', () => {
    const drafts = toDrafts(['ns=2;s=测试.出口温度'], INDEX, new Set())
    expect(drafts[0]?.fieldType).toBeNull()
  })

  it('不在索引里的地址（比如对象节点）直接忽略', () => {
    expect(toDrafts(['ns=2;s=Nope'], INDEX, new Set())).toEqual([])
  })
})

describe('编码逐条判合法', () => {
  it('合法的编码没有毛病', () => {
    expect(codeProblems([draft('outlet_temp')], new Set()).size).toBe(0)
  })

  it('空编码要人填，且说清是为什么', () => {
    const found = codeProblems([draft('')], new Set())
    expect(found.get('ns=2;s=A.Temp')).toContain('必填')
  })

  it('中文与空格这类字符不合规——后端的 Code 只收 ASCII 标识串', () => {
    expect(codeProblems([draft('出口温度')], new Set()).size).toBe(1)
    expect(codeProblems([draft('outlet temp')], new Set()).size).toBe(1)
  })

  it('不许以点或下划线开头', () => {
    expect(codeProblems([draft('_temp')], new Set()).size).toBe(1)
  })

  it('超过 64 个字符要报出来，不然整批 422', () => {
    expect(codeProblems([draft('a'.repeat(65))], new Set()).size).toBe(1)
  })

  it('本批里撞码的那一行指到跟谁撞了', () => {
    const found = codeProblems(
      [draft('temp'), draft('temp', 'ns=2;s=B.Temp')],
      new Set(),
    )
    expect(found.get('ns=2;s=B.Temp')).toContain('第 1 行')
  })

  it('⚠ 与库里已有的撞码也要拦：后端一批原子，一条 409 是整批被拒', () => {
    const found = codeProblems([draft('temp')], new Set(['temp']))
    expect(found.get('ns=2;s=A.Temp')).toContain('已经有点位用了')
  })

  it('两头的空白不算数，按去空白后的编码判', () => {
    expect(codeProblems([draft('  temp  ')], new Set()).size).toBe(0)
  })
})

describe('草稿装成提交体', () => {
  const DEFAULTS = {
    fallbackType: 'int',
    samplingIntervalMs: 500,
    archiveEnabled: true,
    deadband: 0.5,
    retentionDays: 30,
  } as const

  it('整批的设置套到每一项上，编码去两头空白', () => {
    expect(toPointItems([draft('  temp ')], DEFAULTS)).toEqual([
      {
        code: 'temp',
        name: '温度',
        address: 'ns=2;s=A.Temp',
        data_type: 'float',
        sampling_interval_ms: 500,
        archive_enabled: true,
        deadband: 0.5,
        archive_retention_days: 30,
      },
    ])
  })

  it('现场读到了类型就用现场的，兜底那一档只管没读到的', () => {
    const rows: ImportDraft[] = [
      { address: 'a', name: 'A', code: 'a', fieldType: 'string' },
      { address: 'b', name: 'B', code: 'b', fieldType: null },
    ]
    expect(toPointItems(rows, DEFAULTS).map((one) => one.data_type)).toEqual([
      'string',
      'int',
    ])
  })

  it('不记历史时死区归零、保留期落 null', () => {
    const items = toPointItems([draft('temp')], {
      ...DEFAULTS,
      archiveEnabled: false,
    })
    expect(items[0]?.deadband).toBe(0)
    expect(items[0]?.archive_retention_days).toBeNull()
  })

  it('保留期 0 是「跟随全局策略」，落成 null 而不是 0', () => {
    const items = toPointItems([draft('temp')], {
      ...DEFAULTS,
      retentionDays: 0,
    })
    expect(items[0]?.archive_retention_days).toBeNull()
  })
})
