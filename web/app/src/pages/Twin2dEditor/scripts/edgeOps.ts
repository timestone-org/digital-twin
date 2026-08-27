/**
 * @fileoverview 连线实例的纯变更：增删改、复制、层序，以及一批标签沿线错开。
 * id 工厂、删除口径与层序重排都借 `nodeOps` 那一份，三支 ops 只有一套口径。
 *
 * ⚠ 一律纯函数：收一份 `Twin2dConfig` 出一份新的，不碰文档态、不碰选中态。
 * ⚠ 连线没有「位置」可对齐——它占多大取决于两端解析到哪，所以这里没有对齐分布，
 *   与之对应的一档是把一批标签沿各自的线错开（`spreadEdgeLabels`）。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdge } from '@dt/twin2d'

import {
  TWIN_2D_NOTHING_REMOVED,
  freshTwin2dId,
  newTwin2dId,
  orderList,
  twin2dRemoval,
} from './nodeOps'
import type {
  Twin2dAdded,
  Twin2dCopied,
  Twin2dIdFactory,
  Twin2dOrderMove,
  Twin2dRemoval,
} from './nodeOps'

/** 连线 id 的前缀。 */
export const TWIN_2D_EDGE_ID_PREFIX = 'edge'

/** 一张表里现有的全部 id。 */
function idsOf(list: readonly { id: string }[]): Set<string> {
  return new Set(list.map((item) => item.id))
}

/**
 * 新增一条连线，追加在末尾。
 * ⚠ 两端必须指向**已有**的节点：归一化把悬空端点的整条线丢掉，所以种子给不出合法
 * 两端时这里交出的是原样的配置与 `id: null`——交一个落不到实处的 id 出去，调用方
 * 会拿它去选中一条根本不存在的线。
 * @param config 当前配置
 * @param seed 新连线的种子（至少给 `from` / `to` / `styleId`）
 * @param makeId id 工厂，缺省随机
 */
export function addEdge(
  config: Twin2dConfig,
  seed: Partial<Omit<Twin2dEdge, 'id'>>,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(TWIN_2D_EDGE_ID_PREFIX, idsOf(config.edges), makeId)
  const next = normalizeTwin2dConfig({
    ...config,
    edges: [...config.edges, { ...seed, id }],
  })
  const landed = next.edges.some((edge) => edge.id === id)
  return landed ? { config: next, id } : { config, id: null }
}

/**
 * 改一条连线的若干字段；连线不在就原样返回入参那份配置。
 * ⚠ `id` 不在可改之列：绑定行按文档序钉、诊断按 id 点名，改 id 两处一起失联。
 * @param config 当前配置
 * @param id 要改的连线
 * @param patch 要覆盖的字段
 */
export function updateEdge(
  config: Twin2dConfig,
  id: string,
  patch: Partial<Omit<Twin2dEdge, 'id'>>,
): Twin2dConfig {
  if (!config.edges.some((edge) => edge.id === id)) return config
  return {
    ...config,
    edges: config.edges.map((edge) =>
      edge.id === id ? { ...edge, ...patch } : edge,
    ),
  }
}

/**
 * 复制一批连线，每份副本插在它自己后面。
 * ⚠ 副本与原件两端**完全重合**（连线的位置由两端决定，没有可加的位移）：画面上
 * 看着只有一条，得靠拖拐点分开。这是连线这一类固有的，不在这里偷偷给个偏移——
 * 偏移会写进 `waypoints`，而那等于替用户决定了这条线要走折线。
 * @param config 当前配置
 * @param ids 要复制的那一批
 * @param makeId id 工厂，缺省随机
 */
export function duplicateEdges(
  config: Twin2dConfig,
  ids: readonly string[],
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dCopied {
  const picked = new Set(ids)
  const taken = idsOf(config.edges)
  const copies: string[] = []
  const edges: Twin2dEdge[] = []
  for (const edge of config.edges) {
    edges.push(edge)
    if (!picked.has(edge.id)) continue
    const id = freshTwin2dId(TWIN_2D_EDGE_ID_PREFIX, taken, makeId)
    taken.add(id)
    copies.push(id)
    edges.push({ ...edge, id })
  }
  if (copies.length === 0) return { config, ids: [] }
  return { config: normalizeTwin2dConfig({ ...config, edges }), ids: copies }
}

/**
 * 删掉一批连线。删线不级联到别处——节点不会因为没线了就消失。
 * @param config 当前配置
 * @param ids 要删的那一批
 */
export function removeEdges(
  config: Twin2dConfig,
  ids: readonly string[],
): Twin2dRemoval {
  const doomed = new Set(ids)
  const kept = config.edges.filter((edge) => !doomed.has(edge.id))
  if (kept.length === config.edges.length) {
    return { config, removed: TWIN_2D_NOTHING_REMOVED }
  }
  return twin2dRemoval(
    config,
    normalizeTwin2dConfig({ ...config, edges: kept }),
  )
}

/**
 * 调一批连线的层序。
 * @param config 当前配置
 * @param ids 要动的那一批
 * @param move 四档层序
 */
export function orderEdges(
  config: Twin2dConfig,
  ids: readonly string[],
  move: Twin2dOrderMove,
): Twin2dConfig {
  const edges = orderList(config.edges, ids, move)
  return edges === config.edges ? config : { ...config, edges }
}

/**
 * 把一批连线的标签沿各自的线错开：第 i 条落在 `i / (n + 1)` 处。
 * ⚠ 这是连线这一类的「分布」：几条平行的线各自的标签默认都在中点，叠成一坨谁都
 * 读不出来，而它看着像「标签没渲染出来」。
 * ⚠ 只有一条时落回 0.5（中点），与归一化的缺省同一档。
 * @param config 当前配置
 * @param ids 要错开的那一批
 */
export function spreadEdgeLabels(
  config: Twin2dConfig,
  ids: readonly string[],
): Twin2dConfig {
  const picked = new Set(ids)
  const inside = config.edges.filter((edge) => picked.has(edge.id))
  if (inside.length === 0) return config
  const step = 1 / (inside.length + 1)
  const wanted = new Map(
    inside.map((edge, index) => [edge.id, (index + 1) * step]),
  )
  if (inside.every((edge) => wanted.get(edge.id) === edge.labelAt)) {
    return config
  }
  return {
    ...config,
    edges: config.edges.map((edge) => {
      const labelAt = wanted.get(edge.id)
      return labelAt === undefined ? edge : { ...edge, labelAt }
    }),
  }
}
