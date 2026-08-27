/**
 * @fileoverview 契约：详情弹窗按部件建卡片与那块 3D、换部件整份重来、
 * 关掉与卸载时都把命令式建出来的东西收干净。
 *
 * ⚠ 弹窗 Teleport 到 body：`wrapper.find` 看不见它，断言一律走 document。
 * ⚠ 卡片与画布都是命令式建的 DOM，Vue 不认它们——不收就是一次每开一个部件
 * 泄漏一份的漏。
 */
import { normalizeTwinConfig, type TwinPart } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import TwinPartModal from '../src/TwinPartModal.vue'

function partOf(over: Record<string, unknown> = {}): TwinPart {
  const part = normalizeTwinConfig({
    parts: [
      {
        id: 'p1',
        name: '冷水机组',
        detail: { fields: [{ key: 'temp', label: '出水温度', unit: '℃' }] },
        ...over,
      },
    ],
  }).parts[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

function meshNamed(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  )
  mesh.name = name
  return mesh
}

function render(
  part: TwinPart | null = partOf(),
  values: Record<string, { value: unknown }> = {},
) {
  const objects = [meshNamed('pump')]
  return mount(TwinPartModal, {
    props: {
      part,
      values,
      objectsOf: () => objects,
      rendererFactory: () => createHeadlessRenderer(),
    },
    attachTo: document.body,
  })
}

function modalText(): string {
  return document.querySelector('.dt-modal')?.textContent ?? ''
}

function dataHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-test="part-modal-data"]')
}

function stageHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-test="part-modal-stage"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('弹窗本身', () => {
  it('没有部件时整个不弹', () => {
    render(null)

    expect(document.querySelector('.dt-modal')).toBeNull()
  })

  it('标题空着退回部件名', () => {
    render()

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe(
      '冷水机组',
    )
  })

  it('配了标题与副标题就用配的那一份', () => {
    render(partOf({ detail: { title: '1# 主机', subtitle: '地下二层' } }))

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe(
      '1# 主机',
    )
    expect(modalText()).toContain('地下二层')
  })

  it('宽度按配置给到弹窗面板上', () => {
    render(partOf({ detail: { width: 900 } }))

    expect(
      document.querySelector<HTMLElement>('.dt-modal__panel')?.style.width,
    ).toBe('900px')
  })

  it('关闭键上抛 close', async () => {
    const wrapper = render()

    document
      .querySelector<HTMLElement>('.dt-modal button[aria-label="关闭"]')
      ?.click()
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('数据卡片', () => {
  it('字段的标签、读数与单位都画出来', () => {
    render(partOf(), { 'p1::temp': { value: 7.2 } })

    expect(modalText()).toContain('出水温度')
    expect(modalText()).toContain('7.2')
    expect(modalText()).toContain('℃')
  })

  // ⚠ 键里不带部件 id 的话，两个部件上同名的字段会互相抢值
  it('取值按 `<部件 id>::<字段 key>`，别的部件的同名字段不串进来', () => {
    render(partOf(), { 'other::temp': { value: 99 } })

    expect(modalText()).not.toContain('99')
  })

  // 标题已经写在弹窗头上，卡片再写一遍就是同一句话出现两次
  it('卡片自己不再画一遍标题', () => {
    render()

    expect(dataHost()?.querySelector('.twin-panel__title')).toBeNull()
  })

  it('风格变体落到卡片的类名上', () => {
    render(partOf({ detail: { variant: 'hud' } }))

    expect(dataHost()?.querySelector('.twin-panel--hud')).not.toBeNull()
  })

  it('只换值时不重建卡片，读数跟着刷', async () => {
    const wrapper = render(partOf(), { 'p1::temp': { value: 7.2 } })
    const card = dataHost()?.firstElementChild

    await wrapper.setProps({ values: { 'p1::temp': { value: 8.5 } } })

    expect(dataHost()?.firstElementChild).toBe(card)
    expect(modalText()).toContain('8.5')
  })

  it('换部件时整批换掉，上一份不留在页面上', async () => {
    const wrapper = render(partOf(), { 'p1::temp': { value: 7.2 } })

    await wrapper.setProps({
      part: partOf({ id: 'p2', name: '冷却塔' }),
      values: {},
    })

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe(
      '冷却塔',
    )
    expect(modalText()).not.toContain('7.2')
  })
})

describe('弹窗里那块 3D', () => {
  it('开着时画布挂进去了', () => {
    render()

    expect(stageHost()?.querySelector('canvas')).not.toBeNull()
  })

  it('关掉「画模型」时不起那套场景', () => {
    render(partOf({ detail: { showModel: false } }))

    expect(stageHost()?.querySelector('canvas')).toBeNull()
  })

  it('模型区高度按配置给', () => {
    render(partOf({ detail: { modelHeight: 400 } }))

    const body = document.querySelector<HTMLElement>('.twin-part-modal')
    expect(body?.style.getPropertyValue('--tp-stage-height')).toBe('400px')
  })

  // ⚠ 上下文有硬上限：来回点几次部件之后最早的那个会被浏览器静默回收
  it('换部件时先把上一块的上下文丢掉', async () => {
    const wrapper = render()
    const before = stageHost()?.querySelector('canvas')

    await wrapper.setProps({ part: partOf({ id: 'p2', name: '冷却塔' }) })

    expect(stageHost()?.querySelectorAll('canvas')).toHaveLength(1)
    expect(stageHost()?.querySelector('canvas')).not.toBe(before)
  })

  it('卸载时把卡片与画布都收干净', () => {
    const wrapper = render()

    wrapper.unmount()

    expect(document.querySelector('.dt-modal')).toBeNull()
  })
})
