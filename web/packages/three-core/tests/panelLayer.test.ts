/**
 * @fileoverview 信息牌层守这几样：落点解析、取值键带牌 id、没有值时退回静态文案、
 * 变体落成 class、随模型体量缩放、三种朝向、DOM 清得干净。
 *
 * ⚠ 取值键不带牌 id 时，两张牌上同名的字段会互相覆盖——两个读数都在，
 * 只是其中一个显示的是另一张牌的值，界面上完全看不出来。
 */
import { TWIN_PANEL_VARIANTS } from '@dt/twin-config'
import type { TwinAnchor, TwinPanel, TwinPanelField } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { PanelLayer } from '../src/panelLayer'

const VISIBLE = {
  visible: true,
  hideBelow: null,
  hideAbove: null,
  fade: null,
} as const

const STYLE = {
  variant: 'card',
  orient: 'center',
  accent: '--accent-primary',
  background: '',
  width: 0,
  height: 0,
  columns: 1,
  density: 'normal',
  scan: false,
  corners: false,
  grid: false,
  fontScale: 1,
  scale: 1,
  animate: false,
  pulse: false,
} as const

function field(key: string, overrides: Partial<TwinPanelField> = {}) {
  return {
    key,
    label: key,
    unit: '',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'text',
    min: 0,
    max: 100,
    levels: [],
    ...overrides,
  } satisfies TwinPanelField
}

function panel(overrides: Partial<TwinPanel> = {}): TwinPanel {
  return {
    id: 'p1',
    name: '泵组',
    subtitle: '',
    footnote: '',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 0, 0],
    fields: [field('temp')],
    billboard: 'face',
    style: { ...STYLE },
    visibility: { ...VISIBLE },
    ...overrides,
  }
}

function anchor(id: string, position: [number, number, number]): TwinAnchor {
  return {
    id,
    name: id,
    position,
    label: '',
    unit: '',
    decimals: null,
    visibility: { ...VISIBLE },
  }
}

/** CSS3D 挂的是 0×0 的挂点，卡片在它里面；逐牌的 CSS 变量写在挂点上。 */
function mounts(layer: PanelLayer): HTMLElement[] {
  return layer.group.children
    .filter(
      (child): child is typeof child & { element: HTMLElement } =>
        'element' in child,
    )
    .map((child) => child.element)
}

function cards(layer: PanelLayer): HTMLElement[] {
  return mounts(layer).flatMap((mount) => {
    const card = mount.querySelector('.twin-panel')
    return card instanceof HTMLElement ? [card] : []
  })
}

function valuesOf(layer: PanelLayer): string[] {
  return cards(layer).flatMap((card) =>
    [...card.querySelectorAll('.twin-panel__value, .twin-panel__num')].map(
      (node) => node.textContent ?? '',
    ),
  )
}

describe('建与清', () => {
  it('一张牌建一张卡片', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])

    expect(cards(layer)).toHaveLength(1)
  })

  it('看不见的牌不建卡片', () => {
    const layer = new PanelLayer()
    layer.build([panel({ visibility: { ...VISIBLE, visible: false } })], [])

    expect(cards(layer)).toHaveLength(0)
  })

  it('重建先清旧的，不叠加', () => {
    const layer = new PanelLayer()
    layer.build([panel({ id: 'p1' }), panel({ id: 'p2' })], [])
    layer.build([panel({ id: 'p3' })], [])

    expect(cards(layer)).toHaveLength(1)
  })

  // ⚠ 从场景图上摘下 CSS2D 对象带不走它的 DOM，漏了卡片会留在页面上飘着
  it('清掉时把 DOM 从页面上摘掉', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const layer = new PanelLayer()
    layer.build([panel()], [])
    const mount = mounts(layer)[0]
    if (mount === undefined) throw new Error('本该建出卡片')
    host.append(mount)

    layer.dispose()

    expect(mount.isConnected).toBe(false)
    host.remove()
  })
})

