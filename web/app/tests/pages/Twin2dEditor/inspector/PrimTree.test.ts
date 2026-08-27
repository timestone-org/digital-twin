/**
 * @fileoverview 契约：图元树摆得出层级、每行都露出 kind 与 id、选中一枚抛得出去，
 * 增删复制与层序都由 `primOps` 算出整份新配置再上抛，拖拽在**放手之前**就拦住
 * 超深与「拖进自己的子树」。
 *
 * ⚠ 深度上限拦不住的话，归一化会把超深那一层归成空数组——用户看到的是「保存之后
 * 子树没了」，而拖的时候一句提示都没有。
 * ⚠ id 是节点级覆盖补丁与变体补丁的寻址键：行上不摆 id，那两处只能靠猜。
 * ⚠ 删掉的子树里如果有当前选中的那一枚，选中必须跟着摘掉：不摘的话右栏画着一枚
 * 已经不在的图元，改哪一项都写不回去且不报错。
 * ⚠ 拖起来又放回原处不许记一帧：撤销栈上多出一格按了没反应的空步。
 */
import { TWIN_2D_MAX_PRIM_DEPTH, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle, Twin2dPrim } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import PrimTree from '@/pages/Twin2dEditor/components/inspector/PrimTree.vue'
import { TWIN_2D_PRIM_MOVE_BLOCK_LABELS } from '@/pages/Twin2dEditor/scripts/primOps'

/** 一棵三层的树：盒 a 里一枚文本与一个空盒，根层另有一枚矢量。 */
const PRIMS: readonly Record<string, unknown>[] = [
  {
    id: 'a',
    kind: 'box',
    children: [
      { id: 'a1', kind: 'txt' },
      { id: 'a2', kind: 'box', children: [] },
    ],
  },
  { id: 'b', kind: 'vec' },
]

/**
 * 一串嵌 `levels` 层的盒；`levels` 为 1 时就是一枚没有子树的盒。
 * @param levels 层数
 */
function tower(levels: number): Record<string, unknown> {
  const children = levels > 1 ? [tower(levels - 1)] : []
  return { id: `t${levels}`, kind: 'box', children }
}

/**
 * 从一份配置里取那份样式。
 * @param config 整份配置
 */
function styleOf(config: Twin2dConfig): Twin2dNodeStyle {
  const found = config.styles.find((style) => style.id === 'sty')
  if (found === undefined) throw new Error('样式不见了')
  return found
}

function mountTree(
  prims: readonly Record<string, unknown>[] = PRIMS,
  selected = '',
) {
  const config = normalizeTwin2dConfig({ styles: [{ id: 'sty', prims }] })
  return mount(PrimTree, {
    props: { config, nodeStyle: styleOf(config), selected },
  })
}

type Wrapper = ReturnType<typeof mountTree>

/** 最后一次上抛的那份配置里，这份样式的图元树。 */
function lastPrims(wrapper: Wrapper): readonly Twin2dPrim[] {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有抛出改动')
  return styleOf(events[events.length - 1]?.[0] as Twin2dConfig).prims
}

/** 每一次 `pick` 抛出去的 id。 */
function picks(wrapper: Wrapper): string[] {
  return (wrapper.emitted('pick') ?? []).map((frame) => frame[0] as string)
}

/**
 * 造一个拖拽事件；happy-dom 造不出真的 dataTransfer，塞一个够用的替身。
 * @param kind 事件名
 */
function dragEvent(kind: string): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true })
  const transfer = { setData: () => undefined, effectAllowed: '' }
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  return event
}

/**
 * 起手拖一行，悬到一道落点上，放得下就松手。
 * @param wrapper 挂好的树
 * @param from 拖的是哪一枚
 * @param to 落点的 data-test
 */
async function dragTo(
  wrapper: Wrapper,
  from: string,
  to: string,
): Promise<boolean> {
  const row = wrapper.get(`[data-test="prim-row-${from}"]`).element
  row.dispatchEvent(dragEvent('dragstart'))
  const over = dragEvent('dragover')
  const target = wrapper.get(`[data-test="${to}"]`).element
  target.dispatchEvent(over)
  if (over.defaultPrevented) target.dispatchEvent(dragEvent('drop'))
  await nextTick()
  return over.defaultPrevented
}

/** 面上那句「放不下」的说法；没有就是空串。 */
function blockedText(wrapper: Wrapper): string {
  const notice = wrapper.find('[data-test="prim-block"]')
  return notice.exists() ? notice.text() : ''
}

