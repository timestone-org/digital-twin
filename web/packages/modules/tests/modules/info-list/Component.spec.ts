/**
 * @fileoverview 守信息列表整块的渲染：分组三档（组头计数 / 页签计数用全量 / 键盘可达）、
 * 表头与数据行共用同一份列模板、空态三档各说各的、滚动视口拿到的条目数，以及迟滞那一个
 * 定时器的持有与释放。
 *
 * ⚠ 页签计数拿当前页的子集算，屏上看着完全正常——除了当前页，每一页都写着自己那一份的
 * 行数。⚠ 空态三档合成一句之后，「该去配点位」与「该去查现场」就再也分不开了。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/info-list/Component.vue'
import manifest from '../../../src/modules/info-list/manifest'
import { LIST_SLOT_KEY } from '../../../src/modules/info-list/rows'
import { configDefaults } from '../../../src/shared/config'
import ScrollList from '../../../src/shared/ScrollList.vue'

const DEFAULTS = configDefaults(manifest.configSchema)

type Slots = Record<string, ModuleSlotMeta>

function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Slots,
) {
  return mount(Component, {
    props: {
      config: { ...DEFAULTS, ...config },
      values,
      ...(slots === undefined ? {} : { meta: { slots } }),
    },
  })
}

type Rendered = ReturnType<typeof render>

/** 注入袋：逐行的主读数。 */
function readings(...values: unknown[]): Record<string, unknown> {
  return { [LIST_SLOT_KEY]: values.map((value) => ({ value })) }
}

function texts(wrapper: Rendered, selector: string): string[] {
  return wrapper.findAll(selector).map((node) => node.text())
}

const THREE_GROUPS = [
  { label: '一号罐', group: '蓄热' },
  { label: '二号罐', group: '蓄热' },
  { label: '冷罐', group: '蓄冷' },
]

describe('信息列表的骨架', () => {
  it('标题交给共用面板，档位类与整块变量都落在列表根上', () => {
    const wrapper = render({ title: '末端能耗', valueSize: 20 })
    const list = wrapper.get('.il-list')

    expect(wrapper.find('.module-panel').exists()).toBe(true)
    expect(list.classes()).toContain('il--shell-divider')
    expect(list.attributes('style')).toContain('--il-value-size: 20px')
  })

  it('滚动视口拿到的条目数就是真画出来的行数', async () => {
    const wrapper = render(
      { items: [{ label: '甲' }, { label: '乙' }, { label: '丙' }] },
      readings(1, 2, 3),
    )
    await nextTick()

    expect(wrapper.findAll('.il-row')).toHaveLength(3)
    expect(wrapper.getComponent(ScrollList).props()).toMatchObject({
      itemCount: 3,
      autoScroll: true,
      secondsPerItem: 3,
    })
  })

  it('滚动开关与每项秒数照原样往下传', () => {
    const wrapper = render({ autoScroll: false, scrollSpeed: 7 })

    expect(wrapper.getComponent(ScrollList).props()).toMatchObject({
      autoScroll: false,
      secondsPerItem: 7,
    })
  })
})

describe('三列对齐档的表头', () => {
  it('三列表头才出，段位编排档下一行都不画', () => {
    const stacked = render({ columnHeader: { show: true } })
    const columns = render({
      rowLayout: 'columns',
      columnHeader: { show: true, name: '名称', value: '当日', unit: '单位' },
    })

    expect(stacked.find('.il-head').exists()).toBe(false)
    expect(texts(columns, '.il-head__cell')).toEqual(['名称', '当日', '单位'])
  })

  it('表头关掉时只剩数据行', () => {
    const wrapper = render({
      rowLayout: 'columns',
      columnHeader: { show: false, name: '名称', value: '数值', unit: '单位' },
    })

    expect(wrapper.find('.il-head').exists()).toBe(false)
  })

  it('列模板只有一份：整块注入变量，表头与数据行都引用它', async () => {
    const wrapper = render({ rowLayout: 'columns', unitSize: 12 }, readings(1))
    await nextTick()

    expect(wrapper.get('.il-list').attributes('style')).toContain(
      '--il-cols-tpl',
    )
    expect(wrapper.get('.il-row').attributes('style')).toContain(
      'grid-template-columns: var(--il-cols-tpl',
    )
  })
})

