/**
 * @fileoverview 契约：样式预览的算料——临时节点跟着样式尺寸走、覆盖尺寸真的换盒、
 * 示例读数经运行态那条缝合管线（派生槽跟着算出来），以及缩放盒的两段变换次序。
 *
 * ⚠ 示例读数必须走 `twin2dValues`：在预览这一侧另拼一张槽键表的话，派生槽在预览里
 * 与在墙上不是同一个数，而两处单看都对（§10.1）。这里正面断言派生槽算得出来——
 * 只断言基础槽有值的话，另拼一张表的实现照样绿。
 * ⚠ 有 `enumMap` 的槽要取表里头一个键：喂一个不在表里的数，映射查不到就退回数字直出，
 * 于是配了词表的槽在预览里显示的是裸数字，看着像词表没生效。
 * ⚠ `translate` 排在 `scale` 左边：CSS 的变换列表从右往左作用，排右边那半格位移会
 * 跟着一起缩，缩得越狠偏得越多。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dNodeStyle } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_PREVIEW_NODE_ID,
  twin2dPreviewFit,
  twin2dPreviewShots,
} from '@/pages/Twin2dEditor/scripts/stylePreview'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('夹具样式没通过归一化')
}

/**
 * 三个槽都被 `txt` 图元引到，否则它们连绑定行都不成，示例读数无从落位。
 * `double` 是派生槽：它自己不成行，但引到的 `power` 要成行。
 */
const STYLE: Twin2dNodeStyle =
  normalizeTwin2dConfig({
    styles: [
      {
        id: 'st',
        name: '换热器',
        size: { w: 120, h: 80 },
        slots: [
          { key: 'power', label: '功率', dataType: 'number', unit: 'kW' },
          {
            key: 'mode',
            label: '模式',
            dataType: 'enum',
            enumMap: { '3': '制热', '4': '制冷' },
          },
          {
            key: 'double',
            label: '两倍',
            kind: 'derived',
            dataType: 'number',
            expr: { kind: 'scale', of: { kind: 'slot', slot: 'power' }, by: 2 },
          },
        ],
        prims: [
          { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'power' } },
          { id: 't2', kind: 'txt', src: { kind: 'slot', slot: 'mode' } },
          { id: 't3', kind: 'txt', src: { kind: 'slot', slot: 'double' } },
        ],
      },
    ],
  }).styles[0] ?? throwMissing()

/** 缺省那一档：跟样式尺寸走、不镜像、示例读数给 10。 */
const BASE = { size: null, flipped: false, sample: 10 } as const

/**
 * 一帧预览；归一化把种子丢掉就当场炸，不悄悄退化成空表。
 * @param options 这一帧的开关
 */
function shot(options: Parameters<typeof twin2dPreviewShots>[1]) {
  const first = twin2dPreviewShots(STYLE, options)[0]
  if (first === undefined) throw new Error('一帧预览都没算出来')
  return first
}

describe('临时节点', () => {
  it('位姿归零、id 定死，一份预览只有一个节点', () => {
    const one = shot(BASE)

    expect(one.node.id).toBe(TWIN_2D_PREVIEW_NODE_ID)
    expect(one.node.styleId).toBe('st')
    expect(one.node.x).toBe(0)
    expect(one.node.y).toBe(0)
  })

  it('不给覆盖尺寸就跟样式自己的 size 走', () => {
    expect(shot(BASE).size).toEqual({ w: 120, h: 80 })
  })

  it('给了覆盖尺寸就按覆盖的画', () => {
    expect(shot({ ...BASE, size: { w: 300, h: 40 } }).size).toEqual({
      w: 300,
      h: 40,
    })
  })

  it('镜像那一档真的翻在节点上，不是只喂一档变体', () => {
    expect(shot({ ...BASE, flipped: true }).node.flipX).toBe(true)
    expect(shot(BASE).node.flipX).toBe(false)
  })
})

describe('示例读数', () => {
  it('数值槽喂进示例值', () => {
    expect(shot(BASE).readSlot('power')?.value).toBe(10)
  })

  it('派生槽跟着算出来——走的是运行态那条缝合管线', () => {
    expect(shot(BASE).readSlot('double')?.value).toBe(20)
  })

  it('配了词表的槽取表里头一个键，好让词表看得见', () => {
    expect(shot(BASE).readSlot('mode')?.value).toBe(3)
  })

  it('清空示例读数时每个槽都无值，于是出自己的占位符', () => {
    const one = shot({ ...BASE, sample: null })

    expect(one.readSlot('power')?.value).toBeNull()
    expect(one.readSlot('double')?.value ?? null).toBeNull()
  })

  it('槽位口径原样带出来，格式化不在这一层另开一份', () => {
    expect(shot(BASE).readSlot('power')?.slot.unit).toBe('kW')
  })

  it('这份样式没有的槽键读不出东西来', () => {
    expect(shot(BASE).readSlot('nope')).toBeNull()
  })

  it('变体的 slot 与 has 两档读的是同一袋读数', () => {
    expect(shot(BASE).slots.get('power')).toBe(10)
    expect(shot(BASE).slots.get('double')).toBe(20)
  })
})

describe('缩放盒', () => {
  it('按框等比缩，两轴取更紧的那一边', () => {
    const fit = twin2dPreviewFit({ w: 100, h: 100 }, { w: 200, h: 50 }, 3)

    expect(fit.transform).toContain('scale(0.5)')
  })

  it('小符号最多放大到封顶那一档，不按框铺满', () => {
    const fit = twin2dPreviewFit({ w: 200, h: 200 }, { w: 10, h: 10 }, 3)

    expect(fit.transform).toContain('scale(3)')
  })

  it('translate 排在 scale 左边', () => {
    const fit = twin2dPreviewFit({ w: 100, h: 100 }, { w: 50, h: 50 }, 3)

    expect(fit.transform).toBe('translate(-50%, -50%) scale(2)')
  })

  it('盒的宽高就是节点在画布坐标里占的宽高', () => {
    const fit = twin2dPreviewFit({ w: 100, h: 100 }, { w: 120, h: 80 }, 3)

    expect(fit.width).toBe('120px')
    expect(fit.height).toBe('80px')
  })
})
