/**
 * @fileoverview 部件之间的从属关系：直接子件、以某个部件为顶的装配清单，
 * 以及「详情弹窗够不够得着这个部件」的判定。
 *
 * ⚠ `parts` 是**扁平数组**，层级只在 `parentId` 上——文档序就是绑定行号，
 * 换成嵌套结构会让存量大屏每一行绑定改喂另一个部件（见 `bindingRows.ts` 文件头）。
 * ⚠ 本文件每一支都自己防环：落库的 JSON 是用户可控的，A→B→A 一旦递归下去就是
 * 栈溢出，表现是整块大屏白屏，而配置面板上看不出哪一条配错了。成环本身由
 * `collectTwinConfigIssues` 报，这里只负责断在重复那一环、照样给出一份清单。
 */
import type { TwinPart } from './types'

/**
 * 装配栏一行：部件 + 它在这棵子树里的位置。
 * ⚠ 同层一律按**文档序**，绝不另排：装配栏上看到的次序与绑点面板上数的行号
 * 必须是同一个，另排一次就没人对得上了。
 */
export interface TwinAssemblyNode {
  part: TwinPart
  /** 0 = 打开的那个部件自己。 */
  depth: number
  /** 同层里的最后一个；连接轨据它把竖线收成半截。 */
  isLast: boolean
}

/** 装配深度上限，超了由诊断提醒：再深下去装配栏缩进就吃光行宽了。 */
export const MAX_ASSEMBLY_DEPTH = 4

/**
 * id → 部件。
 * ⚠ 重复 id 取**先见者**，与全仓 `parts.find(…)` 的口径一致；重复本身由诊断报，
 * 这里不静默改名。
 */
function indexParts(parts: readonly TwinPart[]): Map<string, TwinPart> {
  const byId = new Map<string, TwinPart>()
  for (const part of parts) if (!byId.has(part.id)) byId.set(part.id, part)
  return byId
}

/** 实际上级 id；空串 = 顶层。自指与悬空都算顶层。 */
function resolvedParent(part: TwinPart, byId: Map<string, TwinPart>): string {
  const raw = part.parentId
  if (raw === '' || raw === part.id) return ''
  return byId.has(raw) ? raw : ''
}

/** 上级 id → 直接子件，各自按文档序。顶层挂在空串上。 */
function childIndex(parts: readonly TwinPart[]): Map<string, TwinPart[]> {
  const byId = indexParts(parts)
  const kids = new Map<string, TwinPart[]>()
  for (const part of parts) {
    const key = resolvedParent(part, byId)
    const bucket = kids.get(key)
    if (bucket === undefined) kids.set(key, [part])
    else bucket.push(part)
  }
  return kids
}

/**
 * 某个部件的直接子件，按文档序；`parentId` 给空串即全部顶层部件。
 * @param parts 归一化后的全部部件
 * @param parentId 上级部件 id
 */
export function partChildren(
  parts: readonly TwinPart[],
  parentId: string,
): TwinPart[] {
  return childIndex(parts).get(parentId) ?? []
}

/**
 * 从直接上级往上数的祖先链，由近及远。
 * ⚠ 成环或撞上悬空 id 时就地收住，不报错：那两样由诊断报，这里返回一条短链
 * 也比让调用方各自防环强。
 * @param parts 归一化后的全部部件
 * @param partId 从哪个部件往上数
 */
export function partAncestors(
  parts: readonly TwinPart[],
  partId: string,
): TwinPart[] {
  const byId = indexParts(parts)
  const out: TwinPart[] = []
  const seen = new Set<string>([partId])
  let cursor = byId.get(partId)?.parentId ?? ''
  while (cursor !== '' && !seen.has(cursor)) {
    const parent = byId.get(cursor)
    if (parent === undefined) break
    out.push(parent)
    seen.add(cursor)
    cursor = parent.parentId
  }
  return out
}

/**
 * 沿上级往上走会不会回到自己（含自指）。
 * @param parts 归一化后的全部部件
 * @param partId 起点部件 id
 */
export function partOnParentCycle(
  parts: readonly TwinPart[],
  partId: string,
): boolean {
  const byId = indexParts(parts)
  const seen = new Set<string>()
  let cursor = partId
  while (cursor !== '') {
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? ''
  }
  return false
}

/**
 * 以某个部件为顶的装配清单：深度优先、同层按文档序，第一项是它自己。
 * 部件不存在时给空数组。
 * @param parts 归一化后的全部部件
 * @param rootId 打开的那个部件
 */
export function partAssembly(
  parts: readonly TwinPart[],
  rootId: string,
): TwinAssemblyNode[] {
  const root = indexParts(parts).get(rootId)
  if (root === undefined) return []
  const kids = childIndex(parts)
  const out: TwinAssemblyNode[] = []
  const seen = new Set<string>()

  const walk = (part: TwinPart, depth: number, isLast: boolean): void => {
    // ⚠ 这一句就是防环：成环时后代里会再次出现祖先，接着走下去是栈溢出
    if (seen.has(part.id)) return
    seen.add(part.id)
    out.push({ part, depth, isLast })
    const children = kids.get(part.id) ?? []
    children.forEach((child, index) => {
      walk(child, depth + 1, index === children.length - 1)
    })
  }

  walk(root, 0, true)
  return out
}

/**
 * 这个部件的详情能不能被人看到：自己近距点击就弹，或者某个祖先弹得出来。
 * ⚠ 子件是**从父件的装配栏里**带出来看的，与它自己配了什么点击动作无关——
 * 按「只看 near」判可达会把每一个子件都报成「字段永远显示不出来」，而那正是
 * 这次要显示的东西，整块诊断从此没人看。
 * @param parts 归一化后的全部部件
 * @param partId 要判定的部件
 */
export function partDetailReachable(
  parts: readonly TwinPart[],
  partId: string,
): boolean {
  const byId = indexParts(parts)
  if (byId.get(partId)?.click.near === 'detail') return true
  return partAncestors(parts, partId).some(
    (part) => part.click.near === 'detail',
  )
}

/**
 * 后代里有没有配了详情字段的。纯容器父件（自己不取数、子件各自取数）靠它
 * 豁免「弹出来是一张空卡片」那条诊断。
 * @param parts 归一化后的全部部件
 * @param partId 要判定的部件
 */
export function hasFieldedDescendant(
  parts: readonly TwinPart[],
  partId: string,
): boolean {
  return partAssembly(parts, partId).some(
    (node) => node.depth > 0 && node.part.detail.fields.length > 0,
  )
}
