/**
 * @fileoverview 应用壳注入给实时 provider 的那条订阅函数：WS 上一张大屏一个主题，
 * 推来的一帧里是**整屏**的点位条目，按调用方要的那批筛出来再往下发。
 *
 * ⚠ 主题按大屏而不是按点位：publisher 是按屏组装与节流的（DASHBOARD_DESIGN §6），
 * 一个点位一个主题会让一屏几百个点变成几百次订阅往返。
 * ⚠ 退订必须真的退：大屏一开就是几天，漏一次就持续累积一份订阅。
 */
import type { PointValueListener, Unsubscribe } from '@dt/contracts'

import { decodePointItems } from './pointFrames'

/** 应用壳的 WS 通道里本函数用得到的那一小块。 */
export interface PointChannel {
  subscribe: (
    topic: string,
    handler: (payload: Record<string, unknown>) => void,
  ) => () => void
}

/** 订阅一批点位，返回退订。 */
export type SubscribePoints = (
  nodeKeys: readonly string[],
  onValue: PointValueListener,
) => Unsubscribe

/**
 * 造订阅函数。
 * @param channel 应用壳的 WS 通道
 * @param topicOf 当前该订哪个主题；返回 null 表示还没打开任何大屏
 */
export function createPointSubscribe(
  channel: PointChannel,
  topicOf: () => string | null,
): SubscribePoints {
  return (nodeKeys, onValue) => {
    const topic = topicOf()
    if (topic === null || nodeKeys.length === 0) return () => undefined
    const wanted = new Set(nodeKeys)
    return channel.subscribe(topic, (payload) => {
      for (const { nodeKey, sample } of decodePointItems(payload)) {
        if (wanted.has(nodeKey)) onValue(nodeKey, sample)
      }
    })
  }
}
