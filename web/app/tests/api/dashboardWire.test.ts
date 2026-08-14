/**
 * @fileoverview 契约：出参的线形（snake_case）到载荷（camelCase）的映射逐字段窄化，
 * 认不出的绑定来源当场抛而不是静默按某一种处理。
 *
 * ⚠ `detail_json` 的键是 **snake_case**：服务端要读它里面的 `node_key` 去校验点位
 * 存在，写成 camelCase 会让校验静默跳过，于是一条指向不存在点位的历史绑定
 * 照常入库、永不产数据。
 */
import { describe, expect, it } from 'vitest'

import { TransportError } from '@/api/client'
import {
  fromArchiveDetail,
  fromHistoryRange,
  toBinding,
  toDashboard,
  toDashboardSummary,
  toHistoryRange,
  toNode,
  toProject,
  type BindingWire,
  type DashboardWire,
  type NodeWire,
} from '@/api/dashboardWire'

function bindingWire(over: Partial<BindingWire> = {}): BindingWire {
  return {
    id: 'b1',
    node_id: 'n1',
    field_key: 'value',
    source_kind: 'static',
    node_key: null,
    static_value_json: 42,
    compute_json: null,
    detail_json: null,
    transform_json: null,
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    ...over,
  }
}

function nodeWire(over: Partial<NodeWire> = {}): NodeWire {
  return {
    id: 'n1',
    dashboard_id: 'db1',
    parent_id: null,
    client_key: null,
    module_type: 'demo',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z_index: 5,
    is_visible: true,
    config_json: { title: '标题' },
    created_at: '',
    updated_at: '',
    bindings: [bindingWire()],
    ...over,
  }
}

function dashboardWire(over: Partial<DashboardWire> = {}): DashboardWire {
  return {
    id: 'db1',
    project_id: 'p1',
    name: '总览',
    description: null,
    design_width: 1920,
    design_height: 1080,
    row_version: 3,
    schema_version: 1,
    is_public: false,
    node_count: 1,
    created_at: '',
    updated_at: '',
    theme_json: { accent: '#101010' },
    chrome_json: {},
    nodes: [nodeWire()],
    ...over,
  }
}

describe('绑定', () => {
  it('字段名转成 camelCase，取值原样带过来', () => {
    expect(toBinding(bindingWire())).toMatchObject({
      id: 'b1',
      nodeId: 'n1',
      fieldKey: 'value',
      sourceKind: 'static',
      staticValueJson: 42,
    })
  })

  it('认不出的来源当场抛——出现第五种值意味着两侧的清单漂了', () => {
    expect(() => toBinding(bindingWire({ source_kind: 'opuca' }))).toThrow(
      TransportError,
    )
  })

  it('派生规格的运算符认不出时给 null，由求值层说清为什么', () => {
    expect(
      toBinding(
        bindingWire({
          source_kind: 'computed',
          compute_json: { op: 'nope', inputs: ['a'] },
        }),
      ).computeJson,
    ).toBeNull()
  })

  it('派生规格带小数位时保留，不带就不写这个键', () => {
    const withPrecision = toBinding(
      bindingWire({
        source_kind: 'computed',
        compute_json: { op: 'avg', inputs: ['a', 'b'], precision: 2 },
      }),
    )
    const without = toBinding(
      bindingWire({
        source_kind: 'computed',
        compute_json: { op: 'avg', inputs: ['a'] },
      }),
    )

    expect(withPrecision.computeJson).toEqual({
      op: 'avg',
      inputs: ['a', 'b'],
      precision: 2,
    })
    expect(without.computeJson?.precision).toBeUndefined()
  })

  it('派生规格的 inputs 只留字符串', () => {
    expect(
      toBinding(
        bindingWire({
          source_kind: 'computed',
          compute_json: { op: 'sum', inputs: ['a', 7, null] },
        }),
      ).computeJson?.inputs,
    ).toEqual(['a'])
  })

  it('定值变换的三项逐个窄化成有限数，脏值给 null', () => {
    expect(
      toBinding(
        bindingWire({
          transform_json: { scale: 2, offset: 'oops', round: 1 },
        }),
      ).transformJson,
    ).toEqual({ scale: 2, offset: null, round: 1 })
  })

  it('历史取数说明按 snake_case 的 node_key 读，缺了就给 null', () => {
    expect(
      toBinding(
        bindingWire({
          source_kind: 'archive',
          detail_json: { node_key: 's1:t1', range: { last_window: '1h' } },
        }),
      ).detailJson,
    ).toEqual({ nodeKey: 's1:t1', range: { lastWindow: '1h' } })

    expect(
      toBinding(
        bindingWire({ source_kind: 'archive', detail_json: { range: {} } }),
      ).detailJson,
    ).toBeNull()
  })
})

describe('时间范围', () => {
  it('四种边界逐项窄化，缺席的键不写进对象', () => {
    expect(
      toHistoryRange({
        from_ms: 1,
        to_ms: 2,
        last_window: '7d',
        limit: 100,
      }),
    ).toEqual({ fromMs: 1, toMs: 2, lastWindow: '7d', limit: 100 })
    expect(toHistoryRange({})).toEqual({})
    expect(toHistoryRange('nope')).toEqual({})
  })

  it('空的相对窗按没给处理', () => {
    expect(toHistoryRange({ last_window: '' })).toEqual({})
  })

  it('写回线形时同样只写给了的键', () => {
    expect(fromHistoryRange({ lastWindow: '1h' })).toEqual({
      last_window: '1h',
    })
    expect(fromHistoryRange({ fromMs: 1, toMs: 2, limit: 3 })).toEqual({
      from_ms: 1,
      to_ms: 2,
      limit: 3,
    })
  })

  it('取数说明写回去时键是 snake_case', () => {
    expect(
      fromArchiveDetail({ nodeKey: 's1:t1', range: { lastWindow: '1h' } }),
    ).toEqual({ node_key: 's1:t1', range: { last_window: '1h' } })
  })
})

describe('节点与大屏', () => {
  it('节点的几何与配置原样带过来，绑定跟着转', () => {
    expect(toNode(nodeWire())).toMatchObject({
      id: 'n1',
      dashboardId: 'db1',
      zIndex: 5,
      isVisible: true,
      configJson: { title: '标题' },
    })
    expect(toNode(nodeWire()).bindings[0]?.fieldKey).toBe('value')
  })

  it('大屏带上主题、外观与整棵节点树', () => {
    const payload = toDashboard(dashboardWire())

    expect(payload).toMatchObject({
      id: 'db1',
      rowVersion: 3,
      schemaVersion: 1,
      themeJson: { accent: '#101010' },
    })
    expect(payload.nodes).toHaveLength(1)
  })

  it('公开令牌恒为 null——一期不开公开分享面，编一个会让「已公开」看上去是真的', () => {
    expect(toDashboard(dashboardWire()).publicToken).toBeNull()
  })

  it('列表项只带规模，不带节点树', () => {
    expect(toDashboardSummary(dashboardWire())).toMatchObject({
      nodeCount: 1,
      designWidth: 1920,
    })
  })

  it('项目带上它下面有几张大屏', () => {
    expect(
      toProject({
        id: 'p1',
        name: '园区',
        description: null,
        theme_json: {},
        brand_json: {},
        dashboard_count: 4,
        created_at: '',
        updated_at: '',
      }),
    ).toMatchObject({ id: 'p1', dashboardCount: 4 })
  })
})
