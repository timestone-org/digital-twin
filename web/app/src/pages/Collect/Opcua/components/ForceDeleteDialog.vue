<script setup lang="ts">
/**
 * @fileoverview 带「引用守卫」的删除确认（数据源 / 点位通用）。
 *
 * 一级：普通删除 → confirm(false)。后端因被引用返回 409 时，父组件回填
 * `conflict` 文案 → 升级为二级：展示警告 + 「强制删除」按钮 → confirm(true)。
 * ⚠ 强删的后果（引用失效）必须写在 `conflict` 文案里——按钮本身不解释。
 */
import { computed } from 'vue'
import { DtButton, DtIcon, DtModal } from '@dt/ui'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    // ⚠ 显式 `| undefined`：exactOptionalPropertyTypes 下 withDefaults 才会
    // 把默认值并进模板里的类型（同 DtInput / DtCheckbox 的处理）
    title?: string | undefined
    /** 待删除对象名（高亮显示）。 */
    name?: string | undefined
    /** 普通确认文案（不含名称部分）。 */
    message?: string | undefined
    /** 409 引用冲突文案；非空 → 进入强制删除二级确认。 */
    conflict?: string | null | undefined
    loading?: boolean | undefined
  }>(),
  {
    title: '删除确认',
    message: '此操作不可撤销。',
    conflict: null,
    loading: false,
  },
)

const isBusy = computed(() => props.loading === true)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [force: boolean]
}>()

const hasConflict = computed(
  () => props.conflict !== null && props.conflict !== undefined,
)

const modalTitle = computed(() =>
  hasConflict.value ? '对象正被引用' : (props.title ?? '删除确认'),
)
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="modalTitle"
    width="28rem"
    :close-on-backdrop="!isBusy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <p
        v-if="!hasConflict"
        class="m-0 text-sm leading-relaxed text-text-secondary"
      >
        确定删除<template v-if="name"
          >「<span class="text-accent-secondary">{{ name }}</span
          >」</template
        >？
        {{ message }}
      </p>
      <p
        v-else
        class="m-0 flex items-start gap-2 rounded-md border border-state-warning/40 bg-state-warning/10 px-3 py-2.5 text-xs leading-relaxed text-state-warning"
      >
        <DtIcon name="alert-triangle" :size="14" class="mt-px shrink-0" />
        <span>{{ conflict }}</span>
      </p>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="isBusy"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton
        intent="danger"
        size="sm"
        :icon="hasConflict ? 'alert-triangle' : 'trash'"
        :loading="isBusy"
        data-test="force-delete-confirm"
        @click="emit('confirm', hasConflict)"
      >
        {{ hasConflict ? '强制删除' : '删除' }}
      </DtButton>
    </template>
  </DtModal>
</template>
