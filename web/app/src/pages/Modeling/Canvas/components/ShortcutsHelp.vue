<script setup lang="ts">
/**
 * @fileoverview 快捷键速查表。清单在 `../scripts/shortcutHelp`。
 */
import { computed } from 'vue'

import { shortcutSections } from '../scripts/shortcutHelp'
import { modLabel } from '../scripts/useCanvasMenu'

const sections = computed(() => shortcutSections(modLabel(navigator.platform)))
</script>

<template>
  <div class="dt-ml-keys">
    <section v-for="section in sections" :key="section.title">
      <h4>{{ section.title }}</h4>
      <dl>
        <template v-for="row in section.rows" :key="row.keys">
          <dt>{{ row.keys }}</dt>
          <dd>{{ row.desc }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-keys {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  h4 {
    margin: 0 0 0.25rem;
    color: var(--text-title);
    font-size: var(--ctl-fs-sm);
  }

  dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0;
  }

  dt {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-sm);
  }

  dd {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
