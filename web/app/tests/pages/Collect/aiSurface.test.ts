/** @fileoverview 采集助手区分启用与运行，源凭据与连接参数不进入模型。 */
import { expect, it } from 'vitest'
import { createCollectSurface } from '@/pages/Collect/scripts/aiSurface'

it('快照仅提供配置和最近运行证据，拒绝业务写入', async () => {
  const source = {
    id: 'source',
    name: '测试源',
    code: 'test',
    protocol: 'opcua' as const,
    read_mode: 'subscribe' as const,
    is_enabled: true,
    point_count: 10,
    endpoint: 'secret-endpoint',
    username: 'secret-user',
    options_json: { token: 'secret-token' },
    runtime: {
      state: 'online' as const,
      point_count: 8,
      error_category: null,
      error_detail: null,
      leader_instance: null,
      updated_at: '2026-10-22T01:00:00Z',
    },
  }
  const surface = createCollectSurface(() => source)
  const snapshot = surface.snapshot()
  expect(snapshot['selected_source']).toMatchObject({
    configured_points: 10,
    runtime: { reported_points: 8 },
  })
  expect(JSON.stringify(snapshot)).not.toContain('secret-')
  await expect(
    surface.run({ call_id: 'c', name: 'collect.write', arguments: {} }),
  ).rejects.toThrow(/没有实现/)
  expect(createCollectSurface(() => null).snapshot()).toEqual({
    selected_source: null,
  })
})
