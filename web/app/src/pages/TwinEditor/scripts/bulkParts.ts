/**
 * @fileoverview 从模型节点批量建部件：一个模型动辄几十个节点，逐个新建再逐个
 * 填节点名是这套编辑器里最费手的一段。
 * ⚠ 已被别的部件认领的节点要挡在外面——同一个节点挂两个部件时，显隐与点击
 * 两条规则会互相打架，而界面上看不出是哪两条在打。
 */
import type { TwinConfig } from '@dt/twin-config'

import { addEntity, updateEntity, type TwinIdFactory } from './entityOps'

/** 一个候选节点在批量面板上的状态。 */
export interface BulkPartCandidate {
  /** 模型里的节点名。 */
  name: string
  /** 已经被某个部件认领了；认领者的名字用来说明为什么不能再选。 */
  takenBy: string | null
}

/**
 * 把模型节点列成候选，标出谁已被认领。
 * @param config 当前配置
 * @param modelNodes 模型里的全部节点名
 */
export function bulkPartCandidates(
  config: TwinConfig,
  modelNodes: readonly string[],
): BulkPartCandidate[] {
  const owner = new Map<string, string>()
  for (const part of config.parts) {
    for (const node of part.nodes) {
      if (!owner.has(node)) owner.set(node, part.name)
    }
  }
  return modelNodes.map((name) => ({
    name,
    takenBy: owner.get(name) ?? null,
  }))
}

/**
 * 按节点名批量建部件：一个节点一个部件，部件名就取节点名。
 * 已被认领的节点与重复项静默跳过——它们在面板上本就是不可选的。
 * @param config 当前配置
 * @param nodeNames 选中的节点名
 * @param makeId id 工厂，缺省随机
 */
export function addPartsFromNodes(
  config: TwinConfig,
  nodeNames: readonly string[],
  makeId?: TwinIdFactory,
): { config: TwinConfig; ids: string[] } {
  const taken = new Set(config.parts.flatMap((part) => part.nodes))
  const seen = new Set<string>()
  let next = config
  const ids: string[] = []
  for (const name of nodeNames) {
    const trimmed = name.trim()
    if (trimmed === '' || taken.has(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    const added =
      makeId === undefined
        ? addEntity(next, 'parts')
        : addEntity(next, 'parts', makeId)
    next = updateEntity(added.config, 'parts', added.id, {
      name: trimmed,
      nodes: [trimmed],
    })
    ids.push(added.id)
  }
  return { config: next, ids }
}
