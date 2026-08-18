/**
 * @fileoverview DtTipHost 的接管契约：摘 title、弹自家气泡、收起时原样装回去。
 * ⚠ 「装回去」是这个宿主的立身之本：静止态的 DOM 与无障碍树必须跟没有它时逐字相同，
 * 否则 axe 扫到的是一份被掏空的页面，而线上读屏也跟着少一段说明。
 * ⚠ 摘的时机必须早于气泡弹出：系统气泡自己有约 1 秒延时，等弹出再摘就是两只一起出现。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import DtTipHost from '../../../src/components/DtTipHost/DtTipHost.vue'

function mountHost(delay = 0) {
  return mount(DtTipHost, { props: { delay }, attachTo: document.body })
}

/** 造一个带 title 的按钮挂进文档。 */
function anchor(title = '拖入或点击添加', tag = 'button'): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('title', title)
  document.body.append(el)
  return el
}

function bubble(): HTMLElement | null {
  return document.querySelector('[role="tooltip"]')
}

/** 指针移到某个元素上。 */
async function hover(el: EventTarget): Promise<void> {
  el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  await nextTick()
  await nextTick()
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('DtTipHost 接管原生 title', () => {
  it('悬停时把 title 摘掉，系统气泡就没得弹了', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)

    expect(el.hasAttribute('title')).toBe(false)
    host.unmount()
  })

  it('⚠ 摘 title 早于气泡弹出：延时里系统气泡不许有可乘之机', async () => {
    vi.useFakeTimers()
    const host = mountHost(350)
    const el = anchor()

    el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))

    expect(el.hasAttribute('title')).toBe(false)
    expect(bubble()).toBeNull()

    vi.advanceTimersByTime(350)
    await nextTick()
    await nextTick()

    expect(bubble()?.textContent).toBe('拖入或点击添加')
    host.unmount()
  })

  it('弹的是本项目的气泡，字就是那句 title', async () => {
    const host = mountHost()
    const el = anchor('数字孪生 · 拖入或点击添加')

    await hover(el)

    expect(bubble()?.className).toContain('dt-tip')
    expect(bubble()?.textContent).toBe('数字孪生 · 拖入或点击添加')
    host.unmount()
  })

  it('指针移到别处时收起，并把 title 原样装回去', async () => {
    const host = mountHost()
    const el = anchor()
    const other = document.createElement('div')
    document.body.append(other)

    await hover(el)
    await hover(other)

    expect(bubble()).toBeNull()
    expect(el.getAttribute('title')).toBe('拖入或点击添加')
    host.unmount()
  })

  it('⚠ 宿主自己被卸载也要把 title 还回去，否则整页提示凭空少一批', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)
    host.unmount()

    expect(el.getAttribute('title')).toBe('拖入或点击添加')
  })

  it('⚠ 展开期间 Vue 把 title 重新写回来，要再摘一次', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)
    el.setAttribute('title', '换了一句')
    // MutationObserver 的回调排在微任务里，让出一次就跑完了
    await nextTick()
    await nextTick()

    expect(el.hasAttribute('title')).toBe(false)
    expect(bubble()?.textContent).toBe('换了一句')
    host.unmount()
  })

  it('空白 title 不弹，也不留个空气泡', async () => {
    const host = mountHost()
    const el = anchor('   ')

    await hover(el)

    expect(bubble()).toBeNull()
    host.unmount()
  })

  it('没有 title 的元素照样什么都不弹', async () => {
    const host = mountHost()
    const el = document.createElement('button')
    document.body.append(el)

    await hover(el)

    expect(bubble()).toBeNull()
    host.unmount()
  })

  it('⚠ iframe 的 title 是无障碍名不是提示，不许接管', async () => {
    const host = mountHost()
    const el = anchor('嵌入的页面', 'iframe')

    await hover(el)

    expect(bubble()).toBeNull()
    expect(el.getAttribute('title')).toBe('嵌入的页面')
    host.unmount()
  })

  it('title 挂在祖先上时，落在子孙上的指针也认', async () => {
    const host = mountHost()
    const outer = anchor('外层的说明', 'div')
    const inner = document.createElement('span')
    outer.append(inner)

    await hover(inner)

    expect(bubble()?.textContent).toBe('外层的说明')
    host.unmount()
  })

  it('⚠ 指针在同一只上挪动不重开：重开会让气泡一路闪', async () => {
    const host = mountHost()
    const outer = anchor('外层的说明', 'div')
    const inner = document.createElement('span')
    outer.append(inner)

    await hover(outer)
    const first = bubble()
    await hover(inner)

    expect(bubble()).toBe(first)
    host.unmount()
  })
})

describe('DtTipHost 无障碍', () => {
  it('键盘聚焦同样弹：只认 hover 的提示键盘用户永远看不到', async () => {
    const host = mountHost()
    const el = anchor()

    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await nextTick()
    await nextTick()

    expect(bubble()?.textContent).toBe('拖入或点击添加')
    host.unmount()
  })

  it('气泡以 role=tooltip 承载语义，触发器经 aria-describedby 指过去', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)

    expect(el.getAttribute('aria-describedby')).toBe(bubble()?.id)
    host.unmount()
  })

  it('⚠ 元素本来就有的 aria-describedby 不许动，收起时也别删了人家的', async () => {
    const host = mountHost()
    const el = anchor()
    el.setAttribute('aria-describedby', 'somewhere-else')

    await hover(el)
    expect(el.getAttribute('aria-describedby')).toBe('somewhere-else')

    await hover(document.body)
    expect(el.getAttribute('aria-describedby')).toBe('somewhere-else')
    host.unmount()
  })

  it('Esc 可关掉，覆盖 WCAG 对悬浮内容的可消除要求', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(bubble()).toBeNull()
    expect(el.getAttribute('title')).toBe('拖入或点击添加')
    host.unmount()
  })

  it('气泡定位成 fixed，跨得过 overflow 容器', async () => {
    const host = mountHost()
    const el = anchor()

    await hover(el)

    expect(bubble()?.getAttribute('style')).toContain('position: fixed')
    host.unmount()
  })
})