describe('树上摆什么', () => {
  it('每一行都摆出 kind 与 id', () => {
    const row = mountTree().get('[data-test="prim-pick-a1"]')

    expect(row.text()).toContain('文本')
    expect(row.text()).toContain('a1')
  })

  it('子树跟着父盒一起摆出来', () => {
    const wrapper = mountTree()

    expect(wrapper.find('[data-test="prim-row-a2"]').exists()).toBe(true)
  })

  it('一枚图元都没有时给一行空态', () => {
    expect(mountTree([]).find('[data-test="prim-empty"]').exists()).toBe(true)
  })

  it('空盒里也留着一道落点，装得下拖进来的东西', () => {
    const wrapper = mountTree()

    expect(wrapper.find('[data-test="prim-gap-end:a2"]').exists()).toBe(true)
  })

  it('选中的那一行有可辨的标记', () => {
    const wrapper = mountTree(PRIMS, 'b')

    expect(
      wrapper.get('[data-test="prim-pick-b"]').attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper.get('[data-test="prim-pick-a"]').attributes('aria-pressed'),
    ).toBe('false')
  })

  it('点一行就把这一枚抛出去，画布照它高亮', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-pick-a2"]').trigger('click')

    expect(picks(wrapper)).toEqual(['a2'])
  })
})

describe('行上那几枚键', () => {
  it('复制连子树一起，副本另发号且选中转到副本上', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-copy-a"]').trigger('click')
    const prims = lastPrims(wrapper)
    const copy = prims[1]

    expect(prims).toHaveLength(3)
    expect(copy?.id).not.toBe('a')
    expect(copy?.kind === 'box' && copy.children).toHaveLength(2)
    expect(picks(wrapper)).toEqual([copy?.id])
  })

  // ⚠ 树上一行行往下是文档序，而文档序在后的画在上面：两个名字对不上会让人按反
  it('「在树上上移」把它在文档序里往前挪一格', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-up-b"]').trigger('click')

    expect(lastPrims(wrapper).map((prim) => prim.id)).toEqual(['b', 'a'])
  })

  it('「在树上下移」把它在文档序里往后挪一格', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-down-a"]').trigger('click')

    expect(lastPrims(wrapper).map((prim) => prim.id)).toEqual(['b', 'a'])
  })

  it('已经在头一位还要上移时一帧都不记', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-up-a"]').trigger('click')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('删一枚连它的子树一起没', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-remove-a"]').trigger('click')

    expect(lastPrims(wrapper).map((prim) => prim.id)).toEqual(['b'])
  })

  // ⚠ 不摘的话右栏画着一枚已经不在的图元，改哪一项都写不回去且不报错
  it('删掉的子树里有选中的那一枚时，选中跟着摘掉', async () => {
    const wrapper = mountTree(PRIMS, 'a1')

    await wrapper.get('[data-test="prim-remove-a"]').trigger('click')

    expect(picks(wrapper)).toEqual([''])
  })

  it('删的是别处那一枚时不动选中', async () => {
    const wrapper = mountTree(PRIMS, 'a1')

    await wrapper.get('[data-test="prim-remove-b"]').trigger('click')

    expect(wrapper.emitted('pick')).toBeUndefined()
  })
})

describe('新增', () => {
  it('一枚都没选时落到根层末尾，选中转到新的那一枚上', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-add-txt"]').trigger('click')
    const prims = lastPrims(wrapper)

    expect(prims).toHaveLength(3)
    expect(prims[2]?.kind).toBe('txt')
    expect(picks(wrapper)).toEqual([prims[2]?.id])
  })

  it('选中的是盒时落进那个盒里', async () => {
    const wrapper = mountTree(PRIMS, 'a')

    await wrapper.get('[data-test="prim-add-vec"]').trigger('click')
    const root = lastPrims(wrapper)[0]

    expect(
      root?.kind === 'box' && root.children.map((one) => one.kind),
    ).toEqual(['txt', 'box', 'vec'])
  })

  it('落点那一句把新的一枚落在哪说出来', () => {
    const wrapper = mountTree(PRIMS, 'a')

    expect(wrapper.get('[data-test="prim-add-at"]').text()).toContain('a')
  })

  // ⚠ 加得进去却在保存时被截断的话，用户看到的是「加了又没了」
  it('落点已经满到上限时四枚键一起禁用，并说清为什么', () => {
    const wrapper = mountTree([tower(TWIN_2D_MAX_PRIM_DEPTH)], 't1')

    expect(
      wrapper.get('[data-test="prim-add-box"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.get('[data-test="prim-add-at"]').text()).toBe(
      TWIN_2D_PRIM_MOVE_BLOCK_LABELS.depth,
    )
  })
})

