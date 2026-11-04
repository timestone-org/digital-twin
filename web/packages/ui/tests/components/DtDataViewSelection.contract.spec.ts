/** @fileoverview 数据视图选择与原生复选框、插槽及可访问名称的契约。 */
import type { DtDataColumn } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, expect, it } from 'vitest'
import { DtDataView } from '../../src'
import type { DtDataViewSelection } from '../../src'

const rows = [{ id: 'a', name: '<img src=x onerror=alert(1)>' }]
const columns: DtDataColumn[] = [{ key: 'name', label: '名称', card: 'title' }]
const wrappers: { unmount: () => void }[] = []

function render(
  selection: DtDataViewSelection<(typeof rows)[number]>,
  custom = false,
) {
  const wrapper = mount(DtDataView, {
    props: { columns, rows, view: custom ? 'card' : 'table' },
    attrs: { selection },
    slots: custom
      ? {
          card: '<a class="custom-card" href="#details">{{ params.row.name }}</a>',
        }
      : {},
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

it('自定义卡片也能选择，勾选不会触发卡片链接', async () => {
  const wrapper = render({ selectedIds: [], rowLabel: (row) => row.name }, true)
  const link = wrapper.get('.custom-card')
  let clicked = 0
  let bubbled = 0
  link.element.addEventListener('click', () => {
    clicked += 1
  })
  wrapper
    .get<HTMLElement>('.dt-data-view')
    .element.addEventListener('click', () => {
      bubbled += 1
    })
  wrapper.get<HTMLInputElement>('input[aria-label^="选择 "]').element.click()
  await nextTick()
  expect(wrapper.emitted('update:selectedIds')).toEqual([[['a']]])
  expect(clicked).toBe(0)
  expect(bubbled).toBe(0)
  expect(wrapper.find('img').exists()).toBe(false)
  expect(
    wrapper.find('input[aria-label^="选择 "]').attributes('aria-label'),
  ).toBe(`选择 ${rows[0]?.name}`)
})

it('全选文案与原生复选框的可访问名称一致', () => {
  const wrapper = render({
    selectedIds: [],
    selectAllLabel: '选择当前筛选结果',
  })
  const input = wrapper.get<HTMLInputElement>(
    'input[aria-label="选择当前筛选结果"]',
  )
  expect(wrapper.text()).toContain('选择当前筛选结果')
  expect(input.element.type).toBe('checkbox')
  input.element.focus()
  expect(document.activeElement).toBe(input.element)
})

it.each([{ disabled: true }, { loading: true }])(
  '禁用状态%o下行和全选都不产生更新',
  async (state) => {
    const wrapper = render({ selectedIds: [], disabled: state.disabled })
    if ('loading' in state) await wrapper.setProps({ loading: state.loading })
    const inputs = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input.element.disabled).toBe(true)
      input.element.disabled = false
      await input.setValue(true)
    }
    expect(wrapper.emitted('update:selectedIds')).toBeUndefined()
  },
)

it('保留键盘焦点与空格默认行为，原生change更新受控选择', async () => {
  const wrapper = render({ selectedIds: [] })
  const input = wrapper.get<HTMLInputElement>('input[aria-label="选择 a"]')
  input.element.focus()
  const keyboard = new KeyboardEvent('keydown', {
    key: ' ',
    bubbles: true,
    cancelable: true,
  })
  input.element.dispatchEvent(keyboard)
  expect(keyboard.defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(input.element)
  await input.setValue(true)
  expect(wrapper.emitted('update:selectedIds')).toEqual([[['a']]])
})
