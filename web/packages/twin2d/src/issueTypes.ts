/**
 * @fileoverview 诊断的词汇表：两档严重度、十五个 code 与一条诊断的形状。
 * 单独成文件是因为两族判据都要用它——引用完整性那族在 `issues.ts`，丢弃那族在
 * `issuesDropped.ts`，而两者之间不许成环。
 */

/** 两档严重度：`error` = 有东西画不出来，`warn` = 画得出来但不是配的那样。 */
export const TWIN_2D_ISSUE_LEVELS = ['error', 'warn'] as const
export type Twin2dIssueLevel = (typeof TWIN_2D_ISSUE_LEVELS)[number]

/** 十五种问题，一种一个 code：先引用完整性那一族，再丢弃那一族。 */
export const TWIN_2D_ISSUE_CODES = [
  'dangling-style',
  'dangling-port',
  'dangling-slot',
  'dangling-prim',
  'dangling-gradient',
  'dangling-sprite',
  'waypoint-out-of-canvas',
  'prim-too-deep',
  'dropped-node',
  'dropped-edge',
  'dropped-mark',
  'dropped-prim',
  'dropped-slot',
  'dropped-port',
  'dropped-variant',
] as const
export type Twin2dIssueCode = (typeof TWIN_2D_ISSUE_CODES)[number]

/** 一条诊断。`at` 是人能照着找过去的字段路径，如 `nodes[3].styleId`。 */
export interface Twin2dIssue {
  level: Twin2dIssueLevel
  code: Twin2dIssueCode
  message: string
  at: string
}
