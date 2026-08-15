/**
 * @fileoverview 左右两栏的拖拽改宽：宽度状态、栅格模板、指针拖拽与键盘微调。
 * 取值域与存档在 `paneWidths.ts`、DOM 接线在 `paneDrag.ts`，这里只管把它们接起来。
 */
import { computed, onUnmounted, ref, type CSSProperties } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { createDrag, observeResize } from './paneDrag'
import {
  PANE_DEFAULTS,
  SPLITTER_PX,
  clampPane,
  paneLimits,
  readPaneWidths,
  writePaneWidths,
  type PaneLimits,
  type PaneSide,
} from './paneWidths'

export interface EditorPanes {
  /** 绑到栅格容器上，用来量可用总宽。 */
  hostRef: Ref<HTMLElement | null>
  left: Ref<number>
  right: Ref<number>
  gridStyle: ComputedRef<CSSProperties>
  limitsOf: (side: PaneSide) => PaneLimits
  startDrag: (side: PaneSide, event: PointerEvent) => void
  /** 键盘微调；正数是把这一侧拉宽。 */
  nudge: (side: PaneSide, delta: number) => void
  reset: (side: PaneSide) => void
}

export function useEditorPanes(): EditorPanes {
  const stored = readPaneWidths()
  const hostRef = ref<HTMLElement | null>(null)
  const left = ref(stored.left)
  const right = ref(stored.right)

  /** 容器还没挂上时按一个够大的数算，免得初次读档就被夹到下限。 */
  const totalWidth = (): number =>
    hostRef.value?.getBoundingClientRect().width ?? Number.MAX_SAFE_INTEGER

  const limitsOf = (side: PaneSide): PaneLimits =>
    paneLimits(totalWidth(), side === 'left' ? right.value : left.value)

  function apply(side: PaneSide, next: number): void {
    const width = clampPane(next, limitsOf(side))
    if (side === 'left') left.value = width
    else right.value = width
  }

  const commit = (): void => {
    writePaneWidths({ left: left.value, right: right.value })
  }

  const widthOf = (side: PaneSide): number =>
    side === 'left' ? left.value : right.value

  const drag = createDrag(widthOf, apply, commit)
  observeResize(hostRef, () => {
    apply('left', left.value)
    apply('right', right.value)
  })
  onUnmounted(drag.stop)

  return {
    hostRef,
    left,
    right,
    gridStyle: computed<CSSProperties>(() => ({
      gridTemplateColumns: `${left.value}px ${SPLITTER_PX}px minmax(0, 1fr) ${SPLITTER_PX}px ${right.value}px`,
      // 拖拽期间整块不许选中：指针一旦划过面板，两侧的文字会被刷成一片蓝
      ...(drag.isResizing.value
        ? { userSelect: 'none', cursor: 'col-resize' }
        : {}),
    })),
    limitsOf,
    startDrag: drag.start,
    nudge: (side, delta) => {
      apply(side, widthOf(side) + delta)
      commit()
    },
    reset: (side) => {
      apply(side, PANE_DEFAULTS[side])
      commit()
    },
  }
}
