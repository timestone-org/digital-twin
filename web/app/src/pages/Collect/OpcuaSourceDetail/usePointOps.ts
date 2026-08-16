/**
 * @fileoverview 点位表上那几个写动作：建、改、删、下发写值、导出。
 *
 * 从面板里拆出来不是为了短，是因为这几件各自都有一条**不能省的口径**，
 * 混在渲染逻辑里迟早被人顺手改掉：
 * - 寻址串校验的 `unverified` 档必须如实提示，不许当成通过。
 * - 删点位被大屏绑着时会 409，确认文案要先把这件事说清。
 * - 写值失败**绝不自动重试**，幂等键由弹窗那次意图带过来。
 *
 * 每个动作都是模块级函数、显式收一个 `deps`：composable 只负责把 toast 与
 * confirm 取出来接上，这样动作本身在测试里不需要挂组件实例。
 */
import type {
  CollectPoint,
  CollectPointItemInput,
  CollectPointUpdateInput,
} from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { downloadCsv } from '@/utils/downloadJson'
import { pointsToCsv } from './pointCsv'

/** 拉全量点位时一次取多少条。⚠ 与后端单页上限对齐，取大了会被 422。 */
const PAGE_SIZE = 100

interface Deps {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  sourceId: () => string
}

export interface PointOps {
  create: (item: CollectPointItemInput) => Promise<boolean>
  update: (pointId: string, input: CollectPointUpdateInput) => Promise<boolean>
  remove: (point: CollectPoint) => Promise<boolean>
  write: (
    point: CollectPoint,
    payload: { value: unknown; key: string },
  ) => Promise<boolean>
  exportCsv: (sourceCode: string) => Promise<void>
  /** 取这个数据源下的全部点位。导出与冲突预检共用。 */
  fetchAll: () => Promise<CollectPoint[]>
}

/**
 * 校验结论如实说。
 * ⚠ `unverified` 不是「通过」：采集侧离线或超时都落这一档，静默当成通过会让
 * 一条根本读不到的寻址串看起来完全正常。
 */
function warnUnverified(deps: Deps, checks: readonly { status: string }[]): void {
  if (checks.some((check) => check.status === 'unverified')) {
    deps.toast.warning('寻址串这次没能到现场确认，采集起来之后请核对是否有值')
  }
}

/** 翻完这个数据源下的全部点位。 */
async function fetchAll(deps: Deps): Promise<CollectPoint[]> {
  const all: CollectPoint[] = []
  let page = 1
  for (;;) {
    const chunk = await collect.listPoints({
      sourceId: deps.sourceId(),
      page,
      size: PAGE_SIZE,
    })
    all.push(...chunk.items)
    if (all.length >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  return all
}

async function createPoint(
  deps: Deps,
  item: CollectPointItemInput,
): Promise<boolean> {
  try {
    const batch = await collect.createPoints({
      source_id: deps.sourceId(),
      items: [item],
    })
    warnUnverified(deps, batch.address_checks)
    deps.toast.success('点位已创建')
    return true
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return false
  }
}

async function updatePoint(
  deps: Deps,
  pointId: string,
  input: CollectPointUpdateInput,
): Promise<boolean> {
  try {
    const saved = await collect.updatePoint(pointId, input)
    warnUnverified(deps, saved.address_check === null ? [] : [saved.address_check])
    deps.toast.success('点位已保存')
    return true
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return false
  }
}

async function removePoint(deps: Deps, point: CollectPoint): Promise<boolean> {
  const ok = await deps.confirm.ask({
    title: '删除点位',
    message:
      `删除「${point.name}」（${point.code}）不可恢复。它已归档的历史会保留，` +
      '按编码存放；被大屏绑着时删除会被拒绝并列出那些大屏。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return false
  try {
    await collect.deletePoint(point.id)
    deps.toast.success('点位已删除')
    return true
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return false
  }
}

/** 下发写值。⚠ 失败不自动重试——超时不代表没写成功。 */
async function writeValue(
  deps: Deps,
  point: CollectPoint,
  payload: { value: unknown; key: string },
): Promise<boolean> {
  try {
    const result = await collect.writePoint(
      point.id,
      payload.value,
      payload.key,
    )
    if (result.is_written) {
      deps.toast.success(`已向「${point.name}」下发`)
      return true
    }
    deps.toast.error('采集侧没有确认写入，请核对设备状态后再决定是否重来')
    return false
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return false
  }
}

async function exportPoints(deps: Deps, sourceCode: string): Promise<void> {
  try {
    const all = await fetchAll(deps)
    downloadCsv(pointsToCsv(all), `${sourceCode}-点位`)
    deps.toast.success(`已导出 ${all.length} 个点位`)
  } catch (caught) {
    deps.toast.error(describeError(caught))
  }
}

/**
 * 造一套点位写动作。
 * @param sourceId 取当前数据源 id
 */
export function usePointOps(sourceId: () => string): PointOps {
  const deps: Deps = {
    toast: useToast(),
    confirm: useConfirm(),
    sourceId,
  }
  return {
    create: (item) => createPoint(deps, item),
    update: (pointId, input) => updatePoint(deps, pointId, input),
    remove: (point) => removePoint(deps, point),
    write: (point, payload) => writeValue(deps, point, payload),
    exportCsv: (sourceCode) => exportPoints(deps, sourceCode),
    fetchAll: () => fetchAll(deps),
  }
}
