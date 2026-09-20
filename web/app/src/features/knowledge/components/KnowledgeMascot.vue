<script setup lang="ts">
/** @fileoverview 知识库吉祥物场景，动效定义见全局 animations。 */
import welcome from '@/assets/knowledge/welcome.png'
import search from '@/assets/knowledge/search.png'
import library from '@/assets/knowledge/library.png'

const props = withDefaults(
  defineProps<{
    scene?: 'welcome' | 'search' | 'library'
    compact?: boolean
    active?: boolean
  }>(),
  { scene: 'welcome', compact: false, active: false },
)

const SCENES = { welcome, search, library }
</script>

<template>
  <div
    class="knowledge-mascot"
    :class="[
      `knowledge-mascot--${props.scene}`,
      {
        'knowledge-mascot--compact': props.compact,
        'knowledge-mascot--active': props.active,
      },
    ]"
    aria-hidden="true"
  >
    <span class="knowledge-mascot__halo" />
    <span class="knowledge-mascot__spark knowledge-mascot__spark--one">✦</span>
    <span class="knowledge-mascot__spark knowledge-mascot__spark--two">✧</span>
    <img
      :src="SCENES[props.scene]"
      alt=""
      width="240"
      height="240"
      draggable="false"
    />
    <span class="knowledge-mascot__orbit" />
  </div>
</template>

<style scoped lang="scss">
.knowledge-mascot {
  position: relative;
  isolation: isolate;
  width: 15rem;
  max-width: 100%;
  aspect-ratio: 1;
  flex-shrink: 0;
  pointer-events: none;

  img {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: 50% 85%;
    animation: dt-mascot-greet 2.2s ease-in-out 2;
  }

  &__halo {
    position: absolute;
    inset: 14% 6% 5%;
    z-index: -1;
    border-radius: 50%;
    background: radial-gradient(
      ellipse,
      rgba(var(--accent-primary-rgb), 0.16),
      rgba(var(--accent-secondary-rgb), 0.05) 60%,
      transparent 72%
    );
  }

  &__spark {
    position: absolute;
    z-index: 1;
    color: var(--accent-primary);
    font-size: 1.4rem;
    animation: dt-mascot-spark 2s ease-in-out 2;
    &--one {
      left: 8%;
      top: 27%;
    }
    &--two {
      right: 8%;
      top: 12%;
      animation-delay: 0.3s;
    }
  }

  &__orbit {
    position: absolute;
    inset: auto 20% 4%;
    height: 7%;
    z-index: -1;
    border-radius: 50%;
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  &--compact {
    width: 6rem;
  }
  &--library img {
    animation-name: dt-mascot-read;
  }
  &--search img {
    animation: none;
  }
  &--active img {
    animation: dt-mascot-search 1.8s ease-in-out infinite;
  }
  &--active .knowledge-mascot__spark {
    animation-iteration-count: infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  .knowledge-mascot img,
  .knowledge-mascot__spark {
    animation: none;
  }
}
</style>
