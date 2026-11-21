<script setup lang="ts">
/** @fileoverview 确认旧联动涉及的规则，并为每个旧节点选择包内组件。 */
import { DtNotice, DtSelect } from '@dt/ui'
import type { ImportInteractionReview } from '@/features/dashboard/importInteractions'
defineProps<{
  review: ImportInteractionReview | null
  choices: ReadonlyMap<string, string>
  disabled: boolean
}>()
const emit = defineEmits<{ choose: [reference: string, key: string] }>()
</script>

<template>
  <section
    v-if="review && (review.references.length || review.problems.length)"
    class="flex flex-col gap-3"
    aria-label="联动节点对照"
  >
    <h3 class="m-0 text-sm font-medium text-text-primary">联动节点对照</h3>
    <DtNotice
      v-if="review.problems.length"
      intent="danger"
      icon="alert-triangle"
    >
      请修正导出包中的联动节点标记。
      <ul class="mt-1 list-disc pl-4">
        <li v-for="problem in review.problems" :key="problem">{{ problem }}</li>
      </ul>
    </DtNotice>
    <p v-if="review.references.length" class="text-xs text-text-secondary">
      旧包缺少以下节点的对照。请按涉及的联动选择包内节点。
    </p>
    <div
      v-for="item in review.references"
      :key="item.value"
      class="flex flex-col gap-1 rounded-md border border-border-subtle p-3"
    >
      <span class="break-all font-mono text-xs text-text-primary">{{
        item.value || '（空引用）'
      }}</span>
      <ul class="list-disc pl-4 text-xs text-text-secondary">
        <li v-for="use in item.uses" :key="use">{{ use }}</li>
      </ul>
      <DtSelect
        label="对应的包内节点"
        :model-value="choices.get(item.value) ?? ''"
        :options="review.options"
        :disabled="disabled"
        :display="{ placeholder: '选择包内节点' }"
        required
        @update:model-value="emit('choose', item.value, $event)"
      />
    </div>
  </section>
</template>
