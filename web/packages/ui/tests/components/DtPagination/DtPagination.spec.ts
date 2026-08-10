/**
 * @fileoverview DtPagination 的行为契约：条目区间文案、首尾页的禁用、
 * 页码窗口、a11y 接线，以及「换每页条数必须回到第 1 页」这条静默陷阱。
 *
 * ⚠ 每页条数用的是 DtSelect，浮层 teleport 到 body，断言要看整个 document。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import DtPagination from '../../../src/components/DtPagination/DtPagination.vue'

type Wrapper = ReturnType<typeof render>

function render(props: Record<string, unknown> = {}) {
  return mount(DtPagination, {
    props: { page: 1, size: 10, total: 95, ...props },
    attachTo: document.body,
  })
}

function step(wrapper: Wrapper, label: string) {
  return wrapper.findAll('button').find((node) => node.text() === label)
}

function pageButtons(wrapper: Wrapper) {
  return wrapper.findAll('.dt-pagination__page')
}

function pageLabels(wrapper: Wrapper): string[] {
  return pageButtons(wrapper).map((node) => node.text())
}

function currentPage(wrapper: Wrapper): string | undefined {
  return pageButtons(wrapper)
    .find((node) => node.attributes('aria-current') === 'page')
    ?.text()
}

async function openSizeMenu(): Promise<void> {
  document.querySelector<HTMLButtonElement>('.dt-select__trigger')?.click()
  await flushPromises()
}

function sizeOptions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.dt-select-menu__item')]
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtPagination 条目区间', () => {
  it('报出当前页覆盖的条目与总数', () => {
    expect(render().text()).toContain('第 1–10 条，共 95 条')
  })

  it('每页条数改变时区间跟着走', () => {
    expect(render({ page: 2, size: 20 }).text()).toContain('第 21–40 条')
  })

  it('末页只报到实际条数，不报出不存在的第 100 条', () => {
    expect(render({ page: 10 }).text()).toContain('第 91–95 条，共 95 条')
  })

  it('一条都没有时只说共 0 条，不写出「第 0–0 条」这种读不通的区间', () => {
    const text = render({ total: 0 }).text()
    expect(text).toContain('共 0 条')
    expect(text).not.toContain('第 0')
  })
})

describe('DtPagination 页码', () => {
  it('页码按总数与每页条数算出来', () => {
    expect(pageLabels(render({ total: 30 }))).toEqual(['1', '2', '3'])
  })

  it('当前页标 aria-current，其余不标——只靠颜色区分读屏读不到', () => {
    const wrapper = render({ page: 3, total: 50 })
    expect(currentPage(wrapper)).toBe('3')
    expect(
      pageButtons(wrapper).filter(
        (node) => node.attributes('aria-current') === 'page',
      ),
    ).toHaveLength(1)
  })

  it('页数多时中间折成省略号，页码不会铺满一整行', () => {
    const wrapper = render({ page: 10, total: 500 })
    expect(pageLabels(wrapper)).toEqual(['1', '9', '10', '11', '50'])
    expect(wrapper.findAll('.dt-pagination__gap')).toHaveLength(2)
  })

  it('页数少时不出现省略号', () => {
    expect(render({ total: 50 }).findAll('.dt-pagination__gap')).toHaveLength(0)
  })

  it('省略号对读屏隐藏——它不是可点的页码', () => {
    const gap = render({ page: 10, total: 500 }).find('.dt-pagination__gap')
    expect(gap.attributes('aria-hidden')).toBe('true')
  })

  it('点页码抛出该页', async () => {
    const wrapper = render({ total: 50 })
    await pageButtons(wrapper)[2]?.trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[3]])
  })

  it('点当前页不抛事件——白发一次请求把列表闪一下', async () => {
    const wrapper = render({ page: 2, total: 50 })
    await pageButtons(wrapper)[1]?.trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('越界的页码收回末页再渲染，不留一个点不亮的当前页', () => {
    const wrapper = render({ page: 999 })
    expect(currentPage(wrapper)).toBe('10')
    expect(step(wrapper, '下一页')?.attributes('disabled')).toBeDefined()
  })
})

describe('DtPagination 上一页 / 下一页', () => {
  it('点下一页抛出下一页页码', async () => {
    const wrapper = render({ page: 3 })
    await step(wrapper, '下一页')?.trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[4]])
  })

  it('点上一页抛出上一页页码', async () => {
    const wrapper = render({ page: 3 })
    await step(wrapper, '上一页')?.trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[2]])
  })

  it('第一页禁用上一页', async () => {
    const wrapper = render()
    const prev = step(wrapper, '上一页')
    expect(prev?.attributes('disabled')).toBeDefined()
    await prev?.trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('最后一页禁用下一页', async () => {
    const wrapper = render({ page: 10 })
    const next = step(wrapper, '下一页')
    expect(next?.attributes('disabled')).toBeDefined()
    await next?.trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('一条都没有时两个方向都禁用', () => {
    const wrapper = render({ total: 0 })
    expect(step(wrapper, '上一页')?.attributes('disabled')).toBeDefined()
    expect(step(wrapper, '下一页')?.attributes('disabled')).toBeDefined()
    expect(pageLabels(wrapper)).toEqual(['1'])
  })
})

describe('DtPagination 每页条数', () => {
  it('备选值来自 sizeOptions', async () => {
    render({ size: 5, sizeOptions: [5, 25] })
    await openSizeMenu()
    expect(sizeOptions().map((node) => node.textContent?.trim())).toEqual([
      '5 条/页',
      '25 条/页',
    ])
  })

  it('缺省备选值给出四档', async () => {
    render()
    await openSizeMenu()
    expect(sizeOptions()).toHaveLength(4)
  })

  it('当前档不在备选里时补进列表，否则下拉显示的是 placeholder', async () => {
    const wrapper = render({ size: 15, sizeOptions: [10, 20] })
    await openSizeMenu()
    expect(sizeOptions().map((node) => node.textContent?.trim())).toEqual([
      '10 条/页',
      '15 条/页',
      '20 条/页',
    ])
    expect(wrapper.find('.dt-select__value').text()).toBe('15 条/页')
  })

  it('换每页条数时页码回到第 1 页——不回就直接落到一个空页', async () => {
    const wrapper = render({ page: 9, size: 10, total: 95 })
    await openSizeMenu()
    sizeOptions()[3]?.click()
    await flushPromises()
    expect(wrapper.emitted('update:size')).toEqual([[100]])
    expect(wrapper.emitted('update:page')).toEqual([[1]])
  })

  it('已经在第 1 页时也照样抛页码，调用方不必自己兜', async () => {
    const wrapper = render({ page: 1, size: 10, total: 95 })
    await openSizeMenu()
    sizeOptions()[1]?.click()
    await flushPromises()
    expect(wrapper.emitted('update:page')).toEqual([[1]])
    expect(wrapper.emitted('update:size')).toEqual([[20]])
  })
})

describe('DtPagination 无障碍', () => {
  it('整块是 nav，缺省有可读名称', () => {
    expect(render().find('nav').attributes('aria-label')).toBe('分页')
  })

  it('同页多个分页器时可以各起各的名字', () => {
    const wrapper = render({ ariaLabel: '用户列表分页' })
    expect(wrapper.find('nav').attributes('aria-label')).toBe('用户列表分页')
  })

  it('每页条数下拉有可读名称——它没有可见 label', () => {
    expect(render().find('.dt-select__trigger').attributes('aria-label')).toBe(
      '每页条数',
    )
  })
})
