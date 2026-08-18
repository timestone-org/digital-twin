/**
 * @fileoverview 模板库那两个写操作：把一张屏另存为模板、从库里删一个模板。
 * 事件由聚合组件发，这里只管请求、忙碌态与提示。
 */
import { ref, type Ref } from 'vue'
import { useConfirm, useToast } from '@dt/ui'
import type { DashboardTemplateSummary } from '@dt/contracts'

import type { DashboardSummary } from '@/api/dashboardWire'
import {
  createDashboardTemplate,
  deleteDashboardTemplate,
} from '@/api/dashboardTemplates'
import { describeError } from '@/composables/useAsyncList'

export interface TemplateDraft {
  name: string
  category: string
  description: string
}

export interface TemplateDialogFlow {
  busy: Ref<boolean>
  save: (dashboard: DashboardSummary, draft: TemplateDraft) => Promise<boolean>
  /** 问一遍再删；用户答不删或删失败都给 false。 */
  drop: (template: DashboardTemplateSummary) => Promise<boolean>
}

export function useTemplateDialogFlow(): TemplateDialogFlow {
  const toast = useToast()
  const confirm = useConfirm()
  const busy = ref(false)

  async function save(
    dashboard: DashboardSummary,
    draft: TemplateDraft,
  ): Promise<boolean> {
    busy.value = true
    try {
      await createDashboardTemplate({
        sourceDashboardId: dashboard.id,
        name: draft.name,
        category: draft.category === '' ? undefined : draft.category,
        description: draft.description === '' ? undefined : draft.description,
      })
      toast.success(`已存为模板「${draft.name}」`)
      return true
    } catch (caught) {
      toast.error(describeError(caught))
      return false
    } finally {
      busy.value = false
    }
  }

  async function drop(template: DashboardTemplateSummary): Promise<boolean> {
    const agreed = await confirm.ask({
      title: '删除模板',
      message:
        `模板「${template.name}」会从模板库里消失。已经用它建出来的大屏不受` +
        '影响，但之后再也建不出同样的屏了。',
      confirmText: '删除',
      danger: true,
    })
    if (!agreed) return false
    busy.value = true
    try {
      await deleteDashboardTemplate(template.id)
      toast.success('模板已删除')
      return true
    } catch (caught) {
      toast.error(describeError(caught))
      return false
    } finally {
      busy.value = false
    }
  }

  return { busy, save, drop }
}
