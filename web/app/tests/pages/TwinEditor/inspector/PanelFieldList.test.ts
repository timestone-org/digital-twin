/**
 * @fileoverview 契约：信息牌字段列表把「行号」摆在明面上。
 *
 * 实时值按所有信息牌字段摊平后的文档序对齐，插一行会让它之后每一行整体后移一格——
 * 这是本模块最安静的坑，所以列表必须显示行号、必须能表达 `decimals = null`
 * 这一档（不定位数），并且改动一律整份写回、不就地改 props。
 */
import {
  ALWAYS_VISIBLE,
  type TwinPanel,
  type TwinPanelField,
} from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PanelFieldList from '@/pages/TwinEditor/components/fields/PanelFieldList.vue'

function fieldOf(
  key: string,
  over: Partial<TwinPanelField> = {},
): TwinPanelField {
  return {
    key,
    label: key,
    unit: '',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'text',
    min: 0,
    max: 100,
    levels: [],
    ...over,
  }
}

function panelOf(fields: TwinPanelField[]): TwinPanel {
  return {
    id: 'p1',
    name: '一号牌',
    subtitle: '',
    footnote: '',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    fields,
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
  }
}

function mountList(panel: TwinPanel, rowOffset?: number) {
  return mount(PanelFieldList, {
    props: rowOffset === undefined ? { panel } : { panel, rowOffset },
  })
}

type Wrapper = ReturnType<typeof mountList>

function written(wrapper: Wrapper): TwinPanelField[] {
  const events = wrapper.emitted('update:fields')
  if (!events?.[0]) throw new Error('没有写回字段')
  return events[0][0] as TwinPanelField[]
}

function rowButton(wrapper: Wrapper, label: string, index: number) {
  const found = wrapper.findAll(`button[aria-label="${label}"]`)[index]
  if (!found) throw new Error(`未找到第 ${index} 个「${label}」`)
  return found
}

async function pickPreset(wrapper: Wrapper, label: string): Promise<void> {
  await wrapper
    .get('[data-test="panel-field-presets"] button[aria-haspopup="menu"]')
    .trigger('click')
  const item = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (entry) => entry.textContent?.trim() === label,
  )
  if (item === undefined) throw new Error(`缺少常用测点：${label}`)
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

function lastWritten(wrapper: Wrapper): TwinPanelField[] {
  const event = wrapper.emitted<[TwinPanelField[]]>('update:fields')?.at(-1)
  if (event === undefined) throw new Error('没有写回字段')
  return event[0]
}

describe('行号', () => {
  it('给了前置行数就按全局行号标出来', () => {
    const wrapper = mountList(panelOf([fieldOf('a'), fieldOf('b')]), 3)

    expect(wrapper.text()).toContain('第 4 行')
    expect(wrapper.text()).toContain('第 5 行')
  })

  it('没给前置行数时说清楚这是本牌内序号，不假装知道全局位置', () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))

    expect(wrapper.text()).toContain('本牌第 1 行')
  })

  it('把「插一行会让后面整体后移」写在面板上', () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))

    expect(wrapper.text()).toContain('整体后移一格')
  })

  it('每行标出取值键，键里带牌 id', () => {
    const wrapper = mountList(panelOf([fieldOf('temp')]))

    expect(wrapper.text()).toContain('p1::temp')
  })
})

describe('小数位的三档', () => {
  it('null 档在界面上写明「不定位数」，不用 0 兼职', () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))

    expect(wrapper.text()).toContain('不定位数')
  })

  it('打开开关从 null 变成 0', async () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))
    await rowButton(wrapper, '指定小数位', 0).trigger('click')

    expect(written(wrapper)[0]?.decimals).toBe(0)
  })

  it('关掉开关变回 null 而不是 0', async () => {
    const wrapper = mountList(panelOf([fieldOf('a', { decimals: 2 })]))
    await rowButton(wrapper, '指定小数位', 0).trigger('click')

    expect(written(wrapper)[0]?.decimals).toBeNull()
  })
})

