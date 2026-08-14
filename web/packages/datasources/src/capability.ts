/**
 * @fileoverview 一种来源天生没有的能力被调用时，怎么响亮地失败。
 * ⚠ 静默返回一个空订阅或空序列，表现出来就是「绑了点位但永远没数据」——
 * 那是最难查的那类故障，所以这里一律抛。
 */
import type { BindingSourceKind, Unsubscribe } from '@dt/contracts'

import { DataSourceError } from './errors'

/** 没有东西要退订时的退订。 */
const NOOP_UNSUBSCRIBE: Unsubscribe = () => undefined

/**
 * 该来源没有可订阅的实时点位：给了点位就是这条绑定接错了来源。
 * @param kind 哪种来源
 * @param nodeKeys 调用方想订阅的点位
 */
export function refuseSubscribe(
  kind: BindingSourceKind,
  nodeKeys: readonly string[],
): Unsubscribe {
  if (nodeKeys.length > 0) {
    throw new DataSourceError(
      'unsupported-subscribe',
      `${kind} 来源没有可订阅的点位，却收到 ${nodeKeys.length} 个：这条绑定接错了来源`,
    )
  }
  return NOOP_UNSUBSCRIBE
}

/**
 * 该来源没有历史序列。
 * @param kind 哪种来源
 */
export function refuseHistory(kind: BindingSourceKind): Promise<never> {
  return Promise.reject(
    new DataSourceError(
      'unsupported-history',
      `${kind} 来源没有历史序列，取不到就是取不到，不给空序列`,
    ),
  )
}
