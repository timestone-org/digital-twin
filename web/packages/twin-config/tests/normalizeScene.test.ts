/**
 * @fileoverview 场景层归一化的口径：摆放、内置动画、场景特效、视点。
 *
 * ⚠ 这里守的多数是「配了一个越界值，渲染层拿去当真」的那类错：
 * fov 取到 0 或 180 时取景距离的公式除零或塌缩，画面整个消失而没有任何报错；
 * 特效倍率没有上限时手滑输个 1000 就是一片白。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CAMERA_FOV,
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
  defaultCameraOf,
  normalizeCamera,
  normalizeModel,
  normalizeViewpoints,
} from '../src/normalizeScene'
import type { TwinCamera } from '../src/types'

function camera(raw: unknown): TwinCamera {
  const built = normalizeCamera(raw, 0)
  if (built === null) throw new Error('这份输入本该归一出一个视点')
  return built
}

describe('模型摆放', () => {
  it('只认 asset: 引用，别的写法一律当成没挑模型', () => {
    expect(normalizeModel({ asset: 'https://cdn/a.glb' }).asset).toBe('')
    expect(normalizeModel({ asset: '  asset:x ' }).asset).toBe('asset:x')
  })

  it('缩放夹进区间，0 与负数不许落到模型根上', () => {
    expect(normalizeModel({ scale: 0 }).scale).toBe(0.001)
    expect(normalizeModel({ scale: -5 }).scale).toBe(0.001)
    expect(normalizeModel({ scale: 1e9 }).scale).toBe(1000)
  })

  it('两个开关缺省关：地面网格与原始材质都是显式选项', () => {
    const model = normalizeModel({})
    expect(model.showGroundGrid).toBe(false)
    expect(model.originalMaterials).toBe(false)
  })
})

describe('内置动画', () => {
  it('缺省不播，空 clips 表示全播', () => {
    const animations = normalizeModel({}).animations
    expect(animations).toEqual({ enabled: false, clips: [], speed: 1 })
  })

  it('倒放是合法的，但速度有上下限', () => {
    const speedOf = (speed: unknown): number =>
      normalizeModel({ animations: { speed } }).animations.speed
    expect(speedOf(-1)).toBe(-1)
    expect(speedOf(-100)).toBe(-4)
    expect(speedOf(100)).toBe(4)
    expect(speedOf('快一点')).toBe(1)
  })

  it('clip 名去重去空白', () => {
    const clips = normalizeModel({
      animations: { clips: [' spin ', 'spin', '', 7] },
    }).animations.clips
    expect(clips).toEqual(['spin'])
  })
})

describe('场景特效', () => {
  it('三类都缺省关：不配特效就一个对象都不该建', () => {
    const effects = normalizeModel({}).sceneEffects
    expect(effects.starfield.enabled).toBe(false)
    expect(effects.pedestal.enabled).toBe(false)
    expect(effects.lightColumn.enabled).toBe(false)
  })

  it('底座开了之后那四样缺省全在，不给一个空圆盘', () => {
    const pedestal = normalizeModel({
      sceneEffects: { pedestal: { enabled: true } },
    }).sceneEffects.pedestal
    expect(pedestal.ring).toBe(true)
    expect(pedestal.grid).toBe(true)
    expect(pedestal.gradientGround).toBe(true)
    expect(pedestal.contactShadow).toBe(true)
  })

  it('底座的四样能逐个关掉', () => {
    const pedestal = normalizeModel({
      sceneEffects: { pedestal: { enabled: true, ring: false } },
    }).sceneEffects.pedestal
    expect(pedestal.ring).toBe(false)
    expect(pedestal.grid).toBe(true)
  })

  it('反射档与光柱模式不认识的取值回落到最省的那一档', () => {
    const effects = normalizeModel({
      sceneEffects: {
        pedestal: { reflection: 'raytrace' },
        lightColumn: { mode: 'laser', rise: 'pingpong' },
      },
    }).sceneEffects
    expect(effects.pedestal.reflection).toBe('none')
    expect(effects.lightColumn.mode).toBe('dome')
    expect(effects.lightColumn.rise).toBe('loop')
  })

  it('强度类倍率一律夹在 [0,2]', () => {
    const effects = normalizeModel({
      sceneEffects: {
        starfield: { density: 99, speed: -3 },
        lightColumn: { intensity: 99 },
      },
    }).sceneEffects
    expect(effects.starfield.density).toBe(2)
    expect(effects.starfield.speed).toBe(0)
    expect(effects.lightColumn.intensity).toBe(2)
  })

  it('颜色只认 hex 与 token，别的回落到主题强调色', () => {
    const effects = normalizeModel({
      sceneEffects: {
        pedestal: { color: 'rebeccapurple' },
        lightColumn: { color: '--accent-primary' },
      },
    }).sceneEffects
    expect(effects.pedestal.color).toBe('#00d5ff')
    expect(effects.lightColumn.color).toBe('--accent-primary')
  })
})

describe('视点', () => {
  it('非对象条目丢掉', () => {
    expect(normalizeCamera('nope', 0)).toBeNull()
  })

  it('缺 id 时按下标铸一个，同一份输入永远得到同一个', () => {
    expect(normalizeCamera({}, 2)?.id).toBe('camera-2')
  })

  // ⚠ fov 取到 0 或 180 时取景距离除零或塌缩，画面整个消失且不报错
  it('fov 夹进 three 认的开区间内', () => {
    expect(camera({ fov: 0 }).fov).toBe(MIN_CAMERA_FOV)
    expect(camera({ fov: 180 }).fov).toBe(MAX_CAMERA_FOV)
    expect(camera({ fov: 'wide' }).fov).toBe(DEFAULT_CAMERA_FOV)
  })

  it('机位与注视点都是世界坐标，逐位容错', () => {
    const built = camera({ position: [1, 'x', 3], target: null })
    expect(built.position).toEqual([1, 0, 3])
    expect(built.target).toEqual([0, 0, 0])
  })
})

describe('默认机位', () => {
  it('标了默认就用它', () => {
    const cameras = [camera({ id: 'a' }), camera({ id: 'b', isDefault: true })]
    expect(defaultCameraOf(cameras)?.id).toBe('b')
  })

  it('一个都没标时用文档序第一个', () => {
    const cameras = [camera({ id: 'a' }), camera({ id: 'b' })]
    expect(defaultCameraOf(cameras)?.id).toBe('a')
  })

  // 让「最后一个赢」会让人在列表里改顺序时莫名换镜头
  it('多个都标了只认第一个', () => {
    const cameras = [
      camera({ id: 'a', isDefault: true }),
      camera({ id: 'b', isDefault: true }),
    ]
    expect(defaultCameraOf(cameras)?.id).toBe('a')
  })

  it('一个视点都没有时给 null，不编一个出来', () => {
    expect(defaultCameraOf([])).toBeNull()
  })
})

describe('视点切换控件', () => {
  it('缺省不显示，形态是按钮组', () => {
    expect(normalizeViewpoints(undefined)).toEqual({
      enabled: false,
      mode: 'buttons',
      keyboard: false,
      items: [],
    })
  })

  it('不认识的形态回落到按钮组', () => {
    expect(normalizeViewpoints({ mode: 'carousel' }).mode).toBe('buttons')
  })

  it('顺序表去重去空白；空表示按文档序全显示', () => {
    expect(normalizeViewpoints({ items: [' a ', 'a', ''] }).items).toEqual([
      'a',
    ])
  })
})
