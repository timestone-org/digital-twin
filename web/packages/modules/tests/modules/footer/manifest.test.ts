/**
 * @fileoverview 守页脚清单的声明：钉在页脚区域、是容器、不取数，以及缺省的标题条
 * 开关与 `resolveContentInset` 留出的内缩同源——两边不一致时子节点会整体错位。
 */
import { describe, expect, it, vi } from 'vitest'

import manifest from '../../../src/modules/footer/manifest'
import { configDefaults } from '../../../src/shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  resolveContentInset,
} from '../../../src/shared/container'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

describe('页脚清单的声明', () => {
  it('钉在页脚区域，是容器，且不套卡片框', () => {
    expect(manifest.type).toBe('footer')
    expect(manifest.region).toBe('footer')
    expect(manifest.isContainer).toBe(true)
    expect(manifest.chrome).toBe('bare')
  })

  it('初始尺寸是整宽的一条，且给了缩放下限', () => {
    expect(manifest.defaultSize).toEqual({
      width: 1920,
      height: 72,
      minWidth: 240,
      minHeight: 40,
    })
  })

  it('自己不取数——版权与状态灯都是各自绑点的子节点', () => {
    expect(manifest.bindings).toEqual([])
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('页脚清单与容器几何的对齐', () => {
  it('缺省不开标题条，内容区因此只内缩一个内边距', () => {
    const defaults = configDefaults(manifest.configSchema)

    expect(defaults[SHOW_TITLE_CONFIG_KEY]).toBe(false)
    expect(resolveContentInset(defaults).top).toBe(8)
  })

  it('内部布局的缺省是整块写死的，不从子字段拼', () => {
    expect(field(CONTAINER_CONFIG_KEY)?.default).toEqual({ pad: 8 })
  })

  it('内边距的可配范围与容器几何一致', () => {
    const pad = field(CONTAINER_CONFIG_KEY)?.fields?.[0]

    expect(pad).toMatchObject({ key: 'pad', min: 0, max: 64, default: 8 })
  })

  it('标题文本只在标题条开着时才出现在属性面板里', () => {
    expect(field('title')?.when).toEqual({
      key: SHOW_TITLE_CONFIG_KEY,
      in: [true],
    })
  })
})

describe('页脚清单的渲染组件', () => {
  it('渲染组件是异步装载的，清单本身不把它拽进首屏包体', async () => {
    const loaded = await vi.waitFor(() => manifest.component())

    expect(loaded.default).toBeDefined()
  })
})
