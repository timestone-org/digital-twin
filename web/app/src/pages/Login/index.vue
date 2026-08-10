<script setup lang="ts">
/**
 * @fileoverview 登录页的外框：氛围底 + 两栏卡片。
 * 左侧品牌 HUD 见 LoginBrandPanel.vue，右侧表单见 LoginForm.vue。
 */
import { DtCard } from '@dt/ui'

import LoginBrandPanel from './components/LoginBrandPanel.vue'
import LoginForm from './components/LoginForm.vue'
</script>

<template>
  <div class="login dt-grid-bg">
    <div class="login__glow login__glow--top" aria-hidden="true" />
    <div class="login__glow login__glow--bottom" aria-hidden="true" />

    <!-- 四角括号在这里给不了：卡片自身 overflow:hidden，贴在 -1px 的角标会被裁掉 -->
    <DtCard padding="none" class="login__card dt-scanlines dt-animate-rise-in">
      <LoginBrandPanel />

      <LoginForm />
    </DtCard>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.login {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  padding: 16px;
  background-color: var(--surface-base);

  @include t.from(t.$bp-sm) {
    padding: 24px;
  }

  &__glow {
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
    filter: blur(120px);

    &--top {
      top: -192px;
      left: 25%;
      width: 36rem;
      height: 36rem;
      transform: translateX(-50%);
      opacity: 0.5;
      background: radial-gradient(
        circle,
        rgba(var(--accent-primary-rgb), 0.3),
        transparent 70%
      );
    }

    &--bottom {
      bottom: -160px;
      right: 25%;
      width: 30rem;
      height: 30rem;
      transform: translateX(50%);
      opacity: 0.4;
      background: radial-gradient(
        circle,
        rgba(var(--accent-secondary-rgb), 0.22),
        transparent 70%
      );
    }
  }

  &__card {
    position: relative;
    z-index: 1;
    display: grid;
    width: 100%;
    max-width: 56rem;
    overflow: hidden;

    @include t.from(t.$bp-lg) {
      grid-template-columns: 1.05fr 1fr;
    }
  }
}
</style>
