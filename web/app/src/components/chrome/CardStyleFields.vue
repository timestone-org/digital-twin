<script setup lang="ts">
/**
 * @fileoverview 卡片外观（chrome）的字段组：外观风格 + 常显九项 + 四个可折叠高级分组。
 * ⚠ 铁律「未设置 = 不写值」：没动过的控件一条键都不写，清空控件 = 删键，
 * 渲染因此落回平台默认；写进去就等于把当下的默认观感固化进这张大屏。
 *
 * 「外观风格」下拉里另有一段**用户自己存下来的样式**（卡片样式库），由页面
 * `provide` 下来；没装就只有内置那两档（`cardStyleLibrary.ts`）。
 */
import type { CardChrome, CardStyle, DtSelectOption } from '@dt/contracts'
import { DtIcon, DtSelect } from '@dt/ui'
import { computed, ref } from 'vue'

import CardStyleField from './CardStyleField.vue'
import {
  CARD_COMMON_FIELDS,
  CARD_FIELD_GROUPS,
  DEFAULT_OPEN_GROUP,
  cardGroupDisabledReason,
  chromeEntries,
  visibleCardFields,
  type CardFieldContext,
} from '@/features/dashboard/cardStyleFields'
import {
  stylesForModule,
  useCardStyles,
} from '@/features/dashboard/cardStyleLibrary'
import {
  CARD_STYLE_VARIANTS,
  CUSTOM_STYLE_ID,
  matchCardStyle,
} from '@/features/dashboard/cardStyleVariants'

/** 用户样式在下拉里的取值前缀，与内置那两档的 id 不会撞。 */
const SAVED_PREFIX = 'saved:'

const props = defineProps<{
  modelValue: CardChrome
  /**
   * 模块级面板的适配输入：结构性不支持的字段隐藏、被开关关掉的组禁用并说明。
   * 大屏级面板（页面缺省）不传 = 全量摆出、不禁用。
   */
  context?: CardFieldContext | undefined
  /**
   * 这一格是哪个模块；用来过滤能套的用户样式。
   * ⚠ 大屏级缺省面板不传 = 只列通用外壳样式：那一层没有「哪个模块」这个上下文，
   * 列出绑了模块的样式，点下去只会写它外壳的一半。
   */
  moduleType?: string | null | undefined
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CardChrome] }>()

/**
 * 整包写回。**清空即删键**：`undefined` / 空串都不是一个取值，而是「回到平台默认」，
 * 留在袋子里就会被渲染侧当成显式设置。
 * @param patch 本次改动涉及的键
 */
