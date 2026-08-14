/**
 * @fileoverview 工作台弹窗的开关：同一时刻只开一个，外加一个「针对哪张屏」。
 * 弹窗组件本身不在这里，页面把这份状态转给 WorkbenchDialogs。
 */
import { ref, type Ref } from 'vue'

import type { DashboardSummary } from '@/api/dashboardWire'
import type { WorkbenchDialogName } from '../dialogs'

export interface WorkbenchDialogs {
  /** 当前开着的弹窗，null 表示都关着。 */
  openName: Ref<WorkbenchDialogName | null>
  /** 针对某张屏的弹窗（分享 / 另存为模板 / 自检）的目标。 */
  target: Ref<DashboardSummary | null>
  isOpen: (name: WorkbenchDialogName) => boolean
  open: (name: WorkbenchDialogName, target?: DashboardSummary) => void
  close: () => void
}

export function useWorkbenchDialogs(): WorkbenchDialogs {
  const openName = ref<WorkbenchDialogName | null>(null)
  const target = ref<DashboardSummary | null>(null)

  function isOpen(name: WorkbenchDialogName): boolean {
    return openName.value === name
  }

  function open(name: WorkbenchDialogName, next?: DashboardSummary): void {
    // ⚠ 目标要一起换：留着上一个弹窗的目标会让「分享 A 之后另存 B」把 A 存成模板
    target.value = next ?? null
    openName.value = name
  }

  function close(): void {
    openName.value = null
    target.value = null
  }

  return { openName, target, isOpen, open, close }
}
