/**
 * @fileoverview 悬浮卡避让的 DOM 一侧：只挪「静止态透明」的卡片、按舞台缩放换算位移、
 * 箭头跟着对折并镜像、下次进入前复原。节点组件在进入时调用它那一条在 Twin2dNodeBox.spec。
 *
 * ⚠ happy-dom 没有排版引擎，矩形与 offsetHeight 一律手工钉；这里只验换算与挑选，
 * 真实观感靠浏览器里看。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  flipHoverPopups,
  resetHoverPopups,
} from '../../src/render/hoverPopupFlip'
import { pin } from '../../src/testing/layoutPin'

/** 舞台 600 高、视口设计高 1200（缩放 0.5）里的一个节点与它的卡片和箭头。 */
function buildStage(): {
  stage: HTMLElement
  node: HTMLElement
  popup: HTMLElement
  arrow: SVGElement
  pill: HTMLElement
} {
  const stage = document.createElement('div')
  stage.className = 't2-stage'
  const viewport = document.createElement('div')
  viewport.className = 't2-stage__viewport'
  const node = document.createElement('div')
  const popup = document.createElement('div')
  popup.style.position = 'absolute'
  popup.style.opacity = '0'
  popup.style.pointerEvents = 'none'
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  arrow.style.position = 'absolute'
  const pill = document.createElement('div')
  pill.style.position = 'absolute'
  pill.style.opacity = '1'
  pill.style.pointerEvents = 'none'
  popup.append(arrow)
  node.append(popup, pill)
  viewport.append(node)
  stage.append(viewport)
  document.body.append(stage)
  pin(stage, 0, 600)
  pin(viewport, 0, 600, 1200)
  pin(node, 500, 60)
  // 卡片在节点下方 10px、屏幕高 80，越出舞台下沿 50
  pin(popup, 570, 80, 160)
  pin(arrow, 566, 8)
  // 常显的药丸同样越界，但透明度是 1
  pin(pill, 570, 80)
  return { stage, node, popup, arrow, pill }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('flipHoverPopups', () => {
  it('把越界的卡片翻到节点上方，位移按舞台缩放换回设计像素', () => {
    const { node, popup } = buildStage()
    flipHoverPopups(node)
    // 屏幕位移 410 - 570 = -160，缩放 0.5 → 设计像素 -320
    expect(popup.style.getPropertyValue('translate')).toBe('0 -320px')
  })

  it('箭头以卡片中线对折并竖向镜像', () => {
    const { node, arrow } = buildStage()
    flipHoverPopups(node)
    // 卡片屏幕高 80，箭头相对上沿 -4、高 8 → 屏幕位移 80；卡片内部倍率 80/160 → 160
    expect(arrow.style.getPropertyValue('translate')).toBe('0 160px')
    expect(arrow.style.getPropertyValue('scale')).toBe('1 -1')
  })

  it('常显的图元不挪', () => {
    const { node, pill } = buildStage()
    flipHoverPopups(node)
    expect(pill.style.getPropertyValue('translate')).toBe('')
  })

  it('复原时摘掉全部挪动', () => {
    const { node, popup, arrow } = buildStage()
    flipHoverPopups(node)
    resetHoverPopups(node)
    expect(popup.style.getPropertyValue('translate')).toBe('')
    expect(arrow.style.getPropertyValue('scale')).toBe('')
    expect(node.querySelector('[data-t2-flipped]')).toBeNull()
  })

  it('不在舞台里什么都不做', () => {
    const node = document.createElement('div')
    const popup = document.createElement('div')
    popup.style.cssText = 'position:absolute;opacity:0;pointer-events:none'
    node.append(popup)
    flipHoverPopups(node)
    expect(popup.style.getPropertyValue('translate')).toBe('')
  })
})
