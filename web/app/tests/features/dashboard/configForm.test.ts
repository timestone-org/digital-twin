/**
 * @fileoverview 契约：属性面板的分段与条件显示全由 `configSchema` 声明驱动，
 * `when` 判定读的是**铺过缺省之后**的配置。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigField } from '@dt/contracts'

import { formGroups, isFieldVisible } from '@/features/dashboard/configForm'

const SHOW: ConfigField = {
  key: 'showTitle',
  label: '显示标题条',
  type: 'boolean',
  group: '标题',
}

const TITLE: ConfigField = {
  key: 'title',
  label: '标题',
  type: 'string',
  group: '标题',
  when: { key: 'showTitle', in: [true] },
}

const ACCENT: ConfigField = {
  key: 'accent',
  label: '强调色',
  type: 'color',
  group: '外观',
}

const LOOSE: ConfigField = { key: 'note', label: '备注', type: 'string' }

describe('条件显示', () => {
  it('没有 when 的字段永远显示', () => {
    expect(isFieldVisible(ACCENT, {})).toBe(true)
  })

  it('依赖键落在 in 里才显示', () => {
    expect(isFieldVisible(TITLE, { showTitle: true })).toBe(true)
    expect(isFieldVisible(TITLE, { showTitle: false })).toBe(false)
  })

  it('依赖键没配过时按缺席算，不显示', () => {
    expect(isFieldVisible(TITLE, {})).toBe(false)
  })
})

describe('分段', () => {
  it('按 group 分段，段序即字段首次出现的顺序', () => {
    const groups = formGroups([ACCENT, SHOW, TITLE], { showTitle: true })

    expect(groups.map((group) => group.title)).toEqual(['外观', '标题'])
    expect(groups[1]?.fields.map((field) => field.key)).toEqual([
      'showTitle',
      'title',
    ])
  })

  it('没声明 group 的字段落在「基础」段', () => {
    expect(formGroups([LOOSE], {}).map((group) => group.title)).toEqual([
      '基础',
    ])
  })

  it('条件不满足的字段不进任何段，整段空了就不出现', () => {
    const groups = formGroups([TITLE], { showTitle: false })

    expect(groups).toEqual([])
  })
})
