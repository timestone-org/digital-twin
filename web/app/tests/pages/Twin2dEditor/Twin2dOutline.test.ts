/**
 * @fileoverview 契约：左栏大纲四段——行要摆得出可辨识信息，点选落到画布那条轴上，
 * 样式那一段落在**并行**的 `styleFocus` 轴上（两条互不清空），删/复制/层序一律经
 * ops 算出整份新配置再上抛。
 *
 * ⚠ 两条轴合成一条的话「选着一个节点、同时编着它用的样式」就成了二选一。
 * ⚠ 「恢复内置」是删掉文档里那条覆盖（§13.4）：写死内置数据之后，预置库将来升级
 * 就再也修不到这张图，而用户以为自己已经恢复了。
 * ⚠ 覆盖内置与自建两档不摆同一个按钮：自建的删掉就没了，摆成「恢复」会让用户以为
 * 它也回得来。
 * ⚠ 删一个节点会连带带走挂在它上头的连线（归一化丢弃悬空端点的整条线），只报被
 * 点名的那几个会让选中态停在一条已经不存在的连线上。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdge } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dOutline from '@/pages/Twin2dEditor/components/Twin2dOutline.vue'
import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import type { Twin2dEditorSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'

/** 一个自建的方块样式，两侧各一枚端口。 */
const STYLE = {
  id: 'box',
  name: '方块',
  category: 'misc',
  size: { w: 40, h: 20 },
  ports: [
    { id: 'a', name: 'A', at: { kind: 'xy', x: 0, y: 0.5 }, side: 'left' },
    { id: 'b', name: 'B', at: { kind: 'xy', x: 1, y: 0.5 }, side: 'right' },
  ],
}

/**
 * 三个节点（一个有显示名、一个没有、一个样式悬空）、两条连线（一条样式悬空）、
 * 两条标注，外加一份覆盖内置的连线样式与一份自建节点样式。
 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  styles: [STYLE],
  edgeStyles: [{ id: 'water', name: '改过的水流' }],
  nodes: [
    { id: 'n1', styleId: 'box', x: 100, y: 100, label: '一号泵', badge: 'P1' },
    { id: 'n2', styleId: 'box', x: 300, y: 100 },
    { id: 'n3', styleId: 'ghost', x: 500, y: 100 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'water',
      from: { nodeId: 'n1', portId: 'b' },
      to: { nodeId: 'n2', portId: 'a' },
    },
    {
      id: 'e2',
      styleId: 'nope',
      from: { nodeId: 'n2', portId: 'b' },
      to: { nodeId: 'n1', portId: 'a' },
    },
  ],
  marks: [
    { id: 'm1', kind: 'rect', x: 10, y: 400, w: 60, h: 40, zOrder: 'below' },
    { id: 'm2', kind: 'text', x: 100, y: 400, text: '机房', zOrder: 'above' },
  ],
})

/** 一份自建的连线样式，外加一条在用它的线。 */
const OWN_EDGE_STYLE: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  styles: [STYLE],
  edgeStyles: [{ id: 'my-pipe', name: '我的管道' }],
  nodes: [
    { id: 'n1', styleId: 'box', x: 100, y: 100 },
    { id: 'n2', styleId: 'box', x: 300, y: 100 },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'my-pipe',
      from: { nodeId: 'n1', portId: 'b' },
      to: { nodeId: 'n2', portId: 'a' },
    },
  ],
})

/** 一条端点悬空的连线：只有绕开归一化才进得了文档，行上要退回报 id。 */
const STRAY_EDGE: Twin2dEdge = {
  id: 'e9',
  styleId: 'water',
  from: { nodeId: 'gone', portId: '', t: null },
  to: { nodeId: 'n1', portId: '', t: null },
  route: 'auto',
  waypoints: [],
  accent: '',
  label: '',
  labelAt: 0.5,
}

interface Harness {
  wrapper: ReturnType<typeof mount>
  selection: Twin2dEditorSelection
}

function mountOutline(config: Twin2dConfig = CONFIG): Harness {
  const selection = createTwin2dSelection()
  const wrapper = mount(Twin2dOutline, { props: { config, selection } })
  return { wrapper, selection }
}

/** 最后一次上抛的整份新配置。 */
function lastChange(harness: Harness): Twin2dConfig {
  const events = harness.wrapper.emitted('change')
  if (!events?.length) throw new Error('没有上抛新配置')
  return events[events.length - 1]?.[0] as Twin2dConfig
}

/** 一行的 DOM。 */
function row(harness: Harness, key: string) {
  return harness.wrapper.get(`[data-test="outline-row-${key}"]`)
}

/** 一枚动作键。 */
function actionKey(harness: Harness, name: string) {
  return harness.wrapper.get(`[data-test="outline-${name}"]`)
}

