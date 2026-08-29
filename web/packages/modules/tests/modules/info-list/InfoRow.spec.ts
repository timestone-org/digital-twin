/**
 * @fileoverview 守一行的声明式段位：`lead ｜ 最多三段 lines ｜ tail`，外加扩展指标行。
 * 八个参考模块的行结构必须全部落在这一张网格上，四个最难的（容器卡的占比行、末端卡的
 * 第二行、告警行的四列、源卡的并排脚行 + 扩展指标行）逐个钉在这里。
 * ⚠ 段位落错格、空段占掉一整行、三列对齐档与表头各写一份列模板，三样都不报错。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import InfoRow from '../../../src/modules/info-list/InfoRow.vue'
import {
  readListLook,
  type ListLook,
} from '../../../src/modules/info-list/look'
import type {
  BadgeView,
  MeterView,
} from '../../../src/modules/info-list/rowAlarm'
import type { ListRow } from '../../../src/modules/info-list/rows'
import type { ReadingView } from '../../../src/modules/info-list/rowValue'

const NO_METER: MeterView = { show: false, label: '', text: '', fill: '' }
const NO_BADGE: BadgeView = {
  kind: 'none',
  status: null,
  text: '',
  color: '',
  vars: {},
}

function reading(text: string, unit = ''): ReadingView {
  return { state: 'ok', text, unit, reason: '' }
}

function bar(label: string, text: string): MeterView {
  return { show: true, label, text, fill: '40%' }
}

function row(over: Partial<ListRow> = {}): ListRow {
  return {
    key: 'row-a',
    index: 0,
    label: '一号机组',
    group: '',
    tag: '',
    desc: '',
    time: '',
    icon: '',
    value: reading('12.3', 'kWh'),
    sub: reading('—'),
    subLabel: '',
    badge: NO_BADGE,
    meter: NO_METER,
    meter2: NO_METER,
    extras: [],
    alarmText: '',
    level: null,
    rank: -1,
    blink: false,
    isAlarm: false,
    emitValue: '',
    vars: {},
    ...over,
  }
}

function look(config: Record<string, unknown> = {}): ListLook {
  return readListLook(config)
}

function render(source: ListRow, shape: ListLook) {
  return mount(InfoRow, { props: { row: source, look: shape } })
}

type Rendered = ReturnType<typeof render>

function place(wrapper: Rendered, at: string): string {
  return wrapper.get(`.il-group--${at}`).attributes('style') ?? ''
}

function texts(wrapper: Rendered, selector: string): string[] {
  return wrapper.findAll(selector).map((node) => node.text())
}

const LABEL_VALUE = [{ left: 'label', right: 'value' }]

describe('段位落格', () => {
  it('左组落正文左列、右组落正文右列，同一段共用一条网格行', () => {
    const wrapper = render(row(), look({ rowLines: LABEL_VALUE }))

    expect(place(wrapper, 'left1')).toContain('grid-row: 1')
    expect(place(wrapper, 'right1')).toContain('grid-row: 1')
    expect(place(wrapper, 'left1')).toContain('grid-column: 1')
    expect(place(wrapper, 'right1')).toContain('grid-column: 2')
  })

  it('前导列与两个尾列各占一列，且跨全部段', () => {
    const wrapper = render(
      row({ time: '09:30:00', alarmText: '出口温度越限' }),
      look({
        rowLines: [{ left: 'label' }, { left: 'alarmText' }],
        rowShape: { lead: 'icon', tail: 'value', tail2: 'time' },
      }),
    )

    expect(place(wrapper, 'lead')).toContain('grid-row: 1 / span 2')
    expect(place(wrapper, 'tail')).toContain('grid-row: 1 / span 2')
    expect(place(wrapper, 'tail2')).toContain('grid-row: 1 / span 2')
  })

  it('没有右组时列模板里就没有那一列，空列会白白多出一道列间距', () => {
    const wrapper = render(
      row({
        alarmText: '出口温度越限',
        time: '09:30:00',
        badge: { ...NO_BADGE, kind: 'severity', text: '危急' },
      }),
      look({
        rowLines: [{ left: 'label' }, { left: 'alarmText' }],
        rowShape: { lead: 'badge', tail: 'value', tail2: 'time' },
        badge: { kind: 'severity', style: 'dot' },
      }),
    )

    expect(wrapper.get('.il-row').attributes('style')).toContain(
      'grid-template-columns: auto minmax(0, 1fr) auto auto',
    )
  })

  it('一件都画不出来的段不占网格行——中间空一段会多出一条空行与一道行间距', () => {
    const wrapper = render(
      row({ tag: '' }),
      look({
        rowLines: [{ left: 'label' }, { left: 'tag' }, { left: 'value' }],
      }),
    )

    expect(wrapper.findAll('.il-group')).toHaveLength(2)
    expect(place(wrapper, 'left2')).toContain('grid-row: 2')
  })
})

describe('四个参考模块的行结构', () => {
  it('容器卡：占比条与水温读数在第二段左右分列，液位条独占第三段', () => {
    const wrapper = render(
      row({
        sub: reading('45.2', '℃'),
        subLabel: '水温',
        meter: bar('占比', '68%'),
        meter2: bar('液位', '52%'),
      }),
      look({
        rowLines: [
          { left: 'label', right: 'value' },
          { left: 'meter', right: 'sub' },
          { left: 'meter2' },
        ],
      }),
    )

    expect(place(wrapper, 'left2')).toContain('grid-row: 2')
    expect(place(wrapper, 'right2')).toContain('grid-row: 2')
    expect(place(wrapper, 'left3')).toContain('grid-row: 3')
    expect(wrapper.get('.il-group--right2').text()).toContain('水温')
    expect(wrapper.findAll('.dt-meter')).toHaveLength(2)
  })

  it('末端卡：行首名称与分类标签同组、状态徽章在右，第二段是读数与占比条', () => {
    const wrapper = render(
      row({
        tag: '采暖',
        badge: { ...NO_BADGE, kind: 'device', status: 'running' },
        meter: bar('占比', '18%'),
      }),
      look({
        rowLines: [
          { left: 'label', left2: 'tag', right: 'badge' },
          { left: 'value', right: 'meter' },
        ],
      }),
    )

    expect(texts(wrapper, '.il-group--left1 > *')).toEqual(['一号机组', '采暖'])
    expect(wrapper.get('.il-group--right1').text()).toBe('运行')
    expect(wrapper.find('.il-group--right2 .dt-meter').exists()).toBe(true)
  })

  it('告警行：行首严重度词 + 名称与命中文案上下两行 + 右侧读数与时刻', () => {
    const wrapper = render(
      row({
        alarmText: '出口温度越限',
        time: '09:30:00',
        value: reading('86.4', '℃'),
        badge: {
          ...NO_BADGE,
          kind: 'severity',
          text: '危急',
          color: 'var(--state-danger)',
        },
      }),
      look({
        rowLines: [{ left: 'label' }, { left: 'alarmText' }],
        rowShape: { lead: 'badge', tail: 'value', tail2: 'time' },
        badge: { kind: 'severity', style: 'dot' },
      }),
    )

    expect(wrapper.get('.il-group--lead').text()).toBe('危急')
    expect(wrapper.get('.il-group--left1').text()).toBe('一号机组')
    expect(wrapper.get('.il-group--left2').text()).toBe('出口温度越限')
    expect(wrapper.get('.il-group--tail').text()).toBe('86.4℃')
    expect(wrapper.get('.il-group--tail2').text()).toBe('09:30:00')
  })

  it('源卡：能效与占比条在同一段左右分列，扩展指标行独占一行并铺满正文列', () => {
    const wrapper = render(
      row({
        icon: '/oss/pump.png',
        tag: '余热',
        sub: reading('3.15'),
        subLabel: '能效',
        badge: { ...NO_BADGE, kind: 'device', status: 'running' },
        meter: bar('占比', '31%'),
        extras: [
          { key: '0:功率', label: '功率', text: '12', unit: 'kW' },
          { key: '1:温度', label: '温度', text: '55', unit: '℃' },
        ],
      }),
      look({
        rowLines: [
          { left: 'label' },
          { left: 'badge', left2: 'tag', right: 'value' },
          { left: 'sub', right: 'meter' },
        ],
        rowShape: { lead: 'icon', extras: true },
      }),
    )

    expect(place(wrapper, 'left3')).toContain('grid-row: 3')
    expect(place(wrapper, 'right3')).toContain('grid-row: 3')
    expect(place(wrapper, 'extras')).toContain('grid-row: 4')
    expect(place(wrapper, 'extras')).toContain('grid-column: 2 / 4')
    expect(texts(wrapper, '.il-text--extra')).toEqual(['功率12kW', '温度55℃'])
  })
})

describe('两个徽章位', () => {
  it('状态徽章与分类标签同时挂在行首——单选枚举装不下两个', () => {
    const wrapper = render(
      row({
        tag: '余热',
        badge: { ...NO_BADGE, kind: 'device', status: 'standby' },
      }),
      look({ rowLines: [{ left: 'badge', left2: 'tag', right: 'value' }] }),
    )

    expect(wrapper.get('.dt-status-badge').text()).toBe('待机')
    expect(wrapper.get('.il-text--tag').text()).toBe('余热')
  })

  it('徽章样式档由整块给，逐枚徽章不各配一份', () => {
    const wrapper = render(
      row({ badge: { ...NO_BADGE, kind: 'rule', text: '待执行' } }),
      look({
        rowLines: [{ left: 'label', right: 'badge' }],
        badge: { kind: 'rule', style: 'solid' },
      }),
    )

    expect(wrapper.get('.il-badge').classes()).toContain('il-badge--solid')
  })
})

describe('前导列的图标', () => {
  it('有地址就画图', () => {
    const wrapper = render(
      row({ icon: '/oss/pump.png' }),
      look({ rowLines: LABEL_VALUE, rowShape: { lead: 'icon' } }),
    )

    expect(wrapper.get('img.il-icon').attributes('src')).toBe('/oss/pump.png')
  })

  it('取不到素材图时回退一个圆点，不出碎图图标', () => {
    const wrapper = render(
      row({ icon: '' }),
      look({ rowLines: LABEL_VALUE, rowShape: { lead: 'icon' } }),
    )

    expect(wrapper.find('img.il-icon').exists()).toBe(false)
    expect(wrapper.find('.il-icon-dot').exists()).toBe(true)
  })
})

describe('扩展指标行', () => {
  const extras = [{ key: '0:功率', label: '功率', text: '12', unit: 'kW' }]

  it('开关关着时整行不画', () => {
    const wrapper = render(
      row({ extras }),
      look({ rowLines: LABEL_VALUE, rowShape: { extras: false } }),
    )

    expect(wrapper.find('.il-group--extras').exists()).toBe(false)
  })

  it('开着但一格都取不到值时也不画，不摆一行空标签', () => {
    const wrapper = render(
      row({ extras: [] }),
      look({ rowLines: LABEL_VALUE, rowShape: { extras: true } }),
    )

    expect(wrapper.find('.il-group--extras').exists()).toBe(false)
  })
})

describe('行名的截断档', () => {
  it('独占一整段时折两行', () => {
    const wrapper = render(row(), look({ rowLines: [{ left: 'label' }] }))

    expect(wrapper.get('.il-text--label').classes()).toContain('il-text--clamp')
  })

  it('与别的件同行时单行省略号', () => {
    const withRight = render(row(), look({ rowLines: LABEL_VALUE }))
    const withSecond = render(
      row({ tag: '余热' }),
      look({ rowLines: [{ left: 'label', left2: 'tag' }] }),
    )

    expect(withRight.get('.il-text--label').classes()).not.toContain(
      'il-text--clamp',
    )
    expect(withSecond.get('.il-text--label').classes()).not.toContain(
      'il-text--clamp',
    )
  })
})

describe('三列对齐档', () => {
  const columns = { rowLayout: 'columns', unitPlace: 'column' }

  it('名称 / 数值 / 单位各占一列，段位编排在这一档不生效', () => {
    const wrapper = render(
      row(),
      look({ ...columns, rowLines: [{ left: 'meter', right: 'badge' }] }),
    )

    expect(place(wrapper, 'col-name')).toContain('grid-column: 1')
    expect(place(wrapper, 'col-value')).toContain('grid-column: 2')
    expect(place(wrapper, 'col-unit')).toContain('grid-column: 3')
    expect(wrapper.find('.dt-meter').exists()).toBe(false)
  })

  it('列宽写成变量，与表头共用同一份——拆成两处字符串就会错列', () => {
    const wrapper = render(row(), look(columns))

    expect(wrapper.get('.il-row').attributes('style')).toContain(
      'grid-template-columns: var(--il-cols-tpl',
    )
  })

  it('单位不独占一列时跟着读数走，第三列整个不出', () => {
    const wrapper = render(row(), look({ rowLayout: 'columns' }))

    expect(wrapper.find('.il-group--col-unit').exists()).toBe(false)
    expect(wrapper.get('.il-group--col-value').text()).toBe('12.3kWh')
  })
})

describe('读数的四档', () => {
  it('四档各挂各的修饰类，占位符是同一个「—」', () => {
    const shape = look({ rowLines: LABEL_VALUE })
    for (const state of ['ok', 'pending', 'error', 'unbound'] as const) {
      const wrapper = render(
        row({ value: { state, text: '—', unit: '', reason: '取不到' } }),
        shape,
      )

      expect(wrapper.get('.il-text--value').classes()).toContain(
        `il-cell--${state}`,
      )
    }
  })

  it('没有读数的那一句话挂在读数上，鼠标停上去才看得全', () => {
    const wrapper = render(
      row({
        value: {
          state: 'error',
          text: '—',
          unit: '',
          reason: '取不到：通道断开',
        },
      }),
      look({ rowLines: LABEL_VALUE }),
    )

    expect(wrapper.get('.il-text--value').attributes('title')).toBe(
      '取不到：通道断开',
    )
  })

  it('有读数时不挂 title', () => {
    const wrapper = render(row(), look({ rowLines: LABEL_VALUE }))

    expect(wrapper.get('.il-text--value').attributes('title')).toBeUndefined()
  })
})

describe('行的外壳与上抛', () => {
  it('整块下发的档位类原样挂在行上，表头与行因此吃同一套档位', () => {
    const shape = look({
      rowShell: 'accent',
      dividerStyle: 'dashed',
      hover: 'lift',
    })
    const wrapper = render(row(), shape)

    for (const name of shape.classes) {
      expect(wrapper.get('.il-row').classes()).toContain(name)
    }
  })

  it('告警态与闪烁是叠在外壳之上的修饰类，不是第六档外壳', () => {
    const wrapper = render(
      row({ isAlarm: true, blink: true }),
      look({ rowShell: 'accent' }),
    )

    const classes = wrapper.get('.il-row').classes()
    expect(classes).toContain('il-row--alarm')
    expect(classes).toContain('il-row--blink')
    expect(classes).toContain('il--shell-accent')
  })

  it('逐行的颜色变量原样注入', () => {
    const wrapper = render(
      row({ vars: { '--il-row-color': 'var(--state-danger)' } }),
      look({ rowLines: LABEL_VALUE }),
    )

    expect(wrapper.get('.il-row').attributes('style')).toContain(
      '--il-row-color: var(--state-danger)',
    )
  })

  it('配了联动值的行吞冒泡，没配的放它上去让整块兜底', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)

    const picked = mount(InfoRow, {
      attachTo: document.body,
      props: { row: row({ emitValue: 'unit-a' }), look: look() },
    })
    await picked.get('.il-row').trigger('click')
    expect(spy).not.toHaveBeenCalled()
    expect(picked.emitted('pick')).toEqual([['unit-a']])
    picked.unmount()

    const plain = mount(InfoRow, {
      attachTo: document.body,
      props: { row: row({ emitValue: '' }), look: look() },
    })
    await plain.get('.il-row').trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(plain.emitted('pick')).toBeUndefined()
    plain.unmount()

    document.body.removeEventListener('click', spy)
  })
})

describe('长描述与进度件', () => {
  it('长描述独占一段并强制折行', () => {
    const wrapper = render(
      row({ desc: '每周一 08:00 巡检一次' }),
      look({ rowLines: [{ left: 'label' }, { left: 'desc' }] }),
    )

    expect(wrapper.get('p.il-desc').text()).toBe('每周一 08:00 巡检一次')
  })

  it('不画的那一条进度件整件不占位', () => {
    const wrapper = render(
      row({ meter: NO_METER, meter2: NO_METER }),
      look({ rowLines: [{ left: 'meter', right: 'meter2' }] }),
    )

    expect(wrapper.findAll('.dt-meter')).toHaveLength(0)
    expect(wrapper.findAll('.il-group')).toHaveLength(0)
  })
})
