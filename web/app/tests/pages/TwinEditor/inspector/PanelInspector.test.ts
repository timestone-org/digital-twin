/**
 * @fileoverview 契约：信息牌检查器把「锚点优先、世界坐标静默不生效」摆在明面上。
 *
 * 两者都给时按锚点走，`position` 那一份不生效——不写出来的话，用户改了坐标没反应
 * 会一路去查渲染层。另锁住：宽度 0 是「按内容自适应」这一档，改动一律整份写回。
 */
import {
  ALWAYS_VISIBLE,
  type TwinAnchor,
  type TwinPanel,
} from '@dt/twin-config'
import { DtSelect, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PanelInspector from '@/pages/TwinEditor/components/inspector/PanelInspector.vue'
import PanelFieldList from '@/pages/TwinEditor/components/fields/PanelFieldList.vue'

const ANCHORS: TwinAnchor[] = [
  {
    id: 'a1',
    name: '进水口',
    position: [1, 2, 3],
    label: '',
    unit: '',
    decimals: null,
    visibility: ALWAYS_VISIBLE,
  },
]

function panelOf(over: Partial<TwinPanel> = {}): TwinPanel {
  return {
    id: 'p1',
    name: '一号牌',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 1, 0],
    fields: [
      {
        key: 'f1',
        label: '温度',
        unit: '℃',
        prefix: '',
        decimals: null,
        staticText: '',
      },
    ],
    billboard: 'face',
    style: {
      variant: 'card',
      orient: 'center',
      accent: '--accent-primary',
      background: '',
      width: 0,
      fontScale: 1,
      scale: 1,
      animate: false,
      pulse: false,
    },
    visibility: ALWAYS_VISIBLE,
    ...over,
  }
}

function mountInspector(panel: TwinPanel) {
  return mount(PanelInspector, {
    props: { modelValue: panel, anchors: ANCHORS },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

function written(wrapper: Wrapper): TwinPanel {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回信息牌')
  return events[0][0] as TwinPanel
}

function switchByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSwitch)
    .find((item) => item.props('ariaLabel') === label)
  if (!found) throw new Error(`未找到开关：${label}`)
  return found
}

function selectByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === label)
  if (!found) throw new Error(`未找到下拉：${label}`)
  return found
}

describe('锚点与世界坐标二选一', () => {
  it('锚定之后写明世界坐标不生效', () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'a1' }))

    expect(wrapper.text()).toContain('世界坐标不生效')
    expect(wrapper.text()).toContain('世界坐标（当前不生效）')
  })

  it('没锚定时不说这句，也不给坐标加不生效标记', () => {
    const wrapper = mountInspector(panelOf())

    expect(wrapper.text()).not.toContain('不生效')
  })

  it('锚定到一个不存在的锚点时报出来', () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'ghost' }))

    expect(wrapper.text()).toContain('ghost 不存在')
  })

  it('下拉里有「不锚定」这一档，改回去就用世界坐标', async () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'a1' }))
    await selectByLabel(wrapper, '锚定').setValue('')

    expect(written(wrapper).anchorId).toBe('')
  })
})

describe('卡片宽度', () => {
  it('0 表达为「按内容自适应」，开关是开的', () => {
    const wrapper = mountInspector(panelOf())

    expect(switchByLabel(wrapper, '宽度按内容自适应').props('modelValue')).toBe(
      true,
    )
    expect(wrapper.find('input[aria-label="卡片宽度"]').exists()).toBe(false)
  })

  it('关掉自适应给一个非 0 的具体宽度', async () => {
    const wrapper = mountInspector(panelOf())
    await switchByLabel(wrapper, '宽度按内容自适应').setValue(false)

    expect(written(wrapper).style.width).toBeGreaterThan(0)
  })

  it('已有具体宽度时打开自适应写回 0', async () => {
    const panel = panelOf()
    const wrapper = mountInspector({
      ...panel,
      style: { ...panel.style, width: 320 },
    })
    await switchByLabel(wrapper, '宽度按内容自适应').setValue(true)

    expect(written(wrapper).style.width).toBe(0)
  })
})

describe('整份写回', () => {
  it('改标题不动原对象', async () => {
    const panel = panelOf()
    const wrapper = mountInspector(panel)
    await wrapper.find('input[aria-label="标题文本"]').setValue('新标题')

    const next = written(wrapper)
    expect(next.name).toBe('新标题')
    expect(panel.name).toBe('一号牌')
    expect(next).not.toBe(panel)
  })

  it('改外观只换 style，其余原样带过去', async () => {
    const wrapper = mountInspector(panelOf())
    await switchByLabel(wrapper, '入场动画').setValue(true)

    const next = written(wrapper)
    expect(next.style.animate).toBe(true)
    expect(next.style.variant).toBe('card')
    expect(next.fields).toHaveLength(1)
  })

  it('字段列表写回的是整份 fields', () => {
    const wrapper = mountInspector(panelOf())
    wrapper.findComponent(PanelFieldList).vm.$emit('update:fields', [])

    expect(written(wrapper).fields).toEqual([])
  })

  it('标题留空时说明不画标题行', () => {
    const wrapper = mountInspector(panelOf({ name: '' }))

    expect(wrapper.text()).toContain('不画标题行')
  })
})

describe('外观预设', () => {
  it('命中的预设是按压态，未命中的弹起', () => {
    const wrapper = mountInspector(panelOf())

    expect(
      wrapper
        .get('[data-test="panel-preset-plain-card"]')
        .attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper
        .get('[data-test="panel-preset-tech-hud"]')
        .attributes('aria-pressed'),
    ).toBe('false')
  })

  it('点一个预设把它那套开关整组写进 style', async () => {
    const wrapper = mountInspector(panelOf())

    await wrapper.get('[data-test="panel-preset-tech-hud"]').trigger('click')

    const next = written(wrapper)
    expect(next.style).toMatchObject({
      variant: 'hud',
      orient: 'top',
      animate: true,
      pulse: true,
    })
  })
})
