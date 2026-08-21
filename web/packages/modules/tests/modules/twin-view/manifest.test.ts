/**
 * @fileoverview 守孪生清单的声明：3D 画布不套卡片框、绑定槽直接摊开公共常量、
 * 标题那几档的取值范围与组件的白名单是同一份，以及配置面按标题/运行态/模型分组。
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
  it('配置面按标题、运行态、模型三组分开，没有一组叫模块名', () => {
    const groups = [...new Set(manifest.configSchema.map((item) => item.group))]

    expect(groups).toEqual(['标题', '运行态', '模型'])
    expect(groups).not.toContain(manifest.displayName)
  })

  // ⚠ 给了 default 会 materialize 进每一次渲染，等于把存量大屏统统打开工具条
  it('工具条开关刻意不给 default，缺省即不显示', () => {
    expect(field('showSceneTools')?.default).toBeUndefined()
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

describe('绑点面板的行名', () => {
  it('按配置里的实体名给出每一行的名字，而不是让人数行号', () => {
    const labels = manifest.bindingRowLabels?.({
      twin: {
        anchors: [
          { id: 'a1', name: '一号机组', position: [0, 0, 0] },
          { id: 'a2', name: '二号机组', position: [1, 0, 0] },
        ],
      },
    })

    expect(labels?.['anchorValues[0].value']?.title).toContain('一号机组')
    expect(labels?.['anchorValues[1].value']?.title).toContain('二号机组')
    // id 与实体自己的 id 一致，绑的时候靠它核对对应关系
    expect(labels?.['anchorValues[0].value']?.id).toBe('a1')
  })

  it('配置为空时给一张空表，绑点面板自己退回「第 N 行」', () => {
    expect(manifest.bindingRowLabels?.({})).toEqual({})
  })
})

/**
 * ⚠ 孪生的行**不是**用户随手加的：行号就是实体的文档序。不声明行数的话，
 * 绑点面板会摆出「新增一行」，而加出来的那一行永远喂不到任何东西。
 */
describe('绑点面板的行数', () => {
  it('按实体数给，信息牌按摊平后的字段数', () => {
    const counts = manifest.bindingRowCounts?.({
      twin: {
        anchors: [{ id: 'a1' }, { id: 'a2' }],
        panels: [{ id: 'p1', fields: [{ key: 'a' }, { key: 'b' }] }],
      },
    })

    expect(counts?.anchorValues).toBe(2)
    expect(counts?.panelValues).toBe(2)
  })

  it('配置为空时五个槽全是 0，而不是漏掉键', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({
      anchorValues: 0,
      panelValues: 0,
      arrowValues: 0,
      flowValues: 0,
      hierValues: 0,
    })
  })
})

describe('孪生壳不消费的 chrome 键', () => {
  // ⚠ 3D 画布没有标题条与正文排版的消费点：整套标题键 + 字体字色都要声明掉，
  //   漏一个 = 面板上多一个「配了没反应」的控件
  it('逐键声明：整套标题键与正文字体字色', () => {
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
      'fontFamily',
      'textColor',
    ])
  })
})
