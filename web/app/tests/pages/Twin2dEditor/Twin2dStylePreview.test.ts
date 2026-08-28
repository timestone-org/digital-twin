/**
 * @fileoverview 契约：样式预览画的是**真渲染件**（`Twin2dNodeBox`）而不是示意图，
 * 样式一改画面跟着变，交互态与状态两组开关真的喂到渲染件上，尺寸能切到自定义那一档。
 *
 * ⚠ 画示意图的话「这个样式长什么样」就被推回给用户去试，而编辑器与大屏所见即所得
 * 靠的正是两边同一个渲染件。这里正面断言渲染件在场并收到当下这份样式。
 * ⚠ 交互态那排键的清单直接对 `TWIN_2D_STATES`：包里加一档而这里漏掉时，配了那一档
 * 变体的用户在预览里永远切不到它，且一处都不报错。
 * ⚠ 状态缺省那一档必须喂 `null` 而不是某个具体档：喂具体档等于把样式自己的
 * `defaultStatus` 悄悄盖掉，于是预览里看到的状态点与画布上那个对不上。
 * ⚠ 局部渐变的 DOM id 是 `t2g-<实例前缀>-<渐变 id>`，按**样式 id** 拼前缀的话，同一份
 * 样式的两张预览（右栏一张、编辑面一张，开编辑面时必然同时在场）会把同一个 id 写进
 * 文档两遍，`url(#…)` 只认头一个——第二张的渐变悄悄取到第一张那份。所以两张预览的
 * 渐变 id 必须不同，且这条只能在**同一个应用实例**里验：`useId()` 是按应用计数的。
 */
import {
  TWIN_2D_STATES,
  Twin2dNodeBox,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dNodeStyle } from '@dt/twin2d'
import { DtSegmented, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import Twin2dStylePreview from '@/pages/Twin2dEditor/components/Twin2dStylePreview.vue'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('夹具样式没通过归一化')
}

/**
 * 一份带一行固定文字的样式；文字与尺寸都摆成能一眼在 DOM 上认出来的值。
 * @param text 那一行字
 * @param size 缺省尺寸
 */
function styleOf(text: string, size = { w: 120, h: 80 }): Twin2dNodeStyle {
  return (
    normalizeTwin2dConfig({
      styles: [
        {
          id: 'st',
          name: '换热器',
          size,
          defaultStatus: 'online',
          prims: [{ id: 't1', kind: 'txt', src: { kind: 'lit', text } }],
        },
      ],
    }).styles[0] ?? throwMissing()
  )
}

function mountPreview(nodeStyle: Twin2dNodeStyle = styleOf('原样')) {
  return mount(Twin2dStylePreview, { props: { nodeStyle } })
}

type Wrapper = ReturnType<typeof mountPreview>

/**
 * 渲染件这一刻收到的整份 props。
 * @param wrapper 挂好的预览
 */
function boxProps(wrapper: Wrapper) {
  return wrapper.getComponent(Twin2dNodeBox).props()
}

/**
 * 敲一个数进某个数字框。
 * @param wrapper 挂好的预览
 * @param test 那一格的 data-test
 * @param text 敲进去的字
 */
async function typeNumber(
  wrapper: Wrapper,
  test: string,
  text: string,
): Promise<void> {
  const input = wrapper.get(`input[data-test="${test}"]`)
  await input.setValue(text)
  await input.trigger('change')
}

/**
 * 把尺寸那一档切到自定义。
 * @param wrapper 挂好的预览
 */
async function switchToCustom(wrapper: Wrapper): Promise<void> {
  wrapper.getComponent(DtSegmented).vm.$emit('update:modelValue', 'custom')
  await wrapper.vm.$nextTick()
}

describe('画的是真渲染件', () => {
  it('复用 Twin2dNodeBox，不另画一份示意图', () => {
    const wrapper = mountPreview()

    expect(wrapper.findComponent(Twin2dNodeBox).exists()).toBe(true)
    expect(boxProps(wrapper).nodeStyle).toMatchObject({ id: 'st' })
  })

  it('样式一改画面跟着变', async () => {
    const wrapper = mountPreview(styleOf('改之前'))
    expect(wrapper.text()).toContain('改之前')

    await wrapper.setProps({ nodeStyle: styleOf('改之后') })

    expect(wrapper.text()).toContain('改之后')
    expect(wrapper.text()).not.toContain('改之前')
  })

  it('槽位读数按示例值填，一处实时数据都不接', () => {
    const wrapper = mountPreview()

    expect(boxProps(wrapper).readSlot).toBeTypeOf('function')
    expect(boxProps(wrapper).slotValues).toBeInstanceOf(Map)
  })

  it('框上写着当下这一格画的是多大', () => {
    const wrapper = mountPreview(styleOf('原样', { w: 240, h: 60 }))

    expect(wrapper.get('[data-test="style-preview-size"]').text()).toBe(
      '240 × 60',
    )
  })
})

