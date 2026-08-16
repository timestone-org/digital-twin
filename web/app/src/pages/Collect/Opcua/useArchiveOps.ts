/**
 * @fileoverview 点位表上的多选与「记录历史」开关：行内即时保存 + 批量开关。
 *
 * ⚠ 多选的唯一用途就是批量开关记录历史，与其它动作无关；换源 / 翻页 / 搜索
 * 后由调用方清空选择，避免跨页误批量。
 * ⚠ 批量是并发 N 次 PATCH，部分失败不抛：按成功/失败计数提示，失败的行保持
 * 原状——静默吞掉失败数会让用户以为整批都改成了。
 *
 * 每个动作都是模块级函数、显式收一个 `Ctx`：composable 只负责把 ref 接起来。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CollectPoint } from '@dt/contracts'
import { useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'

interface Ctx {
  toast: ReturnType<typeof useToast>
  reload: () => Promise<void>
  selected: Ref<Set<string>>
  batchBusy: Ref<boolean>
  rowBusy: Ref<Set<string>>
}

export interface ArchiveOps {
  selected: Ref<Set<string>>
  selectedCount: ComputedRef<number>
  batchBusy: Ref<boolean>
  /** 行内开关正忙的点位 id。 */
  rowBusy: Ref<Set<string>>
  toggleSelect: (id: string, isOn: boolean) => void
  selectAll: (ids: readonly string[]) => void
  clearSelection: () => void
  /** 行内即时开关（后端热生效，无需重连）。 */
  toggleArchive: (point: CollectPoint, next: boolean) => Promise<void>
  /** 批量开/关记录历史。 */
  batchArchive: (next: boolean) => Promise<void>
}

async function toggleArchive(
  ctx: Ctx,
  point: CollectPoint,
  next: boolean,
): Promise<void> {
  const busy = new Set(ctx.rowBusy.value)
  busy.add(point.id)
  ctx.rowBusy.value = busy
  try {
    await collect.updatePoint(point.id, { archive_enabled: next })
    ctx.toast.success(
      next ? `已开启记录历史：${point.name}` : `已关闭记录历史：${point.name}`,
    )
    await ctx.reload()
  } catch (caught) {
    ctx.toast.error(describeError(caught))
  } finally {
    const done = new Set(ctx.rowBusy.value)
    done.delete(point.id)
    ctx.rowBusy.value = done
  }
}

async function batchArchive(ctx: Ctx, next: boolean): Promise<void> {
  const ids = [...ctx.selected.value]
  if (ids.length === 0 || ctx.batchBusy.value) return
  ctx.batchBusy.value = true
  try {
    const results = await Promise.allSettled(
      ids.map((id) => collect.updatePoint(id, { archive_enabled: next })),
    )
    const failed = results.filter((one) => one.status === 'rejected').length
    if (failed === 0) {
      ctx.toast.success(
        `已${next ? '开启' : '关闭'}记录历史：${ids.length} 个点位`,
      )
    } else {
      ctx.toast.error(`${ids.length - failed} 个成功，${failed} 个失败`)
    }
    ctx.selected.value = new Set()
    await ctx.reload()
  } finally {
    ctx.batchBusy.value = false
  }
}

function toggleSelect(ctx: Ctx, id: string, isOn: boolean): void {
  const next = new Set(ctx.selected.value)
  if (isOn) next.add(id)
  else next.delete(id)
  ctx.selected.value = next
}

/**
 * 造一套记录历史操作。
 * @param reload 改动落库后刷新当前页
 */
export function useArchiveOps(reload: () => Promise<void>): ArchiveOps {
  const ctx: Ctx = {
    toast: useToast(),
    reload,
    selected: ref(new Set<string>()),
    batchBusy: ref(false),
    rowBusy: ref(new Set<string>()),
  }
  return {
    selected: ctx.selected,
    selectedCount: computed(() => ctx.selected.value.size),
    batchBusy: ctx.batchBusy,
    rowBusy: ctx.rowBusy,
    toggleSelect: (id, isOn) => toggleSelect(ctx, id, isOn),
    selectAll: (ids) => (ctx.selected.value = new Set(ids)),
    clearSelection: () => (ctx.selected.value = new Set()),
    toggleArchive: (point, next) => toggleArchive(ctx, point, next),
    batchArchive: (next) => batchArchive(ctx, next),
  }
}
