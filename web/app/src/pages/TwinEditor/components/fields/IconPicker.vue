<script setup lang="ts">
/**
 * @fileoverview 图标选择：从 DtIcon 注册表里挑一个，带搜索与实时预览。
 *
 * ⚠ 刻意不给手输框：`DtIcon` 拿到未登记的名字**既不报错也什么都不画**，
 * 手打错一个字母的结果是「配了图标但那个位置永远空着」，谁也查不出原因。
 * ⚠ 存量配置里可能已经躺着一个非法名字（手写 JSON 来的），所以仍要把
 * 「这个名字不存在」当场红字说出来，并给一键清掉的出路。
 */
import { DtButton, DtIcon, DtInput, ICONS, isIconName } from '@dt/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  /** 当前图标名；空串 = 不画图标。 */
  modelValue: string
  /** 清空那一项的文案，按调用处的语义写。 */
  clearLabel: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

/** 注册表的全部名字，按登记顺序。 */
const ALL_ICONS: readonly string[] = Object.keys(ICONS)

const open = ref(false)
const query = ref('')

/** 名字不在注册表里：渲染层对它是「什么都不画」。 */
const invalid = computed(
  () => props.modelValue !== '' && !isIconName(props.modelValue),
)

const matched = computed(() => {
  const text = query.value.trim().toLowerCase()
  return text === ''
    ? ALL_ICONS
    : ALL_ICONS.filter((name) => name.includes(text))
})

function pick(name: string): void {
  open.value = false
  query.value = ''
  emit('update:modelValue', name)
}

function clear(): void {
  pick('')
}

function toggle(): void {
  open.value = !open.value
  if (!open.value) query.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test="icon-picker">
    <div class="flex min-w-0 items-center gap-1.5">
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-subtle bg-surface-sunken"
        data-test="icon-preview"
      >
        <DtIcon
          v-if="modelValue !== '' && !invalid"
          :name="modelValue"
          :size="15"
          class="text-text-primary"
        />
        <DtIcon
          v-else
          name="alert-circle"
          :size="14"
          :class="invalid ? 'text-state-danger' : 'text-text-disabled'"
        />
      </span>
      <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
        {{ modelValue === '' ? clearLabel : modelValue }}
      </span>
      <DtButton
        :variant="open ? 'solid' : 'soft'"
        size="sm"
        data-test="icon-toggle"
        @click="toggle"
      >
        {{ open ? '收起' : '更换' }}
      </DtButton>
    </div>

    <p
      v-if="invalid"
      class="text-xs text-state-danger"
      data-test="icon-invalid"
    >
      图标 {{ modelValue }} 不在图标表里，这个位置不会画出任何东西。
    </p>

    <div
      v-if="open"
      class="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-border-subtle p-1.5"
      data-test="icon-panel"
    >
      <DtInput
        v-model="query"
        aria-label="搜索图标"
        placeholder="搜索图标名"
        size="sm"
      />
      <div class="grid max-h-40 grid-cols-7 gap-1 overflow-y-auto">
        <button
          v-for="name in matched"
          :key="name"
          type="button"
          class="flex h-7 items-center justify-center rounded-[var(--radius-sm)] text-text-secondary hover:bg-surface-raised hover:text-accent-primary"
          :class="
            name === modelValue
              ? 'bg-surface-raised text-accent-on-surface'
              : ''
          "
          :aria-label="name"
          :title="name"
          data-test="icon-option"
          :data-name="name"
          @click="pick(name)"
        >
          <DtIcon :name="name" :size="15" />
        </button>
      </div>
      <p
        v-if="matched.length === 0"
        class="px-1 py-2 text-center text-xs text-text-disabled"
        data-test="icon-none"
      >
        没有匹配的图标名
      </p>
      <DtButton
        v-if="modelValue !== ''"
        variant="ghost"
        size="sm"
        block
        data-test="icon-clear"
        @click="clear"
      >
        {{ clearLabel }}
      </DtButton>
    </div>
  </div>
</template>
