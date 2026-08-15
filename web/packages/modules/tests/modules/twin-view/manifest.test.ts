/**
 * @fileoverview 守孪生清单的声明：3D 画布不套卡片框、绑定槽直接摊开公共常量、
 * 标题那几档的取值范围与组件的白名单是同一份，以及配置面按标题/模型分组。
 * ⚠ 分组名等于模块名时属性面板等于没分组——一个折叠段装下全部字段。
 */
import { TWIN_CONFIG_KEY, TWIN_VIEW_BINDINGS } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/twin-view/manifest'

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

function groupOf(key: string): string | undefined {
  return field(key)?.group
}

describe('孪生清单的声明', () => {
  it('3D 画布自己就是整块内容，不套卡片框', () => {
    expect(manifest.type).toBe('twin-view')
    expect(manifest.category).toBe('孪生')
    expect(manifest.chrome).toBe('bare')
  })

  it('绑定槽直接摊开公共常量，不在清单里抄一份键名', () => {
    expect(manifest.bindings).toEqual([...TWIN_VIEW_BINDINGS])
  })

  it('刻意不给预览：编造一份只会在画布上留一块空白', () => {
    expect(manifest.preview).toBeUndefined()
  })
})

describe('孪生清单的分组', () => {
  it('配置面按标题、模型两组分开，没有一组叫模块名', () => {
    const groups = [...new Set(manifest.configSchema.map((item) => item.group))]

    expect(groups).toEqual(['标题', '模型'])
    expect(groups).not.toContain(manifest.displayName)
  })

  it('每个字段都落在自己那一组里', () => {
    expect(groupOf('title')).toBe('标题')
    expect(groupOf('titlePosition')).toBe('标题')
    expect(groupOf('titleFontSize')).toBe('标题')
    expect(groupOf(TWIN_CONFIG_KEY)).toBe('模型')
  })
})

describe('孪生清单的取值范围', () => {
  it('标题位置是四个角，缺省与写死那版逐字相同', () => {
    expect(optionValues('titlePosition')).toEqual(CORNERS)
    expect(field('titlePosition')?.default).toBe('top-left')
  })

  it('标题字号的范围就是组件的夹取区间', () => {
    expect(field('titleFontSize')).toMatchObject({
      default: 16,
      min: 8,
      max: 72,
    })
  })

  // ⚠ default 会 materialize 进每一次渲染：标题缺省即「不叠标题」，
  //   给上 default 等于改存量大屏的渲染
  it('标题刻意不给缺省', () => {
    expect(field('title')?.default).toBeUndefined()
  })
})

describe('孪生清单的渲染组件', () => {
  // ⚠ 直接 await 而不是 vi.waitFor：孪生的组件图最重，1s 的轮询窗口在整包并行
  //   跑时会偶发超时，那是机器忙不是契约破了
  it('渲染组件是异步装载的，清单本身不把 three 拽进首屏包体', async () => {
    const loaded = await manifest.component()

    expect(loaded.default).toBeDefined()
  })
})