describe('分组的三档', () => {
  it('不分组时一段到底，既没有组头也没有页签', async () => {
    const wrapper = render({ items: THREE_GROUPS }, readings(1, 2, 3))
    await nextTick()

    expect(wrapper.find('.il-section').exists()).toBe(false)
    expect(wrapper.find('.il-tabs').exists()).toBe(false)
    expect(wrapper.findAll('.il-row')).toHaveLength(3)
  })

  it('组头档按出现序分段，组头带这一段的行数', async () => {
    const wrapper = render(
      { items: THREE_GROUPS, grouping: 'section' },
      readings(1, 2, 3),
    )
    await nextTick()

    expect(texts(wrapper, '.il-section__name')).toEqual(['蓄热', '蓄冷'])
    expect(texts(wrapper, '.il-section__count')).toEqual(['2', '1'])
  })

  it('没填分组的行落进「其它」段，不并进任何一个具名段', async () => {
    const wrapper = render(
      {
        items: [{ label: '甲', group: '蓄热' }, { label: '乙' }],
        grouping: 'section',
      },
      readings(1, 2),
    )
    await nextTick()

    expect(texts(wrapper, '.il-section__name')).toEqual(['蓄热', '其它'])
  })

  it('页签的计数用全量在场行，不是当前页的子集', async () => {
    const wrapper = render(
      { items: THREE_GROUPS, grouping: 'tabs' },
      readings(1, 2, 3),
    )
    await nextTick()

    expect(texts(wrapper, '.il-tab__name')).toEqual(['全部', '蓄热', '蓄冷'])
    expect(texts(wrapper, '.il-tab__count')).toEqual(['3', '2', '1'])
  })

  it('点一页只留那一页的行，页签自己的计数不跟着塌', async () => {
    const wrapper = render(
      { items: THREE_GROUPS, grouping: 'tabs' },
      readings(1, 2, 3),
    )
    await nextTick()
    await wrapper.findAll('.il-tab')[2]?.trigger('click')

    expect(wrapper.findAll('.il-row')).toHaveLength(1)
    expect(texts(wrapper, '.il-tab__count')).toEqual(['3', '2', '1'])
  })

  it('页签是键盘可达的：有 role 与选中态，回车和空格都能切', async () => {
    const wrapper = render(
      { items: THREE_GROUPS, grouping: 'tabs' },
      readings(1, 2, 3),
    )
    await nextTick()
    const tabs = wrapper.findAll('.il-tab')

    expect(wrapper.get('.il-tabs').attributes('role')).toBe('tablist')
    expect(tabs[0]?.attributes('role')).toBe('tab')
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(tabs[0]?.attributes('tabindex')).toBe('0')

    await tabs[1]?.trigger('keydown.enter')
    expect(wrapper.findAll('.il-tab')[1]?.classes()).toContain('is-active')

    await tabs[0]?.trigger('keydown.space')
    expect(wrapper.findAll('.il-tab')[0]?.classes()).toContain('is-active')
  })

  it('初始选中来自配置，指不到任何一页时看全部', async () => {
    const picked = render(
      { items: THREE_GROUPS, grouping: 'tabs', defaultGroup: '蓄冷' },
      readings(1, 2, 3),
    )
    const stray = render(
      { items: THREE_GROUPS, grouping: 'tabs', defaultGroup: '没有这一页' },
      readings(1, 2, 3),
    )
    await nextTick()

    expect(picked.findAll('.il-row')).toHaveLength(1)
    expect(stray.findAll('.il-row')).toHaveLength(3)
  })

  it('页签条摆在滚动视口外面——真滚起来时槽里的内容会被复制一份', () => {
    const wrapper = render({ items: THREE_GROUPS, grouping: 'tabs' })

    expect(wrapper.getComponent(ScrollList).find('.il-tabs').exists()).toBe(
      false,
    )
  })
})

