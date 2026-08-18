/**
 * @fileoverview 页面级快捷键装配：把编辑器状态、排布动作与缩放状态接到
 * `useEditorShortcuts` 的处理器上，并持有帮助弹窗的开关。
 */
import { ref, type Ref } from 'vue'
import type { DesignSize } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import {
  snapStep,
  type EditorGridConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { stepZoom, type CanvasZoom } from '@/features/dashboard/canvasZoom'
import type { ArrangeActions } from './editorArrange'
import {
  useEditorShortcuts,
  type EditorShortcutHandlers,
} from './useEditorShortcuts'

export interface EditorHotkeyDeps {
  editor: DashboardEditor
  arrange: ArrangeActions
  save: () => void
  /** 带确认弹窗的整批删除，由页面提供。 */
  removeSelected: () => void
  design: () => DesignSize
  snap: () => SnapConfig
  grid: () => EditorGridConfig
  zoom: Ref<CanvasZoom>
  /** 适应窗口的实际倍率；逐档缩放要从它起步，否则「适应 → 放大」会先跳到 1。 */
  fitScale?: () => number
  /**
   * Esc 的前置出口（关掉点位挑选这类页面覆盖层）；返回 true 表示这一下已被消费，
   * 不再往「清空选中」落。
   */
  escapeFirst: () => boolean
}

/** 方向键微调：Alt 精调恒 1px，其余按吸附口径。 */
function nudgeBy(
  deps: EditorHotkeyDeps,
  dx: number,
  dy: number,
  fine: boolean,
): void {
  const step = fine
    ? { x: 1, y: 1 }
    : snapStep(deps.design(), deps.grid(), deps.snap())
  deps.arrange.nudgeSelected(Math.round(dx * step.x), Math.round(dy * step.y))
}

/** 层序四个手势：与右键菜单落到同一批出口上，两条路径不会各自漂。 */
function orderHandlers(
  arrange: ArrangeActions,
): Pick<
  EditorShortcutHandlers,
  'orderForward' | 'orderBackward' | 'orderFront' | 'orderBack'
> {
  return {
    orderForward: arrange.bringSelectedForward,
    orderBackward: arrange.sendSelectedBackward,
    orderFront: arrange.bringSelectedToFront,
    orderBack: arrange.sendSelectedToBack,
  }
}

/** 缩放三挡。 */
function zoomHandlers(
  deps: EditorHotkeyDeps,
): Pick<EditorShortcutHandlers, 'zoomStep' | 'zoomReset' | 'zoomFit'> {
  return {
    zoomStep: (direction) => {
      deps.zoom.value = stepZoom(
        deps.zoom.value ?? deps.fitScale?.() ?? 1,
        direction,
      )
    },
    zoomReset: () => {
      deps.zoom.value = 1
    },
    zoomFit: () => {
      deps.zoom.value = null
    },
  }
}

export function useEditorHotkeys(deps: EditorHotkeyDeps): {
  helpOpen: Ref<boolean>
} {
  const helpOpen = ref(false)

  function onEscape(): void {
    if (helpOpen.value) {
      helpOpen.value = false
      return
    }
    if (deps.escapeFirst()) return
    deps.editor.select(null)
  }

  useEditorShortcuts({
    handlers: {
      save: deps.save,
      undo: deps.editor.undo,
      redo: deps.editor.redo,
      copy: () => void deps.arrange.copySelected(),
      paste: () => void deps.arrange.pasteClipboard(),
      duplicate: deps.arrange.duplicateSelected,
      remove: deps.removeSelected,
      selectAll: deps.arrange.selectAllTop,
      escape: onEscape,
      nudge: (dx, dy, fine) => {
        nudgeBy(deps, dx, dy, fine)
      },
      ...orderHandlers(deps.arrange),
      ...zoomHandlers(deps),
      help: () => {
        helpOpen.value = true
      },
    },
    suspended: () => helpOpen.value,
  })

  return { helpOpen }
}
