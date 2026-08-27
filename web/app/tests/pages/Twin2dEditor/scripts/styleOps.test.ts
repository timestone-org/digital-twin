/**
 * @fileoverview 契约：样式的增删改与复制、样式内部三张小表的增删改，全是纯函数，
 * 改完再归一化不变形。
 *
 * ⚠ 改一个**还没被覆盖过的内置样式**必须在文档里落一份同 id 的覆盖，
 * 而「恢复内置」必须是把那条覆盖**删掉**——写死预置数据的话，预置库将来升级就再也
 * 修不到这张图，而用户以为自己已经恢复了。
 * ⚠ 什么都没改时必须原样返回入参那个引用：文档态按引用判要不要压一帧撤销。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  normalizeTwin2dConfig,
  twin2dStyleResolver,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import type { Twin2dIdFactory } from '@/pages/Twin2dEditor/scripts/nodeOps'
import {
  addEdgeStyle,
  addNodeStyle,
  addPort,
  addSlot,
  addVariant,
  duplicateEdgeStyle,
  duplicateNodeStyle,
  orderVariants,
  removeEdgeStyle,
  removeNodeStyle,
  removePort,
  removeSlot,
  removeVariant,
  restoreBuiltinEdgeStyle,
  restoreBuiltinNodeStyle,
  twin2dEdgeStyleOf,
  twin2dEdgeStyleOrigin,
  twin2dEdgeStyleUsage,
  twin2dNodeStyleOf,
  twin2dNodeStyleOrigin,
  twin2dNodeStyleUsage,
  updateEdgeStyle,
  updateNodeStyle,
  updatePort,
  updateSlot,
  updateVariant,
  writeEdgeStyle,
  writeNodeStyle,
} from '@/pages/Twin2dEditor/scripts/styleOps'

/** 一个真存在的预置节点样式 id；改名了这条断言会先红。 */
const BUILTIN_NODE = 'circuit-resistor'
/** 一个真存在的预置连线样式 id。 */
const BUILTIN_EDGE = 'steam'

/** 造 id 的桩：按调用次序发号且带上真实前缀，用例才断言得出具体的 id。 */
function idSeq(): Twin2dIdFactory {
  let seq = 0
  return (prefix) => {
    seq += 1
    return `${prefix}-${seq}`
  }
}

function configOf(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [{ id: 'custom', name: '自建', size: { w: 40, h: 20 } }],
    edgeStyles: [{ id: 'my-wire', name: '我的线' }],
    nodes: [
      { id: 'n1', styleId: 'custom' },
      { id: 'n2', styleId: BUILTIN_NODE },
      { id: 'n3', styleId: 'custom' },
    ],
    edges: [
      {
        id: 'e1',
        styleId: 'my-wire',
        from: { nodeId: 'n1' },
        to: { nodeId: 'n2' },
      },
      {
        id: 'e2',
        styleId: BUILTIN_EDGE,
        from: { nodeId: 'n2' },
        to: { nodeId: 'n3' },
      },
    ],
  })
}

/** 当下生效的那一份节点样式；取不到就让用例当场红。 */
function styleOf(config: Twin2dConfig, id: string): Twin2dNodeStyle {
  const style = twin2dNodeStyleOf(config, id)
  if (style === null) throw new Error(`样式 ${id} 不在`)
  return style
}

function styleIds(config: Twin2dConfig): string[] {
  return config.styles.map((style) => style.id)
}

describe('样式来路', () => {
  it('预置库里有而文档里没有的是内置', () => {
    expect(twin2dNodeStyleOrigin(configOf(), BUILTIN_NODE)).toBe('builtin')
    expect(twin2dEdgeStyleOrigin(configOf(), BUILTIN_EDGE)).toBe('builtin')
  })

  it('两边都有的是覆盖', () => {
    const base = styleOf(configOf(), BUILTIN_NODE)
    const next = writeNodeStyle(configOf(), { ...base, name: '改过的' })

    expect(twin2dNodeStyleOrigin(next, BUILTIN_NODE)).toBe('override')
  })

  it('只有文档里有的是自建', () => {
    expect(twin2dNodeStyleOrigin(configOf(), 'custom')).toBe('custom')
    expect(twin2dEdgeStyleOrigin(configOf(), 'my-wire')).toBe('custom')
  })

  it('哪儿都没有的是缺席', () => {
    expect(twin2dNodeStyleOrigin(configOf(), '没有这个')).toBe('missing')
    expect(twin2dEdgeStyleOrigin(configOf(), '没有这个')).toBe('missing')
  })
})

