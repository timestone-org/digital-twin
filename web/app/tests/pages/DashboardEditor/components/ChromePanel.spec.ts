/**
 * @fileoverview 契约：页面级设置面的「全屏卡片外观缺省」是**大屏级**面板——
 * 不构造模块级适配输入，一个键都不许被隐藏或禁用；那里配的键对整套 card 模块生效。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CardStyleFields from '@/pages/DashboardEditor/components/CardStyleFields.vue'
import ChromePanel from '@/pages/DashboardEditor/components/ChromePanel.vue'

function mountPanel() {
  return mount(ChromePanel, {
    props: {
      draft: {
        name: '一号屏',
        description: null,
        designWidth: 1920,
        designHeight: 1080,
        chromeJson: { card: { showTitle: false } },
      },
      snap: { mode: 'grid', step: 8, enabled: true, guides: true },
      grid: { cols: 24, rows: 14, marginX: 16, marginY: 16 },
      nodes: [],
      getManifest: () => undefined,
    },
  })
}

describe('大屏级外观面板', () => {
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
