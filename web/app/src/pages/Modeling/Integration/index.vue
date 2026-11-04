<script setup lang="ts">
/** @fileoverview 第三方接入的独立说明与验证入口。 */
import { AppShell } from '@/components/layout'
import IntegrationGuide from './components/IntegrationGuide.vue'
</script>

<template>
  <AppShell
    title="第三方接入"
    subtitle="通过模板创建工作流，训练并发布、定时更新与调用模型"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <IntegrationGuide />
    </div>
  </AppShell>
</template>