describe('落点', () => {
  it('锚点优先，并叠上偏移', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ anchorId: 'a1', position: [9, 9, 9], offset: [0, 1, 0] })],
      [anchor('a1', [1, 2, 3])],
    )

    expect(layer.group.children[0]?.position.toArray()).toEqual([1, 3, 3])
  })

  it('没给锚点时用自己的坐标', () => {
    const layer = new PanelLayer()
    layer.build([panel({ position: [4, 5, 6] })], [])

    expect(layer.group.children[0]?.position.toArray()).toEqual([4, 5, 6])
  })

  // ⚠ 退回而不是不画：一张配好字段的牌因为锚点被删就整个消失，
  //   用户只会觉得「我的牌哪去了」
  it('锚点找不到时退回自己的坐标，牌不消失', () => {
    const layer = new PanelLayer()
    layer.build([panel({ anchorId: 'gone', position: [7, 0, 0] })], [])

    expect(cards(layer)).toHaveLength(1)
    expect(layer.group.children[0]?.position.toArray()).toEqual([7, 0, 0])
  })
})

describe('取值', () => {
  it('取值键带牌 id，同名字段不互相覆盖', () => {
    const layer = new PanelLayer()
    layer.build(
      [
        panel({ id: 'p1', name: '', fields: [field('temp')] }),
        panel({ id: 'p2', name: '', fields: [field('temp')] }),
      ],
      [],
    )
    layer.setValues({
      'p1::temp': { value: 10 },
      'p2::temp': { value: 20 },
    })

    expect(valuesOf(layer)).toEqual(['10', '20'])
  })

  it('前缀、单位与小数位一起拼进去', () => {
    const layer = new PanelLayer()
    layer.build(
      [
        panel({
          name: '',
          fields: [field('temp', { prefix: '出口', unit: '℃', decimals: 1 })],
        }),
      ],
      [],
    )
    layer.setValues({ 'p1::temp': { value: 25.46 } })

    expect(valuesOf(layer)).toEqual(['出口 25.5 ℃'])
  })

  it('没有实时值时退回静态文案', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ name: '', fields: [field('temp', { staticText: '待接入' })] })],
      [],
    )

    expect(valuesOf(layer)).toEqual(['待接入'])
  })

  it('两样都没有时说取不到，不留一块空白', () => {
    const layer = new PanelLayer()
    layer.build([panel({ name: '' })], [])

    expect(valuesOf(layer)).toEqual(['—'])
  })

  it('非有限数不上屏，退回静态文案', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ name: '', fields: [field('temp', { staticText: '待接入' })] })],
      [],
    )
    layer.setValues({ 'p1::temp': { value: Number.NaN } })

    expect(valuesOf(layer)).toEqual(['待接入'])
  })
})

describe('文本安全', () => {
  // ⚠ 牌名与字段标签都是用户可控文本，拼进 innerHTML 就是一个注入点
  it('标签里的尖括号是文本，不是标记', () => {
    const layer = new PanelLayer()
    layer.build([panel({ name: '<img src=x onerror=alert(1)>' })], [])
    const card = cards(layer)[0]

    expect(card?.querySelector('img')).toBeNull()
    expect(card?.textContent).toContain('<img')
  })
})

