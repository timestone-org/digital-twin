<script setup lang="ts">
/**
 * @fileoverview 403 页。⚠ 只是体验：真正的拦截在后端，这里不做任何判定。
 */
import { useRouter } from 'vue-router'
import { DtButton, DtCard, DtIcon } from '@dt/ui'

const router = useRouter()
</script>

<template>
  <div class="dt-grid-bg flex min-h-screen items-center justify-center p-6">
    <DtCard
      corners
      class="flex max-w-md flex-col items-center gap-3 px-8 py-10 text-center"
    >
      <DtIcon name="shield" :size="28" class="text-accent-on-surface" />
      <h1 class="font-display m-0 text-xl font-bold text-text-title">
        没有该操作的权限
      </h1>
      <p class="mb-2 text-sm text-text-secondary">如需开通请联系系统管理员。</p>
      <DtButton variant="outline" @click="router.replace('/')">
        返回控制台
      </DtButton>
    </DtCard>
  </div>
</template>
