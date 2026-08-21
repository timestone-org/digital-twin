/**
 * @fileoverview 契约：图标只能从注册表里挑，挑出来的一定画得出来；
 * 存量配置里躺着的非法名字当场红字说出来，并给一键清掉的出路。
 * ⚠ `DtIcon` 拿到未登记的名字既不报错也什么都不画——手输框在这里是不可接受的。
 */
import { ICONS, isIconName } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import IconPicker from '@/pages/TwinEditor/components/fields/IconPicker.vue'

function render(modelValue = '') {
  return mount(IconPicker, { props: { modelValue, clearLabel: '不画图标' } })
}

type Wrapper = ReturnType<typeof render>

async function openPanel(wrapper: Wrapper): Promise<void> {
  await wrapper.get('[data-test="icon-toggle"]').trigger('click')
}

function optionNames(wrapper: Wrapper): (string | undefined)[] {
  return wrapper
    .findAll('[data-test="icon-option"]')
    .map((item) => item.attributes('data-name'))
}

function lastWrite(wrapper: Wrapper): string {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回图标名')
  return events[events.length - 1]?.[0] as string
}

describe('候选来自注册表', () => {
  it('展开之后列出注册表里的每一个名字，一个不少', async () => {
    const wrapper = render()

    await openPanel(wrapper)

    expect(optionNames(wrapper)).toEqual(Object.keys(ICONS))
  })

  it('列出来的每一个名字都真的登记过——挑出来的一定画得出来', async () => {
    const wrapper = render()
    await openPanel(wrapper)

    const bogus = optionNames(wrapper).filter(
      (name) => name === undefined || !isIconName(name),
    )

    expect(bogus).toEqual([])
  })

  it('收起时不占地方', () => {
    expect(render().find('[data-test="icon-panel"]').exists()).toBe(false)
  })
})

describe('挑与清', () => {
  it('点一个图标就写回它的名字，并把面板收起来', async () => {
    const wrapper = render()
    await openPanel(wrapper)

    await wrapper.get('[data-test="icon-option"]').trigger('click')

    expect(isIconName(lastWrite(wrapper))).toBe(true)
    expect(wrapper.find('[data-test="icon-panel"]').exists()).toBe(false)
  })

  it('清空写回空串，也就是「不画图标」', async () => {
    const wrapper = render('folder')
    await openPanel(wrapper)

    await wrapper.get('[data-test="icon-clear"]').trigger('click')

    expect(lastWrite(wrapper)).toBe('')
  })

  it('本来就没图标时不给清空按钮', async () => {
    const wrapper = render()
    await openPanel(wrapper)

    expect(wrapper.find('[data-test="icon-clear"]').exists()).toBe(false)
  })

  it('没选图标时那一行写的是清空文案，不是一段空白', () => {
    expect(render().text()).toContain('不画图标')
  })
})

describe('可访问状态', () => {
  it('「更换/收起」键的按压态随面板开合翻转', async () => {
    const wrapper = render()
    const toggle = wrapper.get('[data-test="icon-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await openPanel(wrapper)
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.classes()).toContain('dt-btn--soft')

    await openPanel(wrapper)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.classes()).toContain('dt-btn--ghost')
  })

  it('网格里当前选中的那格 aria-pressed=true，其余是 false', async () => {
    const first = Object.keys(ICONS)[0]
    if (first === undefined) throw new Error('注册表是空的')
    const wrapper = render(first)
    await openPanel(wrapper)

    const options = wrapper.findAll('[data-test="icon-option"]')
    expect(options[0]?.attributes('aria-pressed')).toBe('true')
    expect(options[1]?.attributes('aria-pressed')).toBe('false')
  })

  it('搜索空结果走行内空态：单行、不渲染图标', async () => {
    const wrapper = render()
    await openPanel(wrapper)
    await wrapper.get('input[aria-label="搜索图标"]').setValue('没有这个东西')

    const empty = wrapper.get('[data-test="icon-none"]')
    expect(empty.classes()).toContain('dt-empty--inline')
    expect(empty.find('svg').exists()).toBe(false)
  })
})

describe('搜索', () => {
  it('按名字过滤', async () => {
    const wrapper = render()
    await openPanel(wrapper)

    await wrapper.get('input[aria-label="搜索图标"]').setValue('chevron')

    expect(optionNames(wrapper)).toEqual(
      Object.keys(ICONS).filter((name) => name.includes('chevron')),
    )
  })

  it('一个都搜不到时说出来，而不是留一片空网格', async () => {
    const wrapper = render()
    await openPanel(wrapper)

    await wrapper.get('input[aria-label="搜索图标"]').setValue('没有这个东西')

    expect(wrapper.get('[data-test="icon-none"]').text()).toContain(
      '没有匹配的图标名',
    )
  })

  it('挑完之后搜索词清掉，下次展开是完整清单', async () => {
    const wrapper = render()
    await openPanel(wrapper)
    await wrapper.get('input[aria-label="搜索图标"]').setValue('chevron')
    await wrapper.get('[data-test="icon-option"]').trigger('click')

    await openPanel(wrapper)

    expect(optionNames(wrapper)).toEqual(Object.keys(ICONS))
  })
})

describe('存量的非法名字', () => {
  // ⚠ 手写 JSON 来的配置里可能已经躺着一个未登记的名字，静默不画谁也查不出来
  it('名字不在注册表里时当场红字说出来', () => {
    expect(
      render('不存在的图标').get('[data-test="icon-invalid"]').text(),
    ).toContain('不会画出任何东西')
  })

  it('合法名字不报警', () => {
    expect(render('folder').find('[data-test="icon-invalid"]').exists()).toBe(
      false,
    )
  })

  it('非法名字也能一键清掉', async () => {
    const wrapper = render('不存在的图标')
    await openPanel(wrapper)

    await wrapper.get('[data-test="icon-clear"]').trigger('click')

    expect(lastWrite(wrapper)).toBe('')
  })
})
