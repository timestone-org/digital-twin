/**
 * @fileoverview 2D 孪生编辑器两层分隔布局的分栏表。
 */
import type { ResizablePane } from '@dt/ui'

/** 左中右三栏。 */
export const TWIN_2D_EDITOR_PANES: readonly ResizablePane[] = [
  { id: 'outline', label: '大纲', size: 20, minSize: 180 },
  { id: 'stage', label: '画布', size: 55, minSize: 280 },
  { id: 'inspector', label: '检查器', size: 25, minSize: 240 },
]

const CANVAS_PANE: ResizablePane = {
  id: 'canvas',
  label: '画布',
  size: 75,
  minSize: 180,
}

const ISSUES_PANE: ResizablePane = {
  id: 'issues',
  label: '配置问题',
  size: 25,
  minSize: 80,
}

/**
 * 中栏上下两格：诊断开着才有下面那一格。
 * @param showIssues 诊断栏开着没有
 */
export function twin2dStagePanes(
  showIssues: boolean,
): readonly ResizablePane[] {
  return showIssues ? [CANVAS_PANE, ISSUES_PANE] : [CANVAS_PANE]
}