describe('四段与行上的可辨识信息', () => {
  it('四段都在，段头报这一段有几条', () => {
    const harness = mountOutline()
    const heads = harness.wrapper.findAll('[data-test^="outline-toggle-"]')

    expect(heads.map((head) => head.text())).toEqual([
      '节点3',
      '连线2',
      '标注2',
      '样式2',
    ])
  })

  it('节点行画显示名与样式名；没有显示名就退到 id', () => {
    const harness = mountOutline()

    expect(row(harness, 'n1').text()).toContain('一号泵')
    expect(row(harness, 'n1').text()).toContain('方块')
    expect(row(harness, 'n2').text()).toContain('n2')
  })

  it('节点自己的角标进行尾的徽标', () => {
    const harness = mountOutline()

    expect(row(harness, 'n1').get('[data-test="row-badge"]').text()).toBe('P1')
  })

  it('样式悬空的节点报「样式缺失」，副名走警告色', () => {
    const harness = mountOutline()
    const note = row(harness, 'n3').get('[data-test="row-note"]')

    expect(note.text()).toBe('样式缺失 · ghost')
    expect(note.classes()).toContain('text-state-warning')
  })

  it('连线行画两端的名字与样式名，文档里改过的连线样式名说了算', () => {
    const harness = mountOutline()

    expect(row(harness, 'e1').text()).toContain('一号泵 → n2')
    expect(row(harness, 'e1').text()).toContain('改过的水流')
  })

  it('连线的样式悬空时同样报「样式缺失」', () => {
    const harness = mountOutline()

    expect(row(harness, 'e2').get('[data-test="row-note"]').text()).toBe(
      '样式缺失 · nope',
    )
  })

  it('端点悬空的连线退回报节点 id，而不是画一行空箭头', () => {
    const harness = mountOutline({ ...CONFIG, edges: [STRAY_EDGE] })

    expect(row(harness, 'e9').text()).toContain('gone → 一号泵')
  })

  it('标注行画档位与上下层，没有文字就退到 id', () => {
    const harness = mountOutline()

    expect(row(harness, 'm1').text()).toContain('m1')
    expect(row(harness, 'm1').text()).toContain('辅助框 · 节点之下')
    expect(row(harness, 'm2').text()).toContain('机房')
    expect(row(harness, 'm2').text()).toContain('文字 · 节点之上')
  })

  it('样式行标出来历：压着同 id 内置的是覆盖，别的是自建', () => {
    const harness = mountOutline()

    expect(row(harness, 'styles:box').text()).toContain('自建')
    expect(row(harness, 'edgeStyles:water').text()).toContain('覆盖内置')
  })

  it('样式行的副名点明它是哪条轴上的', () => {
    const harness = mountOutline()

    expect(row(harness, 'styles:box').text()).toContain('节点样式 · box')
    expect(row(harness, 'edgeStyles:water').text()).toContain(
      '连线样式 · water',
    )
  })

  it('没有名字的样式退到 id', () => {
    const bare = normalizeTwin2dConfig({ styles: [{ id: 'blank' }] })
    const harness = mountOutline(bare)

    expect(row(harness, 'styles:blank').text()).toContain('blank')
  })

  it('一段都没有时出空态，样式那一段还带一句去哪儿弄', () => {
    const harness = mountOutline(normalizeTwin2dConfig({}))

    expect(
      harness.wrapper.get('[data-test="outline-empty-nodes"]').text(),
    ).toContain('还没有节点')
    expect(
      harness.wrapper.get('[data-test="outline-empty-styles"]').text(),
    ).toContain('调色板')
  })
})

describe('折叠', () => {
  it('点段头收起这一段，行与动作条一起不画', async () => {
    const harness = mountOutline()
    await row(harness, 'n1').trigger('click')
    expect(
      harness.wrapper.find('[data-test="outline-actions-nodes"]').exists(),
    ).toBe(true)

    await harness.wrapper
      .get('[data-test="outline-toggle-nodes"]')
      .trigger('click')

    expect(harness.wrapper.find('[data-test="outline-row-n1"]').exists()).toBe(
      false,
    )
    expect(
      harness.wrapper.find('[data-test="outline-actions-nodes"]').exists(),
    ).toBe(false)
    expect(harness.wrapper.find('[data-test="outline-row-e1"]').exists()).toBe(
      true,
    )
  })

  it('再点一下又展开', async () => {
    const harness = mountOutline()
    const head = harness.wrapper.get('[data-test="outline-toggle-nodes"]')

    await head.trigger('click')
    await head.trigger('click')

    expect(head.attributes('aria-expanded')).toBe('true')
    expect(harness.wrapper.find('[data-test="outline-row-n1"]').exists()).toBe(
      true,
    )
  })
})

