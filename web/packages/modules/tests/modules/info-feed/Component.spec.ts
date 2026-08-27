/**
 * @fileoverview 守信息流整块的渲染：标题走共用面板、七个尺寸变量只由列表根一处下发、
 * 条目按推送数组摆行、空态那一句、按级别重排、逐行级别色，以及点一条上抛的是原文。
 *
 * ⚠ 上抛的必须是后端推来的原文而不是屏上那个「—」：没推正文的条目屏上显占位符，
 * 把占位符当值发出去，下游的筛选联动会被设成「—」，两边都不报错。
 * ⚠ 吞不吞冒泡按这一条有没有正文分开：没正文的那一条要放行，否则「整块可点」那条
 * 兜底路径在这几行上永远触发不了。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/info-feed/Component.vue'
import { FEED_SLOT_KEY } from '../../../src/modules/info-feed/feed'
import manifest from '../../../src/modules/info-feed/manifest'
import { configDefaults } from '../../../src/shared/config'
import ScrollList from '../../../src/shared/ScrollList.vue'

const DEFAULTS = configDefaults(manifest.configSchema)

/** 一条推送。 */
interface Item {
  level?: string
  text?: string
  time?: string
}

function render(
  config: Record<string, unknown> = {},
  items?: unknown,
): ReturnType<typeof mount> {
  return mount(Component, {
    props: {
      config: { ...DEFAULTS, ...config },
      values: items === undefined ? {} : { [FEED_SLOT_KEY]: items },
    },
  })
}

/** 推送袋：几条信息按到达序。 */
function feed(...rows: Item[]): Item[] {
  return rows
}

const THREE = feed(
  { level: 'danger', text: '暴雨红色预警', time: '10:24' },
  { level: 'warning', text: '大风黄色预警', time: '09:10' },
  { level: 'info', text: '空气质量良', time: '08:00' },
)

describe('信息流整块的骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', () => {
    const titled = render({ title: '气象预警' }, THREE)

    expect(titled.find('.module-panel').exists()).toBe(true)
    expect(titled.text()).toContain('气象预警')
    expect(render({}, THREE).find('.module-title-bar').exists()).toBe(false)
  })

  it('七个尺寸变量只由列表根一处下发，行上不再重算一遍', () => {
    const wrapper = render({ dotSize: 12, textSize: 18, rowPadY: 10 }, THREE)
    const style = wrapper.get('.if-list').attributes('style') ?? ''

    expect(style).toContain('--if-dot-size: 12px')
    expect(style).toContain('--if-text-size: 18px')
    expect(style).toContain('--if-row-py: 10px')
    expect(wrapper.get('.if-row').attributes('style') ?? '').not.toContain(
      '--if-dot-size',
    )
  })

  it('档位类挂在每一行上，四件按开关各自出', () => {
    const wrapper = render(
      { timePlace: 'left', rowBorderStyle: 'solid' },
      THREE,
    )
    const row = wrapper.get('.if-row')

    expect(row.classes()).toContain('if--time-left')
    expect(row.classes()).toContain('if--border-solid')
    expect(wrapper.findAll('.if-dot')).toHaveLength(3)
    expect(wrapper.findAll('.if-level').map((node) => node.text())).toEqual([
      '危险',
      '警告',
      '提示',
    ])
    expect(wrapper.findAll('.if-time').map((node) => node.text())).toEqual([
      '10:24',
      '09:10',
      '08:00',
    ])
  })
})

describe('信息流的滚动视口', () => {
  it('拿到的条目数就是真画出来的行数', () => {
    const wrapper = render({}, THREE)

    expect(wrapper.findAll('.if-row')).toHaveLength(3)
    expect(wrapper.getComponent(ScrollList).props()).toMatchObject({
      itemCount: 3,
      autoScroll: true,
      secondsPerItem: 3,
    })
  })

  it('滚动开关与每项秒数照原样往下传', () => {
    const wrapper = render({ autoScroll: false, scrollSpeed: 7 }, THREE)

    expect(wrapper.getComponent(ScrollList).props()).toMatchObject({
      autoScroll: false,
      secondsPerItem: 7,
    })
  })
})

