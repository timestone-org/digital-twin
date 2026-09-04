/**
 * @fileoverview 分区归组：顺序由常量表定、空区不产、节点级与端口级分得开。
 */
import { describe, expect, it } from 'vitest'

import {
  LEAD_ZONES,
  TABLE_ZONE,
  ZONE_ORDER,
  ZONE_TITLES,
  blocksOfPort,
  groupByZone,
  isReportZone,
} from '@/pages/Modeling/Canvas/scripts/zones'

function blockOf(zone: (typeof ZONE_ORDER)[number], port = '') {
  return { zone, port, title: `${zone}/${port}` }
}

describe('分区花名册', () => {
  it('每一区都有中文名', () => {
    for (const zone of ZONE_ORDER) expect(ZONE_TITLES[zone]).not.toBe('')
  })

  it('主体视图那一区不在前四区里', () => {
    expect(LEAD_ZONES).not.toContain(TABLE_ZONE)
    expect([...LEAD_ZONES, TABLE_ZONE]).toEqual([...ZONE_ORDER])
  })

  it('花名册外的分区名认不出来', () => {
    expect(isReportZone('charts')).toBe(true)
    expect(isReportZone('chart')).toBe(false)
  })
})

describe('按区归组', () => {
  // ⚠ 顺序由 ZONE_ORDER 定：按数组顺序排的话，两批人写的算子读着不像一个产品
  it('给进来的顺序不影响摆放顺序', () => {
    const groups = groupByZone([blockOf('table'), blockOf('step')])

    expect(groups.map((group) => group.zone)).toEqual(['step', 'table'])
  })

  it('没有块的区连位置都不占', () => {
    const groups = groupByZone([blockOf('charts')])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.blocks).toHaveLength(1)
  })

  it('只挑指定的几区，且仍按常量表排', () => {
    const blocks = [blockOf('table'), blockOf('charts'), blockOf('step')]

    const groups = groupByZone(blocks, [TABLE_ZONE, 'step'])

    expect(groups.map((group) => group.zone)).toEqual(['step', 'table'])
  })

  it('一块都没有时不产任何区', () => {
    expect(groupByZone([])).toEqual([])
  })
})

describe('按端口挑块', () => {
  // ⚠ 空串是节点级：它不属于任何一路，混进端口段会被印两遍
  it('节点级与端口级分得开', () => {
    const blocks = [blockOf('step'), blockOf('step', 'train')]

    expect(blocksOfPort(blocks, '')).toHaveLength(1)
    expect(blocksOfPort(blocks, 'train')[0]?.port).toBe('train')
    expect(blocksOfPort(blocks, 'test')).toEqual([])
  })
})
