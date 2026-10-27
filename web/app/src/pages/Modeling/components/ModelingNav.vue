<script setup lang="ts">
/** @fileoverview 模板、模型及交付成果的统一导航。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { RouterLink } from 'vue-router'
import PermGuard from '@/components/PermGuard.vue'
</script>

<template>
  <nav class="modeling-nav" aria-label="分析建模导航">
    <RouterLink to="/modeling/instances"> 模型实例 </RouterLink>

    <RouterLink to="/modeling/templates"> 模板库 </RouterLink>

    <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
      <RouterLink to="/modeling/pipelines"> 模板设计 </RouterLink>
    </PermGuard>

    <RouterLink to="/modeling/runs"> 训练记录 </RouterLink>

    <RouterLink to="/modeling/models"> 模型版本 </RouterLink>

    <RouterLink to="/modeling/services"> 部署服务 </RouterLink>

    <RouterLink to="/modeling/integration"> 第三方接入 </RouterLink>
  </nav>
</template>

<style scoped lang="scss">
.modeling-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-default);
  padding-bottom: 0.75rem;
  a {
    padding: 0.45rem 0.8rem;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  a.router-link-active {
    color: var(--accent-primary);
    background: var(--surface-panel);
    box-shadow: inset 0 -2px var(--accent-primary);
  }
}
</style>
