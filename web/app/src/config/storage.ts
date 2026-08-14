/**
 * @fileoverview localStorage 的键名清单。
 * ⚠ 键名散在各处时，改名必然漏掉一处，表现是「偏好突然回到默认」而不报错。
 */

export const STORAGE_KEYS = {
  /** 工作台上次选中的项目 id。 */
  lastProject: 'dt.workbench.last-project',
} as const
