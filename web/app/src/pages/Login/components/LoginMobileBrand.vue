<script setup lang="ts">
/**
 * @fileoverview 窄屏顶部的品牌条。宽屏由左侧的 LoginBrandPanel 承担，
 * 这里只在它被藏起来时顶上。
 */

import { AppLogo } from '@/components/brand'
import { appConfig } from '@/config/app'
</script>

<template>
  <div class="login-mobile__bar">
    <span class="login-mobile__mark">
      <AppLogo :size="24" />
    </span>
    <div>
      <p class="login-mobile__name dt-glow-text">{{ appConfig.name }}</p>
      <p class="login-mobile__sub">Digital Twin</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.login-mobile__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;

  @include t.from(t.$bp-lg) {
    display: none;
  }
}

.login-mobile__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  color: var(--accent-primary);
}

.login-mobile__name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.login-mobile__sub {
  margin: 2px 0 0;
  font-size: 10px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(var(--accent-primary-rgb), 0.7);
}
</style>
