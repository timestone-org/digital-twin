/**
 * @fileoverview 标注实例的纯变更：增删改、复制、层序与对齐分布。
 * id 工厂、删除口径、层序重排与盒算术都借 `nodeOps` 那一份，三支 ops 只有一套口径。
 *
 * ⚠ 一律纯函数：收一份 `Twin2dConfig` 出一份新的，不碰文档态、不碰选中态。
 * ⚠ 挪一条标注要连 `x2/y2` 一起挪：辅助线的第二个端点是**绝对坐标**而不是相对起点
 *   的偏移，只挪 `x/y` 的表现是一拖起点线就越拉越长，而每一处取值都是「对」的。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dMark } from '@dt/twin2d'

import { markSnapBox } from './entityBoxes'
import {
  TWIN_2D_NOTHING_REMOVED,
  alignDeltas,
  distributeDeltas,
  freshTwin2dId,
  newTwin2dId,
  orderList,
  twin2dRemoval,
} from './nodeOps'
import type {
  Twin2dAdded,
  Twin2dAlignEdge,
  Twin2dCopied,
  Twin2dDistributeAxis,
  Twin2dIdFactory,
  Twin2dOrderMove,
  Twin2dRemoval,
} from './nodeOps'
import type { Twin2dSnapBox } from './snapping'

/** 标注 id 的前缀。 */
export const TWIN_2D_MARK_ID_PREFIX = 'mark'

/** 一张表里现有的全部 id。 */
function idsOf(list: readonly { id: string }[]): Set<string> {
  return new Set(list.map((item) => item.id))
}

/**
 * 整条标注平移；辅助线的两端一起挪。
 * @param mark 一条标注
 * @param at 位移（设计坐标）
 */
function movedMark(mark: Twin2dMark, at: Pt): Twin2dMark {
  return {
    ...mark,
    x: mark.x + at.x,
    y: mark.y + at.y,
    x2: mark.x2 + at.x,
    y2: mark.y2 + at.y,
  }
}

/** 被点名的那些标注，连同它们占的盒（文档序）。 */
function pickedMarkBoxes(
  marks: readonly Twin2dMark[],
  ids: readonly string[],
): { ids: readonly string[]; boxes: readonly Twin2dSnapBox[] } {
  const picked = new Set(ids)
  const inside = marks.filter((mark) => picked.has(mark.id))
  return {
    ids: inside.map((mark) => mark.id),
    boxes: inside.map(markSnapBox),
  }
}

/** 按 id 给标注加位移；一步都没挪时原样返回入参那份配置。 */
function withMarkDeltas(
  config: Twin2dConfig,
  ids: readonly string[],
  deltas: readonly Pt[],
): Twin2dConfig {
  const map = new Map(ids.map((id, index) => [id, deltas[index]]))
  const still = [...map.values()].every(
    (at) => at === undefined || (at.x === 0 && at.y === 0),
  )
  if (still) return config
  return {
    ...config,
    marks: config.marks.map((mark) => {
      const at = map.get(mark.id)
      if (at === undefined || (at.x === 0 && at.y === 0)) return mark
      return movedMark(mark, at)
    }),
  }
}

/**
 * 新增一条标注，追加在末尾。
 * ⚠ `kind` 必须是三档之一：归一化认不出 kind 就把整条丢掉，所以这里交出的是原样的
 * 配置与 `id: null`，而不是一个指不到实处的 id。
 * @param config 当前配置
 * @param seed 新标注的种子（至少给 `kind`）
 * @param makeId id 工厂，缺省随机
 */
export function addMark(
  config: Twin2dConfig,
  seed: Partial<Omit<Twin2dMark, 'id'>>,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(TWIN_2D_MARK_ID_PREFIX, idsOf(config.marks), makeId)
  const next = normalizeTwin2dConfig({
    ...config,
    marks: [...config.marks, { ...seed, id }],
  })
  const landed = next.marks.some((mark) => mark.id === id)
  return landed ? { config: next, id } : { config, id: null }
}

