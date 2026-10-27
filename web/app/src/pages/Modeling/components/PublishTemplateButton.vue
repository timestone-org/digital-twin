<script setup lang="ts">
/** @fileoverview 发布模板的入口与对话框状态。 */
import { DtButton } from '@dt/ui'
import { PERMISSION_CODES } from '@dt/contracts'
import PermGuard from '@/components/PermGuard.vue'
import { ref } from 'vue'
import PublishTemplateDialog from './PublishTemplateDialog.vue'
defineProps<{
  pipeline: { id: string; name: string } | null
  disabled?: boolean
}>()
const open = ref(false)
</script>
<template>
  <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
    <DtButton
      size="sm"
      variant="ghost"
      :disabled="disabled || !pipeline"
      @click="open = true"
    >
      发布为模板
    </DtButton>
  </PermGuard>
  <PublishTemplateDialog
    :pipeline="open ? pipeline : null"
    @close="open = false"
  />
</template>
