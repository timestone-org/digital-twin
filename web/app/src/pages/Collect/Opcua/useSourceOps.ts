/**
 * @fileoverview 数据源上的写动作：启停（=连接/断开）、连通性测试、建与改。
 *
 * ⚠ 「连接 / 断开」改的是 `is_enabled`：本架构没有手动会话动作，采集器按计划
 * 自动收敛。文案要如实说「采集器几秒内接手」，不装作立刻建了会话。
 * ⚠ 连通性测试连不上也是成功返回，结论在 `is_reachable` 里——按结论报错。
 *
 * 每个动作都是模块级函数、显式收一个 `Ctx`：composable 只负责把 ref 接起来。
 */
import { ref, type Ref } from 'vue'
import type {
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
} from '@dt/contracts'
import { useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'

interface Ctx {
  toast: ReturnType<typeof useToast>
  reload: () => Promise<void>
  busyId: Ref<string | null>
  formOpen: Ref<boolean>
  formSource: Ref<CollectSource | null>
}

export interface SourceOps {
  /** 正在做启停 / 连通性测试的源 id（按钮 loading）。 */
  busyId: Ref<string | null>
  formOpen: Ref<boolean>
  formSource: Ref<CollectSource | null>
  openCreate: () => void
  openEdit: (source: CollectSource) => void
  /** 连接 = 拨成启用；断开 = 拨成停用。 */
  setEnabled: (source: CollectSource, next: boolean) => Promise<void>
  test: (source: CollectSource) => Promise<void>
  create: (input: CollectSourceCreateInput) => Promise<string | null>
  update: (input: CollectSourceUpdateInput) => Promise<void>
}

async function setEnabled(
  ctx: Ctx,
  source: CollectSource,
  next: boolean,
): Promise<void> {
  ctx.busyId.value = source.id
  try {
    await collect.updateSource(source.id, { is_enabled: next })
    ctx.toast.success(
      next
        ? `「${source.name}」已发起连接，采集器几秒内接手`
        : `「${source.name}」已断开（停用采集）`,
    )
    await ctx.reload()
  } catch (caught) {
    ctx.toast.error(describeError(caught))
  } finally {
    ctx.busyId.value = null
  }
}

async function test(ctx: Ctx, source: CollectSource): Promise<void> {
  ctx.busyId.value = source.id
  try {
    const result = await collect.testSource(source.id)
    if (result.is_reachable) ctx.toast.success(`「${source.name}」连得上`)
    else ctx.toast.error(result.detail ?? `「${source.name}」连不上`)
  } catch (caught) {
    ctx.toast.error(describeError(caught))
  } finally {
    ctx.busyId.value = null
  }
}

async function create(
  ctx: Ctx,
  input: CollectSourceCreateInput,
): Promise<string | null> {
  try {
    const created = await collect.createSource(input)
    ctx.formOpen.value = false
    ctx.toast.success('数据源已创建')
    await ctx.reload()
    return created.id
  } catch (caught) {
    ctx.toast.error(describeError(caught))
    return null
  }
}

async function update(
  ctx: Ctx,
  input: CollectSourceUpdateInput,
): Promise<void> {
  const target = ctx.formSource.value
  if (target === null) return
  try {
    await collect.updateSource(target.id, input)
    ctx.formOpen.value = false
    ctx.toast.success('数据源已保存')
    await ctx.reload()
  } catch (caught) {
    ctx.toast.error(describeError(caught))
  }
}

/**
 * 造一套数据源写动作。
 * @param reload 改动落库后刷新列表
 */
export function useSourceOps(reload: () => Promise<void>): SourceOps {
  const ctx: Ctx = {
    toast: useToast(),
    reload,
    busyId: ref<string | null>(null),
    formOpen: ref(false),
    formSource: ref<CollectSource | null>(null),
  }
  return {
    busyId: ctx.busyId,
    formOpen: ctx.formOpen,
    formSource: ctx.formSource,
    openCreate: () => {
      ctx.formSource.value = null
      ctx.formOpen.value = true
    },
    openEdit: (source) => {
      ctx.formSource.value = source
      ctx.formOpen.value = true
    },
    setEnabled: (source, next) => setEnabled(ctx, source, next),
    test: (source) => test(ctx, source),
    create: (input) => create(ctx, input),
    update: (input) => update(ctx, input),
  }
}
