/**
 * @fileoverview DtSegmented 的行为契约：选中态同时给 aria-pressed（只靠颜色
 * 对读屏与色觉障碍都不成立）、iconOnly 必须留可访问名称、点击抛值不自己改。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DtSegmentedOption } from '@dt/contracts'

import DtSegmented from '../../src/components/DtSegmented/DtSegmented.vue'

const OPTIONS: DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图' },
]

function render(modelValue = 'table') {
  return mount(DtSegmented, { props: { modelValue, options: OPTIONS } })
}

describe('DtSegmented', () => {
  it('每个选项一个按钮', () => {
    expect(render().findAll('button')).toHaveLength(2)
  })

  it('选中项带 aria-pressed=true，其余为 false', () => {
    const pressed = render()
      .findAll('button')
      .map((b) => b.attributes('aria-pressed'))
    expect(pressed).toEqual(['true', 'false'])
  })

  it('iconOnly 的项把 label 留给读屏，不是丢掉', () => {
    const first = render().findAll('button')[0]
    expect(first?.attributes('aria-label')).toBe('表格视图')
    expect(first?.text()).toBe('')
  })

  it('非 iconOnly 的项直接显示文字', () => {
    expect(render().findAll('button')[1]?.text()).toBe('卡片视图')
  })

  it('点击抛值，组件自己不改选中态（受控组件）', async () => {
    const wrapper = render()
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['card']])
    expect(wrapper.findAll('button')[0]?.attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('分组带可访问名称', () => {
    const wrapper = mount(DtSegmented, {
      props: { modelValue: 'table', options: OPTIONS, ariaLabel: '展示方式' },
    })
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe(
      '展示方式',
    )
  })
})

describe('撑满与选中态的标记', () => {
  it('缺省抱内容宽，给了 block 才撑满', () => {
    expect(render().classes()).not.toContain('dt-segmented--block')
    expect(
      mount(DtSegmented, {
        props: { modelValue: 'table', options: OPTIONS, block: true },
      }).classes(),
    ).toContain('dt-segmented--block')
  })

  // 观感全挂在 is-active 上（渐变底 + 底部指示条 + 强调色文字）；
  // 类掉了就只剩 aria-pressed，视觉上分不出当前在哪一页
  it('选中项挂 is-active，其余不挂', () => {
    const active = render('card')
      .findAll('button')
      .map((item) => item.classes().includes('is-active'))

    expect(active).toEqual([false, true])
  })
})

describe('两档长相', () => {
  it('缺省是 control：它是控件，与旁边的按钮下拉同属一排', () => {
    expect(render().classes()).toContain('dt-segmented--control')
  })

  it('给了 tabs 就换成页签那一档', () => {
    const wrapper = mount(DtSegmented, {
      props: { modelValue: 'table', options: OPTIONS, variant: 'tabs' },
    })
    expect(wrapper.classes()).toContain('dt-segmented--tabs')
    expect(wrapper.classes()).not.toContain('dt-segmented--control')
  })

  it('⚠ tabs 的量值必须与 AppTabNav 逐一对上', () => {
    // 两处是刻意的重复：AppTabNav 是应用壳里的 RouterLink 导航、用 Tailwind，
    // 本组件在 @dt/ui 里一律 scoped SCSS，跨包共用不了同一份声明。改一边没改
    // 另一边的表现是「系统管理的页签与页内页签长得不一样」，而两边单看都对。
    // ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下
    // 后者不是 file URL，readFileSync 会当场炸
    const read = (part: string): string =>
      readFileSync(join(process.cwd(), part), 'utf8')
    const style = read('packages/ui/src/components/DtSegmented/DtSegmented.vue')
    const nav = read('app/src/components/layout/AppTabNav.vue')
    // gap-1=4px / pb-2=8px / py-1.5=6px / px-3=12px / text-[13px]
    expect(style).toContain('$tab-gap: 4px')
    expect(style).toContain('$tab-rule-gap: 8px')
    expect(style).toContain('$tab-py: 6px')
    expect(style).toContain('$tab-px: 12px')
    expect(style).toContain('$tab-fs: 13px')
    expect(nav).toContain('gap-1 border-b border-border-subtle pb-2')
    expect(nav).toContain('rounded-md px-3 py-1.5 text-[13px]')
    // 选中态：一成透明度的强调底 + 强调字色，两边同一套
    expect(style).toContain('background: rgba(var(--accent-primary-rgb), 0.1)')
    expect(nav).toContain('bg-accent-primary/10 text-accent-on-surface')
  })
})
