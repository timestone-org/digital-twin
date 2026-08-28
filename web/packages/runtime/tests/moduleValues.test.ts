/**
 * @fileoverview 守绑定求值：数组槽展开回行数组、定值变换与 enum 映射按声明生效、
 * 派生槽迭代求解（派生可以引用派生）、成环诚实给 null 并说出原因，
 * 以及取不到的槽**不注入值**——空值冒充「没数据」正是本仓要消灭的静默故障。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  computeModuleValues,
  injectFieldValue,
  resolveBindingSpec,
  type BindingSlot,
  type BindingValueReader,
} from '../src/moduleValues'
import { fakeBinding } from '../src/testing/fixtures'

const ROWS_SPEC: BindingSpec = {
  key: 'rows',
  label: '行',
  dataType: 'number',
  isArray: true,
  arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
}

const MODE_SPEC: BindingSpec = {
  key: 'mode',
  label: '状态',
  dataType: 'enum',
  enumMap: { 0: '停机', 1: '运行' },
}

/** 按槽键给定结果的读取器；没给的槽当作还在等首帧。 */
function readerOf(slots: Record<string, BindingSlot>): BindingValueReader {
  return (binding) => slots[binding.fieldKey] ?? { state: 'pending' }
}

describe('注入袋', () => {
  it('普通槽键直写', () => {
    const values: Record<string, unknown> = {}

    injectFieldValue(values, 'power', 12)

    expect(values).toEqual({ power: 12 })
  })

  it('数组槽展开成行对象数组', () => {
    const values: Record<string, unknown> = {}

    injectFieldValue(values, 'rows[0].value', 1)
    injectFieldValue(values, 'rows[1].value', 2)
    injectFieldValue(values, 'rows[0].label', '一号机')

    expect(values).toEqual({
      rows: [{ value: 1, label: '一号机' }, { value: 2 }],
    })
  })

  it('不带子键的数组槽直接落在行上', () => {
    const values: Record<string, unknown> = {}

    injectFieldValue(values, 'rows[0]', 5)

    expect(values).toEqual({ rows: [5] })
  })
})

describe('槽声明的解析', () => {
  it('数组行的子槽解析到行内声明', () => {
    expect(resolveBindingSpec([ROWS_SPEC], 'rows[3].value')?.dataType).toBe(
      'number',
    )
  })

  it('不带子键时解析到数组槽本身', () => {
    expect(resolveBindingSpec([ROWS_SPEC], 'rows[3]')?.key).toBe('rows')
  })

  it('清单里没有这个槽就是没有', () => {
    expect(resolveBindingSpec([ROWS_SPEC], 'ghost')).toBeUndefined()
  })
})

describe('取到的值', () => {
  it('定值变换按乘、加、取整的次序生效', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'power',
          sourceKind: 'opcua',
          transformJson: { scale: 0.1, offset: 1, round: 2 },
        }),
      ],
      read: readerOf({ power: { state: 'ok', value: 123.456 } }),
    })

    expect(result.values).toEqual({ power: 13.35 })
  })

  it('没写取整位数就不取整，乘加照做', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'power',
          sourceKind: 'opcua',
          transformJson: { scale: 3 },
        }),
      ],
      read: readerOf({ power: { state: 'ok', value: 1.5 } }),
    })

    expect(result.values).toEqual({ power: 4.5 })
  })

  it('字符串数值不参与变换：后端的精确小数是字符串，转成数再算是有损的', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'flow',
          sourceKind: 'opcua',
          transformJson: { scale: 2 },
        }),
      ],
      read: readerOf({ flow: { state: 'ok', value: '12.345' } }),
    })

    expect(result.values).toEqual({ flow: '12.345' })
  })

  it('enum 槽按清单的映射换成语义值，映射外的数值原样保留', () => {
    const read = readerOf({
      mode: { state: 'ok', value: 1 },
      spare: { state: 'ok', value: 7 },
    })

    const result = computeModuleValues({
      specs: [MODE_SPEC, { ...MODE_SPEC, key: 'spare' }],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'mode', sourceKind: 'opcua' }),
        fakeBinding({ id: 'b2', fieldKey: 'spare', sourceKind: 'opcua' }),
      ],
      read,
    })

    expect(result.values).toEqual({ mode: '运行', spare: 7 })
  })

  it('取最新的采样时刻，几条绑定里取最大的那个', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'a', sourceKind: 'opcua' }),
        fakeBinding({ id: 'b2', fieldKey: 'b', sourceKind: 'opcua' }),
      ],
      read: readerOf({
        a: { state: 'ok', value: 1, timestampMs: 100 },
        b: { state: 'ok', value: 2, timestampMs: 300 },
      }),
    })

    expect(result.valueTimeMs).toBe(300)
  })

  it('一条时刻都没有时是 null，不拿当前墙钟顶替', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'a', sourceKind: 'static' }),
      ],
      read: readerOf({ a: { state: 'ok', value: 1 } }),
    })

    expect(result.valueTimeMs).toBeNull()
  })
})

