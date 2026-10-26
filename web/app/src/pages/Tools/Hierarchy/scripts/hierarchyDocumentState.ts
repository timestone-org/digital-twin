/** @fileoverview 页面内图文档、属性草稿与撤销栈。 */
import { newClientUuid } from '@/api/idempotency'
import { useToast } from '@dt/ui'
import { computed, ref, shallowRef } from 'vue'
import { alignNodes, type Alignment } from './geometry'
import { validate } from './graph'
import {
  clone,
  connectNodes,
  insertNode,
  moveNodes,
  removeSelection,
} from './mutations'
import type { GraphDocument, GraphNode, NodeKind } from './types'
export type NodeDraft = Pick<GraphNode, 'code' | 'name' | 'parameter' | 'order'>

export function createState() {
  const document = shallowRef<GraphDocument | null>(null)
  const selectedIds = ref<string[]>([])
  const edgeId = ref('')
  const drafts = ref<Record<string, Partial<NodeDraft>>>({})
  const past = shallowRef<GraphDocument[]>([])
  const future = shallowRef<GraphDocument[]>([])
  const toast = useToast()
  const selected = computed(
    () =>
      document.value?.nodes.find((node) => node.id === selectedIds.value[0]) ??
      null,
  )
  const editing = computed(() =>
    selected.value
      ? { ...selected.value, ...drafts.value[selected.value.id] }
      : null,
  )
  const hasDrafts = computed(() => Object.keys(drafts.value).length > 0)
  return {
    document,
    selectedIds,
    edgeId,
    drafts,
    past,
    future,
    toast,
    selected,
    editing,
    hasDrafts,
  }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {}
  selectEdge = (id: string) => {
    this.select([])
    this.state.edgeId.value = id
  }
  select = (ids: string[]) => {
    this.state.selectedIds.value = ids
    this.state.edgeId.value = ''
  }
  install = (value: GraphDocument) => {
    this.state.document.value = clone(value)
    this.state.drafts.value = {}
    this.state.past.value = []
    this.state.future.value = []
    this.select([])
  }
  commit = (value: GraphDocument, history = true) => {
    if (JSON.stringify(value) === JSON.stringify(this.state.document.value))
      return
    if (history && this.state.document.value) {
      this.state.past.value = [
        ...this.state.past.value.slice(-59),
        clone(this.state.document.value),
      ]
      this.state.future.value = []
    }
    this.state.document.value = value
  }
  applyDrafts = () => {
    const value = this.state.document.value
    if (!value || !this.state.hasDrafts.value) return
    this.commit(
      validate({
        ...clone(value),
        nodes: value.nodes.map((node) => ({
          ...node,
          ...this.state.drafts.value[node.id],
        })),
      }),
    )
    this.state.drafts.value = {}
  }
  patchDraft = (patch: Partial<NodeDraft>) => {
    if (this.state.selected.value)
      this.state.drafts.value = {
        ...this.state.drafts.value,
        [this.state.selected.value.id]: {
          ...this.state.drafts.value[this.state.selected.value.id],
          ...patch,
        },
      }
  }
  discardDrafts = () => {
    this.state.drafts.value = {}
  }
  safely = (action: () => void) => {
    try {
      action()
    } catch (error) {
      this.state.toast.error(
        error instanceof Error ? error.message : '图配置无效',
      )
    }
  }
  add = (kind: NodeKind, position: GraphNode['position']) => {
    const current = this.state.document.value
    if (!current) return
    const id = newClientUuid()
    this.safely(() => {
      this.commit(insertNode(current, kind, position, id))
      this.select([id])
    })
  }
  connect = (source: string, target: string) => {
    const current = this.state.document.value
    if (current)
      this.safely(() =>
        this.commit(connectNodes(current, source, target, newClientUuid())),
      )
  }
  remove = () => {
    if (!this.state.document.value) return
    this.commit(
      removeSelection(
        this.state.document.value,
        this.state.selectedIds.value,
        this.state.edgeId.value,
      ),
    )
    this.state.drafts.value = Object.fromEntries(
      Object.entries(this.state.drafts.value).filter(
        ([id]) => !this.state.selectedIds.value.includes(id),
      ),
    )
    this.select([])
  }
  move = (positions: readonly Pick<GraphNode, 'id' | 'position'>[]) => {
    const current = this.state.document.value
    if (current) this.safely(() => this.commit(moveNodes(current, positions)))
  }
  align = (action: Alignment) => {
    this.move(
      alignNodes(
        this.state.document.value?.nodes.filter((node) =>
          this.state.selectedIds.value.includes(node.id),
        ) ?? [],
        action,
      ),
    )
  }
  nudge = (dx: number, dy: number) => {
    this.move(
      (this.state.document.value?.nodes ?? [])
        .filter((node) => this.state.selectedIds.value.includes(node.id))
        .map((node) => ({
          id: node.id,
          position: {
            x: Math.max(-100000, Math.min(100000, node.position.x + dx)),
            y: Math.max(-100000, Math.min(100000, node.position.y + dy)),
          },
        })),
    )
  }
  undo = (redo = false) => {
    const source = redo ? this.state.future : this.state.past,
      target = redo ? this.state.past : this.state.future
    const value = source.value.at(-1)
    if (!value || !this.state.document.value) return
    target.value = [...target.value, clone(this.state.document.value)]
    source.value = source.value.slice(0, -1)
    this.state.document.value = value
    this.state.drafts.value = {}
    this.select([])
  }
}
