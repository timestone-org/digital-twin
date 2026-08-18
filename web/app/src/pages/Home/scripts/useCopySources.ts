/**
 * @fileoverview 「复制现有屏」那一档的候选屏。
 *
 * ⚠ 与页面上那份列表不是同一份：页面只加载**选中项目**下的屏，而新建弹窗里
 * 目标项目是可以改的，拿页面那份当候选，一切到别的项目就是一片静默的空列表。
 * ⚠ 一页最多 200 条（后端 `MAX_PAGE_SIZE`）。超了要说出来——静默截断会让用户
 * 以为某张屏「不能复制」，而它只是没排进前 200。
 */
import { ref, type Ref } from 'vue'
import { useToast } from '@dt/ui'

import { listDashboards } from '@/api/dashboard'
import type { DashboardSummary } from '@/api/dashboardWire'
import { useRacedFetch } from '@/composables/useRacedFetch'

const PAGE_SIZE = 200

export interface CopySources {
  items: Ref<DashboardSummary[]>
  load: () => Promise<void>
}

export function useCopySources(): CopySources {
  const toast = useToast()
  const items = ref<DashboardSummary[]>([])
  const raced = useRacedFetch()

  /** 拉不到就把候选留空，由调用方退回页面已有的那份，不打断新建。 */
  async function load(): Promise<void> {
    await raced.run(() => listDashboards({ size: PAGE_SIZE }), {
      ok: (page) => {
        items.value = page.items
        if (page.total > page.items.length) {
          toast.warning(
            `大屏超过 ${PAGE_SIZE} 张，复制来源只列得下前 ${PAGE_SIZE} 张`,
          )
        }
      },
      fail: () => undefined,
      settled: () => undefined,
    })
  }

  return { items, load }
}
