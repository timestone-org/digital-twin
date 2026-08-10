<script setup lang="ts">
/**
 * @fileoverview DtCard —— 面板外框：底色 + 描边 + 圆角，可选四角发光括号。
 *
 * 卡片长什么样只有这一处定义，取值全部来自 @dt/tokens 的 `--card-*` 复合层。
 * ⚠ 页面里不要再手写「边框 + 圆角 + 半透明底」那三行工具类：抄一遍就多一份
 * 会各自漂移的卡片，而这种参差要把两张卡摆在一起才看得出来。
 */
import DtIcon from '../DtIcon/DtIcon.vue'

withDefaults(
  defineProps<{
    title?: string | undefined
    subtitle?: string | undefined
    /** 标题前的图标名，需已在 DtIcon 注册表登记。 */
    icon?: string | undefined
    /** 四角发光括号。密集列表里逐张都点会太吵，故默认关。 */
    corners?: boolean | undefined
    padding?: 'none' | 'sm' | 'md' | undefined
  }>(),
  { corners: false, padding: 'md' },
)
</script>

<template>
  <section class="dt-card" :class="[`dt-card--pad-${padding}`]">
    <template v-if="corners">
      <span
        v-for="corner in ['tl', 'tr', 'bl', 'br']"
        :key="corner"
        class="dt-card__corner"
        :class="`dt-card__corner--${corner}`"
        aria-hidden="true"
      />
    </template>

    <header v-if="title || $slots.header || $slots.actions" class="dt-card__hd">
      <slot name="header">
        <div class="dt-card__titles">
          <h2 v-if="title" class="dt-card__title">
            <DtIcon v-if="icon" :name="icon" :size="16" />
            {{ title }}
          </h2>
          <p v-if="subtitle" class="dt-card__subtitle">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.actions" class="dt-card__actions">
        <slot name="actions" />
      </div>
    </header>

    <slot />

    <footer v-if="$slots.footer" class="dt-card__ft">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped lang="scss">
.dt-card {
  position: relative;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  transition:
    border-color var(--fx-transition),
    box-shadow var(--fx-transition);

  &--pad-none {
    padding: 0;
  }

  &--pad-sm {
    padding: 12px;
  }

  &--pad-md {
    padding: 20px;
  }

  &__hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  &__titles {
    min-width: 0;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-title);
  }

  &__subtitle {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
  }

  &__ft {
    margin-top: 12px;
    font-size: 11px;
    color: var(--text-disabled);
  }

  // 四角发光括号。用四个真实元素而不是伪元素：一个元素只有两个伪元素，
  // 凑四角就得让消费方额外塞一个空 span 进来，那是漏在外面的实现细节。
  &__corner {
    position: absolute;
    display: var(--card-corner-display);
    box-sizing: border-box;
    width: 10px;
    height: 10px;
    border: 0 solid var(--card-corner-color);
    box-shadow: 0 0 var(--card-corner-glow) var(--card-corner-color);
    opacity: 0.9;
    pointer-events: none;

    &--tl {
      top: -1px;
      left: -1px;
      border-top-width: 1px;
      border-left-width: 1px;
    }

    &--tr {
      top: -1px;
      right: -1px;
      border-top-width: 1px;
      border-right-width: 1px;
    }

    &--bl {
      bottom: -1px;
      left: -1px;
      border-bottom-width: 1px;
      border-left-width: 1px;
    }

    &--br {
      bottom: -1px;
      right: -1px;
      border-bottom-width: 1px;
      border-right-width: 1px;
    }
  }
}
</style>
