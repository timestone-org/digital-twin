<script setup lang="ts">
/**
 * @fileoverview 登录页左侧品牌 / HUD 面板：旋转瞄准环 + 扫描线，营造控制室
 * 氛围。纯展示、无交互，小屏隐藏。底部的遥测与时钟见 LoginTelemetry.vue。
 */

import { AppLogo } from '@/components/brand'

import { appConfig } from '@/config/app'
import LoginTelemetry from './LoginTelemetry.vue'
</script>

<template>
  <aside class="brand">
    <div class="brand__rings" aria-hidden="true">
      <svg viewBox="0 0 400 400" class="brand__ring brand__ring--slow">
        <circle
          cx="200"
          cy="200"
          r="150"
          fill="none"
          stroke="var(--accent-primary)"
          stroke-width="1"
          stroke-dasharray="3 9"
        />
        <circle
          cx="200"
          cy="200"
          r="120"
          fill="none"
          stroke="var(--accent-primary)"
          stroke-width="0.6"
          stroke-dasharray="1 6"
        />
        <circle
          cx="200"
          cy="200"
          r="186"
          fill="none"
          stroke="var(--accent-secondary)"
          stroke-width="0.5"
          stroke-dasharray="40 14"
        />
      </svg>
    </div>
    <div class="brand__reticle" aria-hidden="true">
      <svg viewBox="0 0 400 400" class="brand__ring brand__ring--fast">
        <circle
          cx="200"
          cy="200"
          r="92"
          fill="none"
          stroke="var(--accent-primary)"
          stroke-width="1.2"
          stroke-dasharray="60 28 14 28"
        />
        <path
          d="M200 70v40M200 290v40M70 200h40M290 200h40"
          stroke="var(--accent-primary)"
          stroke-width="1.4"
        />
      </svg>
    </div>
    <span class="brand__scan dt-animate-scan-y" aria-hidden="true" />

    <div class="brand__head dt-animate-fade-up">
      <span class="brand__mark">
        <AppLogo :size="28" />
      </span>
      <div>
        <p class="brand__name">{{ appConfig.shortName }}</p>
        <p class="brand__sub">Control Center</p>
      </div>
    </div>

    <div class="brand__pitch">
      <p class="brand__eyebrow dt-animate-fade-up">
        <span class="brand__rule" />
        Digital Twin Platform
      </p>
      <h2 class="brand__title dt-glow-text dt-animate-fade-up">
        {{ appConfig.tagline }}<br />一屏掌控全局
      </h2>
      <p class="brand__desc dt-animate-fade-up">
        面向园区、建筑与设备的工业级数字孪生可视化中枢。汇聚 OPC UA
        实时点位，驱动可配置大屏与三维孪生场景。
      </p>
    </div>

    <LoginTelemetry />
  </aside>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.brand {
  position: relative;
  display: none;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 36px;
  border-right: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-sunken) 40%, transparent);

  @include t.from(t.$bp-lg) {
    display: flex;
  }

  &__rings,
  &__reticle {
    position: absolute;
    pointer-events: none;
  }

  &__rings {
    right: -96px;
    top: -96px;
    width: 544px;
    height: 544px;
    opacity: 0.18;
  }

  &__reticle {
    right: -64px;
    top: -64px;
    width: 288px;
    height: 288px;
    opacity: 0.25;
  }

  &__ring {
    width: 100%;
    height: 100%;

    &--slow {
      animation: dt-spin 46s linear infinite;
    }

    &--fast {
      animation: dt-spin 30s linear infinite reverse;
    }
  }

  &__scan {
    position: absolute;
    inset-inline: 0;
    top: 0;
    height: 160px;
    opacity: 0.6;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      rgba(var(--accent-primary-rgb), 0.14),
      transparent
    );
  }

  &__head {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--accent-primary);
    box-shadow:
      inset 0 0 22px -8px var(--accent-primary),
      0 0 18px -6px var(--accent-primary);
  }

  &__name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: var(--text-title);
  }

  &__sub {
    margin: 2px 0 0;
    font-size: 10px;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(var(--accent-primary-rgb), 0.7);
  }

  &__pitch {
    position: relative;
    z-index: 1;
    max-width: 24rem;
  }

  &__eyebrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 11px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(var(--accent-secondary-rgb), 0.8);
    animation-delay: 80ms;
  }

  &__rule {
    display: inline-block;
    width: 32px;
    height: 1px;
    background: rgba(var(--accent-primary-rgb), 0.6);
  }

  &__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: 0.02em;
    animation-delay: 160ms;
  }

  &__desc {
    margin: 16px 0 0;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-secondary);
    animation-delay: 240ms;
  }
}

// 常驻旋转整条关掉，而不只是把时长压到 0
@include t.reduced-motion {
  .brand__ring {
    animation: none;
  }
}
</style>
