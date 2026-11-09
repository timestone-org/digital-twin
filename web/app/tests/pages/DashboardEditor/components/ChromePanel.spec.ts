/**
 * @fileoverview 契约：页面级设置面的「全屏卡片外观缺省」是**大屏级**面板——
 * 不构造模块级适配输入，一个键都不许被隐藏或禁用；那里配的键对整套 card 模块生效。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { listThemes } from '@dt/tokens'

import CardStyleFields from '@/components/chrome/CardStyleFields.vue'
import ChromePanel from '@/pages/DashboardEditor/components/ChromePanel.vue'

function mountPanel(themeJson: Record<string, unknown> = {}) {
  return mount(ChromePanel, {
    props: {
      draft: {
        name: '一号屏',
        description: null,
        designWidth: 1920,
        designHeight: 1080,
        chromeJson: { card: { showTitle: false } },
        themeJson,
      },
      snap: { mode: 'grid', step: 8, enabled: true, guides: true },
      grid: { cols: 24, rows: 14, marginX: 16, marginY: 16 },
      nodes: [],
      getManifest: () => undefined,
    },
  })
}

describe('大屏级外观面板', () => {
  // ⚠ 服务端只收 320–20000：面板放得过去的值会在保存时变成一句笼统的 422
  it('设计宽高的取值域与服务端一致', () => {
    const wrapper = mountPanel()
    const inputs = wrapper
      .findAllComponents(DtNumberInput)
      .filter((one) =>
        ['设计宽度', '设计高度'].includes(String(one.props('label'))),
      )

    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input.props('range')).toEqual({ min: 320, max: 20000 })
    }
    wrapper.unmount()
  })

  it('主题缺省显示跟随系统，选项包含七套系统预设', () => {
    const wrapper = mountPanel()
    const select = wrapper.getComponent(DtSelect)

    expect(select.props('label')).toBe('大屏主题')
    expect(select.props('modelValue')).toBe('')
    expect(select.props('options')).toEqual([
      { value: '', label: '跟随系统' },
      ...listThemes().map((theme) => ({ value: theme.id, label: theme.name })),
    ])
    expect(select.text()).toContain('跟随系统')
    wrapper.unmount()
  })

  it('网格参数按可用宽度排布，不强制三列挤压数值输入', () => {
    const wrapper = mountPanel()
    const fields = wrapper.get('[data-test="chrome-grid-fields"]')
    expect(fields.classes()).toContain(
      '[grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr))]',
    )
    expect(fields.findAll('.dt-number')).toHaveLength(3)
    wrapper.unmount()
  })

  it('主题选择与恢复跟随系统分别抛预设 id 和 null', () => {
    const wrapper = mountPanel({ __base: 'light' })
    const select = wrapper.getComponent(DtSelect)
    expect(select.props('modelValue')).toBe('light')

    select.vm.$emit('update:modelValue', 'dark-tech')
    select.vm.$emit('update:modelValue', '')

    expect(wrapper.emitted('set-theme')).toEqual([['dark-tech'], [null]])
    wrapper.unmount()
  })

  it('未登记的主题回落为跟随系统', () => {
    const wrapper = mountPanel({ __base: 'retired-theme' })
    expect(wrapper.getComponent(DtSelect).props('modelValue')).toBe('')
    wrapper.unmount()
  })

  it('不传模块级适配输入——即使缺省里关了显示标题也不禁任何组', () => {
    const fields = mountPanel().getComponent(CardStyleFields)

    expect(fields.props('context')).toBeUndefined()
    expect(fields.find('[data-test^="card-group-off-"]').exists()).toBe(false)
  })

  it('缺省袋原样喂给外观字段组', () => {
    const fields = mountPanel().getComponent(CardStyleFields)

    expect(fields.props('modelValue')).toEqual({ showTitle: false })
  })
})
