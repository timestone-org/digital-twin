/**
 * @fileoverview 画布选中：单选、加选、框选，以及「选中了什么」的唯一真源。
 *
 * ⚠ 选中集只认**节点 id 与边 id**，不认对象引用：节点数组在运行态每秒重建一次
 * （染色走 provide/inject 挡在数组之外，但列表本身仍会因保存而换新），拿引用
 * 当键会让选中在每次重建后静默消失。
 */
import { computed, ref } from 'vue'

/** 一个可被选中的东西。 */
export interface Selectable {
  kind: 'node' | 'edge'
  id: string
}

/** 只有目标是这一类时才选中它。 */
function onlyOf(
  target: Selectable | null,
  kind: Selectable['kind'],
): ReadonlySet<string> {
  return new Set(target?.kind === kind ? [target.id] : [])
}

/** 只留下还活着的那些 id。 */
function keepAlive(
  current: ReadonlySet<string>,
  live: readonly string[],
): ReadonlySet<string> {
  const alive = new Set(live)
  return new Set([...current].filter((id) => alive.has(id)))
}

/** 画布上的选中状态。 */
export function useCanvasSelection() {
  const nodeIds = ref<ReadonlySet<string>>(new Set())
  const edgeIds = ref<ReadonlySet<string>>(new Set())

  const hasSelection = computed(
    () => nodeIds.value.size > 0 || edgeIds.value.size > 0,
  )
  const selectedNodeIds = computed(() => [...nodeIds.value])
  const selectedEdgeIds = computed(() => [...edgeIds.value])

  /** 只选中这一个，其余清掉。 */
  function select(target: Selectable | null): void {
    nodeIds.value = onlyOf(target, 'node')
    edgeIds.value = onlyOf(target, 'edge')
  }

  /** 加选或反选一个。按住 Shift / Meta 时走它。 */
  function toggle(target: Selectable): void {
    const bucket = target.kind === 'node' ? nodeIds : edgeIds
    const next = new Set(bucket.value)
    if (!next.delete(target.id)) next.add(target.id)
    bucket.value = next
  }

  /** 框选的结果：整体替换节点选中集，边不参与框选。 */
  function selectNodes(ids: readonly string[]): void {
    nodeIds.value = new Set(ids)
    edgeIds.value = new Set()
  }

  /**
   * 图变了之后把选中集收拢到还存在的那些上。
   *
   * ⚠ 不收拢的话，删掉一个节点之后它仍留在选中集里，接着按删除键会去删一个
   * 已经不存在的 id——后端 404，而界面上什么都看不出来。
   */
  function prune(
    liveNodeIds: readonly string[],
    liveEdgeIds: readonly string[],
  ): void {
    nodeIds.value = keepAlive(nodeIds.value, liveNodeIds)
    edgeIds.value = keepAlive(edgeIds.value, liveEdgeIds)
  }

  return {
    hasSelection,
    selectedNodeIds,
    selectedEdgeIds,
    select,
    toggle,
    selectNodes,
    /** 清空。 */
    clear: () => select(null),
    /** 这个节点被选中了吗。 */
    isNodeSelected: (id: string) => nodeIds.value.has(id),
    /** 这条边被选中了吗。 */
    isEdgeSelected: (id: string) => edgeIds.value.has(id),
    prune,
  }
}
