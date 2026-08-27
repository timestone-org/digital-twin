/**
 * @fileoverview 守页脚清单的声明：钉在页脚区域、是容器、不取数、壳里没有标题条，
 * 以及每个观感旋钮只描述一件事——同一条边配两个旋钮时两边一定会漂。
 */
import { describe, expect, it, vi } from 'vitest'

import manifest from '../../../src/modules/footer/manifest'
import { configDefaults } from '../../../src/shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  hasTitleBar,
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
  // 标题是拖进来的文字块子节点；壳里再给一份就有两个答案，也会与它抢位置
  it('没有标题条这一档，内容区因此只内缩一个内边距', () => {
    const defaults = configDefaults(manifest.configSchema)

    expect(defaults[SHOW_TITLE_CONFIG_KEY]).toBeUndefined()
    expect(hasTitleBar(manifest)).toBe(false)
    expect(resolveContentInset(defaults, manifest).top).toBe(8)
  })

  it('内部布局的缺省是整块写死的，不从子字段拼', () => {
    expect(field(CONTAINER_CONFIG_KEY)?.default).toEqual({ pad: 8 })
  })

  it('内边距的可配范围与容器几何一致', () => {
    const pad = field(CONTAINER_CONFIG_KEY)?.fields?.[0]

    expect(pad).toMatchObject({ key: 'pad', min: 0, max: 64, default: 8 })
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

    expect(resolveContentInset(dragged, manifest).top).toBe(8)
  })
})

describe('页脚可配观感的声明', () => {
  // ⚠ 显隐开关 + 取值旋钮描述同一条边时两边必然会漂：取值的 0 就是「没有」
  it('分隔线与扫光各只有一个旋钮，没有另一半的显隐开关', () => {
    expect(field('showDivider')).toBeUndefined()
    expect(field('showSweep')).toBeUndefined()
    expect(field('dividerWidth')).toMatchObject({
      default: 1,
      min: 0,
      max: 8,
      step: 1,
    })
    expect(field('sweepOpacity')).toMatchObject({
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    })
  })

  it('点阵缺省是关的——页脚一直没有底纹，存量不能凭空多一层', () => {
    expect(field('showDotGrid')?.default).toBe(false)
  })

  it('背景底图走素材库那一档，缺省留空', () => {
    expect(field('backgroundImage')).toMatchObject({
      type: 'image',
      default: '',
    })
  })
})

describe('页脚壳不消费的 chrome 键', () => {
  // ⚠ 壳里没有标题条：整套标题键都没有消费点，漏登记一个 = 面板上多一个
  //   「配了没反应」的控件
  it('逐键声明：整套标题键，字体与正文排版照常消费', () => {
    expect(manifest.unsupportedChromeKeys).toEqual([
      'showTitle',
      'titleColor',
      'titleAlign',
      'titlePadding',
      'titleGap',
      'titleFontSize',
      'titleFontWeight',
      'titleLetterSpacing',
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
