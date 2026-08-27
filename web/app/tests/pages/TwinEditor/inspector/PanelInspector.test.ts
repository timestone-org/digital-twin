/**
 * @fileoverview 契约：信息牌检查器把「锚点优先、自填坐标静默不生效」摆在明面上。
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
import type { TwinFrameView } from '@/pages/TwinEditor/scripts/coordFrame'

/** 基准原点落在世界原点上：这一份用例守的不是坐标基准，读数即世界坐标。 */
const FRAME: TwinFrameView = { mode: 'model', origin: [0, 0, 0] }

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
    subtitle: '',
    footnote: '',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 1, 0],
    rotation: [0, 0, 0],
    fields: [
      {
        key: 'f1',
        label: '温度',
        unit: '℃',
        prefix: '',
        decimals: null,
        staticText: '',
        kind: 'text',
        min: 0,
        max: 100,
        levels: [],
      },
    ],
    billboard: 'face',
    style: {
      variant: 'card',
      orient: 'center',
      accent: '--accent-primary',
      background: '',
      width: 0,
      height: 0,
      columns: 1,
      density: 'normal',
      scan: false,
      corners: false,
      grid: false,
      fontScale: 1,
      scale: 1,
      animate: false,
      pulse: false,
    },
    visibility: ALWAYS_VISIBLE,
    ...over,
  }
}

function mountInspector(panel: TwinPanel, picking = false) {
  return mount(PanelInspector, {
    props: {
      modelValue: panel,
      frame: FRAME,
      anchors: ANCHORS,
      picking,
      gizmoMode: 'translate' as const,
    },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

function written(wrapper: Wrapper): TwinPanel {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回信息牌')
  return events[0][0] as TwinPanel
}

/**
 * ⚠ 认 `label` 也认 `ariaLabel`：DtSwitch 有可见标签时用前者，没有时才用后者，
 * 只认一边会让「把裸开关换成带标签的开关」这种纯观感改动把用例整片打红。
 */
function switchByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSwitch)
    .find(
      (item) =>
        item.props('label') === label || item.props('ariaLabel') === label,
    )
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

describe('锚点与坐标二选一', () => {
  it('锚定之后写明坐标不生效', () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'a1' }))

    expect(wrapper.text()).toContain('下面的坐标不生效')
    expect(wrapper.text()).toContain('坐标（当前不生效）')
  })

  it('没锚定时不说这句，也不给坐标加不生效标记', () => {
    const wrapper = mountInspector(panelOf())

    expect(wrapper.text()).not.toContain('不生效')
  })

  it('锚定到一个不存在的锚点时报出来', () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'ghost' }))

    expect(wrapper.text()).toContain('ghost 不存在')
  })

  it('下拉里有「不锚定」这一档，改回去就用自己的坐标', async () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'a1' }))
    await selectByLabel(wrapper, '锚定').setValue('')

    expect(written(wrapper).anchorId).toBe('')
  })
})

describe('从视口拾取位置', () => {
  it('没锚定时给拾取按钮，点一下请求拾取', async () => {
    const wrapper = mountInspector(panelOf())

    const button = wrapper
      .findAll('button')
      .find((item) => item.text().includes('从视口拾取位置'))
    expect(button).toBeDefined()
    await button?.trigger('click')

    expect(wrapper.emitted('requestPickPosition')).toHaveLength(1)
  })

  it('拾取中按钮变成取消，点一下取消拾取', async () => {
    const wrapper = mountInspector(panelOf(), true)

    const button = wrapper
      .findAll('button')
      .find((item) => item.text().includes('取消拾取'))
    expect(button).toBeDefined()
    await button?.trigger('click')

    expect(wrapper.emitted('cancelPick')).toHaveLength(1)
  })

  // 锚定生效时位置由锚点定，拾取回来的坐标写了也没反应
  it('锚定之后不给拾取按钮', () => {
    const wrapper = mountInspector(panelOf({ anchorId: 'a1' }))

    expect(wrapper.text()).not.toContain('从视口拾取位置')
  })
})

describe('旋转', () => {
  it('钉死朝向档给旋转输入，改一轴整份写回', async () => {
    const wrapper = mountInspector(panelOf({ billboard: 'fixed' }))

    expect(wrapper.text()).toContain('旋转')
    // ⚠ DtNumberInput 要 change 才落定，input 只改显示
    await wrapper.find('input[aria-label="Y°"]').setValue('45')
    await wrapper.find('input[aria-label="Y°"]').trigger('change')

    expect(written(wrapper).rotation).toEqual([0, 45, 0])
  })

  // 另两档朝向每帧被相机接管，摆一个改了没反应的输入框比没有更糟
  it('跟随相机的两档不摆旋转控件', () => {
    const wrapper = mountInspector(panelOf({ billboard: 'face' }))

    expect(wrapper.text()).not.toContain('旋转')
    expect(wrapper.text()).not.toContain('视口里怎么拖')
  })

  it('钉死朝向且没锚定时给手柄模式切换，切到拖旋转', async () => {
    const wrapper = mountInspector(panelOf({ billboard: 'fixed' }))

    const rotate = wrapper
      .findAll('button')
      .find((item) => item.text().includes('拖旋转'))
    expect(rotate).toBeDefined()
    await rotate?.trigger('click')

    expect(wrapper.emitted('update:gizmoMode')).toEqual([['rotate']])
  })

  // 锚定的牌没有手柄可拖，切换摆出来也是空的
  it('锚定之后旋转输入还在，手柄切换收起', () => {
    const wrapper = mountInspector(
      panelOf({ billboard: 'fixed', anchorId: 'a1' }),
    )

    expect(wrapper.text()).toContain('旋转')
    expect(wrapper.text()).not.toContain('视口里怎么拖')
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
