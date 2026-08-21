/**
 * @fileoverview 「场景」区组件的契约：三个单例入口各带 data-key、点了抛自己的
 * 选中值、选中的那行高亮、标题命中走 <mark> 切片。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OutlineSceneList from '@/pages/TwinEditor/components/OutlineSceneList.vue'
import { TWIN_SCENE_ENTRIES } from '@/pages/TwinEditor/scripts/outlineNodes'
import type { TwinSceneEntryView } from '@/pages/TwinEditor/scripts/outlineFilter'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

function entryViews(): TwinSceneEntryView[] {
  return TWIN_SCENE_ENTRIES.map((entry) => ({ entry, slices: null }))
}

function render(
  entries: readonly TwinSceneEntryView[] = entryViews(),
  selection: TwinSelection | null = null,
) {
  return mount(OutlineSceneList, { props: { entries, selection } })
}

describe('展示', () => {
  it('三行各带自己的 data-key', () => {
    const rows = render().findAll('[data-test="outline-single"]')

    expect(rows.map((row) => row.attributes('data-key'))).toEqual([
      'model',
      'viewpoints',
      'roam',
    ])
  })

  it('每行画标题与图标', () => {
    const rows = render().findAll('[data-test="outline-single"]')

    expect(rows[0]?.text()).toContain('模型与场景')
    expect(rows.every((row) => row.find('.dt-icon').exists())).toBe(true)
  })

  it('标题命中段包进 <mark>', () => {
    const entries = entryViews()
    const first = entries[0]
    if (first === undefined) throw new Error('缺场景行')
    first.slices = { before: '模型', match: '与场景', after: '' }

    expect(render(entries).get('[data-key="model"] mark').text()).toBe('与场景')
  })

  it('选中的那行高亮，别的行不高亮', () => {
    const rows = render(entryViews(), { kind: 'viewpoints' }).findAll(
      '[data-test="outline-single"]',
    )

    expect(rows[1]?.classes()).toContain('bg-surface-raised')
    expect(rows[0]?.classes()).not.toContain('bg-surface-raised')
  })
})

describe('选中', () => {
  it('点一行抛它自己的选中值', async () => {
    const wrapper = render()

    await wrapper.get('[data-key="roam"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[{ kind: 'roam' }]])
  })
})
