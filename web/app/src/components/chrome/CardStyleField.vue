<script setup lang="ts">
/**
 * @fileoverview 卡片外观里的一条控件：按字段描述摆开关 / 数字 / 下拉 / 取色 / 三格内边距。
 * ⚠ 回填一律容错到「未设置」——脏值绝不能被画成 NaN 或写回去，那会把渲染改掉。
 */
import {
  DtColorInput,
  DtHelpTip,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import {
  TITLE_PAD_DEFAULT,
  TITLE_PAD_LABELS,
  type CardField,
} from '@/features/dashboard/cardStyleFields'

const props = defineProps<{
  field: CardField
  value: unknown
  /** 整组被别的开关关掉时置灰；原因由父级在组头下说明。 */
  disabled?: boolean
}>()

const emit = defineEmits<{ update: [value: unknown] }>()

/** 布尔与三格内边距占整行，其余半行并排。 */
const isFullRow = computed(() =>
  ['bool', 'enum', 'pad3'].includes(props.field.kind),
)

/**
 * 数值回填：容忍后端 JSON 里的 `'10'`，与渲染侧同口径。
 * 0 与负数是合法值（角标偏移的平台现值就是 -1），只有没填 / 填了非数值才落回未设置。
 */
function numOf(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const num = computed(() => numOf(props.value))

/**
 * 枚举 / 取色回填：数字（如字重 400）转成串才对得上选项；
 * 其余（空值、数组、对象这些脏值）一律回填成空串 = 首项「（默认）」。
 */
const text = computed(() => {
  const value = props.value
  if (typeof value === 'string') return value
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : ''
})

/** 开关回填：默认开的那两项要把「未设置」画成开，否则面板与渲染相反。 */
const on = computed(() =>
  props.field.defaultOn === true ? props.value !== false : props.value === true,
)

const pad = computed<(number | undefined)[]>(() => {
  const raw = props.value
  if (!Array.isArray(raw) || raw.length !== 3)
    return [undefined, undefined, undefined]
  return raw.map((cell) => numOf(cell))
})

/**
 * 三格改一格：渲染侧只认「三项全为合法数值」的数组（缺一项整条放弃），
 * 故用平台现值补齐空格再整条写入；三格全空 = 回到未设置 → 交出 undefined 即删键。
 * @param index 改的是第几格
 * @param next 这一格的新值
 */
function onPad(index: number, next: number | undefined): void {
  const cells = [...pad.value]
  cells[index] = next
  if (cells.every((cell) => cell === undefined)) {
    emit('update', undefined)
    return
  }
  emit(
    'update',
    TITLE_PAD_DEFAULT.map((fallback, slot) => cells[slot] ?? fallback),
  )
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="{ 'col-span-2': isFullRow }">
    <!-- 布尔：整行开关，照实写 true / false（模块级要靠显式 false 压过大屏级的 true） -->
    <template v-if="field.kind === 'bool'">
      <div class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-1 text-2xs text-text-secondary">
          {{ field.label }}
          <DtHelpTip
            v-if="field.help"
            :text="field.help"
            :label="field.label"
          />
        </span>
        <DtSwitch
          :model-value="on"
          :aria-label="field.label"
          :disabled="disabled"
          size="sm"
          @update:model-value="emit('update', $event)"
        />
      </div>
      <span v-if="field.hint" class="text-2xs text-text-disabled">
        {{ field.hint }}
      </span>
    </template>

    <!-- 枚举：首项恒为「（默认）」= 空串 = 删键 -->
    <div v-else-if="field.kind === 'enum'" class="flex items-start gap-1">
      <DtSelect
        class="min-w-0 flex-1"
        :model-value="text"
        :options="field.options ?? []"
        :label="field.label"
        :hint="field.hint"
        :disabled="disabled"
        size="sm"
        @update:model-value="emit('update', $event)"
      />
      <DtHelpTip v-if="field.help" :text="field.help" :label="field.label" />
    </div>

    <!-- 颜色：留空 = 走主题 token -->
    <div v-else-if="field.kind === 'color'" class="flex items-start gap-1">
      <DtColorInput
        class="min-w-0 flex-1"
        :model-value="text"
        :label="field.label"
        :hint="field.hint"
        :disabled="disabled"
        size="sm"
        @update:model-value="emit('update', $event)"
      />
      <DtHelpTip v-if="field.help" :text="field.help" :label="field.label" />
    </div>

    <!-- 标题内边距：唯一的三值字段，窄栏放不下步进键 -->
    <template v-else-if="field.kind === 'pad3'">
      <span class="text-2xs text-text-secondary">{{ field.label }} (px)</span>
      <div class="grid grid-cols-3 gap-1.5">
        <DtNumberInput
          v-for="(cell, index) in TITLE_PAD_LABELS"
          :key="cell"
          :model-value="pad[index]"
          :label="cell"
          :placeholder="String(TITLE_PAD_DEFAULT[index])"
          :range="{ min: 0, max: 80 }"
          :steppers="false"
          :disabled="disabled"
          size="sm"
          @update:model-value="onPad(index, $event)"
        />
      </div>
      <span class="text-2xs text-text-disabled">留空 = 8 / 12 / 6</span>
    </template>

    <!-- 数值：占位符写的是平台现值，清空即删键 -->
    <div v-else class="flex items-start gap-1">
      <DtNumberInput
        class="min-w-0 flex-1"
        :model-value="num"
        :label="field.label"
        :hint="field.hint"
        :placeholder="field.placeholder"
        :range="field.range"
        :disabled="disabled"
        size="sm"
        @update:model-value="emit('update', $event)"
      />
      <DtHelpTip v-if="field.help" :text="field.help" :label="field.label" />
    </div>
  </div>
</template>