describe('信息流的空态', () => {
  it('一个槽都没推时落空态那一句，滚动视口整个不挂', () => {
    const wrapper = render()

    expect(wrapper.get('.if-empty').text()).toBe('暂无信息')
    expect(wrapper.findComponent(ScrollList).exists()).toBe(false)
  })

  it('三个子槽全空的条目不占位——一串空白行比缺行更不诚实', () => {
    const wrapper = render({}, feed({}, { text: '  ' }, { time: '08:00' }))

    expect(wrapper.findAll('.if-row')).toHaveLength(1)
    expect(wrapper.get('.if-text').text()).toBe('—')
  })

  it('空态文案配了就照写', () => {
    expect(render({ emptyText: '暂无预警' }, []).get('.if-empty').text()).toBe(
      '暂无预警',
    )
  })
})

describe('信息流的排序与级别色', () => {
  it('缺省保持推送顺序，直通语义不重排', () => {
    const wrapper = render({}, feed(...THREE.slice().reverse()))

    expect(wrapper.findAll('.if-text').map((node) => node.text())).toEqual([
      '空气质量良',
      '大风黄色预警',
      '暴雨红色预警',
    ])
  })

  it('开了按级别排序才按权重降序，同权重保持到达序', () => {
    const wrapper = render(
      { sortByRank: true },
      feed(
        { level: 'info', text: '甲' },
        { level: 'danger', text: '乙' },
        { level: 'info', text: '丙' },
      ),
    )

    expect(wrapper.findAll('.if-text').map((node) => node.text())).toEqual([
      '乙',
      '甲',
      '丙',
    ])
  })

  it('内置档逐行注入级别色，认不出的级别一个变量都不写', () => {
    const wrapper = render(
      {},
      feed({ level: 'red', text: '甲' }, { level: '紫', text: '乙' }),
    )
    const rows = wrapper.findAll('.if-row')

    expect(rows[0]?.attributes('style')).toContain(
      '--if-level-color: var(--state-danger)',
    )
    expect(rows[1]?.attributes('style') ?? '').not.toContain('--if-level-color')
    expect(rows[1]?.find('.if-level').exists()).toBe(false)
  })

  it('色板里配的级别压过内置档，只填文字的条目颜色仍回落', () => {
    const wrapper = render(
      { levels: [{ key: 'red', label: '红色预警' }] },
      feed({ level: 'RED ', text: '甲' }),
    )

    expect(wrapper.get('.if-level').text()).toBe('红色预警')
    expect(wrapper.get('.if-row').attributes('style')).toContain(
      '--if-level-color: var(--state-danger)',
    )
  })
})

describe('信息流的联动上抛', () => {
  it('点一条上抛的是后端推来的原文，不是屏上那个占位符', async () => {
    const onBody = vi.fn()
    document.body.addEventListener('click', onBody)
    const wrapper = mount(Component, {
      attachTo: document.body,
      props: {
        config: { ...DEFAULTS },
        values: {
          [FEED_SLOT_KEY]: feed(
            { level: 'danger', text: '暴雨红色预警' },
            { level: 'warning', time: '09:10' },
          ),
        },
      },
    })

    await wrapper.findAll('.if-row')[0]?.trigger('click')
    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: '暴雨红色预警' }],
    ])
    expect(onBody).not.toHaveBeenCalled()

    await wrapper.findAll('.if-row')[1]?.trigger('click')
    expect(wrapper.emitted('interaction')).toHaveLength(1)
    expect(onBody).toHaveBeenCalledTimes(1)

    document.body.removeEventListener('click', onBody)
    wrapper.unmount()
  })
})
