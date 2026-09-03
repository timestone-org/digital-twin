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

import { useFormDirty } from '@/composables/useFormDirty'

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

interface DeploymentForm {
  code: string
  name: string
  versionId: string
  maxRows: number
  rateLimit: number
}

// 新开一个时的缺省。⚠ 与后端的 server_default 同一份口径
const BLANK: DeploymentForm = {
  code: '',
  name: '',
  versionId: '',
  maxRows: 200,
  rateLimit: 60,
}

const form = ref<DeploymentForm>({ ...BLANK })

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
  () => props.editing !== null || CODE_SHAPE.test(form.value.code),
)
const canSubmit = computed(
  () =>
    form.value.name.trim() !== '' &&
    form.value.versionId !== '' &&
    isCodeValid.value,
)

// ⚠ 这个弹窗有五个输入，关掉前必须问一句：直接关等于把刚填的一整屏悄悄丢掉
const dirty = useFormDirty(() => form.value)

/** 打开时按「改哪一行」回填；新开一个就回到缺省。 */
function refill(row: ModelDeployment | null): DeploymentForm {
  if (row === null) {
    return { ...BLANK, versionId: options.value[0]?.value ?? '' }
  }
  return {
    code: row.code,
    name: row.name,
    versionId: row.model_version_id,
    maxRows: row.max_rows_per_call,
    rateLimit: row.rate_limit_per_minute,
  }
}

watch(
  () => [props.isOpen, props.editing] as const,
  () => {
    form.value = refill(props.editing)
    dirty.markClean()
  },
  { immediate: true, flush: 'post' },
)

function submit(): void {
  emit('submit', {
    code: form.value.code.trim(),
    model_version_id: form.value.versionId,
    name: form.value.name.trim(),
    max_rows_per_call: form.value.maxRows,
    rate_limit_per_minute: form.value.rateLimit,
  })
}
</script>

<template>
  <DtModal
    :model-value="props.isOpen"
    :title="props.editing ? '改对外服务' : '开一个对外服务'"
    width="32rem"
    :dirty="dirty.isDirty.value"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="options.length === 0" intent="warning">
        还没有可上线的模型版本。先在模型库里发布一个，再回来开服务。
      </DtNotice>
      <DtInput
        v-model="form.code"
        label="对外标识"
        hint="第三方调的地址是 /api/v1/platform/open-models/<标识>；小写字母、数字与连字符，建后不可改"
        :disabled="props.editing !== null"
        required
      />
      <DtNotice v-if="form.code !== '' && !isCodeValid" intent="danger">
        只能用小写字母、数字与连字符，且要以字母或数字开头。
      </DtNotice>
      <DtInput v-model="form.name" label="名称" required />
      <DtSelect
        v-model="form.versionId"
        label="钉住的模型版本"
        hint="换版本时第三方不必改代码——地址跟着标识走，不跟着版本走"
        :options="options"
      />
      <DtInput
        v-model.number="form.maxRows"
        type="number"
        label="单次最多算几行"
        :min="1"
        :max="MAX_ROWS"
        hint="超过就 400 并说清上限"
      />
      <DtInput
        v-model.number="form.rateLimit"
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
