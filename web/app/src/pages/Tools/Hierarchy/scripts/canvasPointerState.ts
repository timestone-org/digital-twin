/** @fileoverview 层级图的拖动、多选、平移、端口连接与对齐辅助线。 */
import { computed, ref, shallowRef, type Ref } from 'vue'
import { canvasPoint, type Pointer } from './canvasGeometry'
import { editorSize, snapGuides, type Guide } from './geometry'
import type { GraphNode } from './types'
import type { HierarchyEditor } from './useHierarchyDocument'
interface Gesture {
  kind: 'move' | 'pan' | 'select'
  pointerId: number
  start: Pointer
  screen: Pointer
  original: GraphNode[]
  viewport: {
    x: number
    y: number
    zoom: number
  }
}

export function createState(
  editor: Ref<HierarchyEditor>,
  frame: Ref<HTMLElement | null>,
  canEdit: () => boolean,
) {
  const snap = ref(true),
    showGuides = ref(true),
    guides = shallowRef<Guide[]>([])
  const temporary = shallowRef<GraphNode[] | null>(null),
    gesture = shallowRef<Gesture | null>(null)
  const connection = ref(''),
    cursor = ref<Pointer | null>(null),
    boxEnd = ref<Pointer | null>(null)
  const nodes = computed(
    () => temporary.value ?? editor.value.document.value?.nodes ?? [],
  )
  const selectionBox = computed(() => {
    const value = gesture.value,
      end = boxEnd.value
    return value?.kind === 'select' && end
      ? {
          x: Math.min(value.start.x, end.x),
          y: Math.min(value.start.y, end.y),
          width: Math.abs(value.start.x - end.x),
          height: Math.abs(value.start.y - end.y),
        }
      : null
  })
  return {
    snap,
    showGuides,
    guides,
    temporary,
    gesture,
    connection,
    cursor,
    boxEnd,
    nodes,
    selectionBox,
    editor,
    frame,
    canEdit,
  }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {}
  point = (event: PointerEvent): Pointer | null => {
    const bounds = this.state.frame.value?.getBoundingClientRect(),
      view = this.state.editor.value.document.value?.viewport
    return bounds && view ? canvasPoint(event, bounds, view) : null
  }
  capture = (event: PointerEvent, kind: Gesture['kind']) => {
    const start = this.point(event),
      document = this.state.editor.value.document.value
    if (!start || !document) return
    this.state.frame.value?.focus()
    this.state.frame.value?.setPointerCapture(event.pointerId)
    this.state.gesture.value = {
      kind,
      pointerId: event.pointerId,
      start,
      screen: { x: event.clientX, y: event.clientY },
      original: document.nodes,
      viewport: document.viewport,
    }
  }
  nodeDown = (node: GraphNode, event: PointerEvent) => {
    if (event.button !== 0) return
    const ids = this.state.editor.value.selectedIds.value
    if (event.shiftKey || event.metaKey || event.ctrlKey)
      this.state.editor.value.select(
        ids.includes(node.id)
          ? ids.filter((id) => id !== node.id)
          : [...ids, node.id],
      )
    else if (!ids.includes(node.id)) this.state.editor.value.select([node.id])
    if (
      this.state.canEdit() &&
      this.state.editor.value.selectedIds.value.includes(node.id)
    )
      this.capture(event, 'move')
  }
  backgroundDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.shiftKey) {
      this.state.editor.value.select([])
      this.capture(event, 'select')
    } else {
      this.state.editor.value.select([])
      this.capture(event, 'pan')
    }
  }
  keyPort = (id: string, side: 'in' | 'out') => {
    if (!this.state.canEdit()) return
    if (side === 'out') {
      this.state.connection.value = id
      this.state.cursor.value = null
    } else if (this.state.connection.value) {
      this.state.editor.value.connect(this.state.connection.value, id)
      this.state.connection.value = ''
    }
  }
  portDown = (id: string, side: 'in' | 'out', event: PointerEvent) => {
    if (!this.state.canEdit() || event.button !== 0) return
    if (side === 'in' && this.state.connection.value) {
      this.state.editor.value.connect(this.state.connection.value, id)
      this.state.connection.value = ''
      return
    }
    if (side === 'out') {
      this.state.connection.value = id
      this.state.cursor.value = this.point(event)
      this.state.frame.value?.setPointerCapture(event.pointerId)
    }
  }
  move = (event: PointerEvent) => {
    const current = this.point(event),
      value = this.state.gesture.value
    if (!current) return
    if (this.state.connection.value) this.state.cursor.value = current
    if (!value) return
    if (value.kind === 'pan') {
      const document = this.state.editor.value.document.value
      if (document)
        this.state.editor.value.commit(
          {
            ...document,
            viewport: {
              ...value.viewport,
              x: value.viewport.x + event.clientX - value.screen.x,
              y: value.viewport.y + event.clientY - value.screen.y,
            },
          },
          false,
        )
    } else if (value.kind === 'select') this.state.boxEnd.value = current
    else this.moveSelection(value, current)
  }
  moveSelection = (value: Gesture, current: Pointer) => {
    const selected = new Set(this.state.editor.value.selectedIds.value)
    let moving = value.original
      .filter((node) => selected.has(node.id))
      .map((node) => ({
        ...node,
        position: {
          x: node.position.x + current.x - value.start.x,
          y: node.position.y + current.y - value.start.y,
        },
      }))
    if (this.state.snap.value)
      moving = moving.map((node) => ({
        ...node,
        position: {
          x: Math.round(node.position.x / 10) * 10,
          y: Math.round(node.position.y / 10) * 10,
        },
      }))
    const adjustment = this.state.showGuides.value
      ? snapGuides(
          moving,
          value.original.filter((node) => !selected.has(node.id)),
          6 / value.viewport.zoom,
        )
      : { dx: 0, dy: 0, guides: [] }
    this.state.guides.value = adjustment.guides
    const positions = new Map(
      moving.map((node) => [
        node.id,
        {
          x: node.position.x + adjustment.dx,
          y: node.position.y + adjustment.dy,
        },
      ]),
    )
    this.state.temporary.value = value.original.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    }))
  }
  finish = (event: PointerEvent) => {
    if (this.state.connection.value) {
      const port = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-port="in"]')
      const target = port?.getAttribute('data-node-id')
      if (target) {
        this.state.editor.value.connect(this.state.connection.value, target)
        this.state.connection.value = ''
      }
    }
    if (this.state.gesture.value?.kind === 'move' && this.state.temporary.value)
      this.state.editor.value.move(this.state.temporary.value)
    const box = this.state.selectionBox.value
    if (box)
      this.state.editor.value.select(
        this.state.nodes.value
          .filter(
            (node) =>
              node.position.x >= box.x &&
              node.position.x + editorSize(node).width <= box.x + box.width &&
              node.position.y >= box.y &&
              node.position.y + editorSize(node).height <= box.y + box.height,
          )
          .map((node) => node.id),
      )
    this.cancelGesture()
    this.state.frame.value?.releasePointerCapture(event.pointerId)
  }
  cancelGesture = () => {
    this.state.gesture.value = null
    this.state.temporary.value = null
    this.state.guides.value = []
    this.state.boxEnd.value = null
  }
  cancel = () => {
    this.cancelGesture()
    this.state.connection.value = ''
    this.state.cursor.value = null
  }
}