describe('取当下生效的那一份', () => {
  it('节点样式与包里的解析器同一条口径', () => {
    const config = writeNodeStyle(configOf(), {
      ...styleOf(configOf(), BUILTIN_NODE),
      name: '改过的',
    })
    const resolve = twin2dStyleResolver(config)

    expect(twin2dNodeStyleOf(config, BUILTIN_NODE)).toBe(resolve(BUILTIN_NODE))
    expect(twin2dNodeStyleOf(config, 'custom')).toBe(resolve('custom'))
    expect(twin2dNodeStyleOf(config, '没有这个')).toBeNull()
  })

  it('连线样式也是文档优先、落不到才回预置库', () => {
    const config = configOf()

    expect(twin2dEdgeStyleOf(config, 'my-wire')?.name).toBe('我的线')
    expect(twin2dEdgeStyleOf(config, BUILTIN_EDGE)?.id).toBe(BUILTIN_EDGE)
    expect(twin2dEdgeStyleOf(config, '没有这个')).toBeNull()
  })
})

describe('新建与复制', () => {
  it('新建的节点样式追加在末尾并交出新 id', () => {
    const added = addNodeStyle(configOf(), { name: '新的' }, idSeq())

    expect(added.id).toBe('style-1')
    expect(styleIds(added.config)).toEqual(['custom', 'style-1'])
  })

  it('缺省交给归一化补，不在这里抄一份', () => {
    const added = addNodeStyle(configOf(), { name: '新的' }, idSeq())
    const style = added.config.styles.at(-1)

    expect(style?.defaultStatus).toBe('online')
    expect(style?.size.w).toBeGreaterThan(0)
    expect(style?.prims).toEqual([])
  })

  it('复制内置样式 = 另存为自定义：换个 id，其余逐字相同', () => {
    const source = styleOf(configOf(), BUILTIN_NODE)
    const added = duplicateNodeStyle(configOf(), source, idSeq())
    const copy = added.config.styles.at(-1)

    expect(added.id).toBe(`${BUILTIN_NODE}-1`)
    expect(copy).toEqual({ ...source, id: `${BUILTIN_NODE}-1` })
  })

  it('复制不动预置库里的那一份', () => {
    const source = styleOf(configOf(), BUILTIN_NODE)
    duplicateNodeStyle(configOf(), source, idSeq())

    expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(BUILTIN_NODE)).toEqual(source)
  })

  it('复制内置连线样式也是换个 id、其余逐字相同', () => {
    const source = twin2dEdgeStyleOf(configOf(), BUILTIN_EDGE)
    const copied =
      source === null ? null : duplicateEdgeStyle(configOf(), source, idSeq())

    expect(copied?.id).toBe(`${BUILTIN_EDGE}-1`)
    expect(copied?.config.edgeStyles.at(-1)).toEqual({
      ...source,
      id: `${BUILTIN_EDGE}-1`,
    })
  })

  it('新建与复制之后再归一化不变形', () => {
    const added = addNodeStyle(configOf(), { name: '新的' }, idSeq())
    const source = styleOf(added.config, BUILTIN_NODE)
    const copied = duplicateNodeStyle(added.config, source, idSeq())

    expect(normalizeTwin2dConfig(added.config)).toEqual(added.config)
    expect(normalizeTwin2dConfig(copied.config)).toEqual(copied.config)
  })

  it('新建的连线样式追加在末尾', () => {
    const added = addEdgeStyle(configOf(), { name: '新线' }, idSeq())

    expect(added.id).toBe('edge-style-1')
    expect(added.config.edgeStyles.map((style) => style.id)).toEqual([
      'my-wire',
      'edge-style-1',
    ])
  })
})

