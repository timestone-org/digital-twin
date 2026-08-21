<script setup lang="ts">
/**
 * @fileoverview 名字清单编辑：从候选里挑、也允许手填，逐条可删。
 * 部件的模型节点与模型动画的 clip 共用这一件——两者都是「本包看不见的外部名字」。
 *
 * ⚠ 候选里没有的名字必须标出来：模型换了或节点改了名，配置里那一条就静默地
 * 什么都不再命中，界面上不说的话，用户看到的只是「配了但没反应」。
 * ⚠ 候选为空不等于「都不存在」，那是「还不知道」（模型没加载），此时不判定缺失。
 */
import { DtButton, DtEmpty, DtIcon, DtInput, DtSelect } from '@dt/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: readonly string[]
  /** 候选名单；空数组 = 拿不到候选，只能手填。 */
  candidates: readonly string[]
  /** 手填输入框的占位。 */
  placeholder?: string
  /** 候选为空时的说明。 */
  emptyHint?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const draft = ref('')

// ⚠ 缺省值走 computed 不走 withDefaults：exactOptionalPropertyTypes 下
//   withDefaults 出来的仍是 `string | undefined`，往下传会在每个调用点报错
const inputPlaceholder = computed(() => props.placeholder ?? '手动输入名字')
const emptyText = computed(() => props.emptyHint ?? '')

const candidateSet = computed(() => new Set(props.candidates))
const chosenSet = computed(() => new Set(props.modelValue))

/** 候选里还没被挑走的，供下拉选。 */
const options = computed(() =>
  props.candidates
    .filter((name) => !chosenSet.value.has(name))
    .map((name) => ({ value: name, label: name })),
)

/** 这个名字在候选里找不到。 */
function isMissing(name: string): boolean {
  return props.candidates.length > 0 && !candidateSet.value.has(name)
}

const hasMissing = computed(() => props.modelValue.some(isMissing))

/** 追加一个名字；空串与重复都不追加。 */
function add(name: string): void {
  const trimmed = name.trim()
  if (trimmed === '' || chosenSet.value.has(trimmed)) return
  emit('update:modelValue', [...props.modelValue, trimmed])
}

function addDraft(): void {
  add(draft.value)
  draft.value = ''
}

function remove(name: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== name),
  )
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul v-if="modelValue.length > 0" class="flex flex-col gap-1">
      <li
        v-for="name in modelValue"
        :key="name"
        class="flex min-w-0 items-center gap-1.5 rounded-sm border border-border-subtle px-2 py-1"
      >
        <DtIcon
          v-if="isMissing(name)"
          name="alert-triangle"
          :size="13"
          class="shrink-0 text-state-warning"
        />
        <span
          class="min-w-0 flex-1 truncate text-xs"
          :class="isMissing(name) ? 'text-state-warning' : 'text-text-primary'"
          :title="name"
        >
          {{ name }}
        </span>
        <DtButton
          variant="ghost"
          size="sm"
          icon="close"
          :aria-label="`移除 ${name}`"
          @click="remove(name)"
        />
      </li>
    </ul>
    <DtEmpty v-else size="inline" title="还没有条目。" />

    <p v-if="hasMissing" class="text-xs text-state-warning">
      标黄的名字在当前模型里没找到，它们不会命中任何东西。
    </p>

    <DtSelect
      v-if="options.length > 0"
      model-value=""
      :options="options"
      :display="{ placeholder: '从候选里挑…' }"
      aria-label="从候选里挑"
      size="sm"
      @update:model-value="add"
    />
    <p
      v-else-if="candidates.length === 0 && emptyText !== ''"
      class="text-xs text-text-disabled"
    >
      {{ emptyText }}
    </p>

    <div class="flex min-w-0 items-center gap-1.5">
      <DtInput
        v-model="draft"
        :placeholder="inputPlaceholder"
        aria-label="手填名字"
        size="sm"
        class="min-w-0 flex-1"
        @enter="addDraft"
      />
      <DtButton
        variant="soft"
        size="sm"
        icon="plus"
        aria-label="添加名字"
        @click="addDraft"
      />
    </div>

    <slot name="actions" />
  </div>
</template>