describe('交互态那排开关', () => {
  it('五档一个不少，与包里那份清单同源', () => {
    const wrapper = mountPreview()
    const keys = wrapper
      .findAll('[data-test^="style-preview-state-"]')
      .map((node) => node.attributes('data-test'))

    expect(keys).toEqual(
      TWIN_2D_STATES.map((state) => `style-preview-state-${state}`),
    )
  })

  it('一档都没开时渲染件收到空表', () => {
    expect(boxProps(mountPreview()).states).toEqual([])
  })

  it('按一下就把那一档喂给渲染件，再按一下摘掉', async () => {
    const wrapper = mountPreview()
    const key = '[data-test="style-preview-state-hover"]'

    await wrapper.get(key).trigger('click')
    expect(boxProps(wrapper).states).toEqual(['hover'])

    await wrapper.get(key).trigger('click')
    expect(boxProps(wrapper).states).toEqual([])
  })

  it('几档能一起开，变体叠着的样子才看得出来', async () => {
    const wrapper = mountPreview()

    await wrapper
      .get('[data-test="style-preview-state-hover"]')
      .trigger('click')
    await wrapper
      .get('[data-test="style-preview-state-alarm"]')
      .trigger('click')

    expect(boxProps(wrapper).states).toEqual(['hover', 'alarm'])
  })

  it('镜像那一档连节点自己也翻过来，不是只喂一档变体', async () => {
    const wrapper = mountPreview()

    await wrapper
      .get('[data-test="style-preview-state-flipped"]')
      .trigger('click')

    expect(boxProps(wrapper).node).toMatchObject({ flipX: true })
  })
})

describe('状态四档', () => {
  it('缺省那一档喂 null，样式自己的 defaultStatus 不被盖掉', () => {
    expect(boxProps(mountPreview()).status).toBeNull()
  })

  it('切到具体一档就把它当数据线上的覆盖喂下去', async () => {
    const wrapper = mountPreview()

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'alarm')
    await wrapper.vm.$nextTick()

    expect(boxProps(wrapper).status).toBe('alarm')
  })

  it('认不出的取值退回缺省那一档', async () => {
    const wrapper = mountPreview()

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'nope')
    await wrapper.vm.$nextTick()

    expect(boxProps(wrapper).status).toBeNull()
  })
})

describe('尺寸两档', () => {
  it('缺省按样式自己的 size 画', () => {
    const wrapper = mountPreview(styleOf('原样', { w: 200, h: 100 }))

    expect(boxProps(wrapper).node).toMatchObject({ w: 0, h: 0 })
    expect(wrapper.get('[data-test="style-preview-size"]').text()).toBe(
      '200 × 100',
    )
  })

  it('切到自定义那一档才出两个尺寸框', async () => {
    const wrapper = mountPreview()
    expect(wrapper.find('[data-test="style-preview-w"]').exists()).toBe(false)

    await switchToCustom(wrapper)

    expect(wrapper.find('[data-test="style-preview-w"]').exists()).toBe(true)
  })

  it('自定义尺寸真的把节点拉过去，好验容器族跟不跟得住', async () => {
    const wrapper = mountPreview(styleOf('原样', { w: 120, h: 80 }))

    await switchToCustom(wrapper)
    await typeNumber(wrapper, 'style-preview-w', '320')

    expect(boxProps(wrapper).node).toMatchObject({ w: 320, h: 80 })
    expect(wrapper.get('[data-test="style-preview-size"]').text()).toBe(
      '320 × 80',
    )
  })

  it('换一份样式时自定义尺寸回到新样式的缺省', async () => {
    const wrapper = mountPreview(styleOf('原样', { w: 120, h: 80 }))
    await switchToCustom(wrapper)

    await wrapper.setProps({
      nodeStyle: {
        ...styleOf('另一份', { w: 60, h: 40 }),
        id: 'st2',
      },
    })

    expect(wrapper.get('[data-test="style-preview-size"]').text()).toBe(
      '60 × 40',
    )
  })
})

describe('缩略档', () => {
  it('compact 时那排开关整个不出，只留一张图', () => {
    const wrapper = mount(Twin2dStylePreview, {
      props: { nodeStyle: styleOf('原样'), compact: true },
    })

    expect(wrapper.findComponent(Twin2dNodeBox).exists()).toBe(true)
    expect(wrapper.find('[data-test="style-preview-states"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="style-preview-status"]').exists()).toBe(
      false,
    )
  })
})

/** 一份带局部渐变的样式：渐变的 DOM id 会写进 `<linearGradient id>`。 */
const GRADIENT_STYLE: Twin2dNodeStyle =
  normalizeTwin2dConfig({
    styles: [
      {
        id: 'grad',
        name: '带渐变的',
        size: { w: 120, h: 80 },
        prims: [
          {
            id: 'v1',
            kind: 'vec',
            shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10, r: 0 },
            fill: { kind: 'gradient', ref: 'g1' },
            gradients: [
              {
                id: 'g1',
                kind: 'linear',
                stops: [
                  { at: 0, color: '#0ff' },
                  { at: 1, color: '#f0f' },
                ],
              },
            ],
          },
        ],
      },
    ],
  }).styles[0] ?? throwMissing()

/** 同一个应用实例里并排摆两张预览，与「右栏一张 + 编辑面一张」同形。 */
const TwoPreviews = defineComponent({
  setup() {
    return () =>
      h('div', [
        h(Twin2dStylePreview, { nodeStyle: GRADIENT_STYLE }),
        h(Twin2dStylePreview, { nodeStyle: GRADIENT_STYLE }),
      ])
  },
})

describe('两张预览同时在场', () => {
  it('渐变的 DOM id 不撞号，否则第二张取到第一张那份渐变', () => {
    const wrapper = mount(TwoPreviews)
    const ids = wrapper
      .findAll('linearGradient')
      .map((node) => node.attributes('id'))

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('自定义尺寸的种子', () => {
  it('同一份样式改了缺省尺寸，再切到自定义时种的是新的那个数', async () => {
    const wrapper = mountPreview(styleOf('原样', { w: 120, h: 80 }))

    await wrapper.setProps({ nodeStyle: styleOf('原样', { w: 300, h: 200 }) })
    await switchToCustom(wrapper)

    expect(boxProps(wrapper).node).toMatchObject({ w: 300, h: 200 })
  })
})