/**
 * 改一条标注的若干字段；标注不在就原样返回入参那份配置。
 * ⚠ `id` 不在可改之列：绑定行与诊断都按它寻址，改 id 两处一起失联。
 * @param config 当前配置
 * @param id 要改的标注
 * @param patch 要覆盖的字段
 */
export function updateMark(
  config: Twin2dConfig,
  id: string,
  patch: Partial<Omit<Twin2dMark, 'id'>>,
): Twin2dConfig {
  if (!config.marks.some((mark) => mark.id === id)) return config
  return {
    ...config,
    marks: config.marks.map((mark) =>
      mark.id === id ? { ...mark, ...patch } : mark,
    ),
  }
}

/**
 * 复制一批标注，每份副本插在它自己后面。
 * @param config 当前配置
 * @param ids 要复制的那一批
 * @param offset 副本相对原件的位移（设计坐标）
 * @param makeId id 工厂，缺省随机
 */
export function duplicateMarks(
  config: Twin2dConfig,
  ids: readonly string[],
  offset: Pt,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dCopied {
  const picked = new Set(ids)
  const taken = idsOf(config.marks)
  const copies: string[] = []
  const marks: Twin2dMark[] = []
  for (const mark of config.marks) {
    marks.push(mark)
    if (!picked.has(mark.id)) continue
    const id = freshTwin2dId(TWIN_2D_MARK_ID_PREFIX, taken, makeId)
    taken.add(id)
    copies.push(id)
    marks.push({ ...movedMark(mark, offset), id })
  }
  if (copies.length === 0) return { config, ids: [] }
  return { config: normalizeTwin2dConfig({ ...config, marks }), ids: copies }
}

/**
 * 删掉一批标注。标注不被任何东西引用，删了不级联。
 * @param config 当前配置
 * @param ids 要删的那一批
 */
export function removeMarks(
  config: Twin2dConfig,
  ids: readonly string[],
): Twin2dRemoval {
  const doomed = new Set(ids)
  const kept = config.marks.filter((mark) => !doomed.has(mark.id))
  if (kept.length === config.marks.length) {
    return { config, removed: TWIN_2D_NOTHING_REMOVED }
  }
  return twin2dRemoval(
    config,
    normalizeTwin2dConfig({ ...config, marks: kept }),
  )
}

/**
 * 调一批标注的层序。
 * ⚠ 标注先按 `zOrder` 分成节点层上下两摞再各自按文档序画：同一摞里动层序才看得出
 * 变化，跨摞的先后由 `zOrder` 说了算（`updateMark` 改它）。
 * @param config 当前配置
 * @param ids 要动的那一批
 * @param move 四档层序
 */
export function orderMarks(
  config: Twin2dConfig,
  ids: readonly string[],
  move: Twin2dOrderMove,
): Twin2dConfig {
  const marks = orderList(config.marks, ids, move)
  return marks === config.marks ? config : { ...config, marks }
}

/**
 * 把一批标注对到同一条边上。
 * @param config 当前配置
 * @param ids 要对齐的那一批
 * @param edge 对齐到哪一边
 */
export function alignMarks(
  config: Twin2dConfig,
  ids: readonly string[],
  edge: Twin2dAlignEdge,
): Twin2dConfig {
  const picked = pickedMarkBoxes(config.marks, ids)
  return withMarkDeltas(config, picked.ids, alignDeltas(picked.boxes, edge))
}

/**
 * 把一批标注沿一条轴摆成等距。
 * @param config 当前配置
 * @param ids 要分布的那一批
 * @param axis 沿哪条轴
 */
export function distributeMarks(
  config: Twin2dConfig,
  ids: readonly string[],
  axis: Twin2dDistributeAxis,
): Twin2dConfig {
  const picked = pickedMarkBoxes(config.marks, ids)
  return withMarkDeltas(
    config,
    picked.ids,
    distributeDeltas(picked.boxes, axis),
  )
}
