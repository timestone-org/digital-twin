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
  fromBindingDetail,
  toBindingDetail,
  fromComputeSpec,
  fromHistoryRange,
  fromTransform,
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

  it('派生规格的 inputs 只留字符串，整个不是数组时给空', () => {
    expect(
      toBinding(
        bindingWire({
          source_kind: 'computed',
          compute_json: { op: 'sum', inputs: ['a', 7, null] },
        }),
      ).computeJson?.inputs,
    ).toEqual(['a'])

    expect(
      toBinding(
        bindingWire({
          source_kind: 'computed',
          compute_json: { op: 'sum', inputs: 'a' },
        }),
      ).computeJson?.inputs,
    ).toEqual([])
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

  it('点位历史的取数说明写回去时键是 snake_case', () => {
    expect(
      fromBindingDetail({ nodeKey: 's1:t1', range: { lastWindow: '1h' } }),
    ).toEqual({ node_key: 's1:t1', range: { last_window: '1h' } })
  })

  it('台账的取数说明写出的是 dataset_key，不是 node_key', () => {
    expect(
      fromBindingDetail({
        datasetKey: 'ds:energy_log:进水量',
        range: { lastWindow: '1h' },
      }),
    ).toEqual({
      dataset_key: 'ds:energy_log:进水量',
      range: { last_window: '1h' },
    })
  })

  it('分桶的桶宽存进去再读回来不丢', () => {
    const detail = {
      nodeKey: 's1:t1',
      range: { lastWindow: '24h' },
      interval: '15m',
    }

    const wire = fromBindingDetail(detail)

    expect(wire.interval).toBe('15m')
    expect(toBindingDetail(wire)).toEqual(detail)
  })

  it('分桶的聚合档存进去再读回来不丢', () => {
    // ⚠ 档位不是装饰：拿 avg 去读一条累积曲线画出来的是压扁了的假线，
    // 而数值本身完全合法——丢掉这个键在图上看不出任何异常
    const detail = {
      nodeKey: 's1:kwh',
      range: { lastWindow: '7d' },
      aggregate: 'max' as const,
    }

    const wire = fromBindingDetail(detail)

    expect(wire.aggregate).toBe('max')
    expect(toBindingDetail(wire)).toEqual(detail)
  })

  it('日界对齐的时区存进去再读回来不丢', () => {
    const detail = {
      nodeKey: 's1:t1',
      range: { lastWindow: '365d' },
      timezone: 'Asia/Shanghai',
    }

    const wire = fromBindingDetail(detail)

    expect(wire.timezone).toBe('Asia/Shanghai')
    expect(toBindingDetail(wire)).toEqual(detail)
  })

  it('三项都没配时一个键都不写出去，别把缺席写成 null', () => {
    const wire = fromBindingDetail({
      nodeKey: 's1:t1',
      range: { lastWindow: '1h' },
    })

    expect(Object.keys(wire).sort()).toEqual(['node_key', 'range'])
  })

  it('认不出的聚合档按没配处理，不原样带进载荷', () => {
    // detail_json 是自由 JSONB，手编进去的 avgg 照样入库；原样喂给聚合端点
    // 换回来的是一个没头没尾的 422
    expect(toBindingDetail({ node_key: 's1:t1', aggregate: 'avgg' })).toEqual({
      nodeKey: 's1:t1',
      range: {},
    })
  })

  it('空串的桶宽与时区按没配处理', () => {
    expect(
      toBindingDetail({ node_key: 's1:t1', interval: '', timezone: '' }),
    ).toEqual({ nodeKey: 's1:t1', range: {} })
  })

  it('台账那一支不长这三项', () => {
    // ⚠ 台账 `:series` 端点没有桶宽、档位与时区三个参数，写出去就是配得出来、
    // 存得下、取数时被丢掉
    const wire = fromBindingDetail({
      datasetKey: 'ds:energy_log:进水量',
      range: { lastWindow: '1h' },
    })

    expect(Object.keys(wire).sort()).toEqual(['dataset_key', 'range'])
    expect(toBindingDetail({ dataset_key: 'ds:a:b', interval: '15m' })).toEqual(
      { datasetKey: 'ds:a:b', range: {} },
    )
  })

  it('按自身形状判别是哪一支，不看 source_kind', () => {
    // ⚠ 换过来源却没清干净取数说明时，以真正躺在里面的那个字段为准——
    // 信一个可能对不上的枚举，会拿点位身份去当台账列身份用
    expect(toBindingDetail({ dataset_key: 'ds:a:b' })).toEqual({
      datasetKey: 'ds:a:b',
      range: {},
    })
    expect(toBindingDetail({ node_key: 's1:t1' })).toEqual({
      nodeKey: 's1:t1',
      range: {},
    })
    expect(toBindingDetail({ what: 1 })).toBeNull()
  })
})

describe('派生规格与定值变换写回线形', () => {
  it('派生规格带小数位时写出去，不带就不写这个键', () => {
    expect(fromComputeSpec({ op: 'avg', inputs: ['a'], precision: 2 })).toEqual(
      {
        op: 'avg',
        inputs: ['a'],
        precision: 2,
      },
    )
    expect(fromComputeSpec({ op: 'sum', inputs: ['a', 'b'] })).toEqual({
      op: 'sum',
      inputs: ['a', 'b'],
    })
  })

  it('定值变换的三项都写出去，缺席的写 null', () => {
    expect(fromTransform({ scale: 2 })).toEqual({
      scale: 2,
      offset: null,
      round: null,
    })
    expect(fromTransform({ offset: 1, round: 2 })).toEqual({
      scale: null,
      offset: 1,
      round: 2,
    })
  })

  it('没有规格 / 没有变换时给 null', () => {
    expect(fromComputeSpec(null)).toBeNull()
    expect(fromTransform(null)).toBeNull()
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

  it('载荷里没有公开令牌——详情不带这一列，补一个恒 null 的会让调用方以为读得到', () => {
    expect('publicToken' in toDashboard(dashboardWire())).toBe(false)
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
