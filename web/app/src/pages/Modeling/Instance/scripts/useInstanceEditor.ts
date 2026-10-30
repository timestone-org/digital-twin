/** @fileoverview 模型配置草稿、竞态保护和训练状态轮询。 */
import type { ModelingConfigurationDetail } from '@dt/contracts'
import { onBeforeUnmount, watch } from 'vue'
import type { Ref } from 'vue'
import { createState, resetEditorContext } from './instanceState'
import type { EditorState } from './instanceState'
import * as api from '@/api/modelingTemplates'
import { listModelingRuns, listModelingVersions } from '@/api/modeling'
import { describeModelingError } from '../../scripts/instancePresentation'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { isTraining } from '../../scripts/instancePresentation'

class InstanceReads {
  private readonly reader = useRacedFetch()
  private readonly statusReader = useRacedFetch()
  private poll: ReturnType<typeof setTimeout> | undefined
  isDisposed = false
  constructor(
    private readonly id: Ref<string>,
    private readonly state: EditorState,
  ) {}

  async load(runId?: string): Promise<void> {
    const state = this.state
    state.loading.value = true
    state.error.value = ''
    this.statusReader.cancel()
    clearTimeout(this.poll)
    await this.reader.run(
      (signal) =>
        Promise.all([
          api.getInstanceConfiguration(this.id.value, signal),
          runId
            ? api.getInstanceConfiguration(this.id.value, signal, runId)
            : Promise.resolve(null),
        ]),
      {
        ok: ([current, historical]) =>
          this.applyConfiguration(current, historical ?? current, runId ?? ''),
        fail: (caught) => {
          state.error.value = describeModelingError(caught)
        },
        settled: () => {
          state.loading.value = false
        },
      },
    )
  }

  private applyConfiguration(
    current: ModelingConfigurationDetail,
    configuration: ModelingConfigurationDetail,
    sourceRunId: string,
  ): void {
    const state = this.state
    const model = current.instance
    if (!model) {
      state.error.value = '模型配置缺少修订信息，请重新加载'
      return
    }
    state.instance.value = model
    state.detail.value = configuration
    state.draft.value = JSON.stringify(configuration.configuration, null, 2)
    state.name.value = model.name
    state.description.value = model.description ?? ''
    state.fieldErrors.value = {}
    state.baseline.value = JSON.stringify([
      current.configuration,
      state.name.value,
      state.description.value,
    ])
    state.baselineRevision.value = model.revision
    state.sourceRunId.value = sourceRunId
    state.resetKey.value += 1
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.isDisposed) return
    clearTimeout(this.poll)
    const state = this.state
    await this.statusReader.run(
      (signal) =>
        Promise.all([
          api.getInstance(this.id.value, signal),
          listModelingRuns(this.id.value, { size: 20 }, signal),
          listModelingVersions({ pipelineId: this.id.value, size: 20 }, signal),
        ]),
      {
        ok: ([model, history, published]) => {
          state.instance.value = model
          state.runs.value = history.items
          state.versions.value = published.items
          state.totals.value = {
            runs: history.total,
            versions: published.total,
          }
          if (isTraining(model.latest_run?.status) && !this.isDisposed)
            this.poll = setTimeout(() => void this.refresh(), 2000)
        },
        fail: (caught) => {
          state.error.value = describeModelingError(caught)
        },
        settled: () => {},
      },
    )
  }

  resetContext(): void {
    this.reader.cancel()
    this.statusReader.cancel()
    clearTimeout(this.poll)
    resetEditorContext(this.state)
  }

  isCurrent(id: string, sessionRevision: number): boolean {
    return (
      !this.isDisposed &&
      this.id.value === id &&
      this.state.sessionRevision.value === sessionRevision
    )
  }

  dispose(): void {
    this.isDisposed = true
    clearTimeout(this.poll)
    this.reader.cancel()
    this.statusReader.cancel()
  }
}

function change(
  state: EditorState,
  node: string,
  key: string,
  value: unknown,
): void {
  const configuration = state.parsed.value.value
  if (configuration)
    state.draft.value = JSON.stringify(
      {
        nodes: {
          ...configuration.nodes,
          [node]: { ...configuration.nodes[node], [key]: value },
        },
      },
      null,
      2,
    )
}

function canSave(state: EditorState, id: string): boolean {
  return (
    state.instance.value?.id === id &&
    !state.busy.value &&
    !state.fieldError.value
  )
}

async function save(
  state: EditorState,
  id: string,
  reads: InstanceReads,
): Promise<void> {
  const configuration = state.parsed.value.value
  if (!configuration || !canSave(state, id)) return
  const sessionRevision = state.sessionRevision.value
  state.busy.value = true
  state.error.value = ''
  try {
    await api.configureInstance(id, {
      expected_revision: state.baselineRevision.value,
      configuration,
      name: state.name.value,
      description: state.description.value.trim() || null,
    })
    if (reads.isCurrent(id, sessionRevision)) await reads.load()
  } catch (caught) {
    if (reads.isCurrent(id, sessionRevision))
      state.error.value = describeModelingError(caught)
  } finally {
    if (reads.isCurrent(id, sessionRevision)) state.busy.value = false
  }
}

export function useInstanceEditor(id: Ref<string>) {
  const state = createState()
  const reads = new InstanceReads(id, state)
  watch(id, () => reads.resetContext(), { flush: 'sync' })
  onBeforeUnmount(() => reads.dispose())
  return {
    ...state,
    load: () => reads.load(),
    refresh: () => reads.refresh(),
    restore: (runId: string) => reads.load(runId),
    change: (node: string, key: string, value: unknown) =>
      change(state, node, key, value),
    save: () => save(state, id.value, reads),
  }
}