function applyPatch(patch: CardChrome): void {
  const next: CardChrome = { ...props.modelValue }
  for (const [key, value] of chromeEntries(patch)) {
    if (value === undefined || value === null || value === '') {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  emit('update:modelValue', next)
}

const readStyles = useCardStyles()

/** 这一格能套的用户样式。 */
const savedStyles = computed<CardStyle[]>(() =>
  stylesForModule(readStyles(), props.moduleType ?? null),
)

const builtinId = computed(() => matchCardStyle(props.modelValue))

/**
 * 下拉此刻回填哪一项。用户样式**优先于**内置判定：一条照极简描边存下来的样式，
 * 取值与内置那档逐键相同，回填成内置的话用户会以为自己那条没存上。
 */
const styleId = computed(() => {
  const hit = savedStyles.value.find((one) => sameChrome(one.chrome))
  return hit === undefined ? builtinId.value : `${SAVED_PREFIX}${hit.id}`
})

/**
 * 当前袋子是否就是这一套样式。**逐键全等**，不是子集：样式的语义是一整套外壳，
 * 少一个键就不是它了。
 * @param chrome 一套样式的外壳袋
 */
function sameChrome(chrome: CardChrome): boolean {
  // 走 `chromeEntries` 而不是 `Object.keys`：袋子落库时是自由 JSON，
  // 没登记进词汇表的键在两侧都不该参与比较
  const mine = new Map(chromeEntries(props.modelValue))
  const theirs = new Map(chromeEntries(chrome))
  if (mine.size !== theirs.size) return false
  for (const [key, value] of theirs) {
    if (JSON.stringify(mine.get(key)) !== JSON.stringify(value)) return false
  }
  return true
}

/**
 * 「自定义」只在当前取值落在所有风格之外时才追加，且置灰不可选——
 * 少了它，动过一个旋钮的卡片会被回填成「平台默认」，等于在面板上说谎。
 */
const styleOptions = computed<DtSelectOption[]>(() => {
  const options: DtSelectOption[] = CARD_STYLE_VARIANTS.map((variant) => ({
    value: variant.id,
    label: variant.label,
  }))
  for (const one of savedStyles.value) {
    options.push({ value: `${SAVED_PREFIX}${one.id}`, label: one.name })
  }
  if (styleId.value === CUSTOM_STYLE_ID) {
    options.push({ value: CUSTOM_STYLE_ID, label: '自定义', disabled: true })
  }
  return options
})

const styleHint = computed(() => {
  const saved = savedStyles.value.find(
    (one) => `${SAVED_PREFIX}${one.id}` === styleId.value,
  )
  if (saved !== undefined) return saved.description ?? '我存下来的样式'
  return (
    CARD_STYLE_VARIANTS.find((variant) => variant.id === styleId.value)?.hint ??
    '已在风格基础上改过单项'
  )
})

/**
 * 套一套风格。
 * ⚠ 用户样式是**整袋替换**，内置那两档仍是逐键覆盖：内置档表达的是「在平台默认
 * 之上加这一层」（「平台默认」那档的 patch 就是「把这批键删掉」），而一条存下来的
 * 样式表达的是「外壳整个就长这样」——按内置那套逐键合并的话，这一套没写的键会留着
 * 上一套的残留，用户看到的是「换了样式但没换干净」（CARD_STYLE_LIBRARY_DESIGN §2.1）。
 * @param id 下拉的取值
 */
function applyStyle(id: string): void {
  if (id.startsWith(SAVED_PREFIX)) {
    const saved = savedStyles.value.find(
      (one) => `${SAVED_PREFIX}${one.id}` === id,
    )
    if (saved !== undefined) emit('update:modelValue', { ...saved.chrome })
    return
  }
  const variant = CARD_STYLE_VARIANTS.find((item) => item.id === id)
  if (variant) applyPatch(variant.patch())
}

const openGroups = ref(new Set<string>([DEFAULT_OPEN_GROUP]))

function toggleGroup(id: string): void {
  if (openGroups.value.has(id)) openGroups.value.delete(id)
  else openGroups.value.add(id)
}

const commonFields = computed(() =>
  visibleCardFields(CARD_COMMON_FIELDS, props.context),
)

// 整组字段都被壳声明不消费时连组标题一起藏：一个空组比少一个组更像坏了
const groups = computed(() =>
  CARD_FIELD_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    fields: visibleCardFields(group.fields, props.context),
    reason:
      props.context === undefined
        ? null
        : cardGroupDisabledReason(group.id, props.context),
  })).filter((group) => group.fields.length > 0),
)
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
        v-for="field in commonFields"
        :key="field.key"
        :field="field"
        :value="modelValue[field.key]"
        @update="applyPatch({ [field.key]: $event })"
      />
    </section>

    <section
      v-for="group in groups"
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

      <template v-if="openGroups.has(group.id)">
        <p
          v-if="group.reason !== null"
          class="m-0 text-2xs text-text-disabled"
          :data-test="`card-group-off-${group.id}`"
        >
          {{ group.reason }}
        </p>
        <div class="grid grid-cols-2 gap-2">
          <CardStyleField
            v-for="field in group.fields"
            :key="field.key"
            :field="field"
            :value="modelValue[field.key]"
            :disabled="group.reason !== null"
            @update="applyPatch({ [field.key]: $event })"
          />
        </div>
      </template>
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
