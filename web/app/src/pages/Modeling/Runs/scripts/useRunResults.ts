/** @fileoverview 历史训练及步骤结果的独立读取与竞态隔离。 */
import type {
  ModelingNodeRun,
  ModelingNodeRunSummary,
  ModelingOperator,
  ModelingRun,
} from '@dt/contracts'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import {
  getModelingNodeRun,
  getModelingRun,
  listModelingOperators,
} from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

function createState() {
  return {
    run: shallowRef<ModelingRun | null>(null),
    node: shallowRef<ModelingNodeRun | null>(null),
    nodeId: ref(''),
    operators: shallowRef<readonly ModelingOperator[]>([]),
    loading: ref(false),
    error: ref(''),
    nodeLoading: ref(false),
    nodeError: ref(''),
    catalogError: ref(''),
    runRead: useRacedFetch(),
    nodeRead: useRacedFetch(),
    catalogRead: useRacedFetch(),
  }
}
type State = ReturnType<typeof createState>
function ordered(
  nodes: readonly ModelingNodeRunSummary[],
): ModelingNodeRunSummary[] {
  return [...nodes].sort((left, right) => left.ordinal - right.ordinal)
}
function preferredNode(run: ModelingRun, preferred: string): string {
  const nodes = ordered(run.nodes)
  if (nodes.some((node) => node.node_id === preferred)) return preferred
  return (
    nodes.filter((node) => node.has_preview).at(-1)?.node_id ??
    nodes.find((node) => node.status === 'failed')?.node_id ??
    nodes.at(-1)?.node_id ??
    ''
  )
}
function clearRun(state: State): void {
  state.runRead.cancel()
  state.nodeRead.cancel()
  state.run.value = null
  state.node.value = null
  state.nodeId.value = ''
  state.loading.value = false
  state.nodeLoading.value = false
  state.error.value = ''
  state.nodeError.value = ''
}
function clearAll(state: State): void {
  clearRun(state)
  state.catalogRead.cancel()
  state.operators.value = []
  state.catalogError.value = ''
}
async function loadNode(state: State, nodeId: string): Promise<void> {
  state.nodeRead.cancel()
  state.node.value = null
  state.nodeError.value = ''
  state.nodeLoading.value = false
  const run = state.run.value
  if (!run || !run.nodes.some((node) => node.node_id === nodeId)) return
  state.nodeId.value = nodeId
  state.nodeLoading.value = true
  await state.nodeRead.run(
    (signal) => getModelingNodeRun(run.id, nodeId, signal),
    {
      ok: (result) => {
        state.node.value = result
      },
      fail: (caught) => {
        state.nodeError.value = describeError(caught)
      },
      settled: () => {
        state.nodeLoading.value = false
      },
    },
  )
}
async function loadRun(
  state: State,
  runId: string,
  preferred = '',
): Promise<void> {
  clearRun(state)
  state.loading.value = true
  await state.runRead.run((signal) => getModelingRun(runId, signal), {
    ok: (result) => {
      state.run.value = result
      const nodeId = preferredNode(result, preferred)
      state.nodeId.value = nodeId
      if (nodeId) void loadNode(state, nodeId)
    },
    fail: (caught) => {
      state.error.value = describeError(caught)
    },
    settled: () => {
      state.loading.value = false
    },
  })
}
async function loadOperators(state: State): Promise<void> {
  state.catalogError.value = ''
  await state.catalogRead.run((signal) => listModelingOperators(signal), {
    ok: (result) => {
      state.operators.value = result
    },
    fail: (caught) => {
      state.catalogError.value = describeError(caught)
    },
    settled: () => {},
  })
}
export function useRunResults(runId: () => string | null) {
  const state = createState()
  const nodes = computed(() => ordered(state.run.value?.nodes ?? []))
  const snapshot = computed(() =>
    state.run.value?.graph.nodes.find((node) => node.id === state.nodeId.value),
  )
  const operator = computed(() =>
    state.operators.value.find(
      (item) => item.code === snapshot.value?.operator,
    ),
  )
  watch(
    runId,
    (id) => {
      clearAll(state)
      if (!id) return
      void loadRun(state, id)
      void loadOperators(state)
    },
    { immediate: true },
  )
  onScopeDispose(() => clearAll(state))
  return {
    ...state,
    nodes,
    operator,
    config: computed(() => snapshot.value?.config ?? {}),
    selectNode: (id: string) => loadNode(state, id),
    refreshNode: () => loadNode(state, state.nodeId.value),
    refreshOperators: () => loadOperators(state),
    refresh: () => {
      const id = runId()
      if (id) return loadRun(state, id, state.nodeId.value)
      return Promise.resolve()
    },
  }
}
