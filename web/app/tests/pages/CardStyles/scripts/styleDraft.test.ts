/**
 * @fileoverview 守草稿层的两条要害：观感字段**滤掉**内容字段（存不进样式的输入框
 * 摆出来就是骗人），以及存样式那一刻观感键必须补全（套用是浅合并，少一个键
 * 就会让上一套的取值原样残留，而两侧都不报错）。
 */
import type { CardStyle, ModuleManifest } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  draftOf,
  fillStyleKeys,
  newDraft,
  sameDraft,
  styleFields,
} from '@/pages/CardStyles/scripts/styleDraft'

const MANIFEST = {
  type: 'demo-card',
  displayName: '演示卡',
  category: '数据',
  defaultSize: { width: 400, height: 200 },
  contentKeys: ['title', 'items', 'rules'],
  configSchema: [
    { key: 'title', label: '标题', type: 'string', default: '' },
    { key: 'items', label: '格', type: 'array', default: [] },
    { key: 'rules', label: '取值规则', type: 'array', default: [] },
    { key: 'align', label: '对齐', type: 'enum', default: 'center' },
    { key: 'gapX', label: '列间距', type: 'range', default: 10 },
  ],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
} as unknown as ModuleManifest

describe('观感字段', () => {
  it('内容字段一个都不摆——存不进样式的输入框摆出来就是在骗人', () => {
    expect(styleFields(MANIFEST).map((field) => field.key)).toEqual([
      'align',
      'gapX',
    ])
  })

  it('顺序照清单的书写序，不重排', () => {
    const keys = styleFields(MANIFEST).map((field) => field.key)

    expect(keys).toEqual(['align', 'gapX'])
  })

  it('没有清单就没有内芯段', () => {
    expect(styleFields(null)).toEqual([])
  })
})

describe('观感键补全', () => {
  // ⚠ 这一条是整套样式最要紧的不变量：缺一个键，套用之后屏上留着上一套的那个值
  it('用户只改过一个键，存下去的仍是整套观感', () => {
    expect(fillStyleKeys(MANIFEST, { align: 'left' })).toEqual({
      align: 'left',
      gapX: 10,
    })
  })

  it('内容键即便混进来了也不落进样式', () => {
    const filled = fillStyleKeys(MANIFEST, { title: '偷渡', rules: [{}] })

    expect(filled).toEqual({ align: 'center', gapX: 10 })
  })

  it('没有清单时给空对象，不硬凑', () => {
    expect(fillStyleKeys(null, { align: 'left' })).toEqual({})
  })
})

describe('草稿', () => {
  it('新建通用外壳样式时不摆内芯', () => {
    const draft = newDraft(null, MANIFEST)

    expect(draft.moduleType).toBeNull()
    expect(draft.config).toEqual({})
    expect(draft.id).toBeNull()
  })

  it('新建绑模块的样式时内芯直接铺满缺省', () => {
    expect(newDraft('demo-card', MANIFEST).config).toEqual({
      align: 'center',
      gapX: 10,
    })
  })

  // ⚠ 直接引用的话，右栏改一个旋钮会顺手改掉列表里那条的取值
  it('从库里的一条转草稿时两袋都拷一份', () => {
    const style = {
      id: 'a',
      name: '蓝调',
      description: null,
      moduleType: 'demo-card',
      chrome: { radius: 4 },
      config: { align: 'left' },
      thumbnail: null,
      createdAt: '',
      updatedAt: '',
    } satisfies CardStyle
    const draft = draftOf(style)
    draft.chrome.radius = 12

    expect(style.chrome.radius).toBe(4)
    expect(draft.description).toBe('')
  })
})

describe('草稿等值', () => {
  it('原样比是相等的', () => {
    const draft = newDraft('demo-card', MANIFEST)

    expect(sameDraft(draft, { ...draft })).toBe(true)
  })

  it('改了外壳里的一个键就不相等', () => {
    const draft = newDraft('demo-card', MANIFEST)

    expect(sameDraft(draft, { ...draft, chrome: { radius: 4 } })).toBe(false)
  })

  // ⚠ 比 JSON 串会把键序不同的同一份判成改过的，保存按钮于是永远亮着
  it('键序不同但取值相同仍算相等', () => {
    const left = { ...newDraft(null, null), chrome: { radius: 4, bg: '#000' } }
    const right = { ...left, chrome: { bg: '#000', radius: 4 } }

    expect(sameDraft(left, right)).toBe(true)
  })
})
