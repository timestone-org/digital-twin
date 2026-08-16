/**
 * @fileoverview 一个数据源的点位实时值：订 `collect:{sourceId}` 一个主题，
 * 收到的一帧里是整份点位清单的条目，按 `node_key` 存进一张表供表格逐行取。
 *
 * ⚠ 三件事必须在这里做掉，散到页面里必然漏：
 * 1. **卸载时退订**——不退的话，切走的页面仍在收消息并更新已经不在的状态。
 * 2. **切数据源时先退旧的再订新的**——两个主题同时挂着，旧源的值会盖在新源
 *    的表格上，而 `node_key` 前缀不同并不会拦住它（表是按键写的）。
 * 3. **首帧就是全量**——publisher 认出新观看者时补一帧全量，所以这里不必再
 *    发一次 HTTP 读初值（DASHBOARD_DESIGN §6.1）。
 *
 * ⚠ 主题一订就是整个数据源，不按可见行细分：hub 只认「一个不透明的主题」，
 * 一个点位一个主题会让一屏几十行变成几十次订阅往返。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { PointSample } from '@dt/contracts'

import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { collectTopic, decodePointItems } from '@/runtime/pointFrames'

export interface LiveValues {
  /** 按 `node_key` 索引的最新读数。没收到过的点位不在表里。 */
  samples: Ref<Map<string, PointSample>>
  /** WS 通道此刻通不通。断了要在界面上说出来，不能让旧值冒充现值。 */
  isConnected: Ref<boolean>
}

/**
 * 订一个数据源的实时值。
 * @param sourceId 数据源 id；为空串表示还没选中任何数据源
 */
export function useLiveValues(sourceId: Ref<string>): LiveValues {
  const channel = useRealtimeChannel()
  const samples = ref(new Map<string, PointSample>())
  let unsubscribe: (() => void) | null = null

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  function start(id: string): void {
    stop()
    // ⚠ 换源时连同旧值一起丢：留着的话，新源那些还没收到值的行会摆着上一个
    // 源的读数，而两者在界面上完全分不出来
    samples.value = new Map()
    if (id === '') return
    unsubscribe = channel.subscribe(collectTopic(id), (payload) => {
      const next = new Map(samples.value)
      for (const { nodeKey, sample } of decodePointItems(payload)) {
        next.set(nodeKey, sample)
      }
      samples.value = next
    })
  }

  watch(sourceId, (id) => start(id), { immediate: true })
  onBeforeUnmount(stop)

  return { samples, isConnected: channel.isConnected }
}
