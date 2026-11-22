/** @fileoverview 来源列表与人工同步；关闭、切库、卸载作废列表请求。 */
import { onScopeDispose } from 'vue'
import type { KnowledgeSourceMetadataPatch } from '@dt/contracts'
import {
  createSource,
  listSources,
  syncSource,
  updateSourceMetadata,
  detachSource,
} from '@/api/knowledge'
import type { KnowledgeSource, PlatformSourceConfig } from '@/api/knowledge'
import { messageOf } from './knowledgeState'
import { isCursorPlatformPath } from './sourcePath'
import { supportsSourceManagement } from './sourceMetadata'
import { canWrite, createSourceState, isCurrent } from './knowledgeSourceState'
import type { SourceState } from './knowledgeSourceState'

function cancel(state: SourceState): void {
  state.race.cancel()
  state.sources.value = []
  state.error.value = ''
  state.result.value = ''
  state.isLoading.value = false
}

async function reload(state: SourceState): Promise<void> {
  const wanted = state.baseId()
  if (wanted === '' || !isCurrent(state, wanted)) return
  state.isLoading.value = true
  state.error.value = ''
  await state.race.run((signal) => listSources(wanted, signal), {
    ok: (rows) => {
      state.sources.value = rows
    },
    fail: (cause) => {
      state.error.value = messageOf(cause)
    },
    settled: () => {
      state.isLoading.value = false
    },
  })
}

async function add(
  state: SourceState,
  name: string,
  config: PlatformSourceConfig,
): Promise<boolean> {
  if (!canWrite(state)) return false
  const wanted = state.baseId()
  state.isBusy.value = true
  state.error.value = ''
  state.result.value = ''
  try {
    const source = await createSource(wanted, {
      kind: 'platform',
      name,
      config,
    })
    if (!isCurrent(state, wanted)) return false
    state.sources.value = [...state.sources.value, source]
    state.result.value =
      '已添加来源；尚未同步，点击对应来源的同步按钮开始摄取。'
    return true
  } catch (cause) {
    if (isCurrent(state, wanted)) state.error.value = messageOf(cause)
    return false
  } finally {
    state.isBusy.value = false
  }
}

function syncResult(made: Awaited<ReturnType<typeof syncSource>>): string {
  const tail = made.hasMore
    ? '还有更多资料，请再次同步继续。'
    : '本次同步已完成。'
  return `已登记 ${made.registered} 条，重复跳过 ${made.skipped} 条。${tail}`
}

async function sync(
  state: SourceState,
  source: KnowledgeSource,
): Promise<boolean> {
  if (
    !canWrite(state) ||
    source.baseId !== state.baseId() ||
    source.kind !== 'platform' ||
    isCursorPlatformPath(source.config.path)
  )
    return false
  const wanted = state.baseId()
  state.isBusy.value = true
  state.error.value = ''
  state.result.value = ''
  try {
    const accepted = await state.confirm.ask({
      title: '同步知识来源',
      message: `「${source.name}」用你当前的权限读取平台资料；摄入后拥有 knowledge:use 的用户可检索这些资料。`,
      confirmText: '同步',
    })
    if (!accepted || !isCurrent(state, wanted)) return false
    const made = await syncSource(source.id)
    if (!isCurrent(state, wanted)) return false
    state.result.value = syncResult(made)
    await reload(state)
    return true
  } catch (cause) {
    if (isCurrent(state, wanted)) state.error.value = messageOf(cause)
    return false
  } finally {
    state.isBusy.value = false
  }
}

async function manageSource(
  state: SourceState,
  source: KnowledgeSource,
  changes?: KnowledgeSourceMetadataPatch,
): Promise<boolean> {
  if (!canWrite(state) || !supportsSourceManagement(source)) return false
  const wanted = state.baseId()
  state.isBusy.value = true
  state.error.value = ''
  state.result.value = ''
  try {
    if (changes) {
      const updated = await updateSourceMetadata(source.id, changes)
      if (!isCurrent(state, wanted)) return false
      state.sources.value = state.sources.value.map((row) =>
        row.id === source.id ? updated : row,
      )
      state.result.value = '已保存来源配置'
    } else {
      const accepted = await state.confirm.ask({
        title: '解绑来源',
        message: `停止「${source.name}」的后续同步。已导入的原文、检索结果与引用会保留。`,
        confirmText: '解绑',
        danger: true,
      })
      if (!accepted || !isCurrent(state, wanted)) return false
      await detachSource(source.id)
      if (!isCurrent(state, wanted)) return false
      state.sources.value = state.sources.value.filter(
        (row) => row.id !== source.id,
      )
      state.result.value = '来源已解绑，已导入的资料仍可阅读'
    }
    return true
  } catch (cause) {
    if (isCurrent(state, wanted)) state.error.value = messageOf(cause)
    return false
  } finally {
    state.isBusy.value = false
  }
}

export function useKnowledgeSources(
  baseId: () => string,
  isOpen: () => boolean,
) {
  const state = createSourceState(baseId, isOpen)
  onScopeDispose(() => {
    state.isDisposed = true
    state.race.cancel()
  })
  return {
    ...state,
    cancel: () => cancel(state),
    reload: () => reload(state),
    add: (name: string, config: PlatformSourceConfig) =>
      add(state, name, config),
    sync: (source: KnowledgeSource) => sync(state, source),
    edit: (source: KnowledgeSource, changes: KnowledgeSourceMetadataPatch) =>
      manageSource(state, source, changes),
    detach: (source: KnowledgeSource) => manageSource(state, source),
  }
}
