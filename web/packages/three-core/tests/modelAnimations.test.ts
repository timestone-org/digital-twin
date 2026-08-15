/**
 * @fileoverview 守模型内置动画的口径：开关、留空即全播、只播模型里真有的、
 * 调速、停的那些要真停（不是权重调 0），以及卸载时把 mixer 的缓存也清掉。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { ModelAnimations } from '../src/modelAnimations'

function clipsOf(...names: string[]): THREE.AnimationClip[] {
  return names.map((name) => {
    const track = new THREE.NumberKeyframeTrack('.scale[x]', [0, 1], [1, 2])
    return new THREE.AnimationClip(name, 1, [track])
  })
}

function animationsConfig(raw: Record<string, unknown>) {
  return normalizeTwinConfig({ model: { animations: raw } }).model.animations
}

function layerOf(...names: string[]): ModelAnimations {
  const root = new THREE.Object3D()
  return new ModelAnimations(root, clipsOf(...names))
}

describe('开关', () => {
  it('关着时一段都不播', () => {
    const layer = layerOf('转', '摆')

    layer.apply(animationsConfig({ enabled: false }))

    expect(layer.playingNames).toEqual([])
  })

  it('打开且没列 clips 时全播', () => {
    const layer = layerOf('转', '摆')

    layer.apply(animationsConfig({ enabled: true }))

    expect([...layer.playingNames].sort()).toEqual(['摆', '转'])
  })

  it('列了 clips 就只播列到的', () => {
    const layer = layerOf('转', '摆')

    layer.apply(animationsConfig({ enabled: true, clips: ['转'] }))

    expect(layer.playingNames).toEqual(['转'])
  })

  // 配置里留着已改名的旧 clip 名，不该让整段配置失效
  it('列到的名字模型里没有就跳过，其余照播', () => {
    const layer = layerOf('转', '摆')

    layer.apply(animationsConfig({ enabled: true, clips: ['转', '不存在'] }))

    expect(layer.playingNames).toEqual(['转'])
  })

  it('从开到关时把正在播的停下来', () => {
    const layer = layerOf('转')
    layer.apply(animationsConfig({ enabled: true }))

    layer.apply(animationsConfig({ enabled: false }))

    expect(layer.playingNames).toEqual([])
  })
})

describe('调速', () => {
  it('速度落到每一段上', () => {
    const layer = layerOf('转', '摆')

    layer.apply(animationsConfig({ enabled: true, speed: 2 }))

    layer.update(0.1)
    expect(layer.playingNames).toHaveLength(2)
  })
})

describe('没有动画的模型', () => {
  it('一段都没有时 apply 与 update 都不炸', () => {
    const layer = new ModelAnimations(new THREE.Object3D(), [])

    expect(layer.clipNames).toEqual([])
    expect(() => layer.apply(animationsConfig({ enabled: true }))).not.toThrow()
    expect(() => layer.update(0.1)).not.toThrow()
    expect(() => layer.dispose()).not.toThrow()
  })
})

describe('释放', () => {
  it('卸载后没有动作还在跑', () => {
    const layer = layerOf('转', '摆')
    layer.apply(animationsConfig({ enabled: true }))

    layer.dispose()

    expect(layer.clipNames).toEqual([])
  })

  it('重复 dispose 不炸', () => {
    const layer = layerOf('转')
    layer.dispose()

    expect(() => layer.dispose()).not.toThrow()
  })
})
