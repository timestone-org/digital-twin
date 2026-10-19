<script setup lang="ts">
/** @fileoverview HTTP 点位映射的管理权限入口。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import PermGuard from '@/components/PermGuard.vue'

defineEmits<{ open: [] }>()
</script>

<template>
  <PermGuard :codes="[PERMISSION_CODES.collectManage]">
    <DtButton variant="outline" size="sm" @click="$emit('open')">
      从 JSON 生成点位
    </DtButton>
  </PermGuard>
</template>
