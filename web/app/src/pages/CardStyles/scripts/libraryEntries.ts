/**
 * @fileoverview 左栏那份名单：内置的与用户存下来的，归一成同一种条目。
 *
 * ⚠ 内置的不藏起来：用户来这一页的第一个动作八成是「照极简描边改一点」，
 * 藏了他就得从零调四十个旋钮。内置条目只读——能复制一份改，不能改也不能删。
 */
import type { CardChrome, CardStyle, ModuleManifest } from '@dt/contracts'

import { CARD_STYLE_VARIANTS } from '@/features/dashboard/cardStyleVariants'
import type { StyleDraft } from './styleDraft'
import { fillStyleKeys } from './styleDraft'

/** 模块级预设里那一段外壳。⚠ 与渲染侧读的是同一个键，别在这里另起一个名字。 */
const CARD_STYLE_KEY = '__cardStyle'

/** 左栏的一组：组名 + 组里的条目。 */
export interface StyleGroup {
  title: string
  items: readonly LibraryEntry[]
}

export interface LibraryEntry {
  /** 列表 key；内置的与用户的各带前缀，两边 id 不会撞。 */
  key: string
  label: string
  hint: string
  /** null = 通用外壳样式。 */
  moduleType: string | null
  chrome: CardChrome
  config: Record<string, unknown>
  /** 用户样式的 id；内置条目为 null，据此禁用改名与删除。 */
  savedId: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 丢掉值为 undefined 的键。
 * ⚠ 「平台默认」那一档的 patch 是「把这批键全置 undefined」——它表达的是删键，
 * 原样搬进草稿的话，`undefined` 会被当成一个显式取值一路存回库里。
 * @param chrome 一只外壳袋
 */
function compact(chrome: CardChrome): CardChrome {
  const out: CardChrome = {}
  for (const [key, value] of Object.entries(chrome)) {
    if (value !== undefined) out[key as keyof CardChrome] = value
  }
  return out
}

/** 内置的两档外壳风格，摆在「通用外壳」那一组里。 */
export function builtinChromeEntries(): LibraryEntry[] {
  return CARD_STYLE_VARIANTS.map((variant) => ({
    key: `builtin:${variant.id}`,
    label: variant.label,
    hint: variant.hint,
    moduleType: null,
    chrome: compact(variant.patch()),
    config: {},
    savedId: null,
  }))
}

/**
 * 一个模块自带的观感预设。
 * ⚠ 预设可以写 schema 之外的 `__cardStyle` 段（页头那套就写了）：这里把它拆回
 * 外壳，与内芯分开摆——不拆的话，外壳那几个键会当成内芯键被服务端拒掉。
 * @param manifest 模块清单
 */
export function builtinPresetEntries(manifest: ModuleManifest): LibraryEntry[] {
  return (manifest.configPresets ?? []).map((preset) => {
    const { [CARD_STYLE_KEY]: chrome, ...config } = preset.config
    return {
      key: `builtin:${manifest.type}:${preset.id}`,
      label: preset.label,
      hint: preset.hint ?? '',
      moduleType: manifest.type,
      chrome: compact(asRecord(chrome)),
      config,
      savedId: null,
    }
  })
}

/**
 * 库里的一条样式 → 条目。
 * @param style 用户存下来的样式
 */
export function savedEntry(style: CardStyle): LibraryEntry {
  return {
    key: `saved:${style.id}`,
    label: style.name,
    hint: style.description ?? '',
    moduleType: style.moduleType,
    chrome: style.chrome,
    config: style.config,
    savedId: style.id,
  }
}

/**
 * 条目 → 可编辑的草稿。内置条目变成一条**未落库**的新样式（`id` 为 null），
 * 于是「照内置改一点再存下来」不需要另开一个入口。
 * @param entry 左栏选中的条目
 * @param manifest 该模块的清单，用于把观感键补全
 * @param copySuffix 内置条目转过来时给名字加的后缀
 */
export function entryToDraft(
  entry: LibraryEntry,
  manifest: ModuleManifest | null,
  copySuffix = '副本',
): StyleDraft {
  const isCopy = entry.savedId === null
  return {
    id: entry.savedId,
    name: isCopy ? `${entry.label} ${copySuffix}` : entry.label,
    description: entry.hint,
    moduleType: entry.moduleType,
    chrome: { ...entry.chrome },
    config:
      entry.moduleType === null
        ? {}
        : fillStyleKeys(manifest, asRecord(entry.config)),
  }
}
