/**
 * @fileoverview DtSelect 的行为契约：自定义 listbox 的开合、键盘、搜索过滤、
 * a11y 接线，以及卸载时把 window/document 上的监听摘干净。
 *
 * ⚠ 浮层 teleport 到 body，断言要看整个 document，不能只看 wrapper。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DtSelectOption } from '@dt/contracts'

import DtSelect from '../../../src/components/DtSelect/DtSelect.vue'

const FEW: DtSelectOption[] = [
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙', disabled: true },
  { value: 'c', label: '丙' },
]

const MANY: DtSelectOption[] = Array.from({ length: 10 }, (_, index) => ({
  value: `v${index}`,
  label: `选项 ${index}`,
}))

function render(props: Record<string, unknown> = {}) {
  return mount(DtSelect, {
    props: { modelValue: '', options: FEW, ...props },
    attachTo: document.body,
  })
}

function trigger() {
  return document.querySelector<HTMLButtonElement>('.dt-select__trigger')
}

function items() {
  return [...document.querySelectorAll('.dt-select-menu__item')]
}

function labels() {
  return items().map((node) => node.textContent?.trim() ?? '')
}

function press(key: string, target?: Element | null): Promise<unknown> {
  const node = target ?? trigger()
  node?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
  return flushPromises()
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('DtSelect 触发器', () => {
  it('没有选中时显示 placeholder', () => {
    render({ placeholder: '全部角色' })
    expect(trigger()?.textContent).toContain('全部角色')
  })

  it('选中后显示对应的 label 而不是取值', () => {
    render({ modelValue: 'c' })
    expect(trigger()?.textContent).toContain('丙')
  })

  it('取值不在选项里时回落 placeholder，不显示裸取值', () => {
    render({ modelValue: 'ghost', placeholder: '请选择' })
    expect(trigger()?.textContent).toContain('请选择')
    expect(trigger()?.textContent).not.toContain('ghost')
  })

  it('是 combobox 且带展开态——只靠箭头图标读屏读不到', async () => {
    const wrapper = render()
    expect(trigger()?.getAttribute('role')).toBe('combobox')
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false')
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('没有可见 label 时用 ariaLabel 补可读名称', () => {
    render({ ariaLabel: '按角色筛选' })
    expect(trigger()?.getAttribute('aria-label')).toBe('按角色筛选')
  })

  it('label / hint / error 由 DtField 渲染并接线', () => {
    const wrapper = render({ label: '角色', hint: '可留空', error: '必填' })
    expect(wrapper.text()).toContain('角色')
    // error 与 hint 同传时只渲染 error，describedby 才不会指向未渲染的节点
    expect(wrapper.text()).toContain('必填')
    expect(wrapper.text()).not.toContain('可留空')
    expect(trigger()?.getAttribute('aria-invalid')).toBe('true')
  })

  it('required 由 DtField 打星号', () => {
    expect(render({ label: '角色', required: true }).text()).toContain('*')
  })

  it('size 落到尺寸类名上', () => {
    const wrapper = render({ size: 'lg' })
    expect(wrapper.get('.dt-select').classes()).toContain('dt-select--lg')
  })
})

describe('DtSelect 开合与选中', () => {
  it('点击展开，列表是 listbox', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(labels()).toEqual(['甲', '乙', '丙'])
  })

  it('当前选中项标 aria-selected', async () => {
    const wrapper = render({ modelValue: 'c' })
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(items()[2]?.getAttribute('aria-selected')).toBe('true')
    expect(items()[0]?.getAttribute('aria-selected')).toBe('false')
  })

  it('点选项抛值并收起', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    items()[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']])
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('禁用项点不动', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    items()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('disabled 时点不开', async () => {
    const wrapper = render({ disabled: true })
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('展开着被禁用时自动收起——否则还能点选项写入', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('点外面收起', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })
})

describe('DtSelect 键盘', () => {
  it('未展开时按下方向键先展开', async () => {
    render()
    await press('ArrowDown')
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
  })

  it('方向键跳过禁用项', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('ArrowDown')
    expect(items()[2]?.getAttribute('data-active')).toBe('true')
  })

  it('回车选中当前高亮项', async () => {
    const wrapper = render()
    await press('ArrowDown')
    await press('ArrowDown')
    await press('Enter')
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']])
  })

  it('Home / End 跳到首尾可用项', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('End')
    expect(items()[2]?.getAttribute('data-active')).toBe('true')
    await press('Home')
    expect(items()[0]?.getAttribute('data-active')).toBe('true')
  })

  it('Esc 收起', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('未展开时的 Esc 不拦截——否则弹窗里按 Esc 关不掉弹窗', () => {
    render()
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    trigger()?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('Tab 收起，并把焦点收回触发器', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('Tab')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    // 不收回的话焦点掉到 body，下一次 Tab 从页首重来
    expect(document.activeElement).toBe(trigger())
  })

  it('带搜索框时 Tab 同样把焦点从浮层收回触发器', async () => {
    const wrapper = render({ options: MANY })
    await wrapper.get('.dt-select__trigger').trigger('click')
    const input = document.querySelector('.dt-select-menu__input')
    await press('Tab', input)
    expect(document.activeElement).toBe(trigger())
  })

  it('在弹窗里时浮层挂进弹窗面板，而不是 body 的兄弟节点', async () => {
    // 浮层挂到面板外面，焦点会跑出弹窗的焦点陷阱，读屏也看不见选项
    const panel = document.createElement('div')
    panel.className = 'dt-modal__panel'
    document.body.appendChild(panel)
    const wrapper = mount(DtSelect, {
      props: { modelValue: '', options: FEW },
      attachTo: panel,
    })
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(panel.querySelector('[role="listbox"]')).not.toBeNull()
  })

  it('未展开时的 aria-activedescendant 不指向任何东西', () => {
    render()
    expect(trigger()?.getAttribute('aria-activedescendant')).toBeNull()
  })
})

describe('DtSelect 搜索', () => {
  it('选项少时不给搜索框——三个选项配个搜索框只是碍事', async () => {
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('.dt-select-menu__input')).toBeNull()
  })

  it('选项多时自动给搜索框', async () => {
    const wrapper = render({ options: MANY })
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('.dt-select-menu__input')).not.toBeNull()
  })

  it('searchable 可以强制打开或关掉自动判断', async () => {
    const forced = render({ searchable: true })
    await forced.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('.dt-select-menu__input')).not.toBeNull()
    forced.unmount()
    document.body.innerHTML = ''

    const off = render({ options: MANY, searchable: false })
    await off.get('.dt-select__trigger').trigger('click')
    expect(document.querySelector('.dt-select-menu__input')).toBeNull()
  })

  async function openWithQuery(text: string, props = {}) {
    const wrapper = render({ options: MANY, ...props })
    await wrapper.get('.dt-select__trigger').trigger('click')
    const input = document.querySelector<HTMLInputElement>(
      '.dt-select-menu__input',
    )
    if (input) {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    return { wrapper, input }
  }

  it('按关键词过滤', async () => {
    await openWithQuery('选项 3')
    expect(labels()).toEqual(['选项 3'])
  })

  it('没命中时给空态文案，不是空白一片', async () => {
    await openWithQuery('不存在的东西')
    expect(
      document.querySelector('.dt-select-menu__empty')?.textContent,
    ).toContain('无匹配项')
  })

  it('emptyText 与 searchPlaceholder 可定制', async () => {
    await openWithQuery('nope', {
      emptyText: '没有这个角色',
      searchPlaceholder: '搜角色',
    })
    expect(document.body.textContent).toContain('没有这个角色')
    expect(
      document
        .querySelector('.dt-select-menu__input')
        ?.getAttribute('placeholder'),
    ).toBe('搜角色')
  })

  it('过滤后回车选中的是过滤结果里的那一项', async () => {
    const { wrapper, input } = await openWithQuery('选项 7')
    await press('Enter', input)
    expect(wrapper.emitted('update:modelValue')).toEqual([['v7']])
  })

  it('有关键词时 Esc 先清关键词，再按才收起', async () => {
    const { input } = await openWithQuery('选项 7')
    await press('Escape', input)
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(labels()).toHaveLength(MANY.length)
    await press('Escape', input)
    await flushPromises()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('重新展开时关键词是干净的', async () => {
    const { wrapper } = await openWithQuery('选项 7')
    await press('Escape')
    await press('Escape')
    await wrapper.get('.dt-select__trigger').trigger('click')
    expect(labels()).toHaveLength(MANY.length)
  })
})

describe('DtSelect 资源清理', () => {
  it('收起时摘掉滚动与 resize 监听', async () => {
    const off = vi.spyOn(window, 'removeEventListener')
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('Escape')
    const removed = off.mock.calls.map((call) => call[0])
    expect(removed).toContain('scroll')
    expect(removed).toContain('resize')
  })

  it('浮层还开着就卸载时，监听同样摘干净——不然会一直累积', async () => {
    const off = vi.spyOn(window, 'removeEventListener')
    const docOff = vi.spyOn(document, 'removeEventListener')
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    off.mockClear()
    docOff.mockClear()
    wrapper.unmount()
    expect(off.mock.calls.map((call) => call[0])).toContain('scroll')
    expect(docOff.mock.calls.map((call) => call[0])).toContain('pointerdown')
  })

  it('摘监听时带上与注册时相同的 capture 标志', async () => {
    const off = vi.spyOn(window, 'removeEventListener')
    const wrapper = render()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await press('Escape')
    const scrollCall = off.mock.calls.find((call) => call[0] === 'scroll')
    expect(scrollCall?.[2]).toBe(true)
  })
})
