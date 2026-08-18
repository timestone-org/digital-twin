/**
 * @fileoverview 工作台上各个弹窗的名字。页面只记「现在开着哪一个」，
 * 弹窗组件自己按名字判断要不要显示。
 *
 * ⚠ 同一时刻只允许开一个：这一页的弹窗全都要么改选中项目、要么改大屏列表，
 * 叠着开会让后关的那个把先关的那个刚写完的状态盖回去。
 */

export const WORKBENCH_DIALOGS = [
  'new-project',
  'new-dashboard',
  'project-settings',
  'import',
  'template-library',
  'runtime-params',
  'share',
  'save-as-template',
  'validate',
  'unresolved-bindings',
] as const

export type WorkbenchDialogName = (typeof WORKBENCH_DIALOGS)[number]
