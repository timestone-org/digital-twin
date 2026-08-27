/**
 * @fileoverview 契约：导出包逐字段窄化后才进内存，写回磁盘与写进请求体的都是线形。
 *
 * ⚠ 包可能来自用户随手挑的一个文件，缺字段、错类型必须在这一层就说「形状不对」，
 * 而不是放行到渲染层再崩。
 * ⚠ 包里不许出现任何 id：父子关系只由 `client_key` / `parent_key` 表达，
 * 带 id 的包导回同一个库会让「导入」变成「悄悄改掉源屏」。
 * ⚠ 线形字段名以后端 openapi 为准：这里的夹具要是跟着前端实现写，
 * 两边同错也全绿，真后端却按 extra_forbidden 打回。
 */
import { describe, expect, it } from 'vitest'

import { TransportError } from '@/api/client'
import {
  fromExportPackage,
  parseExportPackage,
  toImportResult,
  type DashboardImportWire,
} from '@/api/dashboardTransferWire'

function bindingWire(over: Record<string, unknown> = {}): unknown {
  return {
    field_key: 'value',
    source_kind: 'static',
    node_key: null,
    static_value_json: 42,
    compute_json: null,
    detail_json: null,
    transform_json: null,
    ...over,
  }
}

function nodeWire(over: Record<string, unknown> = {}): unknown {
  return {
    client_key: 'k1',
    parent_key: null,
    module_type: 'demo',
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    z_index: 5,
    is_visible: true,
    config_json: { title: '标题' },
    bindings: [bindingWire()],
    ...over,
  }
}

function packageWire(over: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    name: '总览',
    description: null,
    design_width: 1920,
    design_height: 1080,
    theme_json: { accent: '#101010' },
    chrome_json: {},
    nodes: [nodeWire()],
    ...over,
  }
}

describe('整包窄化', () => {
  it('线形字段转成 camelCase，节点与绑定跟着转', () => {
    const payload = parseExportPackage(packageWire())

    expect(payload).toMatchObject({
      schemaVersion: 1,
      name: '总览',
      designWidth: 1920,
      designHeight: 1080,
      themeJson: { accent: '#101010' },
    })
    expect(payload.nodes[0]).toMatchObject({
      clientKey: 'k1',
      parentClientKey: null,
      moduleType: 'demo',
      zIndex: 5,
      isVisible: true,
    })
    expect(payload.nodes[0]?.bindings[0]).toMatchObject({
      fieldKey: 'value',
      sourceKind: 'static',
      staticValueJson: 42,
    })
  })

  it('顶层不是对象时当场抛', () => {
    expect(() => parseExportPackage(null)).toThrow(TransportError)
    expect(() => parseExportPackage([])).toThrow(TransportError)
    expect(() => parseExportPackage('{}')).toThrow(TransportError)
  })

  it('缺必填字段时当场抛，报的位置能指到那一项', () => {
    expect(() => parseExportPackage(packageWire({ name: undefined }))).toThrow(
      /name/,
    )
    expect(() =>
      parseExportPackage(packageWire({ schema_version: '1' })),
    ).toThrow(/schema_version/)
    expect(() =>
      parseExportPackage(packageWire({ nodes: [nodeWire({ x: null })] })),
    ).toThrow(/nodes\[0\]\.x/)
  })

  it('节点缺 client_key 时当场抛——父子关系全靠它，缺了树就重建不出来', () => {
    expect(() =>
      parseExportPackage(
        packageWire({ nodes: [nodeWire({ client_key: undefined })] }),
      ),
    ).toThrow(/client_key/)
  })

  it('认不出的绑定来源当场抛，不静默按某一种处理', () => {
    expect(() =>
      parseExportPackage(
        packageWire({
          nodes: [
            nodeWire({ bindings: [bindingWire({ source_kind: 'opuca' })] }),
          ],
        }),
      ),
    ).toThrow(TransportError)
  })

  it('缺席的可选项走缺省：描述给 null，显隐按可见，JSON blob 给空对象', () => {
    const payload = parseExportPackage(
      packageWire({
        description: undefined,
        theme_json: undefined,
        chrome_json: undefined,
        nodes: [
          nodeWire({
            is_visible: undefined,
            config_json: undefined,
            bindings: undefined,
          }),
        ],
      }),
    )

    expect(payload.description).toBeNull()
    expect(payload.themeJson).toEqual({})
    expect(payload.chromeJson).toEqual({})
    expect(payload.nodes[0]).toMatchObject({
      isVisible: true,
      configJson: {},
      bindings: [],
    })
  })

  it('可选项给了错类型仍然抛——「缺省」只对缺席与 null 生效', () => {
    expect(() =>
      parseExportPackage(packageWire({ theme_json: 'nope' })),
    ).toThrow(/theme_json/)
    expect(() =>
      parseExportPackage(packageWire({ nodes: [nodeWire({ is_visible: 1 })] })),
    ).toThrow(/is_visible/)
    expect(() => parseExportPackage(packageWire({ nodes: 'nope' }))).toThrow(
      /nodes/,
    )
  })

  it('派生规格与取数说明按绑定那套口径窄化', () => {
    const payload = parseExportPackage(
      packageWire({
        nodes: [
          nodeWire({
            bindings: [
              bindingWire({
                source_kind: 'archive',
                detail_json: {
                  node_key: 's1:t1',
                  range: { last_window: '1h' },
                },
                compute_json: { op: 'nope', inputs: ['a'] },
                transform_json: { scale: 2, offset: 'oops', round: null },
              }),
            ],
          }),
        ],
      }),
    )

    expect(payload.nodes[0]?.bindings[0]).toMatchObject({
      detailJson: { nodeKey: 's1:t1', range: { lastWindow: '1h' } },
      computeJson: null,
      transformJson: { scale: 2, offset: null, round: null },
    })
  })
})

