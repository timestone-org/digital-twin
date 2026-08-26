/**
 * @fileoverview 大屏节点 ↔ 2D 孪生文档的两次搬运：读出来装成文档态，改完写回
 * 整棵节点树。
 *
 * ⚠ 写回是**整树替换**的一步，服务端没有单节点写入口——同屏其余节点必须原样
 * 带回去，漏一个就是把它删了，而界面上只会显示「保存成功」。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { TWIN_2D_CONFIG_KEY, normalizeTwin2dConfig } from '@dt/twin2d'

import { createTwin2dDoc } from './twin2dDoc'
import type { Twin2dDoc } from './twin2dDoc'

/** 这张大屏上没有这个节点时给用户看的一句话。 */
export const TWIN_2D_MISSING_NODE_MESSAGE =
  '这张大屏上没有这个节点，可能已被删除。'

/**
 * 把这个节点上的配置与绑定装成一份文档态；节点不在就返回 null。
 * @param nodes 服务端返回的整棵节点树
 * @param nodeId 要编辑的节点
 */
export function twin2dDocOf(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): Twin2dDoc | null {
  const target = nodes.find((item) => item.id === nodeId)
  if (target === undefined) return null
  return createTwin2dDoc({
    config: normalizeTwin2dConfig(target.configJson[TWIN_2D_CONFIG_KEY]),
    bindings: target.bindings,
  })
}

/**
 * 把改动写回这个节点，其余节点原样带上。
 * @param current 服务端当前这份载荷
 * @param nodeId 被编辑的节点
 * @param doc 文档态
 */
export function nodesWithTwin2d(
  current: DashboardPayload,
  nodeId: string,
  doc: Twin2dDoc,
): DashboardNodePayload[] {
  return current.nodes.map((item) =>
    item.id === nodeId
      ? {
          ...item,
          configJson: {
            ...item.configJson,
            [TWIN_2D_CONFIG_KEY]: doc.config.value,
          },
          bindings: [...doc.bindings.value],
        }
      : item,
  )
}
