/**
 * @fileoverview 点位 CSV 的解析、模板与回写。
 *
 * ⚠ 这一层的每条用例都对着一种「静默出错数」：BOM、逗号、认不出的枚举、
 * 撞码。它们都不会让程序崩，只会让一份看起来正常的点表建出错的点位。
 */
import { describe, expect, it } from 'vitest'
import type { CollectPoint } from '@dt/contracts'

import {
  CSV_COLUMNS,
  duplicatedCodes,
  parsePointCsv,
  pointsToCsv,
  splitCsvLine,
  templateCsv,
} from '@/pages/Collect/Opcua/scripts/pointCsv'

const BOM = '﻿'
const HEADER = '点位编码,名称,寻址串,数据类型,单位,采样周期(ms)'

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('拆行', () => {
  it('普通逗号切成几格', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('引号里的逗号不切——寻址串里带逗号是常事', () => {
    expect(splitCsvLine('a,"ns=2;s=A,B",c')).toEqual(['a', 'ns=2;s=A,B', 'c'])
  })

  it('引号里的两个连引号还原成一个', () => {
    expect(splitCsvLine('"他说""好""",b')).toEqual(['他说"好"', 'b'])
  })

  it('结尾的空格子留着，不悄悄少一列', () => {
    expect(splitCsvLine('a,b,')).toEqual(['a', 'b', ''])
  })
})

describe('表头', () => {
  it('带 BOM 的表头照样认得出——不剥它就整表判成缺列', () => {
    const result = parsePointCsv(
      `${BOM}${csv('t1,温度,ns=2;s=T1,float,℃,1000')}`,
    )
    expect(result.fatal).toBeNull()
    expect(result.rows[0]?.item?.code).toBe('t1')
  })

  it('英文字段名当表头也认', () => {
    const result = parsePointCsv('code,name,address\nt1,温度,ns=2;s=T1')
    expect(result.fatal).toBeNull()
  })

  it('缺必填列时整表拒绝，并说清缺哪几列', () => {
    const result = parsePointCsv('名称,单位\n温度,℃')
    expect(result.fatal).toContain('点位编码')
    expect(result.fatal).toContain('寻址串')
    expect(result.rows).toEqual([])
  })

  it('只有表头时说「没有数据行」，不当成成功导入 0 条', () => {
    expect(parsePointCsv(HEADER).fatal).toBe('文件里只有表头，没有数据行')
  })

  it('空文件说空文件', () => {
    expect(parsePointCsv('').fatal).toBe('文件是空的')
  })
})

describe('逐行解析', () => {
  it('缺省列走默认值，不逼用户填满一整行', () => {
    const item = parsePointCsv('code,name,address\nt1,温度,ns=2;s=T1').rows[0]
      ?.item
    expect(item).toMatchObject({
      data_type: 'float',
      unit: null,
      sampling_interval_ms: 1000,
      deadband: 0,
      archive_enabled: true,
      archive_retention_days: null,
    })
  })

  it('行号从 1 起且不含表头——报错要指得回文件里那一行', () => {
    const result = parsePointCsv(csv('t1,温度,ns=2;s=T1', ',缺编码,ns=2;s=T2'))
    expect(result.rows[1]?.line).toBe(2)
  })

  it('空行被跳过，不报成「这一行读不了」', () => {
    const result = parsePointCsv(csv('t1,温度,ns=2;s=T1', '', '  '))
    expect(result.rows).toHaveLength(1)
  })

  it('非法编码指名道姓地拒绝', () => {
    const row = parsePointCsv(csv('温度点,温度,ns=2;s=T1')).rows[0]
    expect(row?.item).toBeNull()
    expect(row?.error).toContain('温度点')
  })

  it('认不出的数据类型直接拒，不悄悄回落成 float', () => {
    const row = parsePointCsv(csv('t1,温度,ns=2;s=T1,双精度')).rows[0]
    expect(row?.error).toContain('双精度')
  })

  it('「是 / 否」认得出布尔', () => {
    const text =
      '点位编码,名称,寻址串,归档\nt1,温度,ns=2;s=T1,否\nt2,压力,ns=2;s=P1,是'
    const rows = parsePointCsv(text).rows
    expect(rows.map((row) => row.item?.archive_enabled)).toEqual([false, true])
  })

  it('看不出真假的字眼报错，不当成 false', () => {
    const text = '点位编码,名称,寻址串,归档\nt1,温度,ns=2;s=T1,也许'
    expect(parsePointCsv(text).rows[0]?.error).toContain('也许')
  })

  it('采样周期低于下限时拒绝，而不是静默抬到下限', () => {
    const row = parsePointCsv(csv('t1,温度,ns=2;s=T1,float,,10')).rows[0]
    expect(row?.error).toContain('采样周期')
  })

  it('一行读不了不影响其它行', () => {
    const result = parsePointCsv(csv(',缺编码,ns=2;s=T2', 't1,温度,ns=2;s=T1'))
    expect(result.rows.filter((row) => row.item !== null)).toHaveLength(1)
  })
})

describe('撞码', () => {
  it('文件内重复的编码被列出来', () => {
    const result = parsePointCsv(csv('t1,温度,ns=2;s=T1', 't1,温度2,ns=2;s=T2'))
    expect(duplicatedCodes(result.rows)).toEqual(['t1'])
  })

  it('没重复时是空数组', () => {
    const result = parsePointCsv(csv('t1,温度,ns=2;s=T1', 't2,压力,ns=2;s=P1'))
    expect(duplicatedCodes(result.rows)).toEqual([])
  })
})

describe('模板与导出', () => {
  it('模板带 BOM——没有它 Excel 打开就是乱码', () => {
    expect(templateCsv().startsWith(BOM)).toBe(true)
  })

  it('模板的表头覆盖全部列', () => {
    const header = templateCsv().slice(BOM.length).split('\r\n')[0] ?? ''
    expect(splitCsvLine(header)).toEqual(CSV_COLUMNS.map((c) => c.label))
  })

  it('模板里有样例行，用户才知道寻址串长什么样', () => {
    expect(templateCsv().split('\r\n').length).toBeGreaterThan(2)
  })

  it('导出再导入回来是同一批点位——导入导出闭环', () => {
    const points: CollectPoint[] = [
      {
        id: 'p1',
        source_id: 's1',
        node_key: 's1:t1',
        code: 't1',
        name: '出口温度',
        address: 'ns=2;s=A,B',
        data_type: 'float',
        unit: '℃',
        sampling_interval_ms: 500,
        deadband: 0.5,
        archive_enabled: false,
        archive_max_interval_ms: 30_000,
        archive_retention_days: 90,
        created_at: '2026-08-16T00:00:00.000Z',
        updated_at: '2026-08-16T00:00:00.000Z',
      },
    ]
    const parsed = parsePointCsv(pointsToCsv(points))
    expect(parsed.fatal).toBeNull()
    expect(parsed.rows[0]?.item).toEqual({
      code: 't1',
      name: '出口温度',
      // ⚠ 带逗号的寻址串必须原样回来：被切成两格的话，点位会指向一个不存在的地址
      address: 'ns=2;s=A,B',
      data_type: 'float',
      unit: '℃',
      sampling_interval_ms: 500,
      deadband: 0.5,
      archive_enabled: false,
      archive_max_interval_ms: 30_000,
      archive_retention_days: 90,
    })
  })
})
