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

describe('页脚清单的设计态预览', () => {
  it('预览不提任何与缺省不一致的键——刚拖进画布与保存后必须长得一样', () => {
    const defaults = configDefaults(manifest.configSchema)
    const drift = Object.entries(manifest.preview?.config ?? {}).filter(
      ([key, value]) => defaults[key] !== value,
    )

    expect(drift).toEqual([])
  })

  it('预览铺过一遍之后内容区内缩不变，子节点不会被顶下去', () => {
    const dragged = {
      ...configDefaults(manifest.configSchema),
      ...(manifest.preview?.config ?? {}),
    }

    expect(resolveContentInset(dragged).top).toBe(8)
  })
})

describe('页脚可配观感的声明', () => {
  it('分隔线与扫光缺省开着，兜底就是页脚现值', () => {
    expect(field('showDivider')?.default).toBe(true)
    expect(field('dividerWidth')).toMatchObject({
      default: 1,
      min: 0,
      max: 8,
      step: 1,
    })
    expect(field('showSweep')?.default).toBe(true)
    expect(field('sweepOpacity')).toMatchObject({
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    })
  })

  it('标题缺省居中，三档都摆进了面板', () => {
    expect(field('titleAlign')?.default).toBe('center')
    expect(field('titleAlign')?.options?.map((item) => item.value)).toEqual([
      'left',
      'center',
      'right',
    ])
  })

  it('点阵缺省是关的——页脚一直没有底纹，存量不能凭空多一层', () => {
    expect(field('showDotGrid')?.default).toBe(false)
  })

  it('背景图缺省留空，不注入就不影响纯色背景', () => {
    expect(field('backgroundImage')?.default).toBe('')
  })
})

describe('页脚壳不消费的 chrome 键', () => {
  // ⚠ 标题条自绘且开关走自己的「显示标题条」配置：chrome 的标题键在壳里没有
  //   消费点，声明漏一个 = 面板上多一个「配了没反应」的控件
  it('逐键声明：整套标题条 + showTitle，字体与字色照常消费', () => {
    expect(manifest.unsupportedChromeKeys).toEqual([
      'showTitle',
      'titleAlign',
      'titlePadding',
      'titleGap',
      'titleFontWeight',
      'titleBarWidth',
      'titleBarFull',
      'titleBarRadius',
      'titleBarGlow',
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

describe('页脚清单的渲染组件', () => {
  it('渲染组件是异步装载的，清单本身不把它拽进首屏包体', async () => {
    const loaded = await vi.waitFor(() => manifest.component())

    expect(loaded.default).toBeDefined()
  })
})
