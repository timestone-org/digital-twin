<script setup lang="ts">
/** @fileoverview 复制模型已保存的独立流水线，创建可优化结构的新设计。 */
import type { ModelingInstance } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { createModelingPipeline, getModelingPipeline } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ instance: ModelingInstance | null }>()
const emit = defineEmits<{ close: [] }>()
const auth = useAuthStore()
const router = useRouter()
const operation = useRacedFetch()
const name = ref('')
const code = ref('')
const description = ref('')
const error = ref('')
const busy = ref(false)
const canManage = computed(() => auth.can([PERMISSION_CODES.modelingManage]))
const codeError = computed(() =>
  code.value === '' || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code.value)
    ? ''
    : '使用字母或数字开头，限字母、数字、点、下划线和连字符，最多 64 个字符',
)
const valid = computed(
  () => name.value.trim() !== '' && code.value !== '' && codeError.value === '',
)
const dirty = useFormDirty(() => [name.value, code.value, description.value])

watch(
  () => props.instance?.id ?? '',
  () => {
    operation.cancel()
    busy.value = false
    name.value = props.instance
      ? `${props.instance.name} 优化`.slice(0, 128)
      : ''
    code.value = ''
    description.value = props.instance?.description ?? ''
    error.value = ''
    dirty.markClean()
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => operation.cancel())
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)

async function create(): Promise<void> {
  const instance = props.instance
  if (!instance || !canManage.value || !valid.value || busy.value) return
  const details = {
    code: code.value,
    name: name.value.trim(),
    description: description.value.trim() || null,
  }
  busy.value = true
  error.value = ''
  await operation.run(
    async (signal) => {
      const source = await getModelingPipeline(instance.id, signal)
      if (signal.aborted) return null
      return await createModelingPipeline({ ...details, graph: source.graph })
    },
    {
      ok: (created) => {
        if (!created) return
        busy.value = false
        dirty.markClean()
        emit('close')
        void router.push(`/modeling/pipelines/${created.id}`)
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        busy.value = false
      },
    },
  )
}
</script>

<template>
  <DtModal
    :model-value="instance !== null && canManage"
    title="优化流水线结构"
    width="48rem"
    :dirty="dirty.isDirty.value"
    :close-on-backdrop="!busy"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="info">
        从此模型已保存的流水线与参数创建独立的流水线设计，可继续调整算子与连线。
        保存并发布新工作流后，再创建模型、训练和部署。当前模型与线上部署保持固定。
      </DtNotice>
      <div class="dt-form-grid">
        <DtInput
          v-model="name"
          label="新设计名称"
          :maxlength="128"
          :disabled="busy"
          required
        />
        <DtInput
          v-model="code"
          label="新设计编码"
          hint="请填写未使用的编码，创建后保持不变。"
          :maxlength="64"
          :error="codeError"
          :disabled="busy"
          required
        />
        <DtTextarea
          v-model="description"
          class="dt-form-grid__wide"
          label="说明（选填）"
          :maxlength="512"
          :rows="2"
          :disabled="busy"
        />
      </div>
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </div>
    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="emit('close')">
        取消
      </DtButton>
      <DtButton :disabled="!valid || busy" @click="void create()">
        {{ busy ? '正在创建…' : '创建并进入流程图' }}
      </DtButton>
    </template>
  </DtModal>
</template>
