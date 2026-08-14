/**
 * @fileoverview 主题 → 订阅者的本地登记表，与连接的生命周期解耦。
 *
 * 拆出来是因为它有自己的不变量（最后一个订阅者走才退订、服务端单方面退订时
 * 本地要跟着删），而这些与「socket 怎么重连」无关，混在一起两边都不好测。
 */

export type TopicHandler = (payload: Record<string, unknown>) => void

export interface TopicRegistry {
  /** 登记一个订阅者；返回 true 表示这是该主题的第一个，调用方该发 subscribe。 */
  add: (topic: string, handler: TopicHandler) => boolean
  /** 摘掉一个订阅者；返回 true 表示没人看了，调用方该发 unsubscribe。 */
  remove: (topic: string, handler: TopicHandler) => boolean
  /** 服务端单方面退订：整条抹掉，不再重订也不再分发。 */
  forget: (topic: string) => void
  /** 当前登记的全部主题，重连后据它重订。 */
  topics: () => string[]
  /** 某主题的订阅者快照。 */
  listeners: (topic: string) => TopicHandler[]
  clear: () => void
}

/** 造一张空的登记表。 */
export function createTopicRegistry(): TopicRegistry {
  const handlers = new Map<string, Set<TopicHandler>>()
  return {
    add(topic, handler) {
      const existing = handlers.get(topic)
      if (existing !== undefined) {
        existing.add(handler)
        return false
      }
      handlers.set(topic, new Set([handler]))
      return true
    },
    remove(topic, handler) {
      const bucket = handlers.get(topic)
      if (bucket === undefined) return false
      bucket.delete(handler)
      // ⚠ 还有人在看时不许退订：退了另一半页面会静默停更
      if (bucket.size > 0) return false
      handlers.delete(topic)
      return true
    },
    forget(topic) {
      handlers.delete(topic)
    },
    topics() {
      return [...handlers.keys()]
    },
    listeners(topic) {
      return [...(handlers.get(topic) ?? [])]
    },
    clear() {
      handlers.clear()
    },
  }
}
