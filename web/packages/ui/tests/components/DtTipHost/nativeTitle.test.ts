/**
 * @fileoverview 原生 title 接管三件套的单元契约。
 * ⚠ 命中测试那条最要紧：禁用控件不派发鼠标事件，只有它指得到那只被禁用的按钮，
 * 而系统气泡对禁用与否一视同仁——漏了它就漏出一批没被接管的灰气泡。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  anchorOf,
  holdTitle,
  pointOf,
  releaseTitle,
} from '../../../src/components/DtTipHost/nativeTitle'

/** 造一次落在 (x, y) 上的指针事件，target 由调用方指定。 */
function pointerAt(target: Element): MouseEvent {
  const event = new MouseEvent('pointerover', { bubbles: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('pointOf', () => {
  it('命中点落在 target 内部时以命中点为准：禁用控件只能这么找到', () => {
    const bar = document.createElement('div')
    const disabled = document.createElement('button')
    disabled.disabled = true
    bar.append(disabled)
    document.body.append(bar)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(disabled)

    // 禁用按钮不派发事件，事件打在它的父节点上
    expect(pointOf(pointerAt(bar))).toBe(disabled)
  })

  it('⚠ 命中点跑到 target 之外说明这次测不准，宁可用 target', () => {
    const here = document.createElement('div')
    const elsewhere = document.createElement('div')
    document.body.append(here, elsewhere)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(elsewhere)

    expect(pointOf(pointerAt(here))).toBe(here)
  })

  it('没有命中测试的环境退回 target', () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)

    expect(pointOf(pointerAt(el))).toBe(el)
  })

  it('焦点事件没有坐标，一律按 target 算', () => {
    const el = document.createElement('button')
    document.body.append(el)
    const event = new FocusEvent('focusin', { bubbles: true })
    el.dispatchEvent(event)

    expect(pointOf(event)).toBe(el)
  })
})

describe('anchorOf', () => {
  it('沿祖先链找出第一只带 title 的', () => {
    const outer = document.createElement('div')
    outer.setAttribute('title', '说明')
    const inner = document.createElement('span')
    outer.append(inner)

    expect(anchorOf(inner, null)).toBe(outer)
  })

  it('⚠ 跳过 iframe / svg 继续往上找：它们的 title 不是悬停提示', () => {
    const outer = document.createElement('div')
    outer.setAttribute('title', '说明')
    const frame = document.createElement('iframe')
    frame.setAttribute('title', '嵌入的页面')
    outer.append(frame)

    expect(anchorOf(frame, null)).toBe(outer)
  })

  it('⚠ 指针还在已接管的那只身上就认它：它的 title 已被摘走，重找必然找到别人', () => {
    const held = document.createElement('div')
    const inner = document.createElement('span')
    held.append(inner)
    // 祖先另有一只带 title 的，重找会跑到它头上
    const outer = document.createElement('div')
    outer.setAttribute('title', '外层')
    outer.append(held)

    expect(anchorOf(inner, held)).toBe(held)
  })

  it('一路上去都没有就是没有', () => {
    const el = document.createElement('div')

    expect(anchorOf(el, null)).toBeNull()
  })
})

describe('holdTitle / releaseTitle', () => {
  it('摘下来再装回去，元素回到一模一样的样子', () => {
    const el = document.createElement('button')
    el.setAttribute('title', '导出这一张')
    document.body.append(el)

    const held = holdTitle(el)
    expect(el.hasAttribute('title')).toBe(false)

    releaseTitle(held)
    expect(el.getAttribute('title')).toBe('导出这一张')
  })

  it('空白的 title 不值得接管', () => {
    const el = document.createElement('button')
    el.setAttribute('title', '  ')

    expect(holdTitle(el)).toBeNull()
  })

  it('⚠ 期间被重新写上了就以新的为准，别拿手上那份旧的盖掉', () => {
    const el = document.createElement('button')
    el.setAttribute('title', '旧的')
    document.body.append(el)

    const held = holdTitle(el)
    el.setAttribute('title', '新的')
    releaseTitle(held)

    expect(el.getAttribute('title')).toBe('新的')
  })

  it('元素已经离开文档就作罢，装回去只会把它留在内存里', () => {
    const el = document.createElement('button')
    el.setAttribute('title', '说明')
    document.body.append(el)
    const held = holdTitle(el)
    el.remove()

    releaseTitle(held)

    expect(el.hasAttribute('title')).toBe(false)
  })
})