describe('拖着搬家', () => {
  it('拖到另一道缝上就搬过去了', async () => {
    const wrapper = mountTree()

    const took = await dragTo(wrapper, 'b', 'prim-gap-row:a')

    expect(took).toBe(true)
    expect(lastPrims(wrapper).map((prim) => prim.id)).toEqual(['b', 'a'])
  })

  it('拖到一行盒上就是当它的最后一个子', async () => {
    const wrapper = mountTree()

    await dragTo(wrapper, 'b', 'prim-row-a')
    const root = lastPrims(wrapper)[0]

    expect(root?.kind === 'box' && root.children.map((one) => one.id)).toEqual([
      'a1',
      'a2',
      'b',
    ])
  })

  // ⚠ 撤销栈上多出一格按了没反应的空步
  it('拖起来又放回原处时一帧都不记', async () => {
    const wrapper = mountTree()

    const took = await dragTo(wrapper, 'b', 'prim-gap-row:b')

    expect(took).toBe(true)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('拖进自己的子树里被拦住，并说清为什么', async () => {
    const wrapper = mountTree()

    const took = await dragTo(wrapper, 'a', 'prim-row-a2')

    expect(took).toBe(false)
    expect(blockedText(wrapper)).toBe(TWIN_2D_PRIM_MOVE_BLOCK_LABELS.cycle)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 不在这里拦住的话，归一化会把超深那一层归空——表现是保存之后子树没了
  it('拖到再深一层就要被截断时拦住，并把上限说出来', async () => {
    const wrapper = mountTree([
      tower(TWIN_2D_MAX_PRIM_DEPTH),
      { id: 'solo', kind: 'txt' },
    ])

    const took = await dragTo(wrapper, 'solo', 'prim-gap-end:t1')

    expect(took).toBe(false)
    expect(blockedText(wrapper)).toBe(TWIN_2D_PRIM_MOVE_BLOCK_LABELS.depth)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('拦住的那句话在拖走之后自己收回去', async () => {
    const wrapper = mountTree()
    await dragTo(wrapper, 'a', 'prim-row-a2')

    wrapper
      .get('[data-test="prim-row-a2"]')
      .element.dispatchEvent(dragEvent('dragleave'))
    await nextTick()

    expect(blockedText(wrapper)).toBe('')
  })

  // ⚠ 别处拖进来的东西接住了的话，落下的会是一枚谁也说不清的图元
  it('没起手就悬上来的（别处拖进来的东西）一概不接', async () => {
    const wrapper = mountTree()
    const over = dragEvent('dragover')

    wrapper.get('[data-test="prim-gap-row:a"]').element.dispatchEvent(over)
    await nextTick()

    expect(over.defaultPrevented).toBe(false)
    expect(blockedText(wrapper)).toBe('')
  })

  it('拿不到 dataTransfer 时照样拖得动，不炸', async () => {
    const wrapper = mountTree()
    const row = wrapper.get('[data-test="prim-row-b"]').element
    const bare = new Event('dragstart', { bubbles: true, cancelable: true })

    expect(() => row.dispatchEvent(bare)).not.toThrow()

    const over = dragEvent('dragover')
    const gap = wrapper.get('[data-test="prim-gap-row:a"]').element
    gap.dispatchEvent(over)
    if (over.defaultPrevented) gap.dispatchEvent(dragEvent('drop'))
    await nextTick()

    expect(lastPrims(wrapper).map((prim) => prim.id)).toEqual(['b', 'a'])
  })

  it('松手之后拖拽状态归零，下一次悬上来不会凭空搬东西', async () => {
    const wrapper = mountTree()
    await dragTo(wrapper, 'b', 'prim-gap-row:a')
    const over = dragEvent('dragover')

    wrapper.get('[data-test="prim-gap-row:a"]').element.dispatchEvent(over)
    await nextTick()

    expect(over.defaultPrevented).toBe(false)
  })
})

describe('剪贴板那一对', () => {
  // ⚠ 行尾那枚「复制」是就地再制，底下这一对才是剪贴板：本层只上抛不干活，
  // 在这里另起一份剪贴板的话，键盘粘出来的与按键粘出来的会是两份内容
  it('复制只上抛，一份配置都不自己改', async () => {
    const wrapper = mountTree(PRIMS, 'a')

    await wrapper.get('[data-test="prim-clip-copy"]').trigger('click')

    expect(wrapper.emitted('copy')).toHaveLength(1)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('粘贴也只上抛', async () => {
    const wrapper = mountTree()

    await wrapper.get('[data-test="prim-clip-paste"]').trigger('click')

    expect(wrapper.emitted('paste')).toHaveLength(1)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 一枚都没选时按下去只会是「按了没反应」，那比按不下去难查得多
  it('一枚都没选时复制那一枚按不下去', () => {
    const wrapper = mountTree()

    expect(
      wrapper.get('[data-test="prim-clip-copy"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('粘贴那一枚一直按得下去：剪贴板里有没有东西本层不知道', () => {
    const wrapper = mountTree()

    expect(
      wrapper.get('[data-test="prim-clip-paste"]').attributes('disabled'),
    ).toBeUndefined()
  })
})