describe('空态的三档', () => {
  it('一行都没配时说的是「去加一行」', () => {
    const wrapper = render({ items: [], noRowsText: '还没配点位' })

    expect(wrapper.get('.il-empty').text()).toBe('还没配点位')
    expect(wrapper.find('.dt-scrolllist').exists()).toBe(false)
  })

  it('配了行但一条都没过筛选时说的是「平静」', async () => {
    const wrapper = render(
      { items: [{ label: '甲' }], rowFilter: 'alarm', calmText: '当前无告警' },
      readings(1),
      { [`${LIST_SLOT_KEY}[0].value`]: { state: 'ok' } },
    )
    await nextTick()

    expect(wrapper.get('.il-empty').text()).toBe('当前无告警')
  })

  it('绑了却一个读数都没回来时报的是有几个点位没数据', async () => {
    const wrapper = render(
      { items: [{ label: '甲' }, { label: '乙' }], rowFilter: 'alarm' },
      {},
      {
        [`${LIST_SLOT_KEY}[0].value`]: { state: 'error', message: '断连' },
        [`${LIST_SLOT_KEY}[1].value`]: { state: 'pending' },
      },
    )
    await nextTick()

    expect(wrapper.get('.il-empty').text()).toBe('2 个点位无数据')
  })

  it('有行要画时空态那一句一个字都不出', async () => {
    const wrapper = render({ items: [{ label: '甲' }] }, readings(1))
    await nextTick()

    expect(wrapper.find('.il-empty').exists()).toBe(false)
  })
})

/** 一条「超过 80 就报」的规则，配上只看告警的筛选。 */
const OVER: Record<string, unknown> = {
  items: [{ label: '甲' }],
  rowFilter: 'alarm',
  rules: [{ op: 'gt', value: 80, level: 'danger', color: '', label: '超限' }],
}

describe('告警迟滞的定时器', () => {
  // ⚠ 只假造 setTimeout 与 Date：滚动视口用的是 requestAnimationFrame，
  //   一并假造会让 getTimerCount 数进它那一份，而这里要数的是迟滞那一个
  function freeze(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('清除之后按迟滞时长多留一会儿，到期才自己走', async () => {
    freeze()
    const wrapper = render({ ...OVER, holdSeconds: 30 }, readings(90))
    await nextTick()
    expect(wrapper.findAll('.il-row')).toHaveLength(1)

    await wrapper.setProps({ values: readings(10) })
    await nextTick()
    expect(wrapper.findAll('.il-row')).toHaveLength(1)

    vi.advanceTimersByTime(31_000)
    await nextTick()

    expect(wrapper.findAll('.il-row')).toHaveLength(0)
  })

  it('迟滞关掉时清除即移除，也不留一个定时器', async () => {
    freeze()
    const wrapper = render({ ...OVER, holdSeconds: 0 }, readings(90))
    await nextTick()

    await wrapper.setProps({ values: readings(10) })
    await nextTick()

    expect(wrapper.findAll('.il-row')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('卸载时把在飞的那个定时器收回——大屏一开就是几天', async () => {
    freeze()
    const wrapper = render({ ...OVER, holdSeconds: 30 }, readings(90))
    await nextTick()
    await wrapper.setProps({ values: readings(10) })
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('整块的联动上抛', () => {
  it('配了联动值的行吞掉冒泡，没配的放它上去让整块兜底', async () => {
    const onBody = vi.fn()
    document.body.addEventListener('click', onBody)
    const wrapper = mount(Component, {
      attachTo: document.body,
      props: {
        config: {
          ...DEFAULTS,
          items: [{ label: '甲', emitValue: 'a' }, { label: '乙' }],
        },
        values: readings(1, 2),
      },
    })
    await nextTick()

    await wrapper.findAll('.il-row')[0]?.trigger('click')
    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: 'a' }],
    ])
    expect(onBody).not.toHaveBeenCalled()

    await wrapper.findAll('.il-row')[1]?.trigger('click')
    expect(wrapper.emitted('interaction')).toHaveLength(1)
    expect(onBody).toHaveBeenCalledTimes(1)

    document.body.removeEventListener('click', onBody)
    wrapper.unmount()
  })
})
