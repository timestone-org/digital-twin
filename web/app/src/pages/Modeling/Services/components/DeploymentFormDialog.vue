<script setup lang="ts">
/**
 * @fileoverview 开一个对外服务，或改它的配置。
 *
 * ⚠ `code` 建后不可改：它就是第三方代码里写着的那个地址段。改一次等于让每一家
 * 对接方当场 404（docs/MODELING_PLATFORM_DESIGN.md D13）。
 */
import type { ModelDeployment, ModelingVersionSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

// 配额的两个上限，与库上的 CHECK 同一份口径
const MAX_ROWS = 1000
const MAX_RATE = 6000
// 对外标识的形状。⚠ 与后端的 CHECK 逐字一致：两边不同就是「界面收得下、
// 落库时才拒」
const CODE_SHAPE = /^[a-z0-9][a-z0-9-]{1,62}$/

const props = defineProps<{
  /** `null` 表示新开一个；给了行就是改它。 */
  editing: ModelDeployment | null
  isOpen: boolean
  isBusy: boolean
  versions: readonly ModelingVersionSummary[]
}>()

const emit = defineEmits<{
  submit: [
    payload: {
      code: string
      model_version_id: string
      name: string
      max_rows_per_call: number
      rate_limit_per_minute: number
    },
  ]
  close: []
}>()

const code = ref('')
const name = ref('')
const versionId = ref('')
const maxRows = ref(200)
const rateLimit = ref(60)

/** 只有可上线的版本能开出去。 */
const options = computed(() =>
  props.versions
    .filter((row) => row.is_servable)
    .map((row) => ({
      value: row.id,
      label: `${row.name} v${row.version}`,
    })),
)

const isCodeValid = computed(
  () => props.editing !== null || CODE_SHAPE.test(code.value),
)
const canSubmit = computed(
  () =>
    name.value.trim() !== '' && versionId.value !== '' && isCodeValid.value,
)

watch(
  () => [props.isOpen, props.editing] as const,
  () => {
    const row = props.editing
    code.value = row?.code ?? ''
    name.value = row?.name ?? ''
    versionId.value = row?.model_version_id ?? options.value[0]?.value ?? ''
    maxRows.value = row?.max_rows_per_call ?? 200
    rateLimit.value = row?.rate_limit_per_minute ?? 60
  },
  { immediate: true },
)

function submit(): void {
  emit('submit', {
    code: code.value.trim(),
    model_version_id: versionId.value,
    name: name.value.trim(),
    max_rows_per_call: maxRows.value,
    rate_limit_per_minute: rateLimit.value,
  })
}
</script>

<template>
  <DtModal
    :model-value="props.isOpen"
    :title="props.editing ? '改对外服务' : '开一个对外服务'"
    width="32rem"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="options.length === 0" intent="warning">
        还没有可上线的模型版本。先在模型库里发布一个，再回来开服务。
      </DtNotice>
      <DtInput
        v-model="code"
        label="对外标识"
        hint="第三方调的地址是 /api/v1/platform/open-models/<标识>；小写字母、数字与连字符，建后不可改"
        :disabled="props.editing !== null"
        required
      />
      <DtNotice v-if="code !== '' && !isCodeValid" intent="danger">
        只能用小写字母、数字与连字符，且要以字母或数字开头。
      </DtNotice>
      <DtInput v-model="name" label="名称" required />
      <DtSelect
        v-model="versionId"
        label="钉住的模型版本"
        hint="换版本时第三方不必改代码——地址跟着标识走，不跟着版本走"
        :options="options"
      />
      <DtInput
        v-model.number="maxRows"
        type="number"
        label="单次最多算几行"
        :min="1"
        :max="MAX_ROWS"
        hint="超过就 400 并说清上限"
      />
      <DtInput
        v-model.number="rateLimit"
        type="number"
        label="每分钟最多调几次"
        :min="1"
        :max="MAX_RATE"
        hint="按密钥计。边缘还有一层按来源 IP 的闸，两层缺一不可"
      />
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton :disabled="!canSubmit" :loading="props.isBusy" @click="submit">
        {{ props.editing ? '保存' : '开通' }}
      </DtButton>
    </template>
  </DtModal>
</template>