describe('整包写回线形', () => {
  it('键名全部回到 snake_case——落盘的必须是与后端互换的那份形状', () => {
    const wire = fromExportPackage(parseExportPackage(packageWire()))

    expect(Object.keys(wire).sort()).toEqual([
      'chrome_json',
      'description',
      'design_height',
      'design_width',
      'name',
      'nodes',
      'schema_version',
      'theme_json',
    ])
  })

  it('父子关系读写的都是后端的 parent_key——写别的名字后端按 extra_forbidden 打回', () => {
    const payload = parseExportPackage(
      packageWire({ nodes: [nodeWire({ parent_key: 'k0' })] }),
    )
    expect(payload.nodes[0]?.parentClientKey).toBe('k0')

    const node = (fromExportPackage(payload).nodes as unknown[])[0]
    expect(node).toMatchObject({ parent_key: 'k0' })
    expect(Object.keys(node as Record<string, unknown>)).not.toContain(
      'parent_client_key',
    )
  })

  it('旧版前端落盘的 parent_client_key 仍读得回——那批文件当时导不进去，别再废一次', () => {
    const legacy = nodeWire({ parent_key: undefined }) as Record<
      string,
      unknown
    >
    legacy.parent_client_key = 'k0'
    const payload = parseExportPackage(packageWire({ nodes: [legacy] }))

    expect(payload.nodes[0]?.parentClientKey).toBe('k0')
  })

  it('原样往返：窄化再写回，与进来时逐字段相同', () => {
    const original = packageWire({
      nodes: [
        nodeWire({
          parent_key: 'k0',
          bindings: [
            bindingWire({
              source_kind: 'computed',
              node_key: 's1:t1',
              compute_json: { op: 'avg', inputs: ['a', 'b'], precision: 2 },
              transform_json: { scale: 2, offset: 1, round: 0 },
            }),
          ],
        }),
      ],
    })

    expect(fromExportPackage(parseExportPackage(original))).toEqual(original)
  })

  it('历史取数说明写回去时键是 snake_case，没有说明就写 null', () => {
    const withDetail = fromExportPackage(
      parseExportPackage(
        packageWire({
          nodes: [
            nodeWire({
              bindings: [
                bindingWire({
                  source_kind: 'archive',
                  detail_json: { node_key: 's1:t1', range: {} },
                }),
              ],
            }),
          ],
        }),
      ),
    )
    const nodes = withDetail.nodes

    expect(nodes).toEqual([
      expect.objectContaining({
        bindings: [
          expect.objectContaining({
            detail_json: { node_key: 's1:t1', range: {} },
          }),
        ],
      }),
    ])
    expect(fromExportPackage(parseExportPackage(packageWire())).nodes).toEqual([
      expect.objectContaining({
        bindings: [expect.objectContaining({ detail_json: null })],
      }),
    ])
  })
})

describe('导入结果', () => {
  function importWire(unresolved: unknown): DashboardImportWire {
    return {
      id: 'db1',
      project_id: 'p1',
      name: '总览',
      description: null,
      design_width: 1920,
      design_height: 1080,
      row_version: 1,
      schema_version: 1,
      is_public: false,
      node_count: 0,
      created_at: '',
      updated_at: '',
      theme_json: {},
      chrome_json: {},
      nodes: [],
      unresolved_bindings: unresolved,
    }
  }

  it('大屏整包照常转，告警清单逐条转', () => {
    const result = toImportResult(
      importWire([
        {
          node_key: 's1:t1',
          field_key: 'value',
          source_kind: 'opcua',
          reason: '点位不存在',
        },
      ]),
    )

    expect(result.id).toBe('db1')
    expect(result.unresolvedBindings).toEqual([
      {
        nodeKey: 's1:t1',
        fieldKey: 'value',
        sourceKind: 'opcua',
        reason: '点位不存在',
      },
    ])
  })

  it('告警里没见过的来源名照样带出来——导入已经落库了，为它把整份结果打回等于谎报失败', () => {
    expect(
      toImportResult(
        importWire([
          { node_key: 's1:t1', field_key: 'value', source_kind: 'opuca' },
        ]),
      ).unresolvedBindings,
    ).toEqual([
      { nodeKey: 's1:t1', fieldKey: 'value', sourceKind: 'opuca', reason: '' },
    ])
  })

  it('读不懂的告警条目丢掉，其余照常给出', () => {
    expect(
      toImportResult(
        importWire([
          null,
          { field_key: 'value' },
          {
            node_key: 's1:t1',
            field_key: 'v',
            source_kind: 'opcua',
            reason: 'x',
          },
        ]),
      ).unresolvedBindings,
    ).toHaveLength(1)
  })

  it('告警缺来源与原因时给空串，条目本身仍然列出来', () => {
    expect(
      toImportResult(importWire([{ node_key: 's1:t1', field_key: 'value' }]))
        .unresolvedBindings,
    ).toEqual([
      { nodeKey: 's1:t1', fieldKey: 'value', sourceKind: '', reason: '' },
    ])
  })

  it('告警清单不是数组时按空处理，不让整张屏渲染不出来', () => {
    expect(toImportResult(importWire(undefined)).unresolvedBindings).toEqual([])
    expect(toImportResult(importWire('nope')).unresolvedBindings).toEqual([])
  })
})
