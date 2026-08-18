<script setup lang="ts">
/**
 * @fileoverview 卡片外观（chrome）的字段组：外观风格 + 常显九项 + 四个可折叠高级分组。
 * ⚠ 铁律「未设置 = 不写值」：没动过的控件一条键都不写，清空控件 = 删键，
 * 渲染因此落回平台默认；写进去就等于把当下的默认观感固化进这张大屏。
 */
import type { CardChrome, ChromeKey, DtSelectOption } from '@dt/contracts'
import { DtIcon, DtSelect } from '@dt/ui'
import { computed, ref } from 'vue'

import CardStyleField from './CardStyleField.vue'
import {
  CARD_COMMON_FIELDS,
  CARD_FIELD_GROUPS,
  DEFAULT_OPEN_GROUP,
} from '../scripts/cardStyleFields'
import {
  CARD_STYLE_VARIANTS,
  CUSTOM_STYLE_ID,
  matchCardStyle,
} from '../scripts/cardStyleVariants'

const props = defineProps<{ modelValue: CardChrome }>()

const emit = defineEmits<{ 'update:modelValue': [value: CardChrome] }>()

/**
 * 整包写回。**清空即删键**：`undefined` / 空串都不是一个取值，而是「回到平台默认」，
 * 留在袋子里就会被渲染侧当成显式设置。
 * @param patch 本次改动涉及的键
 */
function applyPatch(patch: CardChrome): void {
  const next: CardChrome = { ...props.modelValue }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') {
      delete next[key as ChromeKey]
    } else {
      next[key as ChromeKey] = value
    }
  }
  emit('update:modelValue', next)
}

const styleId = computed(() => matchCardStyle(props.modelValue))

/**
 * 「自定义」只在当前取值落在所有风格之外时才追加，且置灰不可选——
 * 少了它，动过一个旋钮的卡片会被回填成「平台默认」，等于在面板上说谎。
 */
const styleOptions = computed<DtSelectOption[]>(() => {
  const options: DtSelectOption[] = CARD_STYLE_VARIANTS.map((variant) => ({
    value: variant.id,
    label: variant.label,
  }))
  if (styleId.value === CUSTOM_STYLE_ID) {
    options.push({ value: CUSTOM_STYLE_ID, label: '自定义', disabled: true })
  }
  return options
})

const styleHint = computed(
  () =>
    CARD_STYLE_VARIANTS.find((variant) => variant.id === styleId.value)?.hint ??
    '已在风格基础上改过单项',
)

function applyStyle(id: string): void {
  const variant = CARD_STYLE_VARIANTS.find((item) => item.id === id)
  if (variant) applyPatch(variant.patch())
}

const openGroups = ref(new Set<string>([DEFAULT_OPEN_GROUP]))

function toggleGroup(id: string): void {
  if (openGroups.value.has(id)) openGroups.value.delete(id)
  else openGroups.value.add(id)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 外观风格排在最上面：先定基调、再微调，下面每一项都是在它的结果上做局部覆盖 -->
    <DtSelect
      :model-value="styleId"
      :options="styleOptions"
      :hint="styleHint"
      label="外观风格"
      size="sm"
      @update:model-value="applyStyle"
    />

    <section class="grid grid-cols-2 gap-2">
      <CardStyleField
        v-for="field in CARD_COMMON_FIELDS"
        :key="field.key"
        :field="field"
        :value="modelValue[field.key]"
        @update="applyPatch({ [field.key]: $event })"
      />
    </section>

    <section
      v-for="group in CARD_FIELD_GROUPS"
      :key="group.id"
      class="flex flex-col gap-2 border-t border-border-subtle pt-3"
    >
      <button
        type="button"
        class="card-style__group"
        :aria-expanded="openGroups.has(group.id)"
        @click="toggleGroup(group.id)"
      >
        <DtIcon
          :name="openGroups.has(group.id) ? 'chevron-down' : 'chevron-right'"
          :size="12"
        />
        {{ group.label }}
      </button>

      <div v-if="openGroups.has(group.id)" class="grid grid-cols-2 gap-2">
        <CardStyleField
          v-for="field in group.fields"
          :key="field.key"
          :field="field"
          :value="modelValue[field.key]"
          @update="applyPatch({ [field.key]: $event })"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
// 分组折叠头：与属性面板的分段标题同一套观感（那份是 scoped 的、传不进子组件）
.card-style__group {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s ease;
}

.card-style__group:hover {
  color: var(--text-primary);
}
</style>
