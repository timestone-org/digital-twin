<script setup lang="ts">
/**
 * @fileoverview 新建角色对话框里的权限码选择段：目录取数、加载态、滚动盒
 * 与「已选 N 项 / 全不选」都归它，好让对话框主体只剩一行。
 */
import { onMounted, ref } from 'vue'
import { DtButton, DtNotice, DtSpinner } from '@dt/ui'

import PermissionCodePicker from '@/features/permissions/PermissionCodePicker.vue'
import { usePermissionCatalog } from '@/features/permissions/usePermissionCatalog'

const props = defineProps<{ modelValue: ReadonlySet<string> }>()

const emit = defineEmits<{
  'update:modelValue': [value: Set<string>]
  /** 目录到手没有。看不见自己要提交什么就不许提交。 */
  ready: [value: boolean]
}>()

const catalog = usePermissionCatalog()
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  await catalog.ensure()
  loading.value = false
  error.value = catalog.error.value
  emit('ready', error.value === null)
}

onMounted(() => {
  void load()
})

function clearAll(): void {
  emit('update:modelValue', new Set())
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-2xs text-text-disabled">
        已选 {{ props.modelValue.size }} 项
      </span>
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :disabled="props.modelValue.size === 0"
        @click="clearAll"
      >
        全不选
      </DtButton>
    </div>

    <DtSpinner v-if="loading" />
    <DtNotice v-else-if="error" intent="danger">{{ error }}</DtNotice>
    <div v-else class="max-h-[18rem] overflow-y-auto">
      <PermissionCodePicker
        :model-value="props.modelValue"
        :groups="catalog.groups.value"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </div>
</template>
