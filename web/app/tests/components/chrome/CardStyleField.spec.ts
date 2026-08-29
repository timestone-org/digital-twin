/**
 * @fileoverview 契约：卡片外观单条控件的问号气泡——num / color / enum 三分支都要
 * 渲染 `help` 声明；没声明的不画气泡。声明了而分支漏画时 typecheck 与 lint 双双放行，
 * 表现只是「写了帮助文案却谁也看不见」。
 */
import { DtHelpTip } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CardStyleField from '@/components/chrome/CardStyleField.vue'
import type { CardField } from '@/features/dashboard/cardStyleFields'

function mountField(field: CardField, value: unknown = undefined) {
  return mount(CardStyleField, { props: { field, value } })
}

function tipOf(wrapper: ReturnType<typeof mountField>) {
  return wrapper.findComponent(DtHelpTip)
}

describe('help 气泡', () => {
  it.each([
    ['num', { key: 'cornerSize', label: '角标尺寸', kind: 'num' }],
    ['color', { key: 'textColor', label: '正文字色', kind: 'color' }],
    [
      'enum',
      {
        key: 'cornerStyle',
        label: '角标形状',
        kind: 'enum',
        options: [{ value: '', label: '默认' }],
      },
    ],
  ] as const)('%s 分支声明了 help 就画气泡，文案与标签齐全', (_kind, base) => {
    const wrapper = mountField({ ...base, help: '成段解释' })
    const tip = tipOf(wrapper)

    expect(tip.exists()).toBe(true)
    expect(tip.props('text')).toBe('成段解释')
    expect(tip.props('label')).toBe(base.label)
  })

  it('没声明 help 的字段不画气泡', () => {
    const wrapper = mountField({ key: 'radius', label: '圆角', kind: 'num' })

    expect(tipOf(wrapper).exists()).toBe(false)
  })
})