describe('取不到的槽', () => {
  it('失败的槽不注入值，原因逐槽记下来', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'power', sourceKind: 'archive' }),
      ],
      read: readerOf({
        power: { state: 'error', message: '归档服务超时' },
      }),
    })

    expect(result.values).toEqual({})
    expect(result.errors).toEqual({ power: '归档服务超时' })
    expect(result.tally).toEqual({
      bound: 1,
      ok: 0,
      sampled: 0,
      empty: 0,
      pending: 0,
      error: 1,
    })
  })

  it('等首帧的槽既不注入值也不算失败', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'power', sourceKind: 'opcua' }),
      ],
      read: readerOf({}),
    })

    expect(result.values).toEqual({})
    expect(result.tally.pending).toBe(1)
  })

  it('很久没变的值照常注入，也照常算成取到了', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'power', sourceKind: 'opcua' }),
      ],
      read: readerOf({
        power: { state: 'ok', value: 42, timestampMs: 1_700_000_000_000 },
      }),
    })

    expect(result.values).toEqual({ power: 42 })
    expect(result.tally.ok).toBe(1)
    expect(result.tally.sampled).toBe(1)
    expect(result.valueTimeMs).toBe(1_700_000_000_000)
  })

  it('⚠ 带采样时刻的才计进 sampled：常量槽通道断了也不会过期', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'title', sourceKind: 'static' }),
      ],
      read: readerOf({ title: { state: 'ok', value: '一号线' } }),
    })

    expect(result.tally.ok).toBe(1)
    expect(result.tally.sampled).toBe(0)
  })

  it('取到空值的槽不计进 sampled：屏上没有它可显示的东西', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'power', sourceKind: 'opcua' }),
      ],
      read: readerOf({ power: { state: 'ok', value: null, timestampMs: 17 } }),
    })

    expect(result.tally.sampled).toBe(0)
  })

  it('取到的空值算「绑了但没有值」，不算取不到', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'power', sourceKind: 'opcua' }),
      ],
      read: readerOf({ power: { state: 'ok', value: null } }),
    })

    expect(result.values).toEqual({ power: null })
    expect(result.tally.empty).toBe(1)
    expect(result.tally.error).toBe(0)
  })
})

/** 只认识 sum 与 product 的读取器：派生槽用兄弟值算，缺输入就诚实给 null。 */
const arithmeticReader: BindingValueReader = (binding, siblings) => {
  const spec = binding.computeJson
  if (spec === null) {
    return { state: 'ok', value: binding.staticValueJson }
  }
  const numbers = spec.inputs
    .map((key) => siblings[key])
    .filter((value): value is number => typeof value === 'number')
  if (numbers.length !== spec.inputs.length) return { state: 'ok', value: null }
  const seed = spec.op === 'sum' ? 0 : 1
  return {
    state: 'ok',
    value: numbers.reduce(
      (total, value) => (spec.op === 'sum' ? total + value : total * value),
      seed,
    ),
  }
}

