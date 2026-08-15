/**
 * @fileoverview 契约：诊断面板逐条列出配置问题，点一条跳到出问题的实体。
 * ⚠ 悬空视点那条只能跳到视点切换段：它的 `entityId` 是一个**不存在**的视点 id，
 * 跳过去会落到空处。
 */
import { collectTwinConfigIssues, normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfigIssue } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinDiagnosticsPanel from '@/pages/TwinEditor/components/TwinDiagnosticsPanel.vue'

/** 一份四类问题齐全的坏配置。 */
const BROKEN = normalizeTwinConfig({
  anchors: [
    { id: 'a1', name: '甲' },
    { id: 'a1', name: '乙' },
  ],
  cameras: [{ id: 'c1', name: '全景' }],
  viewpoints: { items: ['ghost'] },
  panels: [{ id: 'pl1', anchorId: 'missing', fields: [{ key: 'f1' }] }],
  flows: [{ id: 'fl1', pathAnchors: ['a1'] }],
})

const ISSUES = collectTwinConfigIssues(BROKEN)

function mountPanel(issues: readonly TwinConfigIssue[] = ISSUES) {
  return mount(TwinDiagnosticsPanel, { props: { issues } })
}

function rowOf(wrapper: ReturnType<typeof mountPanel>, kind: string) {
  const row = wrapper
    .findAll('[data-test="diagnostics-row"]')
    .find((item) => item.attributes('data-kind') === kind)
  if (row === undefined) throw new Error(`缺少 ${kind} 这一条`)
  return row
}

describe('渲染', () => {
  it('没有问题时给一句话，不是一片空白', () => {
    const wrapper = mountPanel([])

    expect(wrapper.find('[data-test="diagnostics-empty"]').text()).toContain(
      '没有发现配置问题',
    )
    expect(wrapper.findAll('[data-test="diagnostics-row"]')).toHaveLength(0)
  })

  it('每条问题各占一行', () => {
    expect(mountPanel().findAll('[data-test="diagnostics-row"]')).toHaveLength(
      ISSUES.length,
    )
  })

  it('一条问题读得出短标签、字段路径与后果', () => {
    const text = rowOf(mountPanel(), 'duplicate-id').text()

    expect(text).toContain('id 重复')
    expect(text).toContain('anchors[1].id')
    expect(text).toContain('后者会覆盖前者')
  })

  // ⚠ 没登记的图标名不报错、只是什么都不画，只能靠这一条兜
  it('每条都真的画出了那个警示图标', () => {
    const rows = mountPanel().findAll('[data-test="diagnostics-row"]')

    expect(rows.every((row) => row.find('.dt-icon').exists())).toBe(true)
  })

  it('四类问题的短标签各不相同', () => {
    const wrapper = mountPanel()
    const kinds = [
      'duplicate-id',
      'dangling-camera',
      'dangling-anchor',
      'flow-too-short',
    ]
    const labels = kinds.map((kind) => rowOf(wrapper, kind).text().slice(0, 4))

    expect(new Set(labels).size).toBe(4)
  })
})

describe('点一条跳过去', () => {
  it('重复 id 跳到那个实体', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'duplicate-id').trigger('click')

    expect(wrapper.emitted('focus')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
  })

  it('悬空视点跳到视点切换段，不跳那个不存在的视点', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'dangling-camera').trigger('click')

    expect(wrapper.emitted('focus')?.[0]).toEqual([{ kind: 'viewpoints' }])
  })

  it('悬空锚点跳到指过去的那张牌', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'dangling-anchor').trigger('click')

    expect(wrapper.emitted('focus')?.[0]).toEqual([
      { kind: 'panels', id: 'pl1' },
    ])
  })

  it('画不出的流跳到那条流', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'flow-too-short').trigger('click')

    expect(wrapper.emitted('focus')?.[0]).toEqual([
      { kind: 'flows', id: 'fl1' },
    ])
  })

  it('落不到实体上的条目不可点', async () => {
    const wrapper = mountPanel([
      {
        kind: 'duplicate-id',
        entityId: 'x',
        path: 'model.asset',
        detail: '模型自己的问题',
      },
    ])
    const row = wrapper.find('[data-test="diagnostics-row"]')

    expect(row.attributes('disabled')).toBeDefined()
    await row.trigger('click')

    expect(wrapper.emitted('focus')).toBeUndefined()
  })
})
