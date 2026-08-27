/**
 * @fileoverview 契约：节点角标那三项各有入口，且文本与颜色带着合并段标识走。
 *
 * ⚠ 这三项本来整块缺席：角标画得出来（预置图元按 `field: 'badge'` 的 `present` 判显示）、
 * 变体也读 `badgeShape`，面板上却一个入口都没有，用户只能去改 JSON。
 * ⚠ 重选当前那一档不写回：换了新引用却什么都没改，撤销键上就多出一格按了没反应的空步。
 */
import { TWIN_2D_BADGE_SHAPES } from '@dt/twin2d'
import type { Twin2dBadgeShape } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodeBadgeFields from '@/pages/Twin2dEditor/components/inspector/NodeBadgeFields.vue'

function mountFields(
  badge = '3',
  badgeColor = '',
  badgeShape: Twin2dBadgeShape = 'round',
) {
  return mount(NodeBadgeFields, { props: { badge, badgeColor, badgeShape } })
}

type Wrapper = ReturnType<typeof mountFields>

/** 最后一次写回的补丁与合并段标识。 */
function lastUpdate(
  wrapper: Wrapper,
): [Record<string, unknown>, string | null] {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回角标')
  const last = events[events.length - 1]
  return [last?.[0] as Record<string, unknown>, last?.[1] as string | null]
}

/**
 * 形状下拉摆出来的全部选项。
 * ⚠ 过一手声明的返回类型再收：typescript-eslint 解析不出 `.vue` 的模块，props 在它
 * 眼里是 `any`，真正的类型检查由 `vue-tsc` 做（同 NodeInspector.test.ts 那条）。
 * @param wrapper 挂好的这一格
 */
function shapeOptions(
  wrapper: Wrapper,
): readonly { value: string; label: string }[] {
  return wrapper.findComponent(DtSelect).props('options')
}

describe('角标三项', () => {
  it('字面量、形状与底色各有一个入口', () => {
    const wrapper = mountFields()

    expect(wrapper.find('input[data-test="node-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="node-badge-shape"]').exists()).toBe(true)
    expect(wrapper.find('.dt-t2-color input[type="text"]').exists()).toBe(true)
  })

  it('三项各自回显文档里的值', () => {
    const wrapper = mountFields('7', 'tomato', 'diamond')

    expect(
      wrapper.find('input[data-test="node-badge"]').attributes('value'),
    ).toBe('7')
    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe('diamond')
    expect(
      wrapper.find('.dt-t2-color input[type="text"]').attributes('value'),
    ).toBe('tomato')
  })

  it('敲字面量走合并段，一段里连着敲并成一帧', async () => {
    const wrapper = mountFields('')

    await wrapper.find('input[data-test="node-badge"]').setValue('A')
    await wrapper.find('input[data-test="node-badge"]').setValue('AB')

    const events = wrapper.emitted('update') ?? []
    expect(events).toHaveLength(2)
    expect(lastUpdate(wrapper)).toEqual([{ badge: 'AB' }, 'badge'])
  })

  it.each(TWIN_2D_BADGE_SHAPES)('形状 %s 选得到', (shape) => {
    const wrapper = mountFields('3', '', shape === 'round' ? 'square' : 'round')

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', shape)

    expect(lastUpdate(wrapper)).toEqual([{ badgeShape: shape }, null])
  })

  it('形状下拉里三档一档不少', () => {
    const values = shapeOptions(mountFields()).map((option) => option.value)

    expect(values).toEqual([...TWIN_2D_BADGE_SHAPES])
  })

  it('认不出的形状与当前那一档都不写回', () => {
    const wrapper = mountFields('3', '', 'round')
    const select = wrapper.findComponent(DtSelect)

    select.vm.$emit('update:modelValue', 'round')
    select.vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('底色经消毒之后带着自己的合并段写回', async () => {
    const wrapper = mountFields('3', '')

    await wrapper.find('.dt-t2-color input[type="text"]').setValue('url(evil)')

    expect(lastUpdate(wrapper)).toEqual([{ badgeColor: '' }, 'badgeColor'])
  })

  it('焦点离开这一段就断段', async () => {
    const wrapper = mountFields()

    await wrapper.find('input[data-test="node-badge"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
