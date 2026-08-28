/**
 * @fileoverview 契约：手势中途**文档被换掉**（拖着不放按 ⌘Z）时，松手不把陈旧草稿
 * 写回去；中途换掉之后又接着拖的，按新文档重算并照常落一次 commit。
 *
 * ⚠ 草稿是照起手那一刻的文档算出来的，`EditorStage.commitNodes` 又把它铺在**当前**
 * 配置上。中途撤销之后原样落下去，那一步撤销会被静默撤回；撤销的若是「删节点」，
 * `edges` 留着而 `nodes` 被换回去，图上就多出一条两端都不在的悬空连线，而
 * `commit` 这条路不过归一化，一处都不报错。
 * ⚠ 「接着又拖了一下」必须照常落 commit：一律作废的话，中途手滑碰了一下撤销键就
 * 再也拖不动了，而画面上看不出为什么。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dNode, Twin2dNodeStyle } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import CanvasNodeLayer from '@/pages/Twin2dEditor/components/CanvasNodeLayer.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('夹具没通过归一化')
}

/** 关掉吸附：位移原样落地，断言里不必再算网格。 */
const FREE = { ...TWIN_2D_DEFAULT_SNAP, enabled: false }

const DOC = normalizeTwin2dConfig({
  styles: [{ id: 's1', name: '方块', size: { w: 40, h: 20 }, prims: [] }],
  nodes: [
    { id: 'a', styleId: 's1', x: 100, y: 50 },
    { id: 'b', styleId: 's1', x: 200, y: 50 },
  ],
})

const STYLE: Twin2dNodeStyle = DOC.styles[0] ?? throwMissing()

/** 撤销之后的那一份文档：少了一个节点，于是必然是**另一个**数组引用。 */
const AFTER_UNDO: readonly Twin2dNode[] = DOC.nodes.filter(
  (node) => node.id !== 'b',
)

interface Harness {
  wrapper: VueWrapper
  /** 换它 = 文档在手势中途被换掉。 */
  nodes: { value: readonly Twin2dNode[] }
  changes: (readonly Twin2dNode[])[]
}

/** 装一层节点层；手势状态机装在外层，与画布壳同形。 */
function mountLayer(): Harness {
  const nodes = ref<readonly Twin2dNode[]>(DOC.nodes)
  const changes: (readonly Twin2dNode[])[] = []
  const host = defineComponent({
    setup() {
      const pointer = useCanvasPointer({
        toDesign: (at) => ({ x: at.clientX, y: at.clientY }),
      })
      return () =>
        h('div', [
          h(CanvasNodeLayer, {
            nodes: nodes.value,
            nodeStyles: [STYLE],
            selectedIds: ['a'],
            snap: FREE,
            scale: 1,
            startGesture: pointer.start,
            onChange: (next: readonly Twin2dNode[]) => {
              changes.push(next)
            },
          }),
        ])
    },
  })
  return { wrapper: mount(host), nodes, changes }
}

/**
 * 在一个节点上按下去。
 * @param wrapper 挂好的那一层
 * @param id 节点 id
 */
function down(wrapper: VueWrapper, id: string): void {
  wrapper.get(`[data-test="node"][data-id="${id}"]`).element.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: 0,
      clientY: 0,
      bubbles: true,
    }),
  )
}

/**
 * 发一下指针事件到 window 上。
 * @param type 事件名
 * @param x 横坐标
 * @param y 纵坐标
 */
function fire(type: 'pointermove' | 'pointerup', x: number, y: number): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }),
  )
}

describe('手势中途文档被换掉', () => {
  it('拖到一半撤销，松手不把陈旧草稿写回去', async () => {
    const harness = mountLayer()
    down(harness.wrapper, 'a')
    fire('pointermove', 40, 0)
    await nextTick()
    expect(harness.changes).toHaveLength(0)

    // 这一步就是拖着不放按了 ⌘Z：文档换了一份新的
    harness.nodes.value = AFTER_UNDO
    await nextTick()
    fire('pointerup', 40, 0)
    await nextTick()

    expect(harness.changes).toHaveLength(0)
  })

  it('文档没被动过的那一拖照常落一次 commit', async () => {
    const harness = mountLayer()
    down(harness.wrapper, 'a')
    fire('pointermove', 40, 0)
    await nextTick()
    fire('pointerup', 40, 0)
    await nextTick()

    expect(harness.changes).toHaveLength(1)
    expect(harness.changes[0]?.find((node) => node.id === 'a')?.x).toBe(140)
  })

  it('中途换掉之后又拖了一下，按新文档重算并照常落地', async () => {
    const harness = mountLayer()
    down(harness.wrapper, 'a')
    fire('pointermove', 40, 0)
    await nextTick()

    harness.nodes.value = AFTER_UNDO
    await nextTick()
    fire('pointermove', 60, 0)
    await nextTick()
    fire('pointerup', 60, 0)
    await nextTick()

    expect(harness.changes).toHaveLength(1)
    expect(harness.changes[0]?.map((node) => node.id)).toEqual(['a'])
  })
})
