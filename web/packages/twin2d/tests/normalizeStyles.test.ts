/**
 * @fileoverview 守样式面的口径：无 id / 无 key 的条目整条丢弃且同 id 只留最先一条、
 * 派生槽算式不合法时降级成普通槽（不许留一个永远算不出值的 derived）、端口的周长参数
 * 是环形要 wrap 不能 clamp、`side` 认不出回 auto、引脚与连线一定有线宽。
 */
import { describe, expect, it } from 'vitest'

import {
  normalizeEdgeStyle,
  normalizeEdgeStyles,
  normalizeNodeStyle,
  normalizeNodeStyles,
  normalizePort,
  normalizePorts,
  normalizeRootPatch,
  normalizeSlot,
  normalizeSlots,
  normalizeVariant,
  normalizeVariants,
} from '../src/normalizeStyles'

const HOVER = { kind: 'state', state: 'hover' }

describe('normalizeSlot', () => {
  it('没有 key 的一条丢弃', () => {
    expect(normalizeSlot({ key: '  ' })).toBeNull()
    expect(normalizeSlot('temperature')).toBeNull()
  })

  it('缺省是一个 live 数值槽，占位符是 em dash', () => {
    expect(normalizeSlot({ key: ' t ' })).toEqual({
      key: 't',
      label: '',
      kind: 'live',
      dataType: 'number',
      unit: '',
      precision: null,
      format: 'auto',
      enumMap: {},
      placeholder: '—',
      primary: false,
      expr: null,
    })
  })

  it('格式档认不出一律回 auto——缺省档必须与「没有格式档」时逐字相同', () => {
    expect(normalizeSlot({ key: 'a' })?.format).toBe('auto')
    expect(normalizeSlot({ key: 'a', format: 'kwh' })?.format).toBe('auto')
    expect(normalizeSlot({ key: 'a', format: 'kwhShort' })?.format).toBe(
      'kwhShort',
    )
    expect(normalizeSlot({ key: 'a', format: 'grouped' })?.format).toBe(
      'grouped',
    )
    expect(normalizeSlot({ key: 'a', format: 'trim2' })?.format).toBe('trim2')
  })

  it('派生槽算式合法时留在 derived 档', () => {
    const slot = normalizeSlot({
      key: 'eff',
      kind: 'derived',
      expr: { kind: 'scale', of: { kind: 'slot', slot: 'cop' }, by: 100 },
    })
    expect(slot?.kind).toBe('derived')
    expect(slot?.expr).toEqual({
      kind: 'scale',
      of: { kind: 'slot', slot: 'cop' },
      by: 100,
    })
  })

  it('派生槽算式不合法时降级成 live 且算式清空', () => {
    const slot = normalizeSlot({ key: 'eff', kind: 'derived', expr: 'a/b' })
    expect(slot?.kind).toBe('live')
    expect(slot?.expr).toBeNull()
  })

  it('live 槽即使带着算式也不进 derived 档', () => {
    const slot = normalizeSlot({
      key: 'p',
      kind: 'live',
      expr: { kind: 'slot', slot: 'a' },
    })
    expect(slot?.kind).toBe('live')
    expect(slot?.expr).toBeNull()
  })

  it('小数位取整并夹到 0..6，取不到数时是 null = 不定点', () => {
    expect(normalizeSlot({ key: 'a', precision: 2.4 })?.precision).toBe(2)
    expect(normalizeSlot({ key: 'a', precision: -3 })?.precision).toBe(0)
    expect(normalizeSlot({ key: 'a', precision: 99 })?.precision).toBe(6)
    expect(normalizeSlot({ key: 'a', precision: null })?.precision).toBeNull()
  })

  it('枚举映射的键一律是字符串，空值那一条丢弃', () => {
    const slot = normalizeSlot({
      key: 'st',
      dataType: 'enum',
      unit: ' kW ',
      placeholder: ' -- ',
      primary: true,
      enumMap: { 0: ' 离线 ', 1: '运行', 2: '  ', '': 'x' },
    })
    expect(slot?.enumMap).toEqual({ '0': '离线', '1': '运行' })
    expect(slot?.dataType).toBe('enum')
    expect(slot?.unit).toBe('kW')
    expect(slot?.placeholder).toBe('--')
    expect(slot?.primary).toBe(true)
  })

  it('枚举映射里的 __proto__ 落成自有键，不改原型', () => {
    const enumMap: unknown = JSON.parse('{"__proto__":"坏"}')
    const slot = normalizeSlot({ key: 'st', enumMap })
    expect(Object.getOwnPropertyNames(slot?.enumMap ?? {})).toEqual([
      '__proto__',
    ])
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it('认不出的数据类型与槽档各回缺省', () => {
    const slot = normalizeSlot({ key: 'a', kind: 'computed', dataType: 'int' })
    expect(slot?.kind).toBe('live')
    expect(slot?.dataType).toBe('number')
  })
})

describe('normalizeSlots', () => {
  it('丢弃脏条目、同 key 只留最先一条并保持文档序', () => {
    const slots = normalizeSlots([
      { key: 'b' },
      'x',
      { key: 'a' },
      { key: 'b', unit: 'kW' },
    ])
    expect(slots.map((slot) => slot.key)).toEqual(['b', 'a'])
    expect(slots[0]?.unit).toBe('')
  })

  it('非数组给空表', () => {
    expect(normalizeSlots(undefined)).toEqual([])
  })
})

describe('normalizePort', () => {
  it('没有 id 的一条丢弃', () => {
    expect(normalizePort({ name: '1' })).toBeNull()
    expect(normalizePort(null)).toBeNull()
  })

  it('缺省落在周长参数 0，方向 both、出线方向 auto、无引脚符号', () => {
    expect(normalizePort({ id: 'l' })).toEqual({
      id: 'l',
      name: '',
      at: { kind: 'perim', t: 0 },
      dir: 'both',
      side: 'auto',
      showName: false,
      marker: null,
    })
  })

  it('周长参数越界按环形 wrap，不夹取', () => {
    expect(
      normalizePort({ id: 'p', at: { kind: 'perim', t: 1.25 } })?.at,
    ).toEqual({ kind: 'perim', t: 0.25 })
    expect(
      normalizePort({ id: 'p', at: { kind: 'perim', t: -0.25 } })?.at,
    ).toEqual({ kind: 'perim', t: 0.75 })
    expect(normalizePort({ id: 'p', at: { kind: 'perim' } })?.at).toEqual({
      kind: 'perim',
      t: 0,
    })
  })

  it('归一坐标两头夹到 0..1，缺的那一维回 0.5', () => {
    expect(
      normalizePort({ id: 'p', at: { kind: 'xy', x: 1.4, y: -2 } })?.at,
    ).toEqual({ kind: 'xy', x: 1, y: 0 })
    expect(normalizePort({ id: 'p', at: { kind: 'xy' } })?.at).toEqual({
      kind: 'xy',
      x: 0.5,
      y: 0.5,
    })
  })

  it('认不出的出线方向回 auto，认不出的引脚方向回 both', () => {
    const port = normalizePort({ id: 'p', side: 'up', dir: 'sink' })
    expect(port?.side).toBe('auto')
    expect(port?.dir).toBe('both')
  })

  it('引脚符号的几何不合法时整个符号丢掉', () => {
    expect(normalizePort({ id: 'p', marker: { length: 6 } })?.marker).toBeNull()
    expect(normalizePort({ id: 'p', marker: 'line' })?.marker).toBeNull()
  })

  it('引脚符号一遍描边都没给时补一条 2px 的，长度非正回 8', () => {
    const marker = normalizePort({
      id: 'p',
      side: 'left',
      dir: 'in',
      showName: true,
      name: ' A ',
      marker: { shape: { kind: 'line', x2: 1 }, length: 0 },
    })?.marker
    expect(marker?.length).toBe(8)
    expect(marker?.strokes).toEqual([
      {
        id: 'stroke-0',
        width: 2,
        color: 'currentColor',
        dash: [],
        cap: 'butt',
        join: 'miter',
        opacity: 1,
        nonScaling: false,
      },
    ])
    expect(marker?.fill).toEqual({ kind: 'none' })
  })
})

describe('normalizePorts', () => {
  it('丢弃脏条目、同 id 只留最先一条', () => {
    const ports = normalizePorts([
      { id: 'l', name: '左' },
      { id: 'l', name: '重名' },
      42,
    ])
    expect(ports.map((port) => port.name)).toEqual(['左'])
  })
})

describe('normalizeRootPatch', () => {
  it('非对象给一个什么都不覆盖的空补丁', () => {
    expect(normalizeRootPatch('lift')).toEqual({})
  })

  it('只写显式给出的键，空串与取不到数的键一概不写', () => {
    expect(
      normalizeRootPatch({
        lift: -2,
        z: 0,
        borderColor: ' var(--danger) ',
        accent: '  ',
      }),
    ).toEqual({ lift: -2, z: 0, borderColor: 'var(--danger)' })
  })

  it('hover 那一档的抬升与等比缩放同在一条补丁上，两样都收', () => {
    expect(normalizeRootPatch({ lift: 3, scale: 1.025 })).toEqual({
      lift: 3,
      scale: 1.025,
    })
  })

  it('⚠ scale 是 0、负数或缺席时都不写这个键——缩到 0 会让整个节点塌成一个点', () => {
    expect('scale' in normalizeRootPatch({ scale: 0 })).toBe(false)
    expect('scale' in normalizeRootPatch({ scale: -1 })).toBe(false)
    expect('scale' in normalizeRootPatch({ scale: 'big' })).toBe(false)
    expect('scale' in normalizeRootPatch({ lift: 1 })).toBe(false)
  })

  it('阴影为空数组时不写这个键，给了才写', () => {
    expect(normalizeRootPatch({ shadows: [] }).shadows).toBeUndefined()
    expect(normalizeRootPatch({ shadows: [{ id: 'g', blur: 8 }] })).toEqual({
      shadows: [
        {
          id: 'g',
          inset: false,
          x: 0,
          y: 0,
          blur: 8,
          spread: 0,
          color: 'currentColor',
        },
      ],
    })
  })
})

describe('normalizeVariant', () => {
  it('没有 id 或条件不合法的一条丢弃', () => {
    expect(normalizeVariant({ when: HOVER })).toBeNull()
    expect(normalizeVariant({ id: 'v', when: { kind: 'x' } })).toBeNull()
    expect(normalizeVariant([])).toBeNull()
  })

  it('补丁按图元 id 收：空键、重名与非对象的值一律丢弃', () => {
    const variant = normalizeVariant({
      id: 'v1',
      when: HOVER,
      patch: { ' ': {}, icon: { opacity: 0.5 }, icon2: 'x' },
    })
    expect(Object.keys(variant?.patch ?? {})).toEqual(['icon'])
    expect(variant?.rootPatch).toEqual({})
  })

  it('子类那一档的条件与根覆盖一起留下来', () => {
    const variant = normalizeVariant({
      id: 'sub-waste-heat',
      when: { kind: 'tag', key: 'subtype', in: ['waste-heat'] },
      rootPatch: { accent: 'var(--series-3)' },
    })
    expect(variant?.when).toEqual({
      kind: 'tag',
      key: 'subtype',
      in: ['waste-heat'],
    })
    expect(variant?.rootPatch).toEqual({ accent: 'var(--series-3)' })
    expect(variant?.patch).toEqual({})
  })
})

describe('normalizeVariants', () => {
  it('保持文档序并按 id 去重——后者覆盖前者靠的就是这个顺序', () => {
    const variants = normalizeVariants([
      { id: 'a', when: HOVER },
      { id: 'b', when: { kind: 'status', in: ['alarm'] } },
      { id: 'a', when: HOVER },
      { id: 'c', when: { kind: 'x' } },
    ])
    expect(variants.map((variant) => variant.id)).toEqual(['a', 'b'])
  })
})

describe('normalizeNodeStyle', () => {
  it('没有 id 的一条丢弃', () => {
    expect(normalizeNodeStyle({ name: '水箱' })).toBeNull()
    expect(normalizeNodeStyle(7)).toBeNull()
  })

  it('缺省尺寸是 160 × 90，状态点缺省画在线', () => {
    const style = normalizeNodeStyle({ id: 12 })
    expect(style?.id).toBe('12')
    expect(style?.size).toEqual({ w: 160, h: 90 })
    expect(style?.defaultStatus).toBe('online')
  })

  it('尺寸取整且不许落到 0', () => {
    expect(
      normalizeNodeStyle({ id: 's', size: { w: 0.4, h: 90.6 } })?.size,
    ).toEqual({ w: 1, h: 91 })
    expect(
      normalizeNodeStyle({ id: 's', size: { w: -8, h: 0 } })?.size,
    ).toEqual({
      w: 160,
      h: 90,
    })
  })

  it('装饰类要的 hidden 一档留得住，认不出的档回 online', () => {
    expect(
      normalizeNodeStyle({ id: 's', defaultStatus: 'hidden' })?.defaultStatus,
    ).toBe('hidden')
    expect(
      normalizeNodeStyle({ id: 's', defaultStatus: 'pending' })?.defaultStatus,
    ).toBe('online')
  })

  it('四个集合都收成数组，脏值给空表', () => {
    const style = normalizeNodeStyle({
      id: 's',
      name: ' 换热器 ',
      category: ' vessel ',
      accent: ' var(--series-1) ',
      prims: 'nope',
      ports: { id: 'l' },
      slots: [{ key: 'a' }, { key: 'a' }],
      variants: [{ id: 'v', when: HOVER }],
    })
    expect(style?.name).toBe('换热器')
    expect(style?.category).toBe('vessel')
    expect(style?.accent).toBe('var(--series-1)')
    expect(style?.prims).toEqual([])
    expect(style?.ports).toEqual([])
    expect(style?.slots).toHaveLength(1)
    expect(style?.variants).toHaveLength(1)
  })
})

describe('normalizeNodeStyles', () => {
  it('同 id 先出现的赢，脏条目丢弃', () => {
    const styles = normalizeNodeStyles([
      { id: 'tank', name: '文档里的' },
      { id: 'tank', name: '后来的' },
      null,
    ])
    expect(styles.map((style) => style.name)).toEqual(['文档里的'])
  })
})

describe('normalizeEdgeStyle', () => {
  it('没有 id 的一条丢弃', () => {
    expect(normalizeEdgeStyle({ name: '蒸汽' })).toBeNull()
    expect(normalizeEdgeStyle('pipe')).toBeNull()
  })

  it('一遍描边都没给时补一条 2px 圆头且不随舞台缩放的导线', () => {
    expect(normalizeEdgeStyle({ id: 'e' })?.strokes).toEqual([
      {
        id: 'stroke-0',
        width: 2,
        color: 'currentColor',
        dash: [],
        cap: 'round',
        join: 'round',
        opacity: 1,
        nonScaling: true,
      },
    ])
  })

  it('给了描边就原样留着——宽底窄芯的双线不许被兜底顶掉', () => {
    const strokes = normalizeEdgeStyle({
      id: 'e',
      strokes: [
        { id: 'base', width: 6, color: 'var(--surface)' },
        { id: 'core', width: 2 },
      ],
    })?.strokes
    expect(strokes?.map((pass) => [pass.id, pass.width])).toEqual([
      ['base', 6],
      ['core', 2],
    ])
  })

  it('走线档认不出时回 auto，拐角半径缺省 8、负数收 0', () => {
    expect(normalizeEdgeStyle({ id: 'e', route: 'spline' })?.route).toBe('auto')
    expect(normalizeEdgeStyle({ id: 'e' })?.cornerRadius).toBe(8)
    expect(
      normalizeEdgeStyle({ id: 'e', cornerRadius: -4 })?.cornerRadius,
    ).toBe(0)
    expect(normalizeEdgeStyle({ id: 'e', route: 'bezier' })?.route).toBe(
      'bezier',
    )
  })

  it('端点标记缺省是没有，箭头一档带住参考项目的三个取值', () => {
    const style = normalizeEdgeStyle({
      id: 'e',
      startMarker: { kind: 'dot' },
      endMarker: { kind: 'arrow' },
    })
    expect(style?.startMarker).toEqual({ kind: 'none' })
    expect(style?.endMarker).toEqual({
      kind: 'arrow',
      size: 10,
      spread: 0.42,
      filled: true,
      opacity: 0.82,
    })
  })

  it('箭头的张开半角两头夹取，尺寸非正回 10', () => {
    const wide = normalizeEdgeStyle({
      id: 'e',
      endMarker: { kind: 'arrow', spread: 9, size: 0, filled: false },
    })?.endMarker
    expect(wide).toEqual({
      kind: 'arrow',
      size: 10,
      spread: Math.PI / 2,
      filled: false,
      opacity: 0.82,
    })
    const narrow = normalizeEdgeStyle({
      id: 'e',
      endMarker: { kind: 'arrow', spread: 0 },
    })?.endMarker
    expect(narrow).toEqual({
      kind: 'arrow',
      size: 10,
      spread: 0.05,
      filled: true,
      opacity: 0.82,
    })
    expect(normalizeEdgeStyle({ id: 'e', endMarker: 3 })?.endMarker).toEqual({
      kind: 'none',
    })
  })

  it('流动缺省不开、dash 空或全零时补回一个完整周期', () => {
    expect(normalizeEdgeStyle({ id: 'e' })?.flow).toEqual({
      enabled: false,
      dash: [10, 10],
      durationMs: 800,
    })
    expect(
      normalizeEdgeStyle({ id: 'e', flow: { enabled: true, dash: [0, -2] } })
        ?.flow,
    ).toEqual({ enabled: true, dash: [10, 10], durationMs: 800 })
    expect(
      normalizeEdgeStyle({
        id: 'e',
        flow: { dash: [6, 4], durationMs: 0 },
      })?.flow,
    ).toEqual({ enabled: false, dash: [6, 4], durationMs: 800 })
  })

  it('非活跃边缺省半透明并拉成实线，颜色空串 = 沿用边色', () => {
    expect(normalizeEdgeStyle({ id: 'e' })?.inactive).toEqual({
      opacity: 0.5,
      dashOff: true,
      color: '',
    })
    expect(
      normalizeEdgeStyle({
        id: 'e',
        inactive: { opacity: 9, dashOff: false, color: ' gray ' },
      })?.inactive,
    ).toEqual({ opacity: 1, dashOff: false, color: 'gray' })
  })

  it('标签缺省没有底板，字体缺席键就是缺席', () => {
    expect(normalizeEdgeStyle({ id: 'e' })?.label).toEqual({
      font: {},
      box: null,
    })
  })

  it('标签底板给了就把边框、圆角与内边距一起收全', () => {
    const label = normalizeEdgeStyle({
      id: 'e',
      label: {
        font: { size: 12 },
        box: { fill: ' #101418 ', radius: 'pill', pad: [2, 6, 2, 6] },
      },
    })?.label
    expect(label?.font).toEqual({ size: 12 })
    expect(label?.box).toEqual({
      fill: '#101418',
      border: {
        width: 0,
        style: 'solid',
        color: 'currentColor',
        sides: { top: true, right: true, bottom: true, left: true },
      },
      radius: 'pill',
      pad: [2, 6, 2, 6],
    })
  })
})

describe('normalizeEdgeStyles', () => {
  it('同 id 先出现的赢，脏条目丢弃', () => {
    const styles = normalizeEdgeStyles([
      { id: 'hot', name: '热水' },
      { id: 'hot', name: '重名' },
      false,
    ])
    expect(styles.map((style) => style.name)).toEqual(['热水'])
  })
})
