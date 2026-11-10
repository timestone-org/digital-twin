<script setup lang="ts">
/** @fileoverview 给画布上的一步改显示名。 */
import { DtButton, DtInput, DtModal } from '@dt/ui'
import { ref, watch } from 'vue'

const props = defineProps<{
  /** 现在的显示名；null = 弹窗关着。 */
  alias: string | null
}>()

const emit = defineEmits<{ apply: [alias: string]; close: [] }>()

const draft = ref('')

watch(
  () => props.alias,
  (alias) => {
    if (alias !== null) draft.value = alias
  },
)

function apply(): void {
  emit('apply', draft.value.trim())
}
</script>

<template>
  <DtModal
    :model-value="props.alias !== null"
    title="给这一步改个名"
    description="留空就用算子本来的名字。"
    width="22rem"
    @update:model-value="emit('close')"
  >
    <!-- ⚠ 用 DtInput 的 enter 而不是 keyup.enter：后者绕过输入法组合守卫 -->
    <DtInput
      v-model="draft"
      label="显示名"
      placeholder="例如：剔除异常行"
      @enter="apply"
    />
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton @click="apply">改名</DtButton>
    </template>
  </DtModal>
</template>
