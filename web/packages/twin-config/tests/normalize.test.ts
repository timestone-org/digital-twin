/**
 * @fileoverview 锁住归一化的三条契约：缺字段给缺省、非法值丢弃而不抛、结果幂等。
 * 幂等是绑定行对齐的前提——归一化跑两遍会挪动实体下标的话，
 * 编辑器派生的 `anchorValues[i]` 与运行时读的第 i 个锚点就不是同一个了。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_CONFIG_VERSION } from '../src/constants'
import { normalizeTwinConfig } from '../src/normalize'
import { NO_CLICK_LIMIT } from '../src/normalizeRules'
import type { TwinModelRef, TwinVisibilityRule } from '../src/types'

/** 只置基线显隐的一份规则。 */
function shown(visible: boolean): TwinVisibilityRule {
  return { visible, hideBelow: null, hideAbove: null, fade: null }
}

/** 一份什么都没配的模型：缺省即「不叠任何东西」。 */
const EMPTY_MODEL: TwinModelRef = {
  asset: '',
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  autoRotate: false,
  background: '',
  showGroundGrid: false,
  originalMaterials: false,
  animations: { enabled: false, clips: [], speed: 1 },
  sceneEffects: {
    starfield: { enabled: false, density: 1, speed: 1, nebula: false },
    pedestal: {
      enabled: false,
      color: '#00d5ff',
      ring: true,
      grid: true,
      gradientGround: true,
      contactShadow: true,
      reflection: 'none',
      radius: 1.6,
    },
    lightColumn: {
      enabled: false,
      mode: 'dome',
      color: '#00d5ff',
      intensity: 1,
      speed: 1,
      height: 1.15,
      rise: 'loop',
    },
  },
}

const MESSY_CONFIG = {
  version: 99,
  model: {
    asset: '  asset:0198f0f1-2f4c-7bbb-9f0d-3a2b1c4d5e6f  ',
    scale: Number.NaN,
    position: [1, 'x', Number.POSITIVE_INFINITY],
    rotation: 'nope',
    autoRotate: 'yes',
    background: 'var(--Surface-Base)',
  },
  parts: [
    null,
    { name: ' 主机 ', nodes: [' pump ', 'pump', '', 7] },
    { id: 'p-fan', visible: false },
  ],
  anchors: [
    { id: ' a-1 ', position: [1, 2, 3], label: ' 出口 ', unit: '℃' },
    { decimals: '2.6' },
    'not-an-object',
  ],
  cameras: [
    { id: ' c-1 ', position: [1, 2, 3], fov: 999, isDefault: true },
    { fov: 'wide' },
    null,
  ],
  viewpoints: { enabled: true, mode: 'nonsense', items: [' c-1 ', ''] },
}

describe('normalizeTwinConfig 的缺省', () => {
  it('完全没有输入时给出一份可渲染的空配置', () => {
    expect(normalizeTwinConfig(undefined)).toEqual({
      version: TWIN_CONFIG_VERSION,
      model: EMPTY_MODEL,
      parts: [],
      anchors: [],
      cameras: [],
      viewpoints: {
        enabled: false,
        mode: 'buttons',
        keyboard: false,
        items: [],
      },
      panels: [],
      arrows: [],
      flows: [],
    })
  })

  it('非对象输入按空配置处理而不是抛错', () => {
    expect(normalizeTwinConfig('nope').parts).toEqual([])
    expect(normalizeTwinConfig(42).version).toBe(TWIN_CONFIG_VERSION)
  })

  it('版本号一律盖成当前格式版本', () => {
    expect(normalizeTwinConfig({ version: 99 }).version).toBe(
      TWIN_CONFIG_VERSION,
    )
  })
})

describe('normalizeTwinConfig 的模型引用', () => {
  it('只收 asset: 前缀的素材引用', () => {
    expect(normalizeTwinConfig(MESSY_CONFIG).model.asset).toBe(
      'asset:0198f0f1-2f4c-7bbb-9f0d-3a2b1c4d5e6f',
    )
    expect(
      normalizeTwinConfig({ model: { asset: 'https://x/a.glb' } }).model.asset,
    ).toBe('')
  })

  it('非有限的缩放与坐标分量落回缺省', () => {
    const model = normalizeTwinConfig(MESSY_CONFIG).model
    expect(model.scale).toBe(1)
    expect(model.position).toEqual([1, 0, 0])
    expect(model.rotation).toEqual([0, 0, 0])
  })

  it('缩放夹在可用区间内', () => {
    expect(normalizeTwinConfig({ model: { scale: 0 } }).model.scale).toBe(0.001)
    expect(normalizeTwinConfig({ model: { scale: 1e9 } }).model.scale).toBe(
      1000,
    )
  })

  it('背景色只认 hex 与 token 两种形状', () => {
    expect(normalizeTwinConfig(MESSY_CONFIG).model.background).toBe(
      '--surface-base',
    )
    expect(
      normalizeTwinConfig({ model: { background: 'red' } }).model.background,
    ).toBe('')
  })

  it('autoRotate 只认布尔真', () => {
    expect(normalizeTwinConfig(MESSY_CONFIG).model.autoRotate).toBe(false)
    expect(
      normalizeTwinConfig({ model: { autoRotate: true } }).model.autoRotate,
    ).toBe(true)
  })
})

describe('normalizeTwinConfig 的实体', () => {
  it('丢掉非对象条目，幸存者的铸造 id 仍带原始下标', () => {
    expect(normalizeTwinConfig(MESSY_CONFIG).parts).toEqual([
      {
        id: 'part-1',
        name: '主机',
        nodes: ['pump'],
        visibility: shown(true),
        clickDistance: NO_CLICK_LIMIT,
      },
      {
        id: 'p-fan',
        name: '',
        nodes: [],
        // 老写法 `visible: false` 仍然读得进来：存量手写配置不该一升级就全亮
        visibility: shown(false),
        clickDistance: NO_CLICK_LIMIT,
      },
    ])
  })

  it('锚点小数位四舍五入并夹进上限，缺省为不定位数', () => {
    const anchors = normalizeTwinConfig(MESSY_CONFIG).anchors
    expect(anchors[0]).toEqual({
      id: 'a-1',
      name: '',
      position: [1, 2, 3],
      label: '出口',
      unit: '℃',
      decimals: null,
      visibility: shown(true),
    })
    expect(anchors[1]?.decimals).toBe(3)
    expect(
      normalizeTwinConfig({ anchors: [{ decimals: 99 }] }).anchors[0]?.decimals,
    ).toBe(10)
  })

  it('非对象的部件与锚点条目一并丢掉', () => {
    expect(normalizeTwinConfig({ parts: ['x', 3, null] }).parts).toEqual([])
    expect(normalizeTwinConfig({ anchors: [[]] }).anchors).toEqual([])
  })
})

describe('normalizeTwinConfig 的幂等', () => {
  it('归一化跑两遍与跑一遍结果相同', () => {
    const once = normalizeTwinConfig(MESSY_CONFIG)
    expect(normalizeTwinConfig(once)).toEqual(once)
  })

  it('归一化跑三遍仍不漂', () => {
    const once = normalizeTwinConfig(MESSY_CONFIG)
    expect(normalizeTwinConfig(normalizeTwinConfig(once))).toEqual(once)
  })

  it('结果里没有 undefined，JSON 往返也不变形', () => {
    const once = normalizeTwinConfig(MESSY_CONFIG)
    const roundTripped: unknown = JSON.parse(JSON.stringify(once))
    expect(roundTripped).toEqual(once)
  })
})
