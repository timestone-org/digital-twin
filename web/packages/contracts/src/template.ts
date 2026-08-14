/**
 * @fileoverview 整屏模板：一份导出包一个模板，全局可见、可实例化到任意项目。
 */
import type { DashboardExportPayload } from './transfer'

/** 列表项。⚠ 刻意不带 `payload`：整包几百 KB，列表一次拉几十条就是几十 MB。 */
export interface DashboardTemplateSummary {
  id: string
  name: string
  description: string | null
  category: string | null
  /** 缩略图 data URL；建模板时从源屏拷一份，源屏之后改版不回溯。 */
  thumbnail: string | null
  /** 出处记录；来源项目删掉后模板照旧活着，故可能指向一个不存在的项目。 */
  sourceProjectId: string | null
  createdAt: string
  updatedAt: string
}

/** 模板详情，带整包。 */
export interface DashboardTemplateDetail extends DashboardTemplateSummary {
  payload: DashboardExportPayload
}
