<script setup lang="ts">
/**
 * @fileoverview 用途分配板：每个用途此刻走哪一路的哪个模型，按消费方分两组。
 *
 * ⚠ 供应商下拉只列**登记了配得上这个用途的模型**的那几路：嵌入用途只认嵌入
 * 模型、看图用途只认接图的对话模型。全列出来的话，选了再报 400，而那条 400
 * 里不会提是哪一格配错了。
 * ⚠ 没分配时写清「沿用该服务环境变量里的配置」：空着与「没接」不是一回事。
 */
import { computed, ref, watch } from 'vue'
import type { DtSelectOption, LlmProvider, LlmPurpose } from '@dt/contracts'
import { DtButton, DtSelect, DtTag } from '@dt/ui'

const props = defineProps<{
  purposes: readonly LlmPurpose[]
  providers: readonly LlmProvider[]
  canManage: boolean
}>()

const emit = defineEmits<{
  assign: [purpose: string, providerId: string, modelName: string]
  clear: [purpose: string]
}>()

/** 消费方在界面上叫什么。⚠ 与后端 `enums.py` 的 consumer 取值逐字对应 */
const CONSUMER_LABELS: Record<string, string> = {
  assistant: 'AI 助手',
  knowledge: '知识库',
}

interface Draft {
  providerId: string
  modelName: string
}

/** 每个用途各自的草稿，键是用途码。 */
const drafts = ref<Record<string, Draft>>({})
const busy = ref<Record<string, boolean>>({})

watch(
  () => props.purposes,
  (listed) => {
    const next: Record<string, Draft> = {}
    for (const one of listed) {
      next[one.purpose] = {
        providerId: one.provider_id ?? '',
        modelName: one.model_name ?? '',
      }
    }
    drafts.value = next
  },
  { immediate: true },
)

const groups = computed(() => {
  const found = new Map<string, LlmPurpose[]>()
  for (const one of props.purposes) {
    const rows = found.get(one.consumer) ?? []
    rows.push(one)
    found.set(one.consumer, rows)
  }
  return [...found.entries()].map(([consumer, rows]) => ({
    consumer,
    label: CONSUMER_LABELS[consumer] ?? consumer,
    rows,
  }))
})

/** 这一路上配得上这个用途的模型。 */
function fittingModels(provider: LlmProvider, purpose: LlmPurpose) {
  return provider.models.filter(
    (model) =>
      model.kind === purpose.kind &&
      (!purpose.is_vision_required || model.has_vision),
  )
}

function providerOptions(purpose: LlmPurpose): readonly DtSelectOption[] {
  return props.providers
    .filter((provider) => fittingModels(provider, purpose).length > 0)
    .map((provider) => ({
      value: provider.id,
      label: provider.is_enabled ? provider.name : `${provider.name}（已停用）`,
    }))
}

function modelOptions(purpose: LlmPurpose): readonly DtSelectOption[] {
  const draft = drafts.value[purpose.purpose]
  const provider = props.providers.find((one) => one.id === draft?.providerId)
  if (!provider) return []
  return fittingModels(provider, purpose).map((model) => ({
    value: model.name,
    label:
      model.kind === 'embedding' && model.dimensions !== null
        ? `${model.name}（${model.dimensions} 维）`
        : model.name,
  }))
}

function pickProvider(purpose: LlmPurpose, providerId: string): void {
  const draft = drafts.value[purpose.purpose]
  if (!draft) return
  draft.providerId = providerId
  // 换了供应商，上一路的模型名对不上新的一路，先清掉再让人挑
  const fitting = modelOptions(purpose)
  draft.modelName = fitting.length === 1 ? (fitting[0]?.value ?? '') : ''
}

function pickModel(purpose: LlmPurpose, modelName: string): void {
  const draft = drafts.value[purpose.purpose]
  if (draft) draft.modelName = modelName
}

function isChanged(purpose: LlmPurpose): boolean {
  const draft = drafts.value[purpose.purpose]
  if (!draft) return false
  return (
    draft.providerId !== (purpose.provider_id ?? '') ||
    draft.modelName !== (purpose.model_name ?? '')
  )
}

function canSave(purpose: LlmPurpose): boolean {
  const draft = drafts.value[purpose.purpose]
  return (
    draft !== undefined &&
    draft.providerId !== '' &&
    draft.modelName !== '' &&
    isChanged(purpose)
  )
}

function save(purpose: LlmPurpose): void {
  const draft = drafts.value[purpose.purpose]
  if (!draft || !canSave(purpose)) return
  emit('assign', purpose.purpose, draft.providerId, draft.modelName)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <section
      v-for="group in groups"
      :key="group.consumer"
      class="flex flex-col gap-2"
    >
      <h3 class="m-0 text-sm font-semibold text-text-title">
        {{ group.label }}
      </h3>
      <div
        v-for="purpose in group.rows"
        :key="purpose.purpose"
        class="purpose-row"
        :data-purpose="purpose.purpose"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm text-text-primary">{{ purpose.label }}</span>
            <DtTag
              size="sm"
              :intent="purpose.kind === 'embedding' ? 'info' : 'neutral'"
            >
              {{ purpose.kind === 'embedding' ? '嵌入' : '对话' }}
            </DtTag>
            <DtTag v-if="purpose.is_vision_required" size="sm">需接图</DtTag>
          </div>
          <p class="m-0 text-2xs text-text-secondary">
            {{ purpose.description }}
          </p>
          <p
            v-if="purpose.provider_name === null"
            class="m-0 text-2xs text-text-disabled"
          >
            未指定 · 沿用该服务环境变量里的配置
          </p>
          <p v-else class="m-0 text-2xs text-text-disabled">
            当前：{{ purpose.provider_name }} / {{ purpose.model_name }}
          </p>
        </div>

        <div v-if="canManage" class="purpose-row__controls">
          <DtSelect
            :model-value="drafts[purpose.purpose]?.providerId ?? ''"
            :options="providerOptions(purpose)"
            size="sm"
            aria-label="供应商"
            :display="{ placeholder: '选供应商' }"
            @update:model-value="pickProvider(purpose, $event)"
          />
          <DtSelect
            :model-value="drafts[purpose.purpose]?.modelName ?? ''"
            :options="modelOptions(purpose)"
            size="sm"
            aria-label="模型"
            :display="{ placeholder: '选模型' }"
            :disabled="modelOptions(purpose).length === 0"
            @update:model-value="pickModel(purpose, $event)"
          />
          <DtButton
            size="sm"
            :disabled="!canSave(purpose) || busy[purpose.purpose]"
            @click="save(purpose)"
          >
            保存
          </DtButton>
          <DtButton
            v-if="purpose.provider_id !== null"
            variant="ghost"
            intent="neutral"
            size="sm"
            @click="emit('clear', purpose.purpose)"
          >
            清除
          </DtButton>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.purpose-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem 1rem;
  align-items: center;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.purpose-row__controls {
  display: grid;
  grid-template-columns: 11rem 13rem auto auto;
  gap: 0.5rem;
  align-items: center;
}

/* 窄屏下控件换到下一行，别把用途说明挤成一列字 */
@media (max-width: 1100px) {
  .purpose-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .purpose-row__controls {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
  }
}
</style>
