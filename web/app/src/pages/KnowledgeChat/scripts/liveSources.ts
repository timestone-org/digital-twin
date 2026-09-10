/** @fileoverview 会话内共享采集主题和首帧缓存，最后一张卡片离开时退订。 */
import type { InjectionKey } from 'vue'
import type { PointSample } from '@dt/contracts'
import { decodePointItems } from '@/runtime/pointFrames'
import type { TopicHandler } from '@/runtime/topicRegistry'
import type { useRealtimeChannel } from '@/composables/useRealtimeChannel'

type Channel = ReturnType<typeof useRealtimeChannel>
interface Receipt {
  sample: PointSample
  receivedAtMs: number
}
type Listener = (receipt: Receipt | undefined, error?: string) => void
interface Source {
  samples: Map<string, Receipt>
  listeners: Map<Listener, string>
  stop: () => void
  resume: () => void
}
export interface LiveSources {
  subscribe: (channel: Channel, key: string, listener: Listener) => () => void
  clearSamples: () => void
  dispose: () => void
}
export const LIVE_SOURCES: InjectionKey<LiveSources> =
  Symbol('chat-live-sources')
const MAX_CACHED_POINTS = 2000

export function createLiveSources(): LiveSources {
  const sources = new Map<string, Source>()
  return {
    subscribe(channel, key, listener) {
      const sourceId = key.split(':')[0] ?? ''
      const entry = sources.get(sourceId) ?? createSource(channel, sourceId)
      sources.set(sourceId, entry)
      entry.resume()
      entry.listeners.set(listener, key)
      listener(entry.samples.get(key))
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size > 0) return
        entry.stop()
        sources.delete(sourceId)
      }
    },
    clearSamples() {
      for (const source of sources.values()) {
        source.samples.clear()
        for (const notify of source.listeners.keys()) notify(undefined)
      }
    },
    dispose() {
      for (const source of sources.values()) source.stop()
      sources.clear()
    },
  }
}

function createSource(channel: Channel, sourceId: string): Source {
  let isUnavailable = false
  const entry: Source = {
    samples: new Map(),
    listeners: new Map(),
    stop: () => undefined,
    resume: () => {
      if (!isUnavailable) return
      entry.stop()
      entry.stop = channel.subscribe(`collect:${sourceId}`, handler)
      isUnavailable = false
    },
  }
  const handler: TopicHandler = (payload) => {
    for (const one of decodePointItems(payload)) {
      if (!one.nodeKey.startsWith(`${sourceId}:`)) continue
      const receipt = { sample: one.sample, receivedAtMs: Date.now() }
      entry.samples.set(one.nodeKey, receipt)
      for (const [notify, nodeKey] of entry.listeners) {
        if (nodeKey === one.nodeKey) notify(receipt)
      }
    }
    capSamples(entry)
  }
  handler.onUnavailable = (message) => {
    isUnavailable = true
    entry.samples.clear()
    for (const notify of entry.listeners.keys()) notify(undefined, message)
  }
  entry.stop = channel.subscribe(`collect:${sourceId}`, handler)
  return entry
}

function capSamples(entry: Source): void {
  const watching = new Set(entry.listeners.values())
  for (const key of entry.samples.keys()) {
    if (entry.samples.size <= MAX_CACHED_POINTS) return
    if (!watching.has(key)) entry.samples.delete(key)
  }
}
