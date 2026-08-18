/**
 * @fileoverview 点位表上「建 / 改 / 写值 / 导出」的弹窗状态与提交编排。
 * 真正的请求与口径在 `usePointOps`；这里只管弹窗开合与成功后的刷新。
 *
 * 每个动作都是模块级函数、显式收一个 `Ctx`：composable 只负责把 ref 接起来。
 */
import { ref, type Ref } from 'vue'
import type {
  CollectPoint,
  CollectPointItemInput,
  CollectPointUpdateInput,
} from '@dt/contracts'

import type { PointOps } from './usePointOps'

interface Ctx {
  ops: PointOps
  reload: () => Promise<void>
  formOpen: Ref<boolean>
  editing: Ref<CollectPoint | null>
  writeOpen: Ref<boolean>
  writing: Ref<CollectPoint | null>
  exporting: Ref<boolean>
}

export interface PointEditing {
  formOpen: Ref<boolean>
  editing: Ref<CollectPoint | null>
  writeOpen: Ref<boolean>
  writing: Ref<CollectPoint | null>
  importOpen: Ref<boolean>
  exporting: Ref<boolean>
  openCreate: () => void
  openEdit: (point: CollectPoint) => void
  openWrite: (point: CollectPoint) => void
  create: (item: CollectPointItemInput) => Promise<void>
  update: (input: CollectPointUpdateInput) => Promise<void>
  write: (payload: { value: unknown; key: string }) => Promise<void>
  exportCsv: (sourceCode: string) => Promise<void>
}

async function create(ctx: Ctx, item: CollectPointItemInput): Promise<void> {
  if (!(await ctx.ops.create(item))) return
  ctx.formOpen.value = false
  await ctx.reload()
}

async function update(ctx: Ctx, input: CollectPointUpdateInput): Promise<void> {
  const target = ctx.editing.value
  if (target === null) return
  if (!(await ctx.ops.update(target.id, input))) return
  ctx.formOpen.value = false
  await ctx.reload()
}

async function write(
  ctx: Ctx,
  payload: { value: unknown; key: string },
): Promise<void> {
  const target = ctx.writing.value
  if (target === null) return
  if (await ctx.ops.write(target, payload)) ctx.writeOpen.value = false
}

async function exportCsv(ctx: Ctx, sourceCode: string): Promise<void> {
  if (ctx.exporting.value) return
  ctx.exporting.value = true
  try {
    await ctx.ops.exportCsv(sourceCode)
  } finally {
    ctx.exporting.value = false
  }
}

/**
 * 造一套点位编辑编排。
 * @param ops 点位写动作
 * @param reload 改动落库后刷新当前页
 */
export function usePointEditing(
  ops: PointOps,
  reload: () => Promise<void>,
): PointEditing {
  const ctx: Ctx = {
    ops,
    reload,
    formOpen: ref(false),
    editing: ref<CollectPoint | null>(null),
    writeOpen: ref(false),
    writing: ref<CollectPoint | null>(null),
    exporting: ref(false),
  }
  return {
    formOpen: ctx.formOpen,
    editing: ctx.editing,
    writeOpen: ctx.writeOpen,
    writing: ctx.writing,
    importOpen: ref(false),
    exporting: ctx.exporting,
    openCreate: () => {
      ctx.editing.value = null
      ctx.formOpen.value = true
    },
    openEdit: (point) => {
      ctx.editing.value = point
      ctx.formOpen.value = true
    },
    openWrite: (point) => {
      ctx.writing.value = point
      ctx.writeOpen.value = true
    },
    create: (item) => create(ctx, item),
    update: (input) => update(ctx, input),
    write: (payload) => write(ctx, payload),
    exportCsv: (sourceCode) => exportCsv(ctx, sourceCode),
  }
}
