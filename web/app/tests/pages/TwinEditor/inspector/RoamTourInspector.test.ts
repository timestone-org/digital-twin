/**
 * @fileoverview 契约：漫游检查器把「怎么配得出一条能飞的轨迹」摆在明面上——
 * 只能从已存的视点里挑、面板上给的是秒、逐段覆盖留空就是不覆盖。
 *
 * ⚠ 时长在面板上是秒、落库是毫秒：换算写错不会报错，只表现为「镜头怎么这么慢」。
 * ⚠ 站点不够两个时预览飞不起来，按钮必须是禁用的，而不是点了没反应。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinCamera, TwinRoamTour } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RoamTourInspector from '@/pages/TwinEditor/components/inspector/RoamTourInspector.vue'

const CONFIG = normalizeTwinConfig({
  cameras: [
    { id: 'c1', name: '全景' },
    { id: 'c2', name: '俯视' },
    { id: 'c3', name: '' },
  ],
})

const CAMERAS: readonly TwinCamera[] = CONFIG.cameras

function makeTour(over: Record<string, unknown> = {}): TwinRoamTour {
  return normalizeTwinConfig({ roamTour: { enabled: true, ...over } }).roamTour
}

function mountInspector(
  modelValue: TwinRoamTour = makeTour(),
  cameras: readonly TwinCamera[] = CAMERAS,
) {
  return mount(RoamTourInspector, {
    props: { modelValue, cameras, previewing: false },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

function lastTour(wrapper: Wrapper): TwinRoamTour {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回漫游配置')
  return events[events.length - 1]?.[0] as TwinRoamTour
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有「${text}」按钮`)
  return found
}

function iconButton(wrapper: Wrapper, label: string) {
  const found = wrapper.find(`button[aria-label="${label}"]`)
  if (!found.exists()) throw new Error(`没有「${label}」`)
  return found
}

function numberInput(wrapper: Wrapper, label: string) {
  const field = wrapper
    .findAll('.dt-field')
    .find((item) => item.text().includes(label))
  const input = field?.find('input')
  if (!input?.exists()) throw new Error(`没有名为「${label}」的输入框`)
  return input
}

describe('空态给下一步', () => {
  it('一个视点都没有时告诉用户先去存机位', () => {
    const wrapper = mountInspector(makeTour(), [])

    expect(wrapper.text()).toContain('先在左边的「视点」里加两个视点')
  })

  it('只有一个视点时说清至少要两个', () => {
    const wrapper = mountInspector(makeTour(), [CAMERAS[0] as TwinCamera])

    expect(wrapper.text()).toContain('漫游至少要 2')
  })

  it('轨迹空着时告诉用户从下面挑', () => {
    const wrapper = mountInspector()

    expect(wrapper.text()).toContain('轨迹还是空的')
  })
})

describe('轨迹站点', () => {
  it('只能从已存的视点里挑，点一下就加进轨迹', async () => {
    const wrapper = mountInspector()

    await buttonByText(wrapper, '全景').trigger('click')

    expect(lastTour(wrapper).items).toEqual(['c1'])
  })

  it('已经在轨迹里的视点不再出现在待选里', () => {
    const wrapper = mountInspector(makeTour({ items: ['c1'] }))

    expect(wrapper.findAll('button').map((item) => item.text())).not.toContain(
      '全景',
    )
  })

  it('上移下移换的是飞行顺序', async () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', 'c2'] }))

    await iconButton(wrapper, '下移 全景').trigger('click')

    expect(lastTour(wrapper).items).toEqual(['c2', 'c1'])
  })

  it('移出只去掉那一站，其余顺序不动', async () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', 'c2'] }))

    await iconButton(wrapper, '移出 全景').trigger('click')

    expect(lastTour(wrapper).items).toEqual(['c2'])
  })

  // ⚠ 与视点切换同一个口径：挪一位不许顺手抹掉指向已删视点的那一项
  it('挪一位不会顺手清掉指向已删视点的那一项', async () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', '没了', 'c2'] }))

    await iconButton(wrapper, '下移 全景').trigger('click')

    const items = lastTour(wrapper).items
    expect(items).toContain('没了')
    expect(items.indexOf('c2')).toBeLessThan(items.indexOf('c1'))
  })

  it('轨迹里有已删视点时把条数说出来', () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', '没了'] }))

    expect(wrapper.text()).toContain('有 1 个视点已经被删掉了')
  })

  it('第一站不给上移、最后一站不给下移', () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', 'c2'] }))

    expect(
      iconButton(wrapper, '上移 全景').attributes('disabled'),
    ).toBeDefined()
    expect(
      iconButton(wrapper, '下移 俯视').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('时长用秒不用毫秒', () => {
  it('毫秒按秒显示', () => {
    const wrapper = mountInspector(makeTour({ segmentMs: 2500, pauseMs: 1000 }))

    expect(numberInput(wrapper, '每段飞行（秒）').element.value).toBe('2.5')
    expect(numberInput(wrapper, '每站停留（秒）').element.value).toBe('1')
  })

  it('填秒写回毫秒', async () => {
    const wrapper = mountInspector()
    const input = numberInput(wrapper, '每段飞行（秒）')

    await input.setValue('3')
    await input.trigger('blur')

    expect(lastTour(wrapper).segmentMs).toBe(3000)
  })

  it('闲置延时同样按秒给', async () => {
    const wrapper = mountInspector(
      makeTour({ idleAutoplay: true, idleAutoplayDelayMs: 60000 }),
    )
    const input = numberInput(wrapper, '闲置多少秒后开始')
    expect(input.element.value).toBe('60')

    await input.setValue('30')
    await input.trigger('blur')

    expect(lastTour(wrapper).idleAutoplayDelayMs).toBe(30000)
  })

  it('没开闲置自动播时不给延时这一栏', () => {
    const wrapper = mountInspector(makeTour({ idleAutoplay: false }))

    expect(wrapper.text()).not.toContain('闲置多少秒后开始')
  })
})

describe('预览这条轨迹', () => {
  it('站点够了才点得动，点了发预览', async () => {
    const wrapper = mountInspector(makeTour({ items: ['c1', 'c2'] }))
    const button = buttonByText(wrapper, '预览这条轨迹')

    await button.trigger('click')

    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('站点不够时按钮禁用并说明原因', () => {
    const wrapper = mountInspector(makeTour({ items: ['c1'] }))

    expect(
      buttonByText(wrapper, '预览这条轨迹').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('可用的站点还不够')
  })

  it('正在预览时按钮变成停止', async () => {
    const wrapper = mount(RoamTourInspector, {
      props: {
        modelValue: makeTour({ items: ['c1', 'c2'] }),
        cameras: CAMERAS,
        previewing: true,
      },
    })

    await buttonByText(wrapper, '停止预览').trigger('click')

    expect(wrapper.emitted('stopPreview')).toHaveLength(1)
  })
})

describe('开关', () => {
  it('没启用时不显示其余开关', () => {
    const wrapper = mountInspector(makeTour({ enabled: false }))

    expect(wrapper.text()).not.toContain('打开大屏就开始飞')
  })

  it('循环与控件是两个独立开关', async () => {
    const wrapper = mountInspector()
    const loop = wrapper
      .findAll('button[role="switch"]')
      .find((item) => item.text() === '飞完最后一站回到第一站')

    await loop?.trigger('click')

    expect(lastTour(wrapper).loop).toBe(false)
  })
})
