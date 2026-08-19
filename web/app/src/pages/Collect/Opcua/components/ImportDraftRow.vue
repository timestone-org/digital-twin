<script setup lang="ts">
/**
 * @fileoverview 导入弹窗里的一行：现场的名字与寻址串（只读）+ 点位编码（可改）。
 *
 * ⚠ 编码可改是这一行存在的全部理由：现场用中文命名标记时推不出编码，而编码
 * 只能是 ASCII 标识串。跳过那些节点等于把整台设备挡在门外。
 */
import { computed } from 'vue'
import type { CollectDataType } from '@dt/contracts'
import { DtInput, DtTag } from '@dt/ui'

import type { ImportDraft } from '../scripts/importDrafts'

const props = withDefaults(
  defineProps<{
    draft: ImportDraft
    /** 现场没读出类型时按它建，整批一档。 */
    fallbackType: CollectDataType
    problem?: string | undefined
    disabled?: boolean | undefined
  }>(),
  { problem: undefined, disabled: false },
)

const emit = defineEmits<{ 'update:code': [value: string] }>()

const dataType = computed(() => props.draft.fieldType ?? props.fallbackType)
// 现场没读到类型时说出来：它与「读出来就是 float」是两件事
const typeTitle = computed(() =>
  props.draft.fieldType === null
    ? '现场没读到类型，按上面选的那一档建'
    : '现场读到的类型',
)
</script>

<template>
  <div
    class="flex items-start gap-2.5 border-b border-border-subtle px-3 py-2 text-xs last:border-0"
  >
    <div class="min-w-0 flex-1 pt-1.5">
      <p class="m-0 truncate text-text-primary" :title="draft.name">
        {{ draft.name }}
      </p>
      <p
        class="m-0 truncate font-mono text-2xs text-text-disabled"
        :title="draft.address"
      >
        {{ draft.address }}
      </p>
    </div>

    <DtTag
      size="sm"
      class="mt-1 shrink-0"
      :intent="draft.fieldType === null ? 'neutral' : 'info'"
      :title="typeTitle"
    >
      {{ dataType }}{{ draft.fieldType === null ? ' ?' : '' }}
    </DtTag>

    <DtInput
      class="w-48 shrink-0 font-mono"
      size="sm"
      :model-value="draft.code"
      :error="problem ?? ''"
      :disabled="disabled"
      placeholder="填一个编码"
      :aria-label="`${draft.name} 的点位编码`"
      @update:model-value="emit('update:code', $event)"
    />
  </div>
</template>
