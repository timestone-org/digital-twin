/**
 * @fileoverview 批量建部件的口径：已被认领的节点挡在外面、重复项只建一次、
 * 部件名取节点名。
 */
import { describe, expect, it } from 'vitest'
import { normalizeTwinConfig } from '@dt/twin-config'

import {
  addPartsFromNodes,
  bulkPartCandidates,
} from '@/pages/TwinEditor/bulkParts'

const EMPTY = normalizeTwinConfig({})

const WITH_PART = normalizeTwinConfig({
  parts: [{ id: 'p1', name: '一号泵', nodes: ['Pump_01'] }],
})

describe('候选清单', () => {
  it('标出谁已被认领，并说明是被哪个部件占的', () => {
    const rows = bulkPartCandidates(WITH_PART, ['Pump_01', 'Pump_02'])

    expect(rows).toEqual([
      { name: 'Pump_01', takenBy: '一号泵' },
      { name: 'Pump_02', takenBy: null },
    ])
  })

  it('没有部件时全都可选', () => {
    const rows = bulkPartCandidates(EMPTY, ['A', 'B'])

    expect(rows.every((row) => row.takenBy === null)).toBe(true)
  })
})

describe('批量新建', () => {
  it('一个节点一个部件，名字取节点名、节点自动关联上', () => {
    const { config, ids } = addPartsFromNodes(EMPTY, ['Tank_A', 'Tank_B'])

    expect(ids).toHaveLength(2)
    expect(config.parts.map((part) => part.name)).toEqual(['Tank_A', 'Tank_B'])
    expect(config.parts.map((part) => part.nodes)).toEqual([
      ['Tank_A'],
      ['Tank_B'],
    ])
  })

  it('已被认领的节点跳过——同一个节点挂两个部件会让两条规则打架', () => {
    const { config, ids } = addPartsFromNodes(WITH_PART, ['Pump_01', 'Pump_02'])

    expect(ids).toHaveLength(1)
    expect(config.parts).toHaveLength(2)
    expect(config.parts[1]?.name).toBe('Pump_02')
  })

  it('重复项与空名字只算一次', () => {
    const { config } = addPartsFromNodes(EMPTY, ['A', 'A', '  ', 'B'])

    expect(config.parts.map((part) => part.name)).toEqual(['A', 'B'])
  })

  it('一个都没选时原样返回', () => {
    const { config, ids } = addPartsFromNodes(EMPTY, [])

    expect(ids).toEqual([])
    expect(config.parts).toEqual([])
  })
})
