/**
 * @fileoverview 点位绑定的换算与过滤。
 *
 * ⚠ 这一组守的两件事都属于「写错不会报错、只会在别处静默出问题」：
 * 1. 选择器列出了类型不对或不可写的点位 → 用户点了保存才被拒，等于让他猜；
 * 2. 换实例没清掉已选的点位 → 旧 node_id 属于旧实例，每分钟往一台不相干的
 *    服务器写一次。
 */
import { describe, expect, it } from 'vitest'
import type { AcModelPublication, OpcuaNode } from '@dt/contracts'

import {
  PUBLISH_STALE_TICKS,
  PUBLISH_TICK_SECONDS,
  boundCount,
  draftOf,
  durationOptions,
  emptyDraft,
  heartbeatAgeSeconds,
  isDraftDirty,
  isDraftFullyBound,
  isHeartbeatStale,
  orphanedBindings,
  recommendationOptions,
  toPublicationInput,
} from '@/features/hvac/publication'

const INSTANCE = 'inst-1'
const KEYS = ['K11', 'K11+K12']
const NOW = Date.parse('2026-08-15T10:00:00.000Z')

function node(over: Partial<OpcuaNode> = {}): OpcuaNode {
  return {
    id: 'node-1',
    instance_id: INSTANCE,
    parent_id: null,
    node_class: 'variable',
    identifier: 'Temp',
    identifier_kind: 'string',
    node_id: 'ns=2;s=Temp',
    browse_name: 'Temp',
    data_type: 'double',
    value_rank: -1,
    array_dimensions: null,
    // CurrentRead | CurrentWrite
    access_level: 3,
    initial_value: null,
    description: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function publication(over: Partial<AcModelPublication> = {}) {
  return {
    model_id: 'model-1',
    opcua_instance_id: INSTANCE,
    recommendation_node_id: 'region',
    recommendation_identifier: 'Recommend',
    is_enabled: true,
    is_fully_bound: true,
    unbound_set_keys: [],
    set_bindings: [
      { set_key: 'K11', node_id: 'a', identifier: 'A', is_serving: true },
      { set_key: 'K11+K12', node_id: 'b', identifier: 'B', is_serving: true },
    ],
    last_published_at: '2026-08-15T09:59:30.000Z',
    last_status: 'ok' as const,
    last_error: null,
    ...over,
  } satisfies AcModelPublication
}

describe('可选点位的过滤', () => {
  it('区域推荐点位只列字符串型——分钟数塞不进它以外的任何类型', () => {
    const options = recommendationOptions([
      node({ id: 'text', data_type: 'string' }),
      node({ id: 'number', data_type: 'double' }),
      node({ id: 'flag', data_type: 'boolean' }),
    ])
    expect(options.map((item) => item.value)).toEqual(['text'])
  })

  it('组合时间点位只列 float/double——整数型放不下 12.4', () => {
    const options = durationOptions([
      node({ id: 'f', data_type: 'float' }),
      node({ id: 'd', data_type: 'double' }),
      node({ id: 'i', data_type: 'int32' }),
      node({ id: 's', data_type: 'string' }),
    ])
    expect(options.map((item) => item.value)).toEqual(['f', 'd'])
  })

  it('不可写的点位一个都不列——绑上去就是每分钟失败一次', () => {
    const readOnly = node({ id: 'ro', data_type: 'double', access_level: 1 })
    expect(durationOptions([readOnly])).toEqual([])
    expect(
      recommendationOptions([
        node({ id: 'ro2', data_type: 'string', access_level: 1 }),
      ]),
    ).toEqual([])
  })

  it('选项上带出完整 NodeId——现场认的是它，不是 browse name', () => {
    const options = durationOptions([
      node({ id: 'x', browse_name: 'SetA', node_id: 'ns=2;s=SetA' }),
    ])
    expect(options[0]?.label).toContain('ns=2;s=SetA')
  })
})

describe('草稿与入参', () => {
  it('已保存的配置能还原成草稿', () => {
    const draft = draftOf(publication(), KEYS)
    expect(draft.instanceId).toBe(INSTANCE)
    expect(draft.recommendationNodeId).toBe('region')
    expect(draft.setNodes).toEqual({ K11: 'a', 'K11+K12': 'b' })
  })

  it('落空的绑定不进草稿——那个键已经不在服务组合里，送回去会被拒', () => {
    const found = publication({
      set_bindings: [
        { set_key: 'K11', node_id: 'a', identifier: 'A', is_serving: true },
        { set_key: 'K99', node_id: 'z', identifier: 'Z', is_serving: false },
      ],
    })
    expect(Object.keys(draftOf(found, KEYS).setNodes)).toEqual(['K11'])
  })

  it('没选点位的组合整条不进入参——空 node_id 会被当成一个不存在的节点', () => {
    const draft = { ...emptyDraft(), instanceId: INSTANCE }
    draft.setNodes = { K11: 'a', 'K11+K12': '' }
    const input = toPublicationInput(draft, KEYS)
    expect(input.set_bindings).toEqual([{ set_key: 'K11', node_id: 'a' }])
  })

  it('没绑区域点位时送 null 而不是空串', () => {
    const input = toPublicationInput(
      { ...emptyDraft(), instanceId: INSTANCE },
      KEYS,
    )
    expect(input.recommendation_node_id).toBeNull()
  })
})

describe('绑齐没有', () => {
  it('实例 + 区域点位 + 每个组合都绑上才算绑齐', () => {
    const draft = draftOf(publication(), KEYS)
    expect(isDraftFullyBound(draft, KEYS)).toBe(true)
    expect(boundCount(draft, KEYS)).toBe(2)
  })

  it('差一个组合就不算——而「没绑齐不会发」要在页面上说出来', () => {
    const draft = draftOf(publication(), KEYS)
    draft.setNodes = { K11: 'a' }
    expect(isDraftFullyBound(draft, KEYS)).toBe(false)
    expect(boundCount(draft, KEYS)).toBe(1)
  })

  it('没有服务组合的模型不算绑齐——它没有可下发的数', () => {
    const draft = draftOf(publication(), [])
    expect(isDraftFullyBound(draft, [])).toBe(false)
  })

  it('区域点位空着，组合全绑上也不算绑齐', () => {
    const draft = draftOf(publication({ recommendation_node_id: null }), KEYS)
    expect(isDraftFullyBound(draft, KEYS)).toBe(false)
  })
})

describe('脏没脏', () => {
  it('原样还原的草稿不脏，保存按钮该是灰的', () => {
    const found = publication()
    expect(isDraftDirty(draftOf(found, KEYS), found, KEYS)).toBe(false)
  })

  it('改开关算脏', () => {
    const found = publication()
    const draft = { ...draftOf(found, KEYS), isEnabled: false }
    expect(isDraftDirty(draft, found, KEYS)).toBe(true)
  })

  it('改任一组合的点位算脏', () => {
    const found = publication()
    const draft = draftOf(found, KEYS)
    draft.setNodes = { ...draft.setNodes, K11: 'other' }
    expect(isDraftDirty(draft, found, KEYS)).toBe(true)
  })

  it('还没配过时，选了实例才算脏', () => {
    expect(isDraftDirty(emptyDraft(), null, KEYS)).toBe(false)
    expect(
      isDraftDirty({ ...emptyDraft(), instanceId: INSTANCE }, null, KEYS),
    ).toBe(true)
  })
})

describe('心跳', () => {
  it('刚发过就不算陈旧', () => {
    expect(isHeartbeatStale(publication(), NOW)).toBe(false)
  })

  it('超过三拍没动就标红——那说明这条循环停了', () => {
    const stale = new Date(
      NOW - (PUBLISH_STALE_TICKS * PUBLISH_TICK_SECONDS + 10) * 1000,
    ).toISOString()
    expect(
      isHeartbeatStale(publication({ last_published_at: stale }), NOW),
    ).toBe(true)
  })

  it('已启用且绑齐却一次都没发过，同样是陈旧', () => {
    expect(
      isHeartbeatStale(publication({ last_published_at: null }), NOW),
    ).toBe(true)
  })

  it('没启用就不判——没启用本来就不该有心跳，标红只会教人无视这个颜色', () => {
    const off = publication({ is_enabled: false, last_published_at: null })
    expect(isHeartbeatStale(off, NOW)).toBe(false)
  })

  it('没绑齐也不判——它本来就没在发', () => {
    const partial = publication({
      is_fully_bound: false,
      last_published_at: null,
    })
    expect(isHeartbeatStale(partial, NOW)).toBe(false)
  })

  it('从来没发过的年龄是 null，不是 0', () => {
    expect(heartbeatAgeSeconds(null, NOW)).toBeNull()
  })
})

describe('落空的绑定', () => {
  it('挑出 set_key 已不在服务组合里的那些——留着不删，但要标出来', () => {
    const found = publication({
      set_bindings: [
        { set_key: 'K11', node_id: 'a', identifier: 'A', is_serving: true },
        { set_key: 'K99', node_id: 'z', identifier: 'Z', is_serving: false },
      ],
    })
    expect(orphanedBindings(found).map((item) => item.set_key)).toEqual(['K99'])
  })

  it('还没配过时是空表，不是崩', () => {
    expect(orphanedBindings(null)).toEqual([])
  })
})
