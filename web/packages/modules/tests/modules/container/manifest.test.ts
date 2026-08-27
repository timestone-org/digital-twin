/**
 * @fileoverview 守容器清单的声明：是容器、不钉区域、不取数，且缺省标题条与
 * `resolveContentInset` 留出的内缩同源——两边不一致时子节点会整体错位 28px。
 */
import { describe, expect, it, vi } from 'vitest'

import manifest from '../../../src/modules/container/manifest'
import { configDefaults } from '../../../src/shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  TITLE_BAR_HEIGHT_PX,
  resolveContentInset,
} from '../../../src/shared/container'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

describe('容器清单的声明', () => {
  it('是容器，不套卡片框，也不钉在任何区域', () => {
    expect(manifest.type).toBe('container')
    expect(manifest.isContainer).toBe(true)
    expect(manifest.chrome).toBe('bare')
    expect(manifest.region).toBeUndefined()
  })

  it('初始尺寸给了缩放下限', () => {
    expect(manifest.defaultSize).toEqual({
      width: 640,
      height: 432,
      minWidth: 120,
      minHeight: 80,
    })
  })

  it('自己不取数——读数与图表都是各自绑点的子节点', () => {
    expect(manifest.bindings).toEqual([])
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('容器清单与容器几何的对齐', () => {
  it('缺省开着标题条，内容区因此比矩形多缩一个标题条高', () => {
    const defaults = configDefaults(manifest.configSchema)

    expect(defaults[SHOW_TITLE_CONFIG_KEY]).toBe(true)
    expect(resolveContentInset(defaults, manifest).top).toBe(
      8 + TITLE_BAR_HEIGHT_PX,
    )
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

describe('容器可配观感的声明', () => {
  it('圆角缺省与容器现值同值', () => {
    expect(field('radius')).toMatchObject({
      default: 4,
      min: 0,
      max: 32,
      step: 1,
    })
  })

  it('描边缺省是关的——容器一直没有边框，存量不能凭空多一圈线', () => {
    expect(field('showBorder')?.default).toBe(false)
    expect(field('borderWidth')).toMatchObject({
      default: 1,
      min: 0,
      max: 8,
      step: 1,
    })
    expect(field('borderWidth')?.when).toEqual({
      key: 'showBorder',
      in: [true],
    })
  })

  it('点阵三项的缺省与现值逐字相同，且都只在点阵开着时露出来', () => {
    expect(field('dotSize')).toMatchObject({ default: 1, min: 1, max: 6 })
    expect(field('dotGap')).toMatchObject({ default: 16, min: 4, max: 64 })
    expect(field('dotOpacity')).toMatchObject({
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
    })
    for (const key of ['dotSize', 'dotGap', 'dotOpacity']) {
      expect(field(key)?.when).toEqual({ key: 'showDotGrid', in: [true] })
    }
  })
})

describe('容器清单的渲染组件', () => {
  it('渲染组件是异步装载的，清单本身不把它拽进首屏包体', async () => {
    const loaded = await vi.waitFor(() => manifest.component())

    expect(loaded.default).toBeDefined()
  })
})

describe('容器壳不消费的 chrome 键', () => {
  // ⚠ 标题条自绘且开关走自己的「显示标题条」配置；字号 / 字距 / 竖条几何那几档
  //   容器壳照常消费，不许一并声明掉
  it('逐键声明：开关与标题条排布类，字号与竖条几何类照常消费', () => {
    expect(manifest.unsupportedChromeKeys).toEqual([
      'showTitle',
      'titleAlign',
      'titlePadding',
      'titleGap',
      'titleBarRadius',
      'titleBarColor',
      'titleBarColorAlt',
      'titlePulse',
      'titlePulseDuration',
      'titleRule',
      'titleRuleHeight',
      'titleRuleOpacity',
    ])
  })
})