describe('增删改与调序', () => {
  it('添加字段给一个牌内不重名的键', async () => {
    const wrapper = mountList(panelOf([fieldOf('f1'), fieldOf('f2')]))
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('添加字段'))
    if (!add) throw new Error('未找到添加按钮')
    await add.trigger('click')

    const next = written(wrapper)
    expect(next).toHaveLength(3)
    expect(next[2]?.decimals).toBe(2)
    expect(new Set(next.map((field) => field.key)).size).toBe(3)
  })

  it('删除只去掉那一行', async () => {
    const wrapper = mountList(panelOf([fieldOf('a'), fieldOf('b')]))
    await rowButton(wrapper, '删除字段', 0).trigger('click')

    expect(written(wrapper).map((field) => field.key)).toEqual(['b'])
  })

  it('下移换的是顺序，不是内容', async () => {
    const wrapper = mountList(panelOf([fieldOf('a'), fieldOf('b')]))
    await rowButton(wrapper, '下移字段', 0).trigger('click')

    expect(written(wrapper).map((field) => field.key)).toEqual(['b', 'a'])
  })

  it('首行不能上移、末行不能下移', () => {
    const wrapper = mountList(panelOf([fieldOf('a'), fieldOf('b')]))

    expect(
      rowButton(wrapper, '上移字段', 0).attributes('disabled'),
    ).toBeDefined()
    expect(
      rowButton(wrapper, '下移字段', 1).attributes('disabled'),
    ).toBeDefined()
  })

  // ⚠ DtDropdownMenu 没有 icon prop：给它传一个只会静默丢弃。触发键与菜单
  //   开合选中必须有用例钉住，否则这个键坏掉时 typecheck 与 lint 都不响
  it('「常用测点」菜单能开、能选，选一项按预设口径加一行', async () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))
    const trigger = wrapper.find(
      '[data-test="panel-field-presets"] button[aria-haspopup="menu"]',
    )
    expect(trigger.exists()).toBe(true)
    expect(trigger.find('.dt-icon').exists()).toBe(true)

    await trigger.trigger('click')
    const item = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]',
      ),
    ].find((entry) => entry.textContent?.includes('温度'))
    if (!item) throw new Error('菜单里没有「温度」')
    item.click()
    await wrapper.vm.$nextTick()

    const next = written(wrapper)
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ label: '温度', unit: '℃', decimals: 1 })
    wrapper.unmount()
  })

  it('改标签整份换新数组，不就地改 props', async () => {
    const fields = [fieldOf('a')]
    const wrapper = mountList(panelOf(fields))
    const input = wrapper.find('input[aria-label="标签"]')
    await input.setValue('温度')

    expect(written(wrapper)[0]?.label).toBe('温度')
    expect(fields[0]?.label).toBe('a')
  })
})

describe('看不见的坑写在面板上', () => {
  it('键重复时报出来：两行会抢同一份实时值', () => {
    const wrapper = mountList(panelOf([fieldOf('t'), fieldOf('t')]))

    expect(wrapper.text()).toContain('字段键重复')
  })

  it('键不重复时不报', () => {
    const wrapper = mountList(panelOf([fieldOf('a'), fieldOf('b')]))

    expect(wrapper.text()).not.toContain('字段键重复')
  })

  it('静态文本与常量绑定的区别写在面板上', () => {
    const wrapper = mountList(panelOf([fieldOf('a')]))

    expect(wrapper.text()).toContain('不进求值')
  })

  it('一个字段都没有时说清楚画出来是空卡片', () => {
    const wrapper = mountList(panelOf([]))

    expect(wrapper.text()).toContain('空卡片')
  })
})

