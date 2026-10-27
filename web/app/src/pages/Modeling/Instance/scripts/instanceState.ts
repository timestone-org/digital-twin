/** @fileoverview 模型配置草稿、竞态保护和训练状态轮询。 */
import type {
  ModelingConfigurationDetail,
  ModelingInstance,
  ModelingRunSummary,
  ModelingVersionSummary,
} from '@dt/contracts'
import { computed, ref } from 'vue'
import { isTraining } from '../../scripts/instancePresentation'
import { parseConfiguration } from './parameters'
export function createState() {
  const instance = ref<ModelingInstance | null>(null)
  const detail = ref<ModelingConfigurationDetail | null>(null)
  const runs = ref<ModelingRunSummary[]>([])
  const versions = ref<ModelingVersionSummary[]>([])
  const totals = ref({ runs: 0, versions: 0 })
  const draft = ref('')
  const name = ref('')
  const description = ref('')
  const baseline = ref('')
  const baselineRevision = ref(0)
  const resetKey = ref(0)
  const error = ref('')
  const loading = ref(false)
  const busy = ref(false)
  const fieldErrors = ref<Record<string, string>>({})
  const parsed = computed(() => parseConfiguration(draft.value))
  const dirty = computed(
    () =>
      baseline.value !== '' &&
      JSON.stringify([parsed.value.value, name.value, description.value]) !==
        baseline.value,
  )
  const training = computed(() =>
    isTraining(instance.value?.latest_run?.status),
  )
  const fieldError = computed(() => getFieldError(fieldErrors.value))
  return {
    instance,
    detail,
    runs,
    versions,
    totals,
    draft,
    name,
    description,
    baseline,
    baselineRevision,
    resetKey,
    error,
    loading,
    busy,
    fieldErrors,
    parsed,
    dirty,
    training,
    fieldError,
  }
}
export type EditorState = ReturnType<typeof createState>

function getFieldError(errors: Record<string, string>): string {
  return Object.values(errors).find(Boolean) ?? ''
}
