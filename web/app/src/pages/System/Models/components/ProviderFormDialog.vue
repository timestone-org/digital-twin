<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑一路供应商的弹窗：端点、密钥、登记的模型、方言体。
 *
 * ⚠ 密钥只在这里出现一次：编辑态那一格留空即沿用旧的，界面上永远拿不回明文。
 * ⚠ 「测试连接」不落任何东西：新建态拿表单里的地址与密钥探，编辑态没填新密钥
 * 就拿库里那一把探——两条路后端分开，前端不许把旧密钥拼进请求。
 */
import { computed, ref, watch } from 'vue'
import type { DtSelectOption, LlmProvider } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtSwitch,
  DtTag,
  DtTextarea,
} from '@dt/ui'

import * as llm from '@/api/llmProviders'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import {
  emptyForm,
  emptyRow,
  formOf,
  isModelKind,
  suggestedRow,
  toCreateInput,
  toUpdateInput,
  validateForm,
  type ProviderForm,
} from '../scripts/providerForm'

const props = defineProps<{
  modelValue: boolean
  provider: LlmProvider | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const KIND_OPTIONS: readonly DtSelectOption[] = [
  { value: 'chat', label: '对话' },
  { value: 'embedding', label: '嵌入' },
]
// 方言体那一格的示例。⚠ 绑成表达式而不是写在模板属性里：JSON 里的双引号会让
// 模板属性的引号风格在 prettier 与 eslint 之间打架
const EXTRA_BODY_EXAMPLE = '例如 {"enable_thinking": true}'

const form = ref<ProviderForm>(emptyForm())
const busy = ref(false)
const probing = ref(false)
const error = ref<string | null>(null)
const probe = ref<{ isOk: boolean; message: string; names: string[] } | null>(
  null,
)

const isEdit = computed(() => props.provider !== null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  () => form.value,
  () => props.modelValue,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = null
    probe.value = null
    form.value = props.provider ? formOf(props.provider) : emptyForm()
  },
  // 组件在「已经是打开态」时挂载，只监听变化的 watch 一次都不会跑
  { immediate: true },
)

/** 自报清单里还没登记的那几个，给「一键登记」用。 */
const unregistered = computed(() => {
  const known = new Set(form.value.models.map((one) => one.name.trim()))
  return (probe.value?.names ?? []).filter((name) => !known.has(name))
})

function addRow(): void {
  form.value.models.push(emptyRow())
}

function addSuggested(name: string): void {
  form.value.models.push(suggestedRow(name))
}

function removeRow(index: number): void {
  form.value.models.splice(index, 1)
}

function setKind(index: number, kind: string): void {
  const row = form.value.models[index]
  if (row === undefined || !isModelKind(kind)) return
  row.kind = kind
  if (kind === 'embedding') row.hasVision = false
  else row.dimensions = ''
}

async function onProbe(): Promise<void> {
  probing.value = true
  probe.value = null
  error.value = null
  try {
    const result =
      form.value.apiKey.trim() === '' && props.provider
        ? await llm.probeProvider(props.provider.id)
        : await llm.probeDraft({
            base_url: form.value.baseUrl.trim(),
            api_key: form.value.apiKey.trim(),
          })
    probe.value = {
      isOk: result.is_ok,
      message: result.message,
      names: result.model_names,
    }
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    probing.value = false
  }
}

async function onSubmit(): Promise<void> {
  const rejected = validateForm(form.value, isEdit.value)
  if (rejected !== null) {
    error.value = rejected
    return
  }
  busy.value = true
  error.value = null
  try {
    if (props.provider) {
      await llm.updateProvider(props.provider.id, toUpdateInput(form.value))
      emit('saved', '供应商已更新')
    } else {
      await llm.createProvider(toCreateInput(form.value))
      emit('saved', '供应商已创建')
    }
    emit('update:modelValue', false)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :dirty="isDirty"
    :title="isEdit ? '编辑供应商' : '新建供应商'"
    description="一个 OpenAI 兼容端点，以及它上面要用的模型。助手与知识库共用这份目录"
    width="40rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="form.name"
        label="名称"
        required
        placeholder="例如：阿里百炼"
      />
      <DtInput
        v-model="form.baseUrl"
        label="端点地址"
        required
        placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
        hint="OpenAI 兼容口径的根，通常以 /v1 结尾"
      />
      <DtInput
        v-model="form.apiKey"
        label="API 密钥"
        type="password"
        :required="!isEdit"
        autocomplete="off"
        :hint="
          isEdit
            ? `留空即沿用现在这把（${provider?.api_key_hint ?? ''}）`
            : '只在这里填一次，之后任何地方都拿不回明文'
        "
      />

      <div class="flex items-center gap-3">
        <DtButton
          variant="outline"
          intent="neutral"
          size="sm"
          :loading="probing"
          @click="onProbe"
        >
          测试连接
        </DtButton>
        <DtSwitch v-model="form.isEnabled" label="启用" size="sm" />
      </div>
      <DtNotice v-if="probe" :intent="probe.isOk ? 'success' : 'warning'">
        {{ probe.message }}
      </DtNotice>
      <div v-if="unregistered.length > 0" class="flex flex-wrap gap-1.5">
        <span class="text-2xs text-text-secondary">端点自报，点一下登记：</span>
        <button
          v-for="name in unregistered"
          :key="name"
          type="button"
          class="model-chip"
          @click="addSuggested(name)"
        >
          {{ name }}
        </button>
      </div>

      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm text-text-title">登记的模型</span>
          <DtButton variant="ghost" size="xs" icon="plus" @click="addRow">
            加一行
          </DtButton>
        </div>
        <p
          v-if="form.models.length === 0"
          class="m-0 text-2xs text-text-secondary"
        >
          还没登记模型。用途分配只能从这里登记过的模型里挑。
        </p>
        <div
          v-for="(row, index) in form.models"
          :key="row.key"
          class="model-row"
        >
          <DtInput v-model="row.name" size="sm" placeholder="模型代号" />
          <DtSelect
            :model-value="row.kind"
            :options="KIND_OPTIONS"
            size="sm"
            aria-label="模型种类"
            @update:model-value="setKind(index, $event)"
          />
          <DtInput
            v-if="row.kind === 'embedding'"
            v-model="row.dimensions"
            size="sm"
            placeholder="向量维数"
          />
          <DtCheckbox v-else v-model="row.hasVision" label="接图" />
          <DtButton
            variant="ghost"
            intent="danger"
            size="xs"
            icon="trash"
            aria-label="删这一行"
            @click="removeRow(index)"
          />
        </div>
      </section>

      <DtTextarea
        v-model="form.extraBody"
        label="额外请求体（可选）"
        mono
        :placeholder="EXTRA_BODY_EXAMPLE"
        hint="透传给端点的 JSON 对象，思考开关一类各家不同的键放这里"
      />
      <DtTextarea v-model="form.notes" label="备注（可选）" />

      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtTag v-if="isEdit && provider?.assigned_purposes.length" size="sm">
        改动会立刻影响指着这一路的 {{ provider?.assigned_purposes.length }}
        个用途
      </DtTag>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) 7rem minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
}

/* 自报的模型名做成可点的小片，与标签同一套底色，按下去就登记 */
.model-chip {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
  }
}
</style>