describe('改字段', () => {
  it('文档里已有的就地换掉，不新增条目', () => {
    const config = configOf()
    const next = updateNodeStyle(config, styleOf(config, 'custom'), {
      name: '改过的',
    })

    expect(styleIds(next)).toEqual(['custom'])
    expect(next.styles.at(0)?.name).toBe('改过的')
  })

  it('改内置样式 = 在文档里落一份同 id 的覆盖', () => {
    const config = configOf()
    const next = updateNodeStyle(config, styleOf(config, BUILTIN_NODE), {
      accent: 'var(--state-warning)',
    })

    expect(styleIds(next)).toEqual(['custom', BUILTIN_NODE])
    expect(twin2dNodeStyleOrigin(next, BUILTIN_NODE)).toBe('override')
    expect(twin2dNodeStyleOf(next, BUILTIN_NODE)?.accent).toBe(
      'var(--state-warning)',
    )
  })

  it('改值不过归一化，用户敲的空格留得住', () => {
    const config = configOf()
    const next = updateNodeStyle(config, styleOf(config, 'custom'), {
      name: '一号 ',
    })

    expect(next.styles.at(0)?.name).toBe('一号 ')
  })

  it('连线样式改字段也落同 id 的覆盖', () => {
    const config = configOf()
    const base = twin2dEdgeStyleOf(config, BUILTIN_EDGE)
    const next =
      base === null ? config : updateEdgeStyle(config, base, { name: '改过的' })

    expect(next.edgeStyles.map((style) => style.id)).toEqual([
      'my-wire',
      BUILTIN_EDGE,
    ])
    expect(twin2dEdgeStyleOf(next, BUILTIN_EDGE)?.name).toBe('改过的')
  })

  it('整份写回认同 id：有就换掉，没有才追加', () => {
    const config = configOf()
    const mine = twin2dEdgeStyleOf(config, 'my-wire')
    const swapped =
      mine === null ? config : writeEdgeStyle(config, { ...mine, name: '换过' })
    const appended =
      mine === null
        ? config
        : writeEdgeStyle(config, { ...mine, id: '另一条', name: '另一条' })

    expect(swapped.edgeStyles.map((style) => style.id)).toEqual(['my-wire'])
    expect(swapped.edgeStyles.at(0)?.name).toBe('换过')
    expect(appended.edgeStyles.map((style) => style.id)).toEqual([
      'my-wire',
      '另一条',
    ])
  })
})

describe('删样式与恢复内置', () => {
  it('恢复内置就是把那条覆盖删掉，样式表里不再有那个 id', () => {
    const config = configOf()
    const covered = updateNodeStyle(config, styleOf(config, BUILTIN_NODE), {
      name: '改过的',
    })
    const restored = restoreBuiltinNodeStyle(covered, BUILTIN_NODE)

    expect(styleIds(covered)).toContain(BUILTIN_NODE)
    expect(styleIds(restored)).not.toContain(BUILTIN_NODE)
    expect(styleIds(restored)).toEqual(['custom'])
  })

  it('恢复内置不把预置数据写进文档，节点仍解析得到样式', () => {
    const config = configOf()
    const covered = updateNodeStyle(config, styleOf(config, BUILTIN_NODE), {
      name: '改过的',
    })
    const restored = restoreBuiltinNodeStyle(covered, BUILTIN_NODE)

    expect(twin2dNodeStyleOf(restored, BUILTIN_NODE)).toEqual(
      TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(BUILTIN_NODE),
    )
  })

  it('对自建样式点恢复内置一步都不动', () => {
    const config = configOf()

    expect(restoreBuiltinNodeStyle(config, 'custom')).toBe(config)
    expect(restoreBuiltinEdgeStyle(config, 'my-wire')).toBe(config)
  })

  it('没有覆盖时恢复内置也原样返回入参那个引用', () => {
    const config = configOf()

    expect(restoreBuiltinNodeStyle(config, BUILTIN_NODE)).toBe(config)
    expect(restoreBuiltinEdgeStyle(config, BUILTIN_EDGE)).toBe(config)
  })

  it('连线样式的恢复内置同样是删覆盖', () => {
    const config = configOf()
    const base = twin2dEdgeStyleOf(config, BUILTIN_EDGE)
    const covered =
      base === null ? config : updateEdgeStyle(config, base, { name: '改过的' })
    const restored = restoreBuiltinEdgeStyle(covered, BUILTIN_EDGE)

    expect(restored.edgeStyles.map((style) => style.id)).toEqual(['my-wire'])
  })

  it('删自建样式要报出会因此悬空的那些节点', () => {
    const removal = removeNodeStyle(configOf(), 'custom')

    expect(styleIds(removal.config)).toEqual([])
    expect(removal.dangling).toEqual(['n1', 'n3'])
  })

  it('删的是内置覆盖时一个实体都不悬空', () => {
    const config = configOf()
    const covered = updateNodeStyle(config, styleOf(config, BUILTIN_NODE), {
      name: '改过的',
    })
    const removal = removeNodeStyle(covered, BUILTIN_NODE)

    expect(removal.dangling).toEqual([])
    expect(twin2dNodeStyleOf(removal.config, BUILTIN_NODE)).not.toBeNull()
  })

  it('删不存在的样式原样返回入参那个引用', () => {
    const config = configOf()

    expect(removeNodeStyle(config, '没有这个').config).toBe(config)
    expect(removeEdgeStyle(config, '没有这个').config).toBe(config)
  })

  it('删连线样式报出会悬空的那些连线', () => {
    const removal = removeEdgeStyle(configOf(), 'my-wire')

    expect(removal.dangling).toEqual(['e1'])
  })

  it('删的是连线样式的内置覆盖时一条线都不悬空', () => {
    const config = configOf()
    const base = twin2dEdgeStyleOf(config, BUILTIN_EDGE)
    const covered =
      base === null ? config : updateEdgeStyle(config, base, { name: '改过的' })
    const removal = removeEdgeStyle(covered, BUILTIN_EDGE)

    expect(removal.dangling).toEqual([])
    expect(twin2dEdgeStyleOf(removal.config, BUILTIN_EDGE)).not.toBeNull()
  })
})

