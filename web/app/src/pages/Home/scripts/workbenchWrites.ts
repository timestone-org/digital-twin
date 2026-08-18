/**
 * @fileoverview 弹窗提交之后真正落库的那几步：新建大屏按起手方式分派到三个不同
 * 的端点，导入前把用户选的文件读成整包。
 *
 * ⚠ 三个端点的出参形状不同——模板实例化与导入回的是带 `unresolvedBindings` 的
 * 结果，空白与复制回的是干净的大屏。这里收敛成同一个形状，调用方才不用为
 * 「这次要不要弹未解析绑定」各写一遍分支。
 */
import type { DashboardExportPayload, UnresolvedBinding } from '@dt/contracts'

import { createDashboard } from '@/api/dashboard'
import { instantiateDashboardTemplate } from '@/api/dashboardTemplates'
import { duplicateDashboard, importDashboard } from '@/api/dashboardTransfer'
import { parseExportPackage } from '@/api/dashboardTransferWire'
import type { NewDashboardPayload } from './payloads'

/** 一次建屏的结果：新屏的身份，外加没接上的绑定。 */
export interface CreatedDashboard {
  id: string
  name: string
  /** 指向本部署不存在的点位的绑定；空数组表示全接上了。 */
  unresolvedBindings: UnresolvedBinding[]
}

/** 复制现有屏。缺 `sourceDashboardId` 的载荷不该走到这里，故直接拒。 */
async function copyExisting(
  input: NewDashboardPayload,
): Promise<CreatedDashboard> {
  const sourceId = input.sourceDashboardId
  if (sourceId === undefined) throw new Error('没有选复制来源')
  const copy = await duplicateDashboard(sourceId, {
    newName: input.name,
    targetProjectId: input.projectId,
  })
  return { id: copy.id, name: copy.name, unresolvedBindings: [] }
}

/** 套模板。名字留空时由服务端沿用模板名，所以空串要转成「不传」。 */
async function fromTemplate(
  input: NewDashboardPayload,
): Promise<CreatedDashboard> {
  const templateId = input.templateId
  if (templateId === undefined) throw new Error('没有选模板')
  const made = await instantiateDashboardTemplate(templateId, {
    targetProjectId: input.projectId,
    name: input.name === '' ? undefined : input.name,
  })
  return {
    id: made.id,
    name: made.name,
    unresolvedBindings: made.unresolvedBindings,
  }
}

/** 按起手方式建一张屏。 */
export async function createDashboardFrom(
  input: NewDashboardPayload,
): Promise<CreatedDashboard> {
  if (input.startMode === 'copy') return copyExisting(input)
  if (input.startMode === 'template') return fromTemplate(input)
  const blank = await createDashboard({
    projectId: input.projectId,
    name: input.name,
    designWidth: input.designWidth,
    designHeight: input.designHeight,
  })
  return { id: blank.id, name: blank.name, unresolvedBindings: [] }
}

export interface ImportChoice {
  /** 新建时的名字；覆盖既有屏时用不上。 */
  newName: string
  /** 给了就是覆盖既有屏：保留它的 id 与名字，只换配置。 */
  targetDashboardId: string | null
}

/** 把一份整包导进项目。 */
export async function importInto(
  projectId: string,
  payload: DashboardExportPayload,
  choice: ImportChoice,
): Promise<CreatedDashboard> {
  const made = await importDashboard({
    projectId,
    payload,
    ...(choice.targetDashboardId === null
      ? { newName: choice.newName }
      : { targetDashboardId: choice.targetDashboardId }),
  })
  return {
    id: made.id,
    name: made.name,
    unresolvedBindings: made.unresolvedBindings,
  }
}

/**
 * 把用户选的文件读成整包。
 * ⚠ 先过 `parseExportPackage` 而不是直接当成整包用：形状不对要在这里就说清楚，
 * 让它一路流到导入端点，回来的会是一个看不出哪儿错了的 400。
 * @param file 用户选中的 JSON 文件
 */
export async function readExportFile(
  file: File,
): Promise<DashboardExportPayload> {
  const raw: unknown = JSON.parse(await file.text())
  return parseExportPackage(raw)
}
