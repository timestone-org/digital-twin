/**
 * @fileoverview 卡片族的收官对照：四个模块的身份互不相撞，且参考仓那 15 个信息展示模块
 * 逐个都有落点（MODULE_INFO_CARD_DESIGN §1.1 与 §1.3）。
 *
 * ⚠ 这张对照表只有四个模块全落地了才校得动，故收在最后一个模块的用例里。
 * ⚠ 覆盖表漏一行不会有任何报错：漏掉的那个参考模块只是「没人做」，而设计文档里
 * 写着「一个不漏」——纸面与仓库各说各话，只有把表写成断言才拦得住。
 */
import { isIconName } from '@dt/ui'
import { describe, expect, it } from 'vitest'

import gaugeCard from '../../../src/modules/gauge-card/manifest'
import infoCard from '../../../src/modules/info-card/manifest'
import infoFeed from '../../../src/modules/info-feed/manifest'
import infoList from '../../../src/modules/info-list/manifest'

const FAMILY = [infoCard, infoList, infoFeed, gaugeCard]

/**
 * 参考仓那 15 个信息展示模块各自的落点：归到哪个新 type、由哪几套预设还原它的观感。
 * ⚠ 逐行取自设计文档 §1.3 的覆盖表；`efficiency-overview` 是唯一不迁的一个——
 * 它真的 `import` 了 echarts（半环 PieChart + COP GaugeChart），不在本族范围内。
 */
const COVERAGE: { source: string; type: string; presets: string[] }[] = [
  { source: 'kpi-card', type: 'info-card', presets: ['kpi-single'] },
  { source: 'kpi-group', type: 'info-card', presets: ['kpi-grid'] },
  {
    source: 'icon-kpi-group',
    type: 'info-card',
    presets: ['icon-grid', 'icon-column'],
  },
  { source: 'list', type: 'info-list', presets: ['row-list'] },
  { source: 'tag-table', type: 'info-list', presets: ['three-col'] },
  {
    source: 'metric-status-table',
    type: 'info-list',
    presets: ['target-badge-list'],
  },
  { source: 'source-list', type: 'info-list', presets: ['source-card'] },
  { source: 'terminal-list-v2', type: 'info-list', presets: ['terminal-card'] },
  { source: 'vessel-list', type: 'info-list', presets: ['vessel-card'] },
  { source: 'work-order-list', type: 'info-list', presets: ['work-order'] },
  { source: 'alarm-list', type: 'info-list', presets: ['alarm-rows'] },
  {
    source: 'feed-list',
    type: 'info-feed',
    presets: ['feed-plain', 'weather-alert'],
  },
  { source: 'target-progress', type: 'gauge-card', presets: ['target-track'] },
  {
    source: 'entity-gauge',
    type: 'gauge-card',
    presets: ['arc-gauge', 'linear-bar', 'tank', 'thermometer'],
  },
  { source: 'efficiency-overview', type: '', presets: [] },
]

/**
 * 表外的三套预设：它们不还原任何一个参考模块，是新模型多出来的排布。
 * ⚠ 列在这里而不是放它们自生自灭：表外冒出新的一套时这条会红，逼着新增的那一套
 * 要么进覆盖表、要么在这里交代自己为什么是额外的。
 *
 * ⚠ `arc-spectrum` **不认领** `efficiency-overview`：那个参考模块是「半环饼图 +
 * COP 仪表 + 40 段光谱离散弧 + 最大余数法配比修正」的整块，而这一套只做了其中
 * 那只弧，且走的是纯 SVG 渐变而不是离散 40 段（MODULE_INFO_CARD_DESIGN §14 一）。
 * 认领了就等于宣称那一块迁完了，而半环与配比修正一行都没有。
 */
const EXTRA_PRESETS = [
  'info-card:plain-grid',
  'gauge-card:arc-spectrum',
  'gauge-card:gauge-grid',
]

function presetIds(type: string): string[] {
  const manifest = FAMILY.find((item) => item.type === type)
  return (manifest?.configPresets ?? []).map((preset) => preset.id)
}

describe('卡片族四个模块的身份', () => {
  it('四个 type 与四个名字互不相撞', () => {
    expect(new Set(FAMILY.map((item) => item.type)).size).toBe(4)
    expect(new Set(FAMILY.map((item) => item.displayName)).size).toBe(4)
    expect(FAMILY.map((item) => item.type)).toEqual([
      'info-card',
      'info-list',
      'info-feed',
      'gauge-card',
    ])
  })

  it('四个图标在族内互不相同，且都是 DtIcon 认得的名字', () => {
    const icons = FAMILY.map((item) => item.icon ?? '')

    expect(icons).toEqual(['layout-grid', 'table', 'activity', 'gauge'])
    expect(new Set(icons).size).toBe(4)
    expect(icons.filter((name) => !isIconName(name))).toEqual([])
  })

  it('四个都归数据类——同一族在模块库里要摆在一起', () => {
    expect(FAMILY.map((item) => item.category)).toEqual([
      '数据',
      '数据',
      '数据',
      '数据',
    ])
  })

  it('四个都没被判成谁的旧版', () => {
    expect(FAMILY.map((item) => item.replacedBy)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('参考仓那 15 个模块的落点', () => {
  it('十五行一个不少，参考模块名不重复', () => {
    expect(COVERAGE).toHaveLength(15)
    expect(new Set(COVERAGE.map((row) => row.source)).size).toBe(15)
  })

  it('唯一不迁的是那个真依赖 echarts 的', () => {
    expect(COVERAGE.filter((row) => row.type === '')).toEqual([
      { source: 'efficiency-overview', type: '', presets: [] },
    ])
  })

  it('每一行指的都是本族真存在的模块与真存在的预设', () => {
    const missing = COVERAGE.filter((row) => row.type !== '').flatMap((row) => {
      const ids = presetIds(row.type)
      return row.presets
        .filter((id) => !ids.includes(id))
        .map((id) => `${row.type}:${id}`)
    })

    expect(missing).toEqual([])
  })

  it('每套预设至多认领一个参考模块，认领关系不重叠', () => {
    const claimed = COVERAGE.flatMap((row) =>
      row.presets.map((id) => `${row.type}:${id}`),
    )

    expect(claimed).toHaveLength(new Set(claimed).size)
  })

  it('族里的每套预设要么认领了一个参考模块，要么在表外那两套里', () => {
    const claimed = new Set(
      COVERAGE.flatMap((row) => row.presets.map((id) => `${row.type}:${id}`)),
    )
    const all = FAMILY.flatMap((item) =>
      presetIds(item.type).map((id) => `${item.type}:${id}`),
    )

    expect(all.filter((id) => !claimed.has(id))).toEqual(EXTRA_PRESETS)
    expect(all).toHaveLength(22)
  })
})