describe('两条选中轴并行', () => {
  it('点一行顶替这一类的整条轴，Ctrl 点加选', async () => {
    const harness = mountOutline()

    await row(harness, 'n1').trigger('click')
    expect(harness.selection.idsOf('nodes')).toEqual(['n1'])

    await row(harness, 'n2').trigger('click', { ctrlKey: true })
    expect(harness.selection.idsOf('nodes')).toEqual(['n1', 'n2'])

    await row(harness, 'n2').trigger('click')
    expect(harness.selection.idsOf('nodes')).toEqual(['n2'])
  })

  it('选中的行落 aria-pressed', async () => {
    const harness = mountOutline()

    await row(harness, 'm1').trigger('click')

    expect(row(harness, 'm1').attributes('aria-pressed')).toBe('true')
    expect(row(harness, 'm2').attributes('aria-pressed')).toBe('false')
  })

  it('点样式那一段落到 styleFocus 上，画布那条轴一个都不掉', async () => {
    const harness = mountOutline()
    await row(harness, 'n1').trigger('click')

    await row(harness, 'styles:box').trigger('click')

    expect(harness.selection.styleFocus.value).toEqual({
      kind: 'styles',
      id: 'box',
    })
    expect(harness.selection.idsOf('nodes')).toEqual(['n1'])
  })

  it('反过来点画布那一段也不清掉正在编的样式', async () => {
    const harness = mountOutline()
    await row(harness, 'edgeStyles:water').trigger('click')

    await row(harness, 'e1').trigger('click')

    expect(harness.selection.styleFocus.value).toEqual({
      kind: 'edgeStyles',
      id: 'water',
    })
    expect(harness.selection.idsOf('edges')).toEqual(['e1'])
  })
})

describe('动作条', () => {
  it('这一段没选中就没有动作条', () => {
    const harness = mountOutline()

    expect(
      harness.wrapper.find('[data-test="outline-actions-nodes"]').exists(),
    ).toBe(false)
  })

  it('选中之后只有这一段出动作条，并报选中几个', async () => {
    const harness = mountOutline()

    await row(harness, 'n1').trigger('click')
    await row(harness, 'n2').trigger('click', { ctrlKey: true })

    expect(
      harness.wrapper.get('[data-test="outline-actions-nodes"]').text(),
    ).toContain('选中 2')
    expect(
      harness.wrapper.find('[data-test="outline-actions-edges"]').exists(),
    ).toBe(false)
  })

  it('复制一批节点：副本按一格栅格错开，选中随即转到副本上', async () => {
    const harness = mountOutline()
    await row(harness, 'n1').trigger('click')

    await actionKey(harness, 'copy-nodes').trigger('click')

    const next = lastChange(harness)
    const fresh = next.nodes.filter(
      (node) => !CONFIG.nodes.some((old) => old.id === node.id),
    )
    expect(fresh).toHaveLength(1)
    expect(fresh[0]?.x).toBe(120)
    expect(harness.selection.idsOf('nodes')).toEqual([fresh[0]?.id])
  })

  it('复制连线不给位移——线的位置由两端定，偏移会替用户写出一条折线', async () => {
    const harness = mountOutline()
    await row(harness, 'e1').trigger('click')

    await actionKey(harness, 'copy-edges').trigger('click')

    const next = lastChange(harness)
    expect(next.edges).toHaveLength(3)
    expect(next.edges[2]?.waypoints).toEqual([])
  })

  it('复制标注也按一格栅格错开', async () => {
    const harness = mountOutline()
    await row(harness, 'm1').trigger('click')

    await actionKey(harness, 'copy-marks').trigger('click')

    const next = lastChange(harness)
    expect(next.marks).toHaveLength(3)
    expect(next.marks[1]?.x).toBe(30)
  })

  it('删节点连带带走挂在它上头的连线', async () => {
    const harness = mountOutline()
    await row(harness, 'n1').trigger('click')

    await actionKey(harness, 'remove-nodes').trigger('click')

    const next = lastChange(harness)
    expect(next.nodes.map((node) => node.id)).toEqual(['n2', 'n3'])
    expect(next.edges).toEqual([])
  })

  it('删连线不动节点', async () => {
    const harness = mountOutline()
    await row(harness, 'e1').trigger('click')

    await actionKey(harness, 'remove-edges').trigger('click')

    const next = lastChange(harness)
    expect(next.edges.map((edge) => edge.id)).toEqual(['e2'])
    expect(next.nodes).toHaveLength(3)
  })

  it('删标注不级联', async () => {
    const harness = mountOutline()
    await row(harness, 'm2').trigger('click')

    await actionKey(harness, 'remove-marks').trigger('click')

    expect(lastChange(harness).marks.map((mark) => mark.id)).toEqual(['m1'])
  })

  it('四档层序各自把文档序挪成该有的样子', async () => {
    const moves = [
      ['front-nodes', ['n2', 'n3', 'n1']],
      ['back-nodes', ['n1', 'n2', 'n3']],
      ['forward-nodes', ['n2', 'n1', 'n3']],
      ['backward-nodes', ['n1', 'n2', 'n3']],
    ] as const

    for (const [key, order] of moves) {
      const harness = mountOutline()
      await row(harness, 'n1').trigger('click')
      await actionKey(harness, key).trigger('click')

      expect(lastChange(harness).nodes.map((node) => node.id)).toEqual(order)
    }
  })

  it('层序对连线与标注一样走得通', async () => {
    const harness = mountOutline()
    await row(harness, 'e1').trigger('click')
    await actionKey(harness, 'front-edges').trigger('click')
    expect(lastChange(harness).edges.map((edge) => edge.id)).toEqual([
      'e2',
      'e1',
    ])

    await row(harness, 'm1').trigger('click')
    await actionKey(harness, 'front-marks').trigger('click')
    expect(lastChange(harness).marks.map((mark) => mark.id)).toEqual([
      'm2',
      'm1',
    ])
  })
})

