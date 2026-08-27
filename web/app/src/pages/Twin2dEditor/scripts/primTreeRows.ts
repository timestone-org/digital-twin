/**
 * @fileoverview 图元树摊平成一列：每一枚图元前面一道插入缝、每一层末尾再补一道，
 * 加四种新图元的种子与「新的一枚落在哪」。`PrimTree.vue` 一个 v-for 画完整棵树。
 *
 * ⚠ 落点的 `index` 一律按**动之前**那张表数（`movePrim` 会替同级往后挪的那一手减一）：
 *   在这里先减一次就整体差一格，而差一格既不报错也不像 bug。
 * ⚠ 每一层末尾那道尾缝不能省：没有它就没法把一枚图元拖到某一层的最后一位，
 *   空盒更是连一个落点都没有——表现是「这个盒子放不进东西」。
 */
import type { Twin2dPrim, Twin2dPrimKind } from '@dt/twin2d'

import { findTwin2dPrim } from './primOps'
import type { Twin2dPrimSeed, Twin2dPrimSpot } from './primOps'

/** 四种图元给人看的名字。 */
export const TWIN_2D_PRIM_KIND_LABELS: Readonly<
  Record<Twin2dPrimKind, string>
> = {
  box: '盒',
  vec: '矢量',
  ico: '图标',
  txt: '文本',
}

/** 四种图元在树上的图标，取 `@dt/ui` 的登记名。 */
export const TWIN_2D_PRIM_KIND_ICONS: Readonly<Record<Twin2dPrimKind, string>> =
  {
    box: 'layout-template',
    vec: 'pencil',
    ico: 'image',
    txt: 'type',
  }

/**
 * 四种新图元的种子。
 * ⚠ 每一枚都给了一处**看得见**的最小配置（一圈边框 / 一遍描边 / 一个占位图标 /
 * 一句字面文本）：只给 `kind` 的话，归一化补出来的是一枚什么都不画的图元，加完之后
 * 画面上毫无变化，用户只会以为这个按钮坏了。其余字段一概交给归一化补缺省——在这里
 * 抄一份缺省值，抄的那份一旦与归一化不一致，新图元会在「存一次再读回来」之后变样。
 */
export const TWIN_2D_PRIM_SEEDS: Readonly<
  Record<Twin2dPrimKind, Twin2dPrimSeed>
> = {
  box: { kind: 'box', size: { w: 40, h: 24 }, border: { width: 1 } },
  vec: {
    kind: 'vec',
    size: { w: 24, h: 24 },
    strokes: [{ id: 'stroke-0', width: 2 }],
  },
  ico: {
    kind: 'ico',
    size: { w: 20, h: 20 },
    src: { kind: 'name', name: 'image' },
  },
  txt: { kind: 'txt', src: { kind: 'lit', text: '文本' } },
}

/** 摊开之后的一档：一道插入缝，加上（可能有的）一行图元。 */
export interface Twin2dPrimRow {
  key: string
  /** 这一档**前面**那道插入缝的落点。 */
  spot: Twin2dPrimSpot
  /** 缩进层深，根层是 0。 */
  depth: number
  /** 有没有图元行；false = 这一档只有一道尾缝（每层末尾，含空盒里那一道）。 */
  hasRow: boolean
  /** 图元 id；尾缝那一档是空串。 */
  id: string
  kindLabel: string
  icon: string
  /** 行尾那句副名：隐藏 / 有条件 / 几个子。 */
  note: string
  /** 只有盒接得住「拖进来当最后一个子」。 */
  isBox: boolean
  childCount: number
}

/** 新图元落在哪，加一句说清它落在哪的话。 */
export interface Twin2dPrimAddAt {
  spot: Twin2dPrimSpot
  hint: string
}

/** 一枚图元在下拉里的那一项。 */
export interface Twin2dPrimOption {
  value: string
  label: string
}

/**
 * 深度优先摊平图元树，`box` 连它的子树一起带上。
 * ⚠ 只列根层的话，挂在盒里的那些图元一枚都覆盖不到，而它们恰恰是最常被覆盖的
 * （状态点、边框、光斑）。
 * @param prims 一棵图元树
 */
function twin2dFlatPrims(prims: readonly Twin2dPrim[]): readonly Twin2dPrim[] {
  return prims.flatMap((prim) =>
    prim.kind === 'box' ? [prim, ...twin2dFlatPrims(prim.children)] : [prim],
  )
}

