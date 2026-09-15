/** @fileoverview 单动画点位控制、暂停续播与绑定重排契约。 */
import {
  normalizeTwinConfig,
  remapTwinBindings,
  twinSceneValues,
} from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ModelAnimations } from '../src/modelAnimations'

function config(controls: unknown[]) {
  return normalizeTwinConfig({ model: { animations: { controls } } })
}
function control(clip: string) {
  return { clip, mode: 'point', operator: 'eq', threshold: 1, stop: 'pause' }
}

describe('独立动画', () => {
  it('两个点位独立控制，重复值不重播，暂停后从原位置继续', () => {
    const root = new THREE.Object3D()
    const clips = ['a', 'b'].map(
      (name, index) =>
        new THREE.AnimationClip(name, 2, [
          new THREE.NumberKeyframeTrack(
            index === 0 ? '.position[x]' : '.position[y]',
            [0, 2],
            [0, 2],
          ),
        ]),
    )
    const layer = new ModelAnimations(root, clips)
    const animations = config([control('a'), control('b')]).model.animations
    layer.apply(animations, { a: 1, b: 0 })
    layer.update(0.3)
    expect(root.position.x).toBeCloseTo(0.3)
    expect(root.position.y).toBe(0)
    layer.apply(animations, { a: 1, b: 1 })
    layer.update(0.2)
    expect(root.position.x).toBeCloseTo(0.5)
    expect(root.position.y).toBeCloseTo(0.2)
    layer.apply(animations, { a: 0, b: 1 })
    layer.update(0.2)
    expect(root.position.x).toBeCloseTo(0.5)
    layer.apply(animations, { a: 1, b: 0 })
    layer.update(0.1)
    expect(root.position.x).toBeCloseTo(0.6)
    layer.dispose()
  })
  it('空值和无效值不误当作停止状态0或启动状态1', () => {
    const layer = new ModelAnimations(new THREE.Object3D(), [
      new THREE.AnimationClip('a', 1, []),
    ])
    const animations = config([{ ...control('a'), threshold: 0 }]).model
      .animations
    layer.apply(animations, { a: null })
    expect(layer.playingNames).toEqual([])
    layer.apply(animations, { a: false })
    expect(layer.playingNames).toEqual(['a'])
    layer.apply(animations, { a: 'bad' })
    expect(layer.playingNames).toEqual([])
    layer.dispose()
  })
  it('绑定按动画身份重排，并与运行态缝合一致', () => {
    const before = config([control('a'), control('b')])
    const after = config([control('b'), control('a')])
    expect(
      remapTwinBindings(before, after, [
        { fieldKey: 'animationValues[0].value' },
      ]),
    ).toEqual([{ fieldKey: 'animationValues[1].value' }])
    expect(
      twinSceneValues(after, { animationValues: [{ value: 0 }, { value: 1 }] })
        .animations,
    ).toEqual({ b: 0, a: 1 })
    expect(
      normalizeTwinConfig(JSON.parse(JSON.stringify(before))).model.animations,
    ).toEqual(before.model.animations)
  })
})

it('单次播放到末尾后持续运行值不重播，复位后重新启动', () => {
  const root = new THREE.Object3D()
  const clip = new THREE.AnimationClip('a', 1, [
    new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
  ])
  const layer = new ModelAnimations(root, [clip])
  const animations = config([{ ...control('a'), loop: 'once', stop: 'reset' }])
    .model.animations
  layer.apply(animations, { a: 1 })
  layer.update(1.2)
  expect(root.position.x).toBeCloseTo(1)
  layer.apply(animations, { a: 1 })
  layer.update(0.3)
  expect(root.position.x).toBeCloseTo(1)
  layer.apply(animations, { a: 0 })
  layer.update(0)
  expect(root.position.x).toBe(0)
  layer.apply(animations, { a: 1 })
  layer.update(0.3)
  expect(root.position.x).toBeCloseTo(0.3)
  layer.dispose()
})
