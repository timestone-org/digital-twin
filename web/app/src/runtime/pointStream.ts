/** @fileoverview 按主题合并实时点位快照，给新视图初值并订阅后续变化。 */
import type {
  PointSample,
  PointValueListener,
  Unsubscribe,
} from '@dt/contracts'

import { decodePointItems } from './pointFrames'
import type { TopicHandler } from './topicRegistry'

/** 应用壳的 WS 通道里本函数用得到的那一小块。 */
export interface PointChannel {
  subscribe: (topic: string, handler: TopicHandler) => () => void
  requestSnapshot?: (topic: string) => void
}

interface TopicSamples {
  users: number
  samples: Map<string, PointSample>
  isSnapshotRequested: boolean
}

// ⚠ 通道对象每次取用都会新建，底层 subscribe 函数才是共享连接的稳定身份。
const channelSamples = new WeakMap<
  PointChannel['subscribe'],
  Map<string, TopicSamples>
>()

/** 清除连接失效前的快照，保留仍在等待重连的订阅。 */
export function clearPointSnapshots(
  subscribe: PointChannel['subscribe'],
): void {
  for (const current of channelSamples.get(subscribe)?.values() ?? []) {
    current.samples.clear()
    current.isSnapshotRequested = false
  }
}

/** 会话关闭时连同订阅计数一起释放，下一条连接从空表开始。 */
export function resetPointSnapshots(
  subscribe: PointChannel['subscribe'],
): void {
  clearPointSnapshots(subscribe)
  channelSamples.delete(subscribe)
}

function topicSamples(channel: PointChannel, topic: string): TopicSamples {
  let topics = channelSamples.get(channel.subscribe)
  if (topics === undefined) {
    topics = new Map()
    channelSamples.set(channel.subscribe, topics)
  }
  let current = topics.get(topic)
  if (current === undefined) {
    current = { users: 0, samples: new Map(), isSnapshotRequested: false }
    topics.set(topic, current)
  }
  current.users += 1
  return current
}

function pointHandler(
  current: TopicSamples,
  wanted: ReadonlySet<string>,
  onValue: PointValueListener,
): TopicHandler {
  return Object.assign(
    (payload: Record<string, unknown>) => {
      for (const { nodeKey, sample } of decodePointItems(payload)) {
        current.samples.set(nodeKey, sample)
        if (wanted.has(nodeKey)) onValue(nodeKey, sample)
      }
      current.isSnapshotRequested = false
    },
    {
      onUnavailable(message: string) {
        current.samples.clear()
        current.isSnapshotRequested = false
        for (const nodeKey of wanted)
          onValue(nodeKey, { state: 'error', errorMessage: message })
      },
    },
  )
}

function readInitialSamples(
  channel: PointChannel,
  topic: string,
  current: TopicSamples,
  wanted: ReadonlySet<string>,
  onValue: PointValueListener,
): void {
  let hasMissing = false
  for (const nodeKey of wanted) {
    const sample = current.samples.get(nodeKey)
    if (sample === undefined) hasMissing = true
    else onValue(nodeKey, sample)
  }
  if (!hasMissing || current.users === 1 || current.isSnapshotRequested) return
  current.isSnapshotRequested = true
  channel.requestSnapshot?.(topic)
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
    const current = topicSamples(channel, topic)
    const stop = channel.subscribe(
      topic,
      pointHandler(current, wanted, onValue),
    )
    readInitialSamples(channel, topic, current, wanted, onValue)
    let isStopped = false
    return () => {
      if (isStopped) return
      isStopped = true
      stop()
      current.users -= 1
      const topics = channelSamples.get(channel.subscribe)
      if (current.users === 0 && topics?.get(topic) === current)
        topics.delete(topic)
    }
  }
}
