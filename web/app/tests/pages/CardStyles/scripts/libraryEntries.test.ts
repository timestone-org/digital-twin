/**
 * @fileoverview 守左栏名单的三件事：内置风格里的「删键」不许当成取值搬进草稿、
 * 模块预设里那一段 `__cardStyle` 必须拆回外壳、内置条目转草稿时是**新建**而不是改。
 */
import type { CardStyle, ModuleManifest } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  builtinChromeEntries,
  builtinPresetEntries,
  entryToDraft,
  savedEntry,
} from '@/pages/CardStyles/scripts/libraryEntries'

const MANIFEST = {
  type: 'demo-card',
  displayName: '演示卡',
  category: '数据',
  defaultSize: { width: 400, height: 200 },
  contentKeys: ['title'],
  configSchema: [
    { key: 'title', label: '标题', type: 'string', default: '' },
    { key: 'align', label: '对齐', type: 'enum', default: 'center' },
    { key: 'gapX', label: '列间距', type: 'range', default: 10 },
  ],
  configPresets: [
    {
      id: 'plain',
      label: '朴素',
      hint: '没有外壳',
      config: { align: 'left', gapX: 0 },
    },
    {
      id: 'framed',
      label: '带框',
      config: { align: 'center', gapX: 8, __cardStyle: { radius: 4 } },
    },
  ],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
} as unknown as ModuleManifest

function style(over: Partial<CardStyle> = {}): CardStyle {
  return {
    id: 'a1',
    name: '蓝调科技卡',
    description: '呼吸描边',
    moduleType: 'demo-card',
    chrome: { radius: 4 },
    config: { align: 'left' },
    thumbnail: null,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...over,
  }
}

describe('内置外壳风格', () => {
  it('两档都在，且都是只读的通用外壳', () => {
    const entries = builtinChromeEntries()

    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(entries.every((one) => one.moduleType === null)).toBe(true)
    expect(entries.every((one) => one.savedId === null)).toBe(true)
  })

  // ⚠ 「平台默认」那一档的 patch 是「把这批键全置 undefined」＝删键。
  //   原样搬进草稿的话，undefined 会被当成一个显式取值一路存回库里
  it('平台默认那一档转过来是空袋子，不是一袋 undefined', () => {
    const entry = builtinChromeEntries().find((one) =>
      one.key.endsWith('default'),
    )

    expect(entry?.chrome).toEqual({})
  })
})

describe('模块内置预设', () => {
  it('预设里那一段 __cardStyle 拆回外壳，不留在内芯里', () => {
    const framed = builtinPresetEntries(MANIFEST).find((one) =>
      one.key.endsWith('framed'),
    )

    expect(framed?.chrome).toEqual({ radius: 4 })
    expect(framed?.config).toEqual({ align: 'center', gapX: 8 })
  })

  it('没写外壳的那一套外壳是空的', () => {
    const plain = builtinPresetEntries(MANIFEST).find((one) =>
      one.key.endsWith('plain'),
    )

    expect(plain?.chrome).toEqual({})
    expect(plain?.moduleType).toBe('demo-card')
  })

  it('一套预设都没有的模块不摆条目', () => {
    const bare = { ...MANIFEST, configPresets: [] } as ModuleManifest

    expect(builtinPresetEntries(bare)).toEqual([])
  })
})

describe('用户样式条目', () => {
  it('带上 savedId，据它开放改名与删除', () => {
    expect(savedEntry(style()).savedId).toBe('a1')
  })

  it('没写说明时一句话是空串而不是 null', () => {
    expect(savedEntry(style({ description: null })).hint).toBe('')
  })
})

describe('条目转草稿', () => {
  // ⚠ 内置条目改出来的必须是**新的一条**：把 id 带上就会去 PATCH 一个并不存在的样式
  it('内置条目转成一条未落库的新样式，名字带副本后缀', () => {
    const entry = builtinPresetEntries(MANIFEST)[0]
    const draft = entry === undefined ? null : entryToDraft(entry, MANIFEST)

    expect(draft?.id).toBeNull()
    expect(draft?.name).toBe('朴素 副本')
  })

  it('用户样式转过来保留 id 与名字，是改不是新建', () => {
    const draft = entryToDraft(savedEntry(style()), MANIFEST)

    expect(draft.id).toBe('a1')
    expect(draft.name).toBe('蓝调科技卡')
  })

  it('内芯照观感键补全：预设只写了两个键，草稿里三个观感键都在', () => {
    const entry = builtinPresetEntries(MANIFEST)[0]

    expect(
      entry === undefined ? null : entryToDraft(entry, MANIFEST).config,
    ).toEqual({ align: 'left', gapX: 0 })
  })

  it('通用外壳样式转过来不带内芯', () => {
    const entry = builtinChromeEntries()[0]

    expect(
      entry === undefined ? null : entryToDraft(entry, null).config,
    ).toEqual({})
  })
})
