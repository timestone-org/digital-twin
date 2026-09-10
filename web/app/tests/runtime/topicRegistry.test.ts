/** @fileoverview 服务端撤回主题时先删除订阅再通知组件。 */
import { expect, it, vi } from 'vitest'
import { createTopicRegistry } from '@/runtime/topicRegistry'

it('notifies subscribers after removing the revoked topic', () => {
  const registry = createTopicRegistry()
  const unavailable = vi.fn(() => {
    expect(registry.topics()).toEqual([])
  })
  const handler = Object.assign(() => undefined, { onUnavailable: unavailable })
  registry.add('collect:source', handler)
  registry.forget('collect:source')
  expect(unavailable).toHaveBeenCalledOnce()
  expect(registry.listeners('collect:source')).toEqual([])
})