describe('状态测点预设', () => {
  it.each([
    {
      label: '运行状态',
      kind: 'status',
      onLabel: '运行',
      offLabel: '停止',
      onTone: 'success',
      offTone: 'neutral',
    },
    {
      label: '开关状态',
      kind: 'switch',
      onLabel: '开启',
      offLabel: '关闭',
      onTone: 'success',
      offTone: 'neutral',
    },
    {
      label: '故障状态',
      kind: 'status',
      onLabel: '故障',
      offLabel: '正常',
      onTone: 'danger',
      offTone: 'success',
    },
  ])(
    '选择$label立即生成对应的状态字段',
    async ({ label, kind, onLabel, offLabel, onTone, offTone }) => {
      const wrapper = mountList(panelOf([]))

      await pickPreset(wrapper, label)

      expect(lastWritten(wrapper)[0]).toMatchObject({
        label,
        kind,
        state: {
          onValue: '1',
          offValue: '0',
          onLabel,
          offLabel,
          unknownLabel: '未知',
          onTone,
          offTone,
        },
      })
      wrapper.unmount()
    },
  )

  it('重复添加的状态测点可分别配置，编辑一项保留另一项', async () => {
    const wrapper = mountList(panelOf([]))
    await pickPreset(wrapper, '运行状态')
    await wrapper.setProps({ panel: panelOf(lastWritten(wrapper)) })
    await pickPreset(wrapper, '运行状态')
    await wrapper.setProps({ panel: panelOf(lastWritten(wrapper)) })

    await wrapper.get('input[aria-label="开启文案"]').setValue('主机运行')

    const fields = lastWritten(wrapper)
    expect(fields[0]?.state?.onLabel).toBe('主机运行')
    expect(fields[1]?.state?.onLabel).toBe('运行')
    wrapper.unmount()
  })
})

describe('状态画法的有效配置', () => {
  it.each(['status', 'switch'] as const)(
    '%s仅展示字段标识、画法与状态配置',
    (kind) => {
      const wrapper = mountList(panelOf([fieldOf('run', { kind })]))

      expect(wrapper.find('input[aria-label="字段键"]').exists()).toBe(true)
      expect(wrapper.find('input[aria-label="标签"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="画法"]').exists()).toBe(true)
      expect(wrapper.find('input[aria-label="开启值"]').exists()).toBe(true)
      expect(wrapper.find('input[aria-label="数值前缀"]').exists()).toBe(false)
      expect(wrapper.find('input[aria-label="单位"]').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="指定小数位"]').exists()).toBe(
        false,
      )
      expect(wrapper.find('input[aria-label="静态文本"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('静态文本纯展示')
      wrapper.unmount()
    },
  )

  it('切回文本恢复原有格式配置与静态文本', async () => {
    const wrapper = mountList(
      panelOf([
        fieldOf('run', {
          kind: 'status',
          prefix: '≈',
          unit: 'kW',
          decimals: 2,
          staticText: '备用',
        }),
      ]),
    )
    expect(wrapper.find('input[aria-label="单位"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="画法"]').trigger('click')
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.trim() === '文本',
    )
    if (option === undefined) throw new Error('缺少文本画法')
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    await wrapper.setProps({ panel: panelOf(lastWritten(wrapper)) })

    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="数值前缀"]').element
        .value,
    ).toBe('≈')
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="单位"]').element.value,
    ).toBe('kW')
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="小数位"]').element.value,
    ).toBe('2')
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="静态文本"]').element
        .value,
    ).toBe('备用')
    expect(wrapper.text()).toContain('静态文本纯展示')
    wrapper.unmount()
  })

  it('混合字段只为普通字段展示数值格式和静态文本说明', () => {
    const wrapper = mountList(
      panelOf([fieldOf('run', { kind: 'switch' }), fieldOf('power')]),
    )

    expect(wrapper.findAll('input[aria-label="单位"]')).toHaveLength(1)
    expect(wrapper.findAll('input[aria-label="数值前缀"]')).toHaveLength(1)
    expect(wrapper.findAll('input[aria-label="静态文本"]')).toHaveLength(1)
    expect(wrapper.findAll('button[aria-label="指定小数位"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('静态文本纯展示')
    wrapper.unmount()
  })
})
