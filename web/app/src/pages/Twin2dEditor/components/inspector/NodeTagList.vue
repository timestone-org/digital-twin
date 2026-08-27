<script setup lang="ts">
/**
 * @fileoverview 节点的 `tags`：自由字符串键值对。子类那一层（变体的 `tag` 一档）
 * 就读它。
 *
 * ⚠ **不做白名单**：给一张可选键值表就等于把子类重新钉死成枚举，而变体的 `tag`
 *   一档全部意义就在于它是开放的。这里只做归一化那两件事——trim 与截到长度上限。
 * ⚠ 键是这一条的身份，**不许就地改**：键一变，`v-for` 的 key 跟着变，那一行整个重建、
 *   输入焦点当场丢，敲第二个字符就已经跳出输入框了。要换键就删掉再加一条。
 * ⚠ 值逐键写回时**不 trim**：trim 了再回填 DOM，空格键就永远打不出来。trim 由
 *   归一化在落库那一步做。
 */
import { TWIN_2D_MAX_TAG_LENGTH } from '@dt/twin2d'
import { DtButton, DtEmpty, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  /** 节点上的 tags。 */
  modelValue: Readonly<Record<string, string>>
}>()

const emit = defineEmits<{
  /** 换一份 tags；`mergeKey` 非空表示这是一段连续输入里的一帧。 */
  update: [Readonly<Record<string, string>>, string | null]
  /** 一段连续输入到此为止。 */
  blur: []
}>()

/** 新增那一行的两个框；加进去之后清空。 */
const draftKey = ref('')
const draftValue = ref('')

const rows = computed(() =>
  Object.entries(props.modelValue).map(([key, value]) => ({ key, value })),
)

/** 新增那一行能不能落地：键非空且不与在册的重名。 */
const nextKey = computed(() =>
  draftKey.value.trim().slice(0, TWIN_2D_MAX_TAG_LENGTH),
)
// ⚠ 重名判定走行表不走 `in`：`'toString' in obj` 对任何对象都为真，
// 用它会让「toString」这个键永远添加不进去，而按钮只是灰着不给任何理由
const canAdd = computed(
  () =>
    nextKey.value !== '' &&
    !rows.value.some((row) => row.key === nextKey.value),
)

/**
 * 改一条的值。
 * ⚠ 计算键落的是自有属性，写 `__proto__` 也只是多一个键；`normalizeTags` 用 Map
 * 收键是同一个理由。
 * @param key 这一条的键
 * @param value 新值
 */
function setValue(key: string, value: string): void {
  emit(
    'update',
    { ...props.modelValue, [key]: value.slice(0, TWIN_2D_MAX_TAG_LENGTH) },
    `tag:${key}`,
  )
}

/**
 * 删掉一条。
 * @param key 这一条的键
 */
function removeTag(key: string): void {
  const kept = new Map(
    rows.value
      .filter((row) => row.key !== key)
      .map((row) => [row.key, row.value] as const),
  )
  emit('update', Object.fromEntries(kept), null)
}

/** 把新增那一行加进去；键 trim 并截到长度上限。 */
function addTag(): void {
  if (!canAdd.value) return
  emit(
    'update',
    {
      ...props.modelValue,
      [nextKey.value]: draftValue.value.slice(0, TWIN_2D_MAX_TAG_LENGTH),
    },
    null,
  )
  draftKey.value = ''
  draftValue.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      title="还没有标签"
      hint="子类等「不改结构只改外观」的维度靠它，键值都自定。"
      data-test="tag-empty"
    />

    <div
      v-for="row in rows"
      :key="row.key"
      class="flex items-end gap-1"
      :data-test="`tag-row-${row.key}`"
    >
      <span
        class="min-w-0 flex-1 truncate pb-1.5 text-xs text-text-secondary"
        :title="row.key"
      >
        {{ row.key }}
      </span>
      <DtInput
        class="min-w-0 flex-1"
        :model-value="row.value"
        size="sm"
        aria-label="标签值"
        :data-test="`tag-value-${row.key}`"
        @update:model-value="setValue(row.key, $event)"
      />
      <DtButton
        size="xs"
        variant="ghost"
        intent="danger"
        icon="trash"
        aria-label="删除这条标签"
        title="删除这条标签"
        :data-test="`tag-remove-${row.key}`"
        @click="removeTag(row.key)"
      />
    </div>

    <div class="flex items-end gap-1">
      <DtInput
        v-model="draftKey"
        class="min-w-0 flex-1"
        size="sm"
        label="新键"
        placeholder="subtype"
        data-test="tag-new-key"
      />
      <DtInput
        v-model="draftValue"
        class="min-w-0 flex-1"
        size="sm"
        label="新值"
        placeholder="solar"
        data-test="tag-new-value"
      />
      <DtButton
        size="xs"
        variant="ghost"
        intent="neutral"
        icon="plus"
        :disabled="!canAdd"
        aria-label="添加标签"
        title="添加标签"
        data-test="tag-add"
        @click="addTag"
      />
    </div>
  </div>
</template>