describe('逐槽结论', () => {
  it('三档各记一条，键就是 fieldKey', () => {
    const bindings = [
      fakeBinding({ id: 'b1', fieldKey: 'a', sourceKind: 'opcua' }),
      fakeBinding({ id: 'b2', fieldKey: 'b', sourceKind: 'opcua' }),
      fakeBinding({ id: 'b3', fieldKey: 'c', sourceKind: 'opcua' }),
    ]

    const result = computeModuleValues({
      specs: [],
      bindings,
      read: readerOf({
        a: { state: 'ok', value: 1, timestampMs: 1700 },
        b: { state: 'error', message: '快照读不到' },
      }),
    })

    expect(result.slots).toEqual({
      a: { state: 'ok', timestampMs: 1700 },
      b: { state: 'error', message: '快照读不到' },
      c: { state: 'pending' },
    })
  })

  it('没配来源的槽压根不在里面——「没接」与「接了取不到」因此分得开', () => {
    const result = computeModuleValues({
      specs: [ROWS_SPEC],
      bindings: [],
      read: readerOf({}),
    })

    expect(result.slots).toEqual({})
  })

  it('没有采样时刻时不编一个：那一列是判断现场动没动的唯一依据', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'a', sourceKind: 'static' }),
      ],
      read: readerOf({ a: { state: 'ok', value: 7 } }),
    })

    expect(result.slots.a).toEqual({ state: 'ok' })
  })
})

describe('派生槽', () => {
  it('拿得到同节点内已求值的兄弟槽', () => {
    // ⚠ 兄弟袋是同一个对象，逐次求值就地填；要比对每次调用时的样子只能当场复制一份
    const seen: Array<Record<string, unknown>> = []
    const read: BindingValueReader = (binding, siblings) => {
      seen.push({ ...siblings })
      return arithmeticReader(binding, siblings)
    }

    computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'a',
          sourceKind: 'static',
          staticValueJson: 3,
        }),
        fakeBinding({
          id: 'b2',
          fieldKey: 'total',
          sourceKind: 'computed',
          computeJson: { op: 'sum', inputs: ['a'] },
        }),
      ],
      read,
    })

    expect(seen).toEqual([{}, { a: 3 }])
  })

  it('派生引用派生时按依赖迭代求解，声明顺序不影响结果', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b3',
          fieldKey: 'total',
          sourceKind: 'computed',
          computeJson: { op: 'sum', inputs: ['a', 'double'] },
        }),
        fakeBinding({
          id: 'b2',
          fieldKey: 'double',
          sourceKind: 'computed',
          computeJson: { op: 'product', inputs: ['a', 'a'] },
        }),
        fakeBinding({
          id: 'b1',
          fieldKey: 'a',
          sourceKind: 'static',
          staticValueJson: 3,
        }),
      ],
      read: arithmeticReader,
    })

    expect(result.values).toEqual({ a: 3, double: 9, total: 12 })
  })

  it('成环的一圈诚实给 null，并把原因写进逐槽错误', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'x',
          sourceKind: 'computed',
          computeJson: { op: 'sum', inputs: ['y'] },
        }),
        fakeBinding({
          id: 'b2',
          fieldKey: 'y',
          sourceKind: 'computed',
          computeJson: { op: 'sum', inputs: ['x'] },
        }),
      ],
      read: arithmeticReader,
    })

    expect(result.values).toEqual({ x: null, y: null })
    expect(Object.keys(result.errors)).toEqual(['x', 'y'])
    expect(result.tally.error).toBe(2)
  })

  it('只引用自己的派生槽不算成环，按缺输入求值', () => {
    const result = computeModuleValues({
      specs: [],
      bindings: [
        fakeBinding({
          id: 'b1',
          fieldKey: 'x',
          sourceKind: 'computed',
          computeJson: { op: 'sum', inputs: ['x'] },
        }),
      ],
      read: arithmeticReader,
    })

    expect(result.values).toEqual({ x: null })
    expect(result.errors).toEqual({})
  })
})

describe('enum 映射的键口径', () => {
  it('⚠ 后端来的映射是字符串键，数值读数照样查得到', () => {
    // enum_map 在 JSON 里的键永远是字符串，这里原样模拟收到的形状
    const spec: BindingSpec = {
      key: 'mode',
      label: '状态',
      dataType: 'enum',
      enumMap: { '0': '离线', '1': '运行' },
    }
    const read = readerOf({ mode: { state: 'ok', value: 1 } })

    const result = computeModuleValues({
      specs: [spec],
      bindings: [
        fakeBinding({ id: 'b1', fieldKey: 'mode', sourceKind: 'opcua' }),
      ],
      read,
    })

    expect(result.values).toEqual({ mode: '运行' })
  })
})
