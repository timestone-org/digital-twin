/**
 * @fileoverview 契约：卡片外观字段组的第一约束不是「能配」，而是「**不动控件就一条键都不写**」——
 * 写进去就把当下的默认观感固化住，以后调整平台默认将影响不到这些大屏。
 * 这里锁住：挂载 / 展开分组零写入、清空即删键、布尔照实写、0 与负数不被空值逻辑吞掉。
 */
import { DtColorInput, DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CardStyleFields from '@/pages/DashboardEditor/components/CardStyleFields.vue'

function mountFields(modelValue: Record<string, unknown> = {}) {
  return mount(CardStyleFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

/** 展开某个高级分组（默认只有「边框」是展开的）。 */
async function openGroup(wrapper: Wrapper, label: string): Promise<void> {
  const head = wrapper
    .findAll('.card-style__group')
    .find((button) => button.text().includes(label))
  if (!head) throw new Error(`未找到分组折叠头：${label}`)
  if (head.attributes('aria-expanded') !== 'true') await head.trigger('click')
}

async function openAll(wrapper: Wrapper): Promise<void> {
  for (const label of ['边框', '四角', '标题条', '文字', '交互']) {
    await openGroup(wrapper, label)
  }
}

function numField(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtNumberInput)
    .find((item) => item.props('label') === label)
  if (!found) throw new Error(`未找到数字控件：${label}`)
  return found
}

function selectField(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (!found) throw new Error(`未找到下拉控件：${label}`)
  return found
}

function switchField(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSwitch)
    .find((item) => item.props('ariaLabel') === label)
  if (!found) throw new Error(`未找到开关控件：${label}`)
  return found
}

/** 第一次写回的整包。 */
function written(wrapper: Wrapper): Record<string, unknown> {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回任何值')
  return events[0][0] as Record<string, unknown>
}

describe('不动控件就不写值', () => {
  it('挂载不写回任何值', () => {
    expect(mountFields().emitted('update:modelValue')).toBeUndefined()
  })

  it('展开全部分组仍不写回任何值', async () => {
    const wrapper = mountFields()
    await openAll(wrapper)

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('空袋子下所有数值控件回填为未设置，只显示占位符', async () => {
    const wrapper = mountFields()
    await openAll(wrapper)

    for (const input of wrapper.findAllComponents(DtNumberInput)) {
      expect(input.props('modelValue')).toBeUndefined()
    }
  })

  it('空袋子下所有枚举控件回填为「（默认）」空串', async () => {
    const wrapper = mountFields()
    await openAll(wrapper)
    const enums = wrapper
      .findAllComponents(DtSelect)
      .filter((item) => item.props('label') !== '外观风格')

    expect(enums.length).toBe(7)
    for (const item of enums) expect(item.props('modelValue')).toBe('')
  })

  it('默认开的两个开关把未设置画成开，否则面板与渲染相反', () => {
    const wrapper = mountFields()

    expect(switchField(wrapper, '四角辉光').props('modelValue')).toBe(true)
    expect(switchField(wrapper, '显示标题').props('modelValue')).toBe(true)
    expect(switchField(wrapper, '呼吸描边').props('modelValue')).toBe(false)
  })
})

describe('分组折叠', () => {
  it('五个高级分组默认只展开「边框」', () => {
    const heads = mountFields().findAll('.card-style__group')

    expect(heads.map((head) => head.text())).toEqual([
      '边框',
      '四角',
      '标题条',
      '文字',
      '交互',
    ])
    expect(heads.map((head) => head.attributes('aria-expanded'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
  })

  it('收起分组后其控件不再渲染，其他分组不受影响', async () => {
    const wrapper = mountFields()
    await openGroup(wrapper, '四角')
    const head = wrapper
      .findAll('.card-style__group')
      .find((item) => item.text() === '边框')
    if (!head) throw new Error('未找到分组折叠头：边框')

    await head.trigger('click')

    const hasPulse = wrapper
      .findAllComponents(DtSwitch)
      .some((item) => item.props('ariaLabel') === '呼吸描边')
    expect(hasPulse).toBe(false)
    expect(selectField(wrapper, '角标形状').exists()).toBe(true)
  })
})

describe('写值语义', () => {
  it('布尔照实写 true 与 false，模块级要靠显式 false 压过大屏级', async () => {
    const wrapper = mountFields()
    await switchField(wrapper, '呼吸描边').trigger('click')
    expect(written(wrapper)).toEqual({ borderPulse: true })

    const off = mountFields({ borderPulse: true })
    await switchField(off, '呼吸描边').trigger('click')
    expect(written(off)).toEqual({ borderPulse: false })
  })

  it('数值清空即删键，回到平台默认', () => {
    const wrapper = mountFields({ borderPulseDuration: 6, radius: 4 })

    numField(wrapper, '呼吸周期').vm.$emit('update:modelValue', undefined)

    expect(written(wrapper)).toEqual({ radius: 4 })
  })

  it('枚举选「（默认）」同样删键', () => {
    const wrapper = mountFields({ borderSide: 'top' })
    expect(selectField(wrapper, '描边边数').props('modelValue')).toBe('top')

    selectField(wrapper, '描边边数').vm.$emit('update:modelValue', '')

    expect(written(wrapper)).toEqual({})
  })

  it('取色控件填的值原样写入', () => {
    const wrapper = mountFields()
    const color = wrapper
      .findAllComponents(DtColorInput)
      .find((item) => item.props('label') === '悬停边框色')
    if (!color) throw new Error('未找到取色控件：悬停边框色')

    color.vm.$emit('update:modelValue', 'var(--accent-primary)')

    expect(written(wrapper)).toEqual({ borderHover: 'var(--accent-primary)' })
  })

  it('0 是合法值不是「没填」，存量的负内缩照常回填', async () => {
    const wrapper = mountFields({ cornerOffset: -1 })
    await openGroup(wrapper, '四角')
    expect(numField(wrapper, '角标内缩').props('modelValue')).toBe(-1)

    numField(wrapper, '角标内缩').vm.$emit('update:modelValue', 0)

    expect(written(wrapper)).toEqual({ cornerOffset: 0 })
  })

  it('数值回填容忍后端 JSON 的数字串，非数值脏值当作未设置', async () => {
    const wrapper = mountFields({ cornerSize: '4', cornerOpacity: 'x' })
    await openGroup(wrapper, '四角')

    expect(numField(wrapper, '角标尺寸').props('modelValue')).toBe(4)
    expect(numField(wrapper, '角标透明度').props('modelValue')).toBeUndefined()
  })

  it('字重存成数字也能回填到对应选项', async () => {
    const wrapper = mountFields({ titleFontWeight: 400 })
    await openGroup(wrapper, '标题条')

    expect(selectField(wrapper, '标题字重').props('modelValue')).toBe('400')
  })

  it('改一项不动其余键', () => {
    const wrapper = mountFields({ radius: 4, titleGap: 8 })

    numField(wrapper, '圆角').vm.$emit('update:modelValue', 12)

    expect(written(wrapper)).toEqual({ radius: 12, titleGap: 8 })
  })
})

describe('标题内边距', () => {
  it('改一格时用平台现值补齐另外两格，渲染侧只认三项全合法的数组', async () => {
    const wrapper = mountFields()
    await openGroup(wrapper, '标题条')

    numField(wrapper, '上').vm.$emit('update:modelValue', 10)

    expect(written(wrapper)).toEqual({ titlePadding: [10, 12, 6] })
  })

  it('已有值时只替换对应位', async () => {
    const wrapper = mountFields({ titlePadding: [10, 12, 8] })
    await openGroup(wrapper, '标题条')
    expect(numField(wrapper, '左右').props('modelValue')).toBe(12)

    numField(wrapper, '下').vm.$emit('update:modelValue', 4)

    expect(written(wrapper)).toEqual({ titlePadding: [10, 12, 4] })
  })

  it('清空最后一格整条删键', async () => {
    const wrapper = mountFields({ titlePadding: [undefined, undefined, 8] })
    await openGroup(wrapper, '标题条')

    numField(wrapper, '下').vm.$emit('update:modelValue', undefined)

    expect(written(wrapper)).toEqual({})
  })

  it('长度不为 3 的脏值当作未设置', async () => {
    const wrapper = mountFields({ titlePadding: [10, 12] })
    await openGroup(wrapper, '标题条')

    expect(numField(wrapper, '上').props('modelValue')).toBeUndefined()
  })
})

describe('外观风格', () => {
  it('空袋子回填「平台默认」', () => {
    expect(selectField(mountFields(), '外观风格').props('modelValue')).toBe(
      'default',
    )
  })

  it('选一个风格整批写入，一步到位', () => {
    const wrapper = mountFields()

    selectField(wrapper, '外观风格').vm.$emit('update:modelValue', 'minimal')

    const next = written(wrapper)
    expect(next['borderStyle']).toBe('breathe')
    expect(next['titlePadding']).toEqual([10, 12, 8])
    expect(next['corners']).toBe(false)
  })

  it('选回平台默认把风格写过的键全部删掉，别的键留着', () => {
    const wrapper = mountFields({ radius: 4, hoverLift: 6 })

    selectField(wrapper, '外观风格').vm.$emit('update:modelValue', 'default')

    expect(written(wrapper)).toEqual({ hoverLift: 6 })
  })

  it('动过单项后回填成不可选的「自定义」，不谎报成平台默认', async () => {
    const wrapper = mountFields({ radius: 4 })
    const control = selectField(wrapper, '外观风格')
    expect(control.props('modelValue')).toBe('custom')

    await control.get('.dt-select__trigger').trigger('click')

    // 展开的选项列表是传送到 body 上的，从组件树里找不到它
    const custom = [...document.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent?.trim() === '自定义',
    )
    expect(custom?.getAttribute('aria-disabled')).toBe('true')
    wrapper.unmount()
  })
})

describe('字段覆盖面', () => {
  const REQUIRED_LABELS = [
    '边框样式',
    '卡片背景',
    '边框色',
    '悬停边框色',
    '角标色',
    '圆角',
    '四角辉光',
    '显示标题',
    '标题色',
    '呼吸描边',
    '呼吸周期',
    '描边边数',
    '角标形状',
    '角标尺寸',
    '角标辉光',
    '角标透明度',
    '角标内缩',
    '纵向对齐',
    '标题内边距',
    '竖条与文字间距',
    '标题字号',
    '标题字重',
    '标题字距',
    '竖条宽度',
    '竖条贯穿整行',
    '竖条圆角',
    '竖条辉光',
    '竖条颜色',
    '竖条脉动辅色',
    '标题脉动',
    '脉动周期',
    '右侧装饰带',
    '装饰带高度',
    '装饰带透明度',
    '毛玻璃模糊',
    '悬停上浮',
    '悬停辉光',
  ]

  it('清单里的每个键都有控件，漏一个用户就配不了', async () => {
    const wrapper = mountFields()
    await openAll(wrapper)
    const text = wrapper.text()

    for (const label of REQUIRED_LABELS) expect(text).toContain(label)
  })
})