/**
 * 还没被覆盖的那些图元，摊成下拉可选项。
 * ⚠ 节点级覆盖与变体覆盖共用这一支：两处各摊一棵树的话，同一枚图元在一处列得出来、
 * 在另一处列不出来，而两处单看都对。
 * @param prims 一棵图元树
 * @param patched 已经有覆盖的那些，按图元 id 索引
 */
export function twin2dPatchOptions(
  prims: readonly Twin2dPrim[],
  patched: Readonly<Record<string, unknown>>,
): readonly Twin2dPrimOption[] {
  return twin2dFlatPrims(prims)
    .filter((prim) => patched[prim.id] === undefined)
    .map((prim) => ({
      value: prim.id,
      label: `${prim.id} · ${TWIN_2D_PRIM_KIND_LABELS[prim.kind]}`,
    }))
}

/**
 * 行尾那句副名。
 * ⚠ 「隐藏」要说出来：一枚 `hidden` 的图元在画面上什么都没有，树上不标的话，
 * 用户只会一遍遍去改它的样式，而看不出它压根没画。
 * @param prim 这一枚图元
 */
function noteOf(prim: Twin2dPrim): string {
  const marks: string[] = []
  if (prim.hidden) marks.push('隐藏')
  if (prim.when !== null) marks.push('有条件')
  if (prim.kind === 'box') marks.push(`${prim.children.length} 子`)
  return marks.join(' · ')
}

/**
 * 深度优先把一层摊进列表：每一枚前面一道插入缝，这一层末尾再补一道。
 * @param list 这一层的图元表
 * @param parentId 这一层挂在谁下面；null = 根层
 * @param depth 这一层的层深
 * @param into 摊平结果，边走边推
 */
function walkPrims(
  list: readonly Twin2dPrim[],
  parentId: string | null,
  depth: number,
  into: Twin2dPrimRow[],
): void {
  for (const [index, prim] of list.entries()) {
    const isBox = prim.kind === 'box'
    into.push({
      key: `row:${prim.id}`,
      spot: { parentId, index },
      depth,
      hasRow: true,
      id: prim.id,
      kindLabel: TWIN_2D_PRIM_KIND_LABELS[prim.kind],
      icon: TWIN_2D_PRIM_KIND_ICONS[prim.kind],
      note: noteOf(prim),
      isBox,
      childCount: isBox ? prim.children.length : 0,
    })
    if (isBox) walkPrims(prim.children, prim.id, depth + 1, into)
  }
  into.push({
    key: `end:${parentId ?? ''}`,
    spot: { parentId, index: list.length },
    depth,
    hasRow: false,
    id: '',
    kindLabel: '',
    icon: '',
    note: '',
    isBox: false,
    childCount: 0,
  })
}

/**
 * 整棵图元树摊平成一列。
 * ⚠ 行的 key 加了前缀（`row:` / `end:`）：两套 key 混在一个 v-for 里，撞上一个名叫
 * `end:` 的图元 id 会让 Vue 复用错行——那时看到的是「拖动之后有一行没跟着更新」。
 * @param prims 整棵图元树
 */
export function twin2dPrimRows(
  prims: readonly Twin2dPrim[],
): readonly Twin2dPrimRow[] {
  const rows: Twin2dPrimRow[] = []
  walkPrims(prims, null, 0, rows)
  return rows
}

/**
 * 新图元落在哪：选中的是盒就落进它末尾，选中的是别的就排在它后面，
 * 一枚都没选（或选中的那一枚已经不在了）就落到根层末尾。
 * ⚠ 落进盒里而不是排在盒后面：选中一个盒再点「新增」，用户要的是往这个盒里装东西。
 * @param prims 整棵图元树
 * @param selected 选中的那一枚；空串 = 一枚都没选
 */
export function twin2dPrimAddAt(
  prims: readonly Twin2dPrim[],
  selected: string,
): Twin2dPrimAddAt {
  const at = findTwin2dPrim(prims, selected)
  if (at === null) {
    return {
      spot: { parentId: null, index: prims.length },
      hint: '新图元落在根层末尾',
    }
  }
  if (at.prim.kind === 'box') {
    return {
      spot: { parentId: at.prim.id, index: at.prim.children.length },
      hint: `新图元落进 ${at.prim.id} 里`,
    }
  }
  return {
    spot: { parentId: at.parentId, index: at.index + 1 },
    hint: `新图元排在 ${at.prim.id} 后面`,
  }
}