describe('变体', () => {
  // ⚠ 五种变体之前全长一个样：观感被内联样式压死，样式表里的选择器一条都赢不了
  it('变体名落成 class，样式表才选得中', () => {
    const layer = new PanelLayer()

    layer.build([panel({ style: { ...STYLE, variant: 'hud' } })], [])

    const card = cards(layer)[0]
    expect(card?.classList.contains('twin-panel')).toBe(true)
    expect(card?.classList.contains('twin-panel--hud')).toBe(true)
    layer.dispose()
  })

  it('八种变体各得各的 class', () => {
    for (const variant of TWIN_PANEL_VARIANTS) {
      const layer = new PanelLayer()
      layer.build([panel({ style: { ...STYLE, variant } })], [])

      expect(
        cards(layer)[0]?.classList.contains(`twin-panel--${variant}`),
      ).toBe(true)
      layer.dispose()
    }
  })

  // ⚠ 内联优先级压过样式表：这几样只要被内联写死，变体就永远赢不了
  it('外观相关的属性一律不内联，只留 CSS 变量', () => {
    const layer = new PanelLayer()

    layer.build([panel({ style: { ...STYLE, variant: 'tag' } })], [])

    const inline = cards(layer)[0]?.style
    expect(inline?.border).toBe('')
    expect(inline?.background).toBe('')
    expect(inline?.borderRadius).toBe('')
    expect(inline?.padding).toBe('')
    layer.dispose()
  })

  // ⚠ 变量挂在挂点上、不挂在卡片上：引线与锚点小环是卡片的兄弟，
  //   写到卡片上它们取不到主题色，会退回缺省的 accent
  it('逐牌不同的取色、尺寸与字号走 CSS 变量挂在挂点上', () => {
    const layer = new PanelLayer()

    layer.build(
      [
        panel({
          style: {
            ...STYLE,
            accent: '#ff0000',
            width: 240,
            height: 160,
            fontScale: 2,
          },
        }),
      ],
      [],
    )

    const inline = mounts(layer)[0]?.style
    expect(inline?.getPropertyValue('--tp-accent')).toBe('#ff0000')
    expect(inline?.getPropertyValue('--tp-width')).toBe('240px')
    expect(inline?.getPropertyValue('--tp-height')).toBe('160px')
    expect(inline?.getPropertyValue('--tp-font-size')).toBe('22.0px')
    layer.dispose()
  })

  it('色规格是 token 时包成 var()', () => {
    const layer = new PanelLayer()

    layer.build(
      [panel({ style: { ...STYLE, accent: '--accent-primary' } })],
      [],
    )

    expect(mounts(layer)[0]?.style.getPropertyValue('--tp-accent')).toBe(
      'var(--accent-primary)',
    )
    layer.dispose()
  })
})

describe('没有读数时的前缀与单位', () => {
  // ⚠ 编辑器里五路实时值恒空：只显示占位符的话，用户配了前缀和单位完全看不到反馈
  it('没有实时值时前缀与单位照样显示', () => {
    const layer = new PanelLayer()

    layer.build(
      [panel({ fields: [field('temp', { prefix: '出口', unit: '℃' })] })],
      [],
    )

    expect(valuesOf(layer)).toEqual(['出口 — ℃'])
    layer.dispose()
  })

  it('有静态文案时也拼上前缀与单位', () => {
    const layer = new PanelLayer()

    layer.build(
      [
        panel({
          fields: [
            field('temp', { prefix: '出口', unit: '℃', staticText: '待接入' }),
          ],
        }),
      ],
      [],
    )

    expect(valuesOf(layer)).toEqual(['出口 待接入 ℃'])
    layer.dispose()
  })

  it('前缀与单位都没配时只有占位符，不留多余空格', () => {
    const layer = new PanelLayer()

    layer.build([panel({ fields: [field('temp')] })], [])

    expect(valuesOf(layer)).toEqual(['—'])
    layer.dispose()
  })
})

