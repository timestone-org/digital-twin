/**
 * @fileoverview 整屏卡片外观缺省那两个工具：读大屏级 `chromeJson.card`、整袋写它。
 *
 * ⚠ 这一段是**全屏的底**，每个画布节点自己的 `__cardStyle` 盖在它上面。用户说
 * 「整屏都换成这个样子」时改的就是它——逐个节点套一遍是 N×40 次调用，而且新加的
 * 模块不会跟着变。
 *
 * ⚠ 它与联动同住元数据轴，那条轴没有撤销栈：写回执必须如实说这一句。
 * ⚠ 写完还要报「哪几个节点自己盖了这批键」——不报的话，用户看到的是
 * 「整屏改了，偏偏那三块没变」，而两边都不报错。
 */
import { isChromeKey } from '@dt/contracts'
import type { AssistantToolCall, CardChrome } from '@dt/contracts'

import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import type { SurfaceSnapshot } from '@/features/ai/surfaces'
import type { MetaSurfaceDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const PAGE_STYLE_TOOLS = [
  'dashboard.read_page_style',
  'dashboard.set_page_style',
] as const

/** 模块级卡片外观住在配置袋子的这一段。 */
const CARD_STYLE = '__cardStyle'

/** 跑一个整屏外观工具；认不出名字给 null，由调用方接着往下问。 */
export function runPageStyle(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (call.name === 'dashboard.read_page_style') return readPageStyle(deps)
  if (call.name === 'dashboard.set_page_style') return setPageStyle(deps, call)
  return null
}

/** 整屏外观缺省此刻是什么样，以及谁在盖它。 */
function readPageStyle(deps: MetaSurfaceDeps): SurfaceSnapshot {
  const card = deps.chrome.card.value
  const keys = Object.keys(card)
  return {
    page_card_style: card,
    // 落库是自由 JSON，词汇表外的键存得下去、渲染时一个变量都不注入
    stray_keys: keys.filter((key) => !isChromeKey(key)),
    overridden_by: shadowsOf(deps, keys),
    note:
      '每个画布节点自己的 __cardStyle 盖在这一段上面；' +
      '`overridden_by` 里的节点不会跟着整屏变，要改它们得逐个改节点。',
  }
}

/**
 * 整袋替换整屏外观缺省。
 * ⚠ 整袋而不是逐键合并：合并会把上一套的残留留在屏上（换了样子但没换干净）。
 * 空袋子 = 删掉这一段 = 整屏回落平台默认。
 */
function setPageStyle(
  deps: MetaSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const chrome = cardArg(call)
  const keys = Object.keys(chrome)
  deps.chrome.setCard(chrome)
  return {
    ok: true,
    chrome_keys: keys.length,
    overridden_by: shadowsOf(deps, keys),
    note:
      '整屏外观不在撤销栈上，用户按 Ctrl+Z 退不回这一步；' +
      '`overridden_by` 里的节点自己盖了其中几个键，屏上看着像没改到。',
  }
}

/** 哪些画布节点自己盖了这批键里的某几个。 */
function shadowsOf(
  deps: MetaSurfaceDeps,
  keys: readonly string[],
): SurfaceSnapshot[] {
  const wanted = new Set(keys)
  const found: SurfaceSnapshot[] = []
  for (const node of deps.editor.nodes.value) {
    const own = Object.keys(objectAt(node.configJson[CARD_STYLE])).filter(
      (key) => wanted.has(key),
    )
    if (own.length === 0) continue
    found.push({
      node_id: node.id,
      label: nodeLabelOf(node, deps.getManifest),
      keys: own,
    })
  }
  return found
}

function objectAt(given: unknown): Record<string, unknown> {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return {}
  }
  return { ...given }
}

/** 收下那只外观袋子；词汇表外的键当场拒收——写进去存得下、渲染时看不见。 */
function cardArg(call: AssistantToolCall): CardChrome {
  const given = objectAt(call.arguments.chrome)
  const stray = Object.keys(given).filter((key) => !isChromeKey(key))
  if (stray.length > 0) {
    throw new Error(
      `外观键不在词汇表里：${stray.join('、')}；用 dashboard.chrome_keys 看有哪些`,
    )
  }
  const card: CardChrome = {}
  for (const [key, value] of Object.entries(given)) {
    if (isChromeKey(key)) card[key] = value
  }
  return card
}
