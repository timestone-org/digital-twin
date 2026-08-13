<script setup lang="ts">
/**
 * @fileoverview 404 页。匿名可达，不要求登录。
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
      <DtIcon name="alert-circle" :size="28" class="text-accent-on-surface" />
      <h1 class="font-display m-0 text-xl font-bold text-text-title">
        页面不存在
      </h1>
      <p class="mb-2 text-sm text-text-secondary">
        链接可能已失效，或地址输入有误。
      </p>
      <DtButton variant="outline" @click="router.replace('/')">
        返回控制台
      </DtButton>
    </DtCard>
  </div>
</template>