describe('随模型缩放', () => {
  function scaleOf(layer: PanelLayer): number {
    const first = layer.group.children[0]
    return first?.scale.x ?? 0
  }

  // ⚠ 牌在世界里有真实尺寸：模型换了体量却不跟着缩，小模型上牌能盖满全屏
  it('模型体量大时牌跟着变大', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])
    layer.setWorldScale(10)
    const small = scaleOf(layer)

    layer.setWorldScale(400)

    expect(scaleOf(layer)).toBeGreaterThan(small)
    layer.dispose()
  })

  it('畸形体量被兜底区间挡住，不产出爆炸或塌缩的缩放', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])

    layer.setWorldScale(1e9)
    expect(scaleOf(layer)).toBeLessThanOrEqual(10)

    layer.setWorldScale(1e-9)
    expect(scaleOf(layer)).toBeGreaterThanOrEqual(1e-4)
    layer.dispose()
  })

  // ⚠ 早早封顶的话，模型越大牌的占比越小，大厂区上就成了一个看不清的小点
  it('大模型上不封顶：牌与模型的比例保持住', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])

    layer.setWorldScale(100)
    const atHundred = scaleOf(layer)
    layer.setWorldScale(1000)

    // 体量翻十倍，缩放也该跟着翻十倍——封顶了的话这个比值会明显小于 10
    expect(scaleOf(layer) / atHundred).toBeCloseTo(10, 1)
    layer.dispose()
  })

  it('整体大小倍率乘在自动缩放之上', () => {
    const big = new PanelLayer()
    const normal = new PanelLayer()
    big.build([panel({ style: { ...STYLE, scale: 3 } })], [])
    normal.build([panel()], [])

    big.setWorldScale(100)
    normal.setWorldScale(100)

    expect(scaleOf(big)).toBeCloseTo(scaleOf(normal) * 3)
    big.dispose()
    normal.dispose()
  })

  it('倍率也落到后建的牌上', () => {
    const layer = new PanelLayer()
    layer.setWorldScale(100)

    layer.build([panel({ style: { ...STYLE, scale: 2 } })], [])

    const one = new PanelLayer()
    one.setWorldScale(100)
    one.build([panel()], [])
    expect(scaleOf(layer)).toBeCloseTo(scaleOf(one) * 2)
    layer.dispose()
    one.dispose()
  })

  it('体量取不到时按 1 算，不产出 0 或 NaN 缩放', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])

    layer.setWorldScale(Number.NaN)

    expect(scaleOf(layer)).toBeGreaterThan(0)
    layer.dispose()
  })

  it('先设缩放再建牌，新建的牌也是对的大小', () => {
    const layer = new PanelLayer()
    layer.setWorldScale(400)
    const before = new PanelLayer()
    before.setWorldScale(10)

    layer.build([panel()], [])
    before.build([panel()], [])

    expect(scaleOf(layer)).toBeGreaterThan(scaleOf(before))
    layer.dispose()
    before.dispose()
  })
})

describe('三种朝向', () => {
  function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(x, y, z)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    return camera
  }

  function quatOf(layer: PanelLayer): THREE.Quaternion {
    return layer.group.children[0]?.quaternion ?? new THREE.Quaternion()
  }

  it('始终朝相机：抄相机的姿态', () => {
    const layer = new PanelLayer()
    layer.build([panel({ billboard: 'face' })], [])
    const camera = cameraAt(10, 8, 6)

    layer.faceCamera(camera)

    expect(quatOf(layer).angleTo(camera.quaternion)).toBeCloseTo(0)
    layer.dispose()
  })

  // ⚠ 钉死那一档一旦被误当成跟随，用户配的朝向就永远看不出效果
  it('钉死朝向：相机怎么转都不动', () => {
    const layer = new PanelLayer()
    layer.build([panel({ billboard: 'fixed' })], [])
    const before = quatOf(layer).clone()

    layer.faceCamera(cameraAt(10, 8, 6))

    expect(quatOf(layer).equals(before)).toBe(true)
    layer.dispose()
  })

  it('只水平跟随：牌保持竖直，不随俯仰躺下去', () => {
    const layer = new PanelLayer()
    layer.build([panel({ billboard: 'horizontal' })], [])

    // 相机在高处斜看下来：face 档会跟着俯下去，horizontal 档不该
    layer.faceCamera(cameraAt(0, 50, 10))

    // 牌的本地 +Y 转到世界后仍应几乎是竖直的
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quatOf(layer))
    expect(up.y).toBeCloseTo(1, 5)
    layer.dispose()
  })

  it('只水平跟随：绕竖轴转向相机', () => {
    const layer = new PanelLayer()
    layer.build([panel({ billboard: 'horizontal' })], [])

    layer.faceCamera(cameraAt(100, 0, 0))
    const facingX = new THREE.Vector3(0, 0, 1).applyQuaternion(quatOf(layer))

    expect(facingX.x).toBeCloseTo(1, 5)
    layer.dispose()
  })

  // 相机正好在牌的正上方时水平分量是零，硬转会让牌在那一瞬间乱甩
  it('相机正在正上方时保持上一帧朝向，不乱甩', () => {
    const layer = new PanelLayer()
    layer.build([panel({ billboard: 'horizontal' })], [])
    layer.faceCamera(cameraAt(100, 0, 0))
    const before = quatOf(layer).clone()

    layer.faceCamera(cameraAt(0, 100, 0))

    expect(quatOf(layer).equals(before)).toBe(true)
    layer.dispose()
  })
})
