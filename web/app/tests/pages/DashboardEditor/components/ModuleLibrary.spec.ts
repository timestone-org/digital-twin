/**
 * @fileoverview 契约：模块库的内容完全来自注册表——分组、搜索与图标都读清单声明，
 * 库里没有任何模块类型字面量，第三方在启动期注册的清单会自动出现在这里。
 * ⚠ 拖到画布用的是自定义 MIME：换成 text/plain 的话，从别处拖进来的任意文本
 * 都会被当成一次「添加模块」。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ModuleManifest } from '@dt/contracts'

import { MODULE_DRAG_MIME } from '@/features/dashboard/moduleLibrary'
import ModuleLibrary from '@/pages/DashboardEditor/components/ModuleLibrary.vue'

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    type: 'demo',
    displayName: '演示',
    category: '演示',
    defaultSize: { width: 10, height: 10 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: {} }),
    ...over,
  }
}

const MANIFESTS = [
  manifest({
    type: 'a',
    displayName: '折线卡片',
    category: '图表',
    icon: 'activity',
  }),
  manifest({
    type: 'b',
    displayName: '页头',
    category: '布局',
    keywords: ['yetou'],
  }),
]

describe('列出模块', () => {
  it('按 category 分组，组名与模块名都来自清单', () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: MANIFESTS } })

    expect(wrapper.text()).toContain('图表')
    expect(wrapper.text()).toContain('折线卡片')
    expect(wrapper.findAll('.dt-lib__item')).toHaveLength(2)
  })

  it('点一项抛出整份清单，而不是它的类型字符串', async () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: MANIFESTS } })

    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')

    expect(wrapper.emitted('add')?.[0]?.[0]).toMatchObject({
      type: 'a',
      displayName: '折线卡片',
    })
  })

  it('一个模块都没注册时给一句能看的空态', () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: [] } })

    expect(wrapper.text()).toContain('没有匹配的模块')
  })
})

describe('搜索', () => {
  it('按别名也搜得到', async () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: MANIFESTS } })

    await wrapper.find('.dt-input__el').setValue('yetou')

    expect(wrapper.findAll('.dt-lib__item')).toHaveLength(1)
    expect(wrapper.text()).toContain('页头')
  })

  it('一个都不命中时给空态而不是空白', async () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: MANIFESTS } })

    await wrapper.find('.dt-input__el').setValue('不存在')

    expect(wrapper.text()).toContain('没有匹配的模块')
  })
})

describe('被取代的模块', () => {
  it('声明了 replacedBy 的模块不进库，但别的照列', () => {
    const wrapper = mount(ModuleLibrary, {
      props: {
        manifests: [
          ...MANIFESTS,
          manifest({ type: 'old', displayName: '旧页头', replacedBy: 'b' }),
        ],
      },
    })

    expect(wrapper.text()).not.toContain('旧页头')
    expect(wrapper.findAll('.dt-lib__item')).toHaveLength(MANIFESTS.length)
  })
})

describe('拖到画布', () => {
  it('每一项都可拖，载荷是模块类型且走自定义 MIME', () => {
    const wrapper = mount(ModuleLibrary, { props: { manifests: MANIFESTS } })
    const item = wrapper.find('[data-test="module-a"]')
    const written: Record<string, string> = {}
    const transfer = {
      setData: (mime: string, value: string) => {
        written[mime] = value
      },
      effectAllowed: '',
    }
    const event = new Event('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })

    expect(item.attributes('draggable')).toBe('true')
    item.element.dispatchEvent(event)

    expect(written[MODULE_DRAG_MIME]).toBe('a')
    expect(transfer.effectAllowed).toBe('copy')
  })
})