describe('谁在引用', () => {
  it('按样式 id 数出节点与连线', () => {
    const config = configOf()

    expect(twin2dNodeStyleUsage(config, 'custom')).toEqual(['n1', 'n3'])
    expect(twin2dNodeStyleUsage(config, BUILTIN_NODE)).toEqual(['n2'])
    expect(twin2dEdgeStyleUsage(config, BUILTIN_EDGE)).toEqual(['e2'])
    expect(twin2dNodeStyleUsage(config, '没有这个')).toEqual([])
  })
})

describe('端口', () => {
  it('不点名 id 就现造一个', () => {
    const config = configOf()
    const added = addPort(config, styleOf(config, 'custom'), {}, idSeq())

    expect(added.id).toBe('port-1')
    expect(added.config.styles.at(0)?.ports.map((port) => port.id)).toEqual([
      'port-1',
    ])
  })

  it('点名的 id 就用点名的那个', () => {
    const config = configOf()
    const added = addPort(
      config,
      styleOf(config, 'custom'),
      { id: 'GND', name: 'GND' },
      idSeq(),
    )

    expect(added.id).toBe('GND')
  })

  it('点名的 id 撞了就加不进去，配置原样返回', () => {
    const config = configOf()
    const once = addPort(
      config,
      styleOf(config, 'custom'),
      { id: 'A' },
      idSeq(),
    )
    const twice = addPort(
      once.config,
      styleOf(once.config, 'custom'),
      { id: 'A' },
      idSeq(),
    )

    expect(twice.id).toBeNull()
    expect(twice.config).toBe(once.config)
  })

  it('给内置样式加端口会落一份覆盖', () => {
    const config = configOf()
    const added = addPort(
      config,
      styleOf(config, BUILTIN_NODE),
      { id: 'extra' },
      idSeq(),
    )

    expect(twin2dNodeStyleOrigin(added.config, BUILTIN_NODE)).toBe('override')
    expect(
      twin2dNodeStyleOf(added.config, BUILTIN_NODE)?.ports.at(-1)?.id,
    ).toBe('extra')
  })

  it('改端口按 id 寻址，端口不在就原样返回入参那份配置', () => {
    const config = configOf()
    const added = addPort(
      config,
      styleOf(config, 'custom'),
      { id: 'A' },
      idSeq(),
    )
    const port = added.config.styles.at(0)?.ports.at(0)
    const style = styleOf(added.config, 'custom')
    const renamed =
      port === undefined
        ? added.config
        : updatePort(added.config, style, { ...port, name: '一号' })
    const missing =
      port === undefined
        ? added.config
        : updatePort(added.config, style, { ...port, id: '没有这个' })

    expect(renamed.styles.at(0)?.ports.at(0)?.name).toBe('一号')
    expect(missing).toBe(added.config)
  })

  it('删端口；删不存在的原样返回入参那份配置', () => {
    const config = configOf()
    const added = addPort(
      config,
      styleOf(config, 'custom'),
      { id: 'A' },
      idSeq(),
    )
    const style = styleOf(added.config, 'custom')

    expect(removePort(added.config, style, 'A').styles.at(0)?.ports).toEqual([])
    expect(removePort(added.config, style, '没有这个')).toBe(added.config)
  })

  it('加端口之后再归一化不变形', () => {
    const config = configOf()
    const added = addPort(
      config,
      styleOf(config, 'custom'),
      { id: 'A' },
      idSeq(),
    )

    expect(normalizeTwin2dConfig(added.config)).toEqual(added.config)
  })
})

