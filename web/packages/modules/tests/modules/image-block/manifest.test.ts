/**
 * @fileoverview 守图片块清单的声明：纯装饰不取数、整块可点由宿主接管，图片来源那一档
 * 走 `image` 控件（走成 string 就没有预览了），枚举与组件的白名单是同一份。
 */
import { describe, expect, it, vi } from 'vitest'

import manifest from '../../../src/modules/image-block/manifest'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

describe('图片块清单的声明', () => {
  it('是装饰模块：不套卡片框、不是容器、不钉区域', () => {
    expect(manifest.type).toBe('image-block')
    expect(manifest.category).toBe('装饰')
    expect(manifest.chrome).toBe('bare')
    expect(manifest.isContainer).toBeUndefined()
    expect(manifest.region).toBeUndefined()
  })

  it('整块可点交给宿主，模块自己不上抛联动事件', () => {
    expect(manifest.hostClickable).toBe(true)
    expect(manifest.emitsInteractions).toBeUndefined()
  })

  it('自己不取数——按读数换图请用状态类模块', () => {
    expect(manifest.bindings).toEqual([])
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('图片块清单的取值范围', () => {
  it('图片来源走 image 控件，属性面板才给得出预览', () => {
    expect(field('src')).toMatchObject({ type: 'image', default: '' })
  })

  it('填充方式与裁剪定位与组件的白名单逐一对上', () => {
    expect(optionValues('fit')).toEqual(['contain', 'cover', 'fill'])
    expect(optionValues('position')).toEqual([
      'center',
      'top',
      'bottom',
      'left',
      'right',
    ])
  })

  it('百分比档的缺省就是「不加这一档滤镜」', () => {
    expect(field('brightness')).toMatchObject({ default: 100, max: 300 })
    expect(field('contrast')).toMatchObject({ default: 100, max: 300 })
    expect(field('saturate')).toMatchObject({ default: 100, max: 300 })
    expect(field('grayscale')).toMatchObject({ default: 0, max: 100 })
    expect(field('blur')).toMatchObject({ default: 0, max: 50 })
  })

  it('旋转覆盖整圈的两个方向', () => {
    expect(field('rotate')).toMatchObject({ default: 0, min: -180, max: 180 })
  })
})

describe('图片块清单的渲染组件', () => {
  it('渲染组件是异步装载的，清单本身不把它拽进首屏包体', async () => {
    const loaded = await vi.waitFor(() => manifest.component())

    expect(loaded.default).toBeDefined()
  })
})
