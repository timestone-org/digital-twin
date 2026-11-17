/** @fileoverview 按模板查找最新成功生成的报告，忽略失败、排队与导入任务。 */
import type { ReportRender, ReportTemplateSummary } from '@dt/contracts'
import { listReportChoices, listReportRenders } from '@/api/reports'

export interface LatestReport {
  name: string
  record: ReportRender
}

/** 将模板编码收敛为目录中的唯一模板。 */
async function resolveTemplate(
  code: string,
): Promise<ReportTemplateSummary | undefined> {
  if (!code) return undefined
  const template = (await listReportChoices()).find(
    (item) => item.code === code,
  )
  if (!template) throw new Error(`未找到报告模板：${code}`)
  return template
}

/** 有界续读记录，成功记录以服务端创建顺序为准。 */
export async function findLatestReport(
  code: string,
  signal: AbortSignal,
): Promise<LatestReport | null> {
  const template = await resolveTemplate(code)
  let after: string | undefined
  for (let page = 0; page < 50; page += 1) {
    signal.throwIfAborted()
    const result = await listReportRenders(after, template?.id, signal)
    const record = result.items.find(
      (item) => item.kind === 'render' && item.status === 'succeeded',
    )
    if (record) return { record, name: template?.name ?? '报告' }
    if (!result.has_more || result.next === null) return null
    after = result.next
  }
  throw new Error('生成记录过多，请指定报告模板后重试')
}