describe('槽位', () => {
  it('新槽追加在末尾：文档序就是绑定行的行序', () => {
    const config = configOf()
    const first = addSlot(
      config,
      styleOf(config, 'custom'),
      { key: 'power' },
      idSeq(),
    )
    const second = addSlot(
      first.config,
      styleOf(first.config, 'custom'),
      { key: 'flow' },
      idSeq(),
    )

    expect(second.config.styles.at(0)?.slots.map((slot) => slot.key)).toEqual([
      'power',
      'flow',
    ])
  })

  it('不点名槽键就现造一个', () => {
    const config = configOf()
    const added = addSlot(config, styleOf(config, 'custom'), {}, idSeq())

    expect(added.id).toBe('slot-1')
  })

  it('槽键撞了就加不进去，配置原样返回', () => {
    const config = configOf()
    const once = addSlot(
      config,
      styleOf(config, 'custom'),
      { key: 'power' },
      idSeq(),
    )
    const twice = addSlot(
      once.config,
      styleOf(once.config, 'custom'),
      { key: 'power' },
      idSeq(),
    )

    expect(twice.id).toBeNull()
    expect(twice.config).toBe(once.config)
  })

  it('改槽位按键寻址，槽位不在就原样返回入参那份配置', () => {
    const config = configOf()
    const added = addSlot(
      config,
      styleOf(config, 'custom'),
      { key: 'power' },
      idSeq(),
    )
    const slot = added.config.styles.at(0)?.slots.at(0)
    const style = styleOf(added.config, 'custom')
    const labelled =
      slot === undefined
        ? added.config
        : updateSlot(added.config, style, { ...slot, label: '有功功率' })
    const missing =
      slot === undefined
        ? added.config
        : updateSlot(added.config, style, { ...slot, key: '没有这个' })

    expect(labelled.styles.at(0)?.slots.at(0)?.label).toBe('有功功率')
    expect(missing).toBe(added.config)
  })

  it('删槽位；删不存在的原样返回入参那份配置', () => {
    const config = configOf()
    const added = addSlot(
      config,
      styleOf(config, 'custom'),
      { key: 'power' },
      idSeq(),
    )
    const style = styleOf(added.config, 'custom')

    expect(
      removeSlot(added.config, style, 'power').styles.at(0)?.slots,
    ).toEqual([])
    expect(removeSlot(added.config, style, '没有这个')).toBe(added.config)
  })
})