describe('样式那一段的动作', () => {
  it('轴上空着时一枚键都不出', () => {
    const harness = mountOutline()

    expect(
      harness.wrapper.find('[data-test="outline-actions-styles"]').exists(),
    ).toBe(false)
  })

  it('压着内置 id 的那一档给「恢复内置」，自建的那一档给「删除」', async () => {
    const harness = mountOutline()

    await row(harness, 'edgeStyles:water').trigger('click')
    expect(actionKey(harness, 'restore-styles').attributes('aria-label')).toBe(
      '恢复内置',
    )
    expect(
      harness.wrapper.find('[data-test="outline-remove-styles"]').exists(),
    ).toBe(false)

    await row(harness, 'styles:box').trigger('click')
    expect(
      harness.wrapper.find('[data-test="outline-restore-styles"]').exists(),
    ).toBe(false)
    expect(
      actionKey(harness, 'remove-styles').attributes('aria-label'),
    ).toContain('删除这份样式')
  })

  it('删除键把还有几个实体在用说出来——样式没了它们就整个不见了', async () => {
    const harness = mountOutline()

    await row(harness, 'styles:box').trigger('click')

    expect(actionKey(harness, 'remove-styles').attributes('aria-label')).toBe(
      '删除这份样式（还有 2 个在用）',
    )
  })

  it('「恢复内置」删掉的是文档里那条覆盖，不是把内置数据写死进来', async () => {
    const harness = mountOutline()
    await row(harness, 'edgeStyles:water').trigger('click')

    await actionKey(harness, 'restore-styles').trigger('click')

    const next = lastChange(harness)
    expect(next.edgeStyles).toEqual([])
    expect(next.edges.map((edge) => edge.styleId)).toContain('water')
  })

  it('删自建样式只动样式表，用它的节点留在原地等重新指认', async () => {
    const harness = mountOutline()
    await row(harness, 'styles:box').trigger('click')

    await actionKey(harness, 'remove-styles').trigger('click')

    const next = lastChange(harness)
    expect(next.styles).toEqual([])
    expect(next.nodes).toHaveLength(3)
  })

  it('复制一份样式：副本另起 id，焦点随即转到副本上', async () => {
    const harness = mountOutline()
    await row(harness, 'styles:box').trigger('click')

    await actionKey(harness, 'copy-styles').trigger('click')

    const next = lastChange(harness)
    const copy = next.styles[1]
    expect(next.styles).toHaveLength(2)
    expect(copy?.id).not.toBe('box')
    expect(copy?.name).toBe('方块')
    expect(harness.selection.styleFocus.value).toEqual({
      kind: 'styles',
      id: copy?.id,
    })
  })

  it('自建的连线样式落在「删除」那一档，也把还有几条线在用说出来', async () => {
    const harness = mountOutline(OWN_EDGE_STYLE)

    await row(harness, 'edgeStyles:my-pipe').trigger('click')

    expect(row(harness, 'edgeStyles:my-pipe').text()).toContain('自建')
    expect(actionKey(harness, 'remove-styles').attributes('aria-label')).toBe(
      '删除这份样式（还有 1 个在用）',
    )
  })

  it('连线样式那一条也复制得出来', async () => {
    const harness = mountOutline()
    await row(harness, 'edgeStyles:water').trigger('click')

    await actionKey(harness, 'copy-styles').trigger('click')

    expect(lastChange(harness).edgeStyles).toHaveLength(2)
  })
})
