/** @fileoverview 导入前只检查本屏联动位置，按旧引用汇总需要管理员确认的规则。 */
import { describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'
import { useInteractionMapping } from '@/pages/Home/scripts/useInteractionMapping'
import type { DashboardExportPayload, ExportNodePayload } from '@dt/contracts'
import { inspectImportInteractions } from '@/features/dashboard/importInteractions'

const legacy = '0195d258-1d43-7a6c-806c-092dddc12e1e'
function node(clientKey: string): ExportNodePayload {
  return {
    clientKey,
    parentClientKey: null,
    moduleType: 'indicator-card',
    x: 0,
    y: 0,
    w: 50,
    h: 30,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    bindings: [],
  }
}
function pack(
  interactions: unknown,
  keys: string[] = ['source', 'display'],
): DashboardExportPayload {
  return {
    schemaVersion: 3,
    name: '合成包',
    description: null,
    designWidth: 1280,
    designHeight: 720,
    themeJson: { arbitrary: legacy },
    chromeJson: { interactions, other: { target: legacy } },
    nodes: keys.map(node),
  }
}
const source = { nodeId: { client_key: 'source' }, event: 'click' }
const local = { client_key: 'display' }
describe('本屏节点的导入对照', () => {
  it('汇总多条规则与同一旧节点的各处使用，跨屏及规则值保留', () => {
    const p = pack([
      {
        id: 'r1',
        source: { nodeId: legacy, event: 'click' },
        action: { type: 'show', targets: [legacy, legacy, local] },
      },
      {
        id: 'r2',
        source,
        action: {
          type: 'setActive',
          groups: [
            { value: 'not-a-node', targets: [legacy, 'display'] },
            { value: legacy, targets: [] },
          ],
        },
      },
      { id: 'r3', source, action: { type: 'openModal', target: 'unmapped' } },
      {
        id: 'r4',
        source,
        action: { type: 'navigate', target: 'cross-screen-id' },
      },
      {
        id: 'r5',
        source,
        action: {
          type: 'navigateByValue',
          routes: [{ value: legacy, target: { dashboard_id: legacy } }],
        },
      },
      { id: 'r6', source, action: { type: 'hide', targets: [local] } },
      { id: 'r7', source, action: { type: 'toggle', targets: ['display'] } },
    ])
    const retained = JSON.stringify(p)
    const review = inspectImportInteractions(p)
    expect(review.references.map((item) => item.value)).toEqual([
      legacy,
      'unmapped',
    ])
    expect(review.references[0]?.uses).toHaveLength(3)
    expect(review.references[1]?.uses).toHaveLength(1)
    expect(review.problems).toEqual([])
    expect(JSON.stringify(p)).toBe(retained)
  })
  it.each([
    legacy,
    legacy.toUpperCase(),
    legacy.replaceAll('-', ''),
    'urn:uuid:' + legacy,
    '{' + legacy + '}',
  ])('旧 UUID 不能仅凭与稳定键的文字相同猜配：%s', (id) => {
    const review = inspectImportInteractions(
      pack([{ source: { nodeId: id }, action: { type: 'closeModal' } }], [id]),
    )
    expect(review.references.map((item) => item.value)).toEqual([id])
  })
  it('显式标记必须准确指向唯一包内节点，无法修正的标记阻止导入', () => {
    const p = pack(
      [
        {
          source,
          action: {
            type: 'show',
            targets: [
              { client_key: 'missing' },
              { client_key: 'display', label: 'extra' },
              { client_key: 'duplicate' },
            ],
          },
        },
      ],
      ['source', 'display', 'duplicate', 'duplicate'],
    )
    const review = inspectImportInteractions(p)
    expect(review.problems.length).toBeGreaterThan(0)
    expect(review.options.map((item) => item.value)).toEqual([
      'source',
      'display',
    ])
    expect(review.references).toEqual([])
  })
  it('没有联动、唯一稳定键和完好的新式标记都不要求手选', () => {
    const review = inspectImportInteractions(
      pack([
        {
          source: { nodeId: 'source' },
          action: { type: 'openModal', target: local },
        },
      ]),
    )
    expect(review.references).toEqual([])
    expect(review.problems).toEqual([])
    expect(inspectImportInteractions(pack(undefined)).references).toEqual([])
  })
})

describe('已知联动字段形状', () => {
  it.each([
    ['非数组规则表', { invalid: true }],
    ['规则不是对象', [null]],
    ['触发源缺节点', [{ source: { event: 'click' } }]],
    ['触发源不是对象', [{ source: [] }]],
    ['触发节点不是引用', [{ source: { nodeId: false } }]],
    ['显示目标必须为数组', [{ action: { type: 'show', targets: 'display' } }]],
    ['隐藏目标缺失', [{ action: { type: 'hide' } }]],
    ['切换目标为 null', [{ action: { type: 'toggle', targets: null } }]],
    ['激活组不是数组', [{ action: { type: 'setActive', groups: {} } }]],
    ['组缺目标', [{ action: { type: 'setActive', groups: [{}] } }]],
    [
      '组目标不是数组',
      [{ action: { type: 'setActive', groups: [{ targets: 'display' }] } }],
    ],
    ['组不是对象', [{ action: { type: 'setActive', groups: [null] } }]],
    ['弹窗缺目标', [{ action: { type: 'openModal' } }]],
  ])('%s 阻止提交', (label, interactions) => {
    expect(
      inspectImportInteractions(pack(interactions)).problems.length,
      label,
    ).toBeGreaterThan(0)
  })
  it('未识别的动作扩展原样保留，继续核对本屏触发源', () => {
    const review = inspectImportInteractions(
      pack([
        {
          source: { nodeId: legacy },
          action: {
            type: 'customExtension',
            targets: 45,
            payload: { opaque: true },
          },
        },
      ]),
    )
    expect(review.problems).toEqual([])
    expect(review.references.map((x) => x.value)).toEqual([legacy])
  })
})

it('仅发送当前待匹配的旧引用，已直配、额外键、无效目标与更换之前的选择都不会发送', () => {
  const payload = ref(
    pack([
      {
        source: { nodeId: legacy },
        action: { type: 'show', targets: ['extra-old', 'display'] },
      },
    ]),
  )
  const scope = effectScope()
  try {
    const review = scope.run(() => useInteractionMapping(() => payload.value))
    if (review === undefined) throw new Error('联动作用域未启动')
    review.choose('phantom', 'display')
    review.choose('display', 'source')
    review.choose(legacy, 'source')
    review.choose('extra-old', 'absent')
    expect(review.map.value).toBeUndefined()
    review.choose('extra-old', 'display')
    expect(review.map.value).toEqual({
      [legacy]: 'source',
      'extra-old': 'display',
    })
    payload.value = pack([{ source: { nodeId: legacy } }])
    expect(review.ready.value).toBe(false)
    review.choose(legacy, 'source')
    expect(review.map.value).toEqual({ [legacy]: 'source' })
  } finally {
    scope.stop()
  }
})
