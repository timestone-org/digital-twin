/**
 * @fileoverview 契约：详情弹窗按部件建卡片与那块 3D、装配栏列出后代并换详情、
 * 换部件整份重来、关掉与卸载时都把命令式建出来的东西收干净。
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

function partsOf(raw: Record<string, unknown>[]): TwinPart[] {
  return normalizeTwinConfig({ parts: raw }).parts
}

function partOf(over: Record<string, unknown> = {}): TwinPart {
  const part = partsOf([
    {
      id: 'p1',
      name: '冷水机组',
      detail: { fields: [{ key: 'temp', label: '出水温度', unit: '℃' }] },
      ...over,
    },
  ])[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

/** 一台带三个子件的机组，其中「主机」下面还有一级。 */
const UNIT = partsOf([
  {
    id: 'unit',
    name: '机组',
    click: { near: 'detail' },
    detail: { fields: [{ key: 'p', label: '总功率' }] },
  },
  {
    id: 'air',
    name: '主机',
    parentId: 'unit',
    detail: { fields: [{ key: 't', label: '排气温度' }] },
  },
  { id: 'rotor', name: '转子', parentId: 'air' },
  {
    id: 'motor',
    name: '电机',
    parentId: 'unit',
    detail: { fields: [{ key: 'i', label: '定子电流' }] },
  },
])

function partNamed(id: string): TwinPart {
  const part = UNIT.find((item) => item.id === id)
  if (part === undefined) throw new Error(`没有部件 ${id}`)
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

interface RenderOver {
  parts?: readonly TwinPart[]
  currentId?: string
  objects?: Record<string, THREE.Object3D[]>
}

function render(
  part: TwinPart | null = partOf(),
  values: Record<string, { value: unknown }> = {},
  over: RenderOver = {},
) {
  // 没指定就每个部件各给一个网格：多数用例只关心「舞台起没起来」
  const spare = new Map<string, THREE.Object3D[]>()
  function objectsOf(partId: string): THREE.Object3D[] {
    if (over.objects !== undefined) return over.objects[partId] ?? []
    const hit = spare.get(partId) ?? [meshNamed(partId)]
    spare.set(partId, hit)
    return hit
  }
  return mount(TwinPartModal, {
    props: {
      part,
      parts: over.parts ?? (part === null ? [] : [part]),
      currentId: over.currentId ?? '',
      values,
      partValues: {},
      objectsOf,
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

function railRows(): string[] {
  return Array.from(
    document.querySelectorAll('[data-test^="assembly-row-"]'),
  ).map((row) => row.textContent?.trim() ?? '')
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
    render(partOf({ detail: { variant: 'hud', fields: [{ key: 'temp' }] } }))

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
    const next = partOf({ id: 'p2', name: '冷却塔' })
    const wrapper = render(partOf(), { 'p1::temp': { value: 7.2 } })

    await wrapper.setProps({ part: next, parts: [next], values: {} })

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe(
      '冷却塔',
    )
    expect(modalText()).not.toContain('7.2')
  })

  // 空卡片只有一圈壳，看着像加载没完成；说出「没配读数」才查得下去
  it('一个字段都没配时给一句话，而不是一张空卡片', () => {
    render(partOf({ detail: { fields: [] } }))

    expect(
      document.querySelector('[data-test="part-modal-no-fields"]'),
    ).not.toBeNull()
    expect(dataHost()?.firstElementChild).toBeFalsy()
  })
})

describe('装配栏', () => {
  it('这个部件不收子件时整条不摆', () => {
    render()

    expect(document.querySelector('.twin-assembly')).toBeNull()
  })

  it('列出自己与全部后代，深度优先、同层按文档序', () => {
    render(partNamed('unit'), {}, { parts: UNIT })

    expect(railRows()).toEqual(['机组', '主机', '转子', '电机'])
  })

  it('点一行上抛 select，抛的是部件 id', async () => {
    const wrapper = render(partNamed('unit'), {}, { parts: UNIT })

    document
      .querySelector<HTMLElement>('[data-test="assembly-row-motor"]')
      ?.click()
    await nextTick()

    expect(wrapper.emitted('select')).toEqual([['motor']])
  })

  it('看着子件时，标题与卡片都换成它的', () => {
    render(
      partNamed('unit'),
      { 'motor::i': { value: 137 } },
      { parts: UNIT, currentId: 'motor' },
    )

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe('电机')
    expect(modalText()).toContain('定子电流')
    expect(modalText()).toContain('137')
  })

  // ⚠ 留一个不在场的 id 会让卡片与画布整份不建，而屏幕上只是一块空白
  it('当前件不在这棵装配里时退回打开的那一个', () => {
    render(partNamed('unit'), {}, { parts: UNIT, currentId: 'ghost' })

    expect(document.querySelector('.dt-modal__title')?.textContent).toBe('机组')
    expect(modalText()).toContain('总功率')
  })

  // 框属于这一次打开，逐行换宽高会让对话框在屏幕上跳
  it('弹窗宽度与模型区高度跟着打开的那个部件，不跟当前件', () => {
    const parts = partsOf([
      { id: 'unit', detail: { width: 900, modelHeight: 400 } },
      {
        id: 'air',
        parentId: 'unit',
        detail: { width: 320, modelHeight: 120, fields: [{ key: 't' }] },
      },
    ])
    const root = parts[0]
    if (root === undefined) throw new Error('造不出部件')
    render(root, {}, { parts, currentId: 'air' })

    expect(
      document.querySelector<HTMLElement>('.dt-modal__panel')?.style.width,
    ).toBe('900px')
    expect(
      document
        .querySelector<HTMLElement>('.twin-part-modal')
        ?.style.getPropertyValue('--tp-stage-height'),
    ).toBe('400px')
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
    const next = partOf({ id: 'p2', name: '冷却塔' })
    const wrapper = render()
    const before = stageHost()?.querySelector('canvas')

    await wrapper.setProps({ part: next, parts: [next] })

    expect(stageHost()?.querySelectorAll('canvas')).toHaveLength(1)
    expect(stageHost()?.querySelector('canvas')).not.toBe(before)
  })

  // 纯容器父件自己常常一个网格都没挂，舞台得把后代的一并摆进去
  it('父件的舞台摆自己加全部后代的对象', () => {
    const objects = {
      unit: [],
      air: [meshNamed('air')],
      rotor: [meshNamed('rotor')],
      motor: [meshNamed('motor')],
    }
    render(partNamed('unit'), {}, { parts: UNIT, objects })

    expect(stageHost()?.querySelector('canvas')).not.toBeNull()
  })

  // 节点名对不上时现在是一块空白，谁也查不出原因
  it('说要画模型却一个节点都找不到时说出来', async () => {
    render(partOf(), {}, { objects: {} })
    await nextTick()

    expect(
      document.querySelector('[data-test="part-modal-stage-empty"]'),
    ).not.toBeNull()
  })

  it('卸载时把卡片与画布都收干净', () => {
    const wrapper = render()

    wrapper.unmount()

    expect(document.querySelector('.dt-modal')).toBeNull()
  })
})
