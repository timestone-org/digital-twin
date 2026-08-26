/**
 * @fileoverview 契约：`TWIN_2D_PRIM_KINDS` 的每一档，在 `Twin2dPrimView.vue` 里都有一条自己的
 * 渲染分支，且没有多余分支——源码侧逐档对上分支判断，行为侧每一档挂载出来都真画了东西。
 *
 * ⚠ 守的是「加了第五种图元、归一化认得它、渲染层不认」：那类图元在编辑器里配得出来、
 * 画布上静默不画，零报错。反向的多余分支同样静默——分支永远走不到，看着像「配了没反应」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { TWIN_2D_PRIM_KINDS } from '../src/kinds'
import Twin2dPrimView from '../src/render/Twin2dPrimView.vue'
import type { Twin2dPrimKind } from '../src/kinds'
import type { Twin2dPaintCtx } from '../src/paintCommon'
import type { Twin2dNode } from '../src/types'
import type {
  Twin2dPrim as Twin2dPrimType,
  Twin2dPrimBase,
} from '../src/typesPrim'
import type { Twin2dVariantCtx } from '../src/variants'

/** ⚠ 从 `process.cwd()`（web workspace 根）拼路径：happy-dom 那一趟里
 *  `import.meta.url` 不是 `file:` 协议，`fileURLToPath` 会当场抛。 */
const SOURCE = readFileSync(
  join(
    process.cwd(),
    'packages',
    'twin2d',
    'src',
    'render',
    'Twin2dPrimView.vue',
  ),
  'utf8',
)

/**
 * 图元的分支判断。
 * ⚠ 认的是 `prim.kind`，不是任意 `kind`：`prim.at.kind === 'fill'` 判的是摆位那一族，
 * 少了这个限定，摆位、填充、几何的每一档都会被当成「多出来的图元分支」。
 */
const KIND_BRANCH = /\bprim\.kind === '([a-z-]+)'/g

const NODE: Twin2dNode = {
  id: 'n1',
  styleId: 's1',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '一号换热站',
  labelPos: 'bottom',
  status: '',
  accent: '',
  badge: '',
  badgeColor: '',
  badgeShape: 'round',
  tags: {},
  slots: [],
  layers: [],
  patch: {},
  ports: [],
}

const CTX: Twin2dPaintCtx = { node: NODE, boxW: 200, boxH: 120, idPrefix: 'a1' }

const VARIANT: Twin2dVariantCtx = {
  states: new Set(),
  status: null,
  tags: new Map(),
  slots: new Map(),
}

const BASE: Omit<Twin2dPrimBase, 'id'> = {
  at: { kind: 'flow' },
  size: { w: 40, h: 40 },
  minWidth: null,
  maxWidth: null,
  z: 0,
  opacity: 1,
  hidden: false,
  when: null,
  anim: null,
  transition: null,
  rotate: 0,
  scale: 1,
  transformOrigin: '50% 50%',
  pointerEvents: 'auto',
  keepUpright: false,
}

/**
 * 每一档一个最小样本。
 * ⚠ 这张表的类型是 `Record<Twin2dPrimKind, …>`：加了第五种图元而不给样本，这份契约
 * **编译期**就红，而不是等到画布上发现那类图元不见了。
 */
const SAMPLES: Record<Twin2dPrimKind, Twin2dPrimType> = {
  box: {
    ...BASE,
    id: 'shell',
    kind: 'box',
    layout: {
      flow: 'row',
      gap: 0,
      align: 'center',
      justify: 'start',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    fills: [],
    border: {
      width: 0,
      style: 'none',
      color: '',
      sides: { top: true, right: true, bottom: true, left: true },
    },
    radius: 0,
    shadows: [],
    backdropBlur: 0,
    clip: false,
    cursor: 'default',
    children: [],
  },
  vec: {
    ...BASE,
    id: 'outline',
    kind: 'vec',
    coord: 'px',
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10, rx: 0 },
    fill: { kind: 'none' },
    strokes: [],
    gradients: [],
    stretch: false,
  },
  ico: {
    ...BASE,
    id: 'glyph',
    kind: 'ico',
    src: { kind: 'sprite', id: 'ico-hx' },
    color: 'currentColor',
  },
  txt: {
    ...BASE,
    id: 'label',
    kind: 'txt',
    src: { kind: 'lit', text: '读数' },
    font: {},
    align: 'start',
    baseline: 'auto',
    nowrap: false,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
  },
}

/** 源码里出现过的图元分支，按出现顺序。 */
function branchedKinds(): string[] {
  return [...SOURCE.matchAll(KIND_BRANCH)].map((match) => match[1] ?? '')
}

describe('TWIN_2D_PRIM_KINDS ↔ Twin2dPrimView.vue 的分支', () => {
  it.each([...TWIN_2D_PRIM_KINDS])('%s 有自己的渲染分支', (kind) => {
    expect(branchedKinds()).toContain(kind)
  })

  it('没有多余分支——四档之外一条都没有', () => {
    expect([...new Set(branchedKinds())].sort()).toEqual(
      [...TWIN_2D_PRIM_KINDS].sort(),
    )
  })

  // 同一档判两遍时，后一遍永远走不到，而两遍看着都对
  it('每一档只判一次', () => {
    const kinds = branchedKinds()

    expect(kinds).toHaveLength(new Set(kinds).size)
  })
})

describe('每一档挂载出来都真画了东西', () => {
  it.each([...TWIN_2D_PRIM_KINDS])('%s 渲染出宿主元素', (kind) => {
    const wrapper = mount(Twin2dPrimView, {
      props: { prim: SAMPLES[kind], ctx: CTX, variant: VARIANT },
    })

    expect(wrapper.find('*').exists()).toBe(true)
  })

  it('样本表逐档齐备，一档不落', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...TWIN_2D_PRIM_KINDS].sort())
  })
})