describe('变体', () => {
  /** 一条认得出的条件。 */
  const WHEN = { kind: 'state', state: 'hover' } as const

  it('条件认不出就加不进去，配置原样返回', () => {
    const config = configOf()
    const added = addVariant(config, styleOf(config, 'custom'), {}, idSeq())

    expect(added.id).toBeNull()
    expect(added.config).toBe(config)
  })

  it('新变体追加在末尾：文档序就是覆盖序', () => {
    const config = configOf()
    const first = addVariant(
      config,
      styleOf(config, 'custom'),
      { when: WHEN },
      idSeq(),
    )
    const second = addVariant(
      first.config,
      styleOf(first.config, 'custom'),
      { when: WHEN },
      idSeq(),
    )

    expect(
      second.config.styles.at(0)?.variants.map((variant) => variant.id),
    ).toEqual(['variant-1', 'variant-2'])
  })

  it('改变体按 id 寻址，不在就原样返回入参那份配置', () => {
    const config = configOf()
    const added = addVariant(
      config,
      styleOf(config, 'custom'),
      { when: WHEN },
      idSeq(),
    )
    const variant = added.config.styles.at(0)?.variants.at(0)
    const style = styleOf(added.config, 'custom')
    const lifted =
      variant === undefined
        ? added.config
        : updateVariant(added.config, style, {
            ...variant,
            rootPatch: { lift: 3 },
          })
    const missing =
      variant === undefined
        ? added.config
        : updateVariant(added.config, style, { ...variant, id: '没有这个' })

    expect(lifted.styles.at(0)?.variants.at(0)?.rootPatch).toEqual({ lift: 3 })
    expect(missing).toBe(added.config)
  })

  it('删变体；删不存在的原样返回入参那份配置', () => {
    const config = configOf()
    const added = addVariant(
      config,
      styleOf(config, 'custom'),
      { when: WHEN },
      idSeq(),
    )
    const style = styleOf(added.config, 'custom')

    expect(
      removeVariant(added.config, style, 'variant-1').styles.at(0)?.variants,
    ).toEqual([])
    expect(removeVariant(added.config, style, '没有这个')).toBe(added.config)
  })

  it('调次序就是调覆盖序；已经到顶再上移原样返回入参那份配置', () => {
    const config = configOf()
    const first = addVariant(
      config,
      styleOf(config, 'custom'),
      { when: WHEN },
      idSeq(),
    )
    const second = addVariant(
      first.config,
      styleOf(first.config, 'custom'),
      { when: WHEN },
      idSeq(),
    )
    const style = styleOf(second.config, 'custom')
    const moved = orderVariants(second.config, style, 'variant-1', 'front')

    expect(moved.styles.at(0)?.variants.map((variant) => variant.id)).toEqual([
      'variant-2',
      'variant-1',
    ])
    expect(orderVariants(second.config, style, 'variant-2', 'front')).toBe(
      second.config,
    )
  })
})

describe('只动点名的那一条', () => {
  /** 两条样式、两条连线样式、样式里三张小表各两条。 */
  function pairsConfig(): Twin2dConfig {
    return normalizeTwin2dConfig({
      styles: [
        { id: 's1', name: '一号' },
        {
          id: 's2',
          name: '二号',
          ports: [{ id: 'p1' }, { id: 'p2' }],
          slots: [{ key: 'k1' }, { key: 'k2' }],
          variants: [
            { id: 'v1', when: { kind: 'state', state: 'hover' } },
            { id: 'v2', when: { kind: 'state', state: 'selected' } },
          ],
        },
      ],
      edgeStyles: [
        { id: 'w1', name: '一号线' },
        { id: 'w2', name: '二号线' },
      ],
    })
  }

  it('样式表里别的条目连引用都不换', () => {
    const config = pairsConfig()
    const style = styleOf(config, 's2')
    const edge = twin2dEdgeStyleOf(config, 'w2')
    const next = writeNodeStyle(config, { ...style, name: '换过' })
    const nextEdge =
      edge === null ? config : writeEdgeStyle(config, { ...edge, name: '换过' })

    expect(next.styles.at(0)).toBe(config.styles.at(0))
    expect(next.styles.at(1)?.name).toBe('换过')
    expect(nextEdge.edgeStyles.at(0)).toBe(config.edgeStyles.at(0))
    expect(nextEdge.edgeStyles.at(1)?.name).toBe('换过')
  })

  it('端口、槽位与变体三张表里别的条目也连引用都不换', () => {
    const config = pairsConfig()
    const style = styleOf(config, 's2')
    const port = style.ports.at(1)
    const slot = style.slots.at(1)
    const variant = style.variants.at(1)
    const withPort =
      port === undefined
        ? config
        : updatePort(config, style, { ...port, name: '换过' })
    const withSlot =
      slot === undefined
        ? config
        : updateSlot(config, style, { ...slot, label: '换过' })
    const withVariant =
      variant === undefined
        ? config
        : updateVariant(config, style, { ...variant, rootPatch: { lift: 2 } })

    expect(styleOf(withPort, 's2').ports.at(0)).toBe(style.ports.at(0))
    expect(styleOf(withPort, 's2').ports.at(1)?.name).toBe('换过')
    expect(styleOf(withSlot, 's2').slots.at(0)).toBe(style.slots.at(0))
    expect(styleOf(withSlot, 's2').slots.at(1)?.label).toBe('换过')
    expect(styleOf(withVariant, 's2').variants.at(0)).toBe(style.variants.at(0))
    expect(styleOf(withVariant, 's2').variants.at(1)?.rootPatch).toEqual({
      lift: 2,
    })
  })
})
