/** @fileoverview 回填写操作逐次确认与未知结果处理；业务权限仍由后台强制检查。 */
import type { Ref } from 'vue'
import type { DatasetBackfillJob, DatasetTable } from '@dt/contracts'
import { ERROR_CODES, PERMISSION_CODES } from '@dt/contracts'
import { useConfirm, type DtConfirmRequest } from '@dt/ui'
import * as dataset from '@/api/dataset'
import { BizError, TransportError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
import { useAuthStore } from '@/stores/auth'
import { backfillRangeProblem, backfillTime } from './backfillView'

/** 回填面板的状态；读与写两半共用这一份。 */
export interface BackfillState {
  isOpen: Ref<boolean>
  job: Ref<DatasetBackfillJob | null>
  since: Ref<string>
  until: Ref<string>
  loading: Ref<boolean>
  /** 正在等确认或写请求在飞。 */
  busy: Ref<boolean>
  /** 上一次写或读的结果不明：此时禁止再发写，免得重复启动。 */
  uncertain: Ref<boolean>
  error: Ref<string | null>
  notice: Ref<string | null>
}

/** 写这一半还要读那一半给的几个回调。 */
interface BackfillActionState extends BackfillState {
  refresh: () => Promise<void>
  schedule: () => void
  stopPolling: () => void
  cancelRead: () => void
  isAlive: () => boolean
}

interface ActionContext {
  table: () => DatasetTable
  state: BackfillActionState
  auth: ReturnType<typeof useAuthStore>
  confirm: ReturnType<typeof useConfirm>
}

/**
 * 此刻还能不能写这张表：没卸载、没换表、是汇总台账且有回填权限。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 */
function writeAllowed(ctx: ActionContext, id: string): boolean {
  return (
    ctx.state.isAlive() &&
    ctx.table().id === id &&
    ctx.table().collect_mode === 'aggregate' &&
    ctx.auth.can([PERMISSION_CODES.datasetBackfill])
  )
}

/**
 * 能不能发起新的写：在 `writeAllowed` 之上还要求没有读在飞、没有写在飞、结果不是未知。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 */
function canAct(ctx: ActionContext, id: string): boolean {
  const { loading, busy, uncertain } = ctx.state
  return (
    writeAllowed(ctx, id) && !loading.value && !busy.value && !uncertain.value
  )
}

/**
 * 确认过了却没派发写（拒绝、关窗、换表）时把锁还回去；换了表就读新表的实际任务。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 */
function releaseUndispatched(ctx: ActionContext, id: string): void {
  const state = ctx.state
  if (!state.isAlive()) return
  state.busy.value = false
  if (ctx.table().id !== id) void state.refresh()
  else state.schedule()
}

/**
 * 确认回来之后还能不能继续派发；不能就顺手还锁。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 * @param agreed 用户是否点了确认
 */
function canResume(ctx: ActionContext, id: string, agreed: boolean): boolean {
  if (!agreed) return false
  if (writeAllowed(ctx, id) && ctx.state.isOpen.value) return true
  releaseUndispatched(ctx, id)
  return false
}

/**
 * 写失败的落点。409 冲突返回 true，调用方据此去读实际任务；超时、5xx 与传输错误
 * 结果未知，置 `uncertain` 锁写，不许用户再点一次重复启动。
 * @param state 回填状态
 * @param caught 写请求抛出的错误
 */
function applyWriteError(state: BackfillActionState, caught: unknown): boolean {
  if (
    caught instanceof BizError &&
    (caught.code === ERROR_CODES.datasetBackfillBusy ||
      caught.code === ERROR_CODES.datasetBackfillNotRunning)
  ) {
    state.notice.value =
      caught.code === ERROR_CODES.datasetBackfillBusy
        ? '已有任务正在执行，尝试重新读取实际进度。'
        : '任务已不在运行，尝试重新读取实际状态。'
    return true
  }
  state.uncertain.value =
    caught instanceof TransportError ||
    !(caught instanceof BizError) ||
    caught.status >= 500
  state.error.value = state.uncertain.value
    ? `操作状态未确认：${describeError(caught)}。请手动刷新进度核查，不要重复启动。`
    : describeError(caught)
  return false
}

/**
 * 派发一次写并落回执；换表或冲突后读实际任务，否则按状态续轮询。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 * @param action 真正的写请求
 * @param successNotice 回执仍在运行时给的提示
 */
async function execute(
  ctx: ActionContext,
  id: string,
  action: () => Promise<DatasetBackfillJob>,
  successNotice: string | null = null,
): Promise<void> {
  const state = ctx.state
  let conflict = false
  try {
    const result = await action()
    if (writeAllowed(ctx, id)) {
      state.job.value = result
      state.error.value = null
      state.uncertain.value = false
      state.notice.value = result.status === 'running' ? successNotice : null
    }
  } catch (caught) {
    if (writeAllowed(ctx, id)) conflict = applyWriteError(state, caught)
  } finally {
    if (state.isAlive()) {
      state.busy.value = false
      if (ctx.table().id !== id || conflict) await state.refresh()
      else state.schedule()
    }
  }
}

/**
 * 逐次确认；等确认期间锁写、停轮询、作废在飞的读。
 * @param ctx 写操作上下文
 * @param id 发起写时的那张台账
 * @param request 确认框内容
 */
async function ask(
  ctx: ActionContext,
  id: string,
  request: DtConfirmRequest,
): Promise<boolean> {
  const state = ctx.state
  state.busy.value = true
  state.stopPolling()
  state.cancelRead()
  const agreed = await ctx.confirm.ask(request)
  if (!state.isAlive()) return false
  if (agreed && state.isOpen.value && writeAllowed(ctx, id)) return true
  releaseUndispatched(ctx, id)
  return false
}

/**
 * 开始回填：校验范围、确认、派发。
 * @param ctx 写操作上下文
 */
async function start(ctx: ActionContext): Promise<void> {
  const { table, state } = ctx
  const id = table().id
  if (!canAct(ctx, id) || state.job.value?.status === 'running') return
  const input = { since: state.since.value, until: state.until.value }
  state.error.value = backfillRangeProblem(input.since, input.until)
  if (state.error.value !== null) return
  const agreed = await ask(ctx, id, {
    title: '开始历史桶回填？',
    confirmText: '确认开始',
    message: `${table().name}：${backfillTime(input.since)} 至 ${backfillTime(input.until)}（本地时间）。按汇总周期重建历史桶并重算后续公式；可能更新已有自动采集值，人工修正保留。实际范围以后台对齐、裁剪结果为准。`,
  })
  if (!canResume(ctx, id, agreed)) return
  state.notice.value = null
  await execute(ctx, id, () => dataset.startDatasetBackfill(id, input))
}

/**
 * 取消运行中的回填：确认、派发；已写入的桶不回滚。
 * @param ctx 写操作上下文
 */
async function cancel(ctx: ActionContext): Promise<void> {
  const id = ctx.table().id
  if (!canAct(ctx, id) || ctx.state.job.value?.status !== 'running') return
  const agreed = await ask(ctx, id, {
    title: '取消历史桶回填？',
    confirmText: '确认取消',
    danger: true,
    message: `${ctx.table().name}：将在当前批次结束后取消。已经写入的历史桶会保留，并继续进行后续公式重算。`,
  })
  if (!canResume(ctx, id, agreed)) return
  await execute(
    ctx,
    id,
    () => dataset.cancelDatasetBackfill(id),
    '已请求取消，等待后台实际终态；已写入的数据不会回滚。',
  )
}

/**
 * 装上回填的写操作。
 * @param table 取当前台账
 * @param state 读那一半给的状态与回调
 */
export function useBackfillActions(
  table: () => DatasetTable,
  state: BackfillActionState,
) {
  const ctx: ActionContext = {
    table,
    state,
    auth: useAuthStore(),
    confirm: useConfirm(),
  }
  return { start: () => start(ctx), cancel: () => cancel(ctx) }
}
