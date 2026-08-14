/**
 * @fileoverview 三个表单弹窗的出参形状。
 *
 * ⚠ 放在这里而不是 `<script setup>` 里 export：SFC 里导出的类型 `vue-tsc`
 * 认得、eslint 的类型解析认不得，跨文件消费时整串取值会退化成 `error type`，
 * 于是 `no-unsafe-member-access` 把每一个字段访问都判红。
 */

/** 新建项目的出参。 */
export interface NewProjectPayload {
  name: string
  description: string
}

/** 新建大屏的出参。⚠ 用 const 联合表达起手方式，不用 enum。 */
export interface NewDashboardPayload {
  /** 从哪儿起手：空白画布 / 复制现有屏 / 套模板。 */
  startMode: 'blank' | 'copy' | 'template'
  projectId: string
  name: string
  designWidth: number
  designHeight: number
  /** `startMode === 'copy'` 时必给。 */
  sourceDashboardId?: string | undefined
  /** `startMode === 'template'` 时必给。 */
  templateId?: string | undefined
}

/** 项目设置的出参。`themeJson` 为 `{}` 即回退内置默认主题。 */
export interface ProjectSettingsPayload {
  name: string
  description: string
  themeJson: Record<string, unknown>
  brandJson: Record<string, unknown>
}
