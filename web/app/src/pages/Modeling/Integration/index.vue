<script setup lang="ts">
/** @fileoverview 第三方接入的独立说明与验证入口。 */
import { AppShell } from '@/components/layout'
import ModelingNav from '../components/ModelingNav.vue'
import IntegrationGuide from './components/IntegrationGuide.vue'
</script>

<template>
  <AppShell
    title="第三方接入"
    subtitle="使用已发布模板，通过接口创建、更新和运行独立模型"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingNav />
      <IntegrationGuide />
    </div>
  </AppShell>
</template>
