/**
 * @fileoverview 守染色层的契约：按规则改材质颜色而不是换材质、这一轮没命中的部件
 * 恢复原色、token 取不出时不染色（不回落成默认色）、dispose 把颜色全还回去。
 */
import type { TwinConfig } from '@dt/twin-config'
import { normalizeTwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'

import { buildNodeIndex, type NodeIndex } from '../src/nodeIndex'
import { TintLayer } from '../src/tintLayer'

/** 原色是纯红，便于一眼看出有没有被改回去 */
const ORIGINAL_HEX = '#ff0000'

let hosts: HTMLElement[] = []

function host(): HTMLElement {
  const element = document.createElement('div')
  element.style.setProperty('--accent-primary', '#00cefc')
  document.body.append(element)
  hosts.push(element)
  return element
}

afterEach(() => {
  for (const element of hosts) element.remove()
  hosts = []
})

function model(): { index: NodeIndex; pump: THREE.Mesh; valve: THREE.Mesh } {
  const root = new THREE.Group()
  const pump = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: ORIGINAL_HEX }),
  )
  pump.name = 'pump'
  const valve = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: ORIGINAL_HEX }),
  )
  valve.name = 'valve'
  root.add(pump, valve)
  return { index: buildNodeIndex(root), pump, valve }
}

function config(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    parts: [
      { id: 'part-pump', name: '泵', nodes: ['pump'] },
      { id: 'part-valve', name: '阀', nodes: ['valve'] },
    ],
    tints: [
      {
        id: 'rule-1',
        name: '运行状态',
        partIds: ['part-pump'],
        mode: 'status',
        statusColors: { running: '#00ff00', alarm: '--accent-primary' },
      },
    ],
    ...overrides,
  })
}

function hexOf(mesh: THREE.Mesh): string {
  return (mesh.material as THREE.MeshStandardMaterial).color.getHexString()
}

describe('状态染色', () => {
  it('命中的部件按状态取色', () => {
    const { index, pump } = model()

    new TintLayer(index, host()).apply(config(), {
      'rule-1': { value: null, status: 'running' },
    })

    expect(hexOf(pump)).toBe('00ff00')
  })

  it('规则里的 token 从宿主级联里取值', () => {
    const { index, pump } = model()

    new TintLayer(index, host()).apply(config(), {
      'rule-1': { value: null, status: 'alarm' },
    })

    expect(hexOf(pump)).toBe('00cefc')
  })

  it('token 取不出时不染色，原色留着', () => {
    const { index, pump } = model()

    new TintLayer(index, null).apply(config(), {
      'rule-1': { value: null, status: 'alarm' },
    })

    expect(hexOf(pump)).toBe('ff0000')
  })

  it('没配到的状态不染色', () => {
    const { index, pump } = model()

    new TintLayer(index, host()).apply(config(), {
      'rule-1': { value: null, status: 'idle' },
    })

    expect(hexOf(pump)).toBe('ff0000')
  })

  it('规则没点到的部件不受影响', () => {
    const { index, valve } = model()

    new TintLayer(index, host()).apply(config(), {
      'rule-1': { value: null, status: 'running' },
    })

    expect(hexOf(valve)).toBe('ff0000')
  })

  it('渐变模式按数值在两端之间插值', () => {
    const { index, pump } = model()
    const layer = new TintLayer(index, host())

    layer.apply(
      config({
        tints: [
          {
            id: 'rule-1',
            name: '温度',
            partIds: ['part-pump'],
            mode: 'gradient',
            gradient: { lo: '#000000', hi: '#ffffff', min: 0, max: 100 },
          },
        ],
      }),
      { 'rule-1': { value: 50, status: null } },
    )

    expect(hexOf(pump)).toBe('808080')
  })
})

describe('恢复原色', () => {
  it('下一轮不再命中的部件回到原色', () => {
    const { index, pump } = model()
    const layer = new TintLayer(index, host())

    layer.apply(config(), { 'rule-1': { value: null, status: 'running' } })
    layer.apply(config(), { 'rule-1': { value: null, status: 'idle' } })

    expect(hexOf(pump)).toBe('ff0000')
  })

  it('连续两轮都命中时保留最新的颜色', () => {
    const { index, pump } = model()
    const layer = new TintLayer(index, host())

    layer.apply(config(), { 'rule-1': { value: null, status: 'running' } })
    layer.apply(config(), { 'rule-1': { value: null, status: 'alarm' } })

    expect(hexOf(pump)).toBe('00cefc')
  })

  it('dispose 把染过的部件全部还回原色', () => {
    const { index, pump } = model()
    const layer = new TintLayer(index, host())
    layer.apply(config(), { 'rule-1': { value: null, status: 'running' } })

    layer.dispose()

    expect(hexOf(pump)).toBe('ff0000')
  })

  it('材质没有颜色通道时跳过，不抛错', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshDepthMaterial(),
    )
    mesh.name = 'pump'
    root.add(mesh)
    const layer = new TintLayer(buildNodeIndex(root), host())

    expect(() => {
      layer.apply(config(), { 'rule-1': { value: null, status: 'running' } })
    }).not.toThrow()
  })

  it('一个网格挂材质数组时每一份都被染到', () => {
    const root = new THREE.Group()
    const first = new THREE.MeshStandardMaterial({ color: ORIGINAL_HEX })
    const second = new THREE.MeshStandardMaterial({ color: ORIGINAL_HEX })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [first, second])
    mesh.name = 'pump'
    root.add(mesh)

    new TintLayer(buildNodeIndex(root), host()).apply(config(), {
      'rule-1': { value: null, status: 'running' },
    })

    expect(first.color.getHexString()).toBe('00ff00')
    expect(second.color.getHexString()).toBe('00ff00')
  })
})
