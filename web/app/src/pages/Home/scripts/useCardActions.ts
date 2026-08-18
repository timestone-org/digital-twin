/**
 * @fileoverview 大屏卡片上那几个直接落库的动作：复制、重命名、导出、删除，
 * 外加预览与编辑两条跳转。需要弹窗的动作由页面转给弹窗，不在这里。
 *
 * ⚠ 每个动作跑完都重新拉一次列表，而不是就地补一条：复制会多出一张屏、
 * 删除会少一张，本地补的那份与库里的差异只会越攒越大。
 */
import { ref, type Ref } from 'vue'
import { useRouter, type Router } from 'vue-router'
import { useConfirm, useToast } from '@dt/ui'

import { deleteDashboard, updateDashboard } from '@/api/dashboard'
import type { DashboardSummary } from '@/api/dashboardWire'
import { duplicateDashboard, exportDashboard } from '@/api/dashboardTransfer'
import { fromExportPackage } from '@/api/dashboardTransferWire'
import { describeError } from '@/composables/useAsyncList'
import { downloadJson } from '@/utils/downloadJson'

export interface CardActions {
  /** 正在处理的那张屏，卡片据此盖忙碌遮罩。 */
  busyDashboardId: Ref<string | null>
  busyLabel: Ref<string>
  preview: (dashboard: DashboardSummary) => void
  edit: (dashboard: DashboardSummary) => void
  duplicate: (dashboard: DashboardSummary) => Promise<void>
  rename: (dashboard: DashboardSummary, name: string) => Promise<void>
  exportOne: (dashboard: DashboardSummary) => Promise<void>
  remove: (dashboard: DashboardSummary) => Promise<void>
}

interface ActionContext {
  toast: ReturnType<typeof useToast>
  busyDashboardId: Ref<string | null>
  busyLabel: Ref<string>
  onChanged: () => Promise<void>
}

/**
 * 盖上忙碌遮罩跑一件事，跑完重新取数；失败只报错，不动列表。
 * @param context 忙碌状态与刷新回调
 * @param dashboardId 盖谁
 * @param label 遮罩上的文案
 * @param task 真正要做的事
 */
async function withBusy(
  context: ActionContext,
  dashboardId: string,
  label: string,
  task: () => Promise<void>,
): Promise<void> {
  context.busyDashboardId.value = dashboardId
  context.busyLabel.value = label
  try {
    await task()
    await context.onChanged()
  } catch (caught) {
    context.toast.error(describeError(caught))
  } finally {
    context.busyDashboardId.value = null
  }
}

/**
 * 导出一张屏并存盘。
 * ⚠ 存的是 `fromExportPackage` 的产出（线形 snake_case），不是内存里的 camelCase
 * 载荷：包要能与后端直接导出的那份互换，也要能被导入端的 `parseExportPackage` 读回。
 */
async function exportOne(
  context: ActionContext,
  dashboard: DashboardSummary,
): Promise<void> {
  try {
    const packed = fromExportPackage(await exportDashboard(dashboard.id))
    downloadJson(packed, dashboard.name)
    context.toast.success(`已导出「${dashboard.name}」`)
  } catch (caught) {
    context.toast.error(describeError(caught))
  }
}

async function remove(
  context: ActionContext,
  confirm: ReturnType<typeof useConfirm>,
  dashboard: DashboardSummary,
): Promise<void> {
  const confirmed = await confirm.ask({
    title: '删除大屏',
    message:
      `「${dashboard.name}」的布局、${dashboard.nodeCount} 个模块与它们的` +
      '数据绑定会一并删除，此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  await withBusy(context, dashboard.id, '删除中…', async () => {
    await deleteDashboard(dashboard.id)
    context.toast.success('大屏已删除')
  })
}

function goTo(router: Router, name: string, dashboardId: string): void {
  void router.push({ name, params: { dashboardId } })
}

/**
 * @param onChanged 大屏列表变了之后重新取数
 */
export function useCardActions(onChanged: () => Promise<void>): CardActions {
  const router = useRouter()
  const confirm = useConfirm()
  const context: ActionContext = {
    toast: useToast(),
    busyDashboardId: ref<string | null>(null),
    busyLabel: ref('处理中…'),
    onChanged,
  }

  return {
    busyDashboardId: context.busyDashboardId,
    busyLabel: context.busyLabel,
    preview: (dashboard) => goTo(router, 'dashboard-view', dashboard.id),
    edit: (dashboard) => goTo(router, 'dashboard-editor', dashboard.id),
    duplicate: (dashboard) =>
      withBusy(context, dashboard.id, '复制中…', async () => {
        const copy = await duplicateDashboard(dashboard.id)
        context.toast.success(`已复制为「${copy.name}」`)
      }),
    rename: (dashboard, name) =>
      withBusy(context, dashboard.id, '重命名中…', () =>
        updateDashboard(dashboard.id, { name }).then(() => undefined),
      ),
    exportOne: (dashboard) => exportOne(context, dashboard),
    remove: (dashboard) => remove(context, confirm, dashboard),
  }
}
