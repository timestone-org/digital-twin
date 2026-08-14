<script setup lang="ts">
/**
 * @fileoverview `type: 'image'` 的控件：填图片 URL 或 CSS background 值，左侧给一张预览。
 * ⚠ 预览按来源分两条路画（见 `imageSource.ts`），塞错了看着就像素材坏了。
 */
import { readText } from '@dt/modules'
import { DtIcon, DtInput } from '@dt/ui'
import { computed } from 'vue'

import { imageSourceKind } from './imageSource'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const current = computed(() => readText(props.value))
const kind = computed(() => imageSourceKind(current.value))
const placeholder = computed(
  () => props.field.placeholder ?? 'https://… 或 linear-gradient(…)',
)
</script>

<template>
  <div class="flex items-center gap-2">
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border-subtle bg-surface-sunken"
    >
      <div
        v-if="kind === 'css'"
        class="h-full w-full"
        :style="{ background: current }"
      />
      <img
        v-else-if="kind === 'url'"
        :src="current"
        alt=""
        class="h-full w-full object-contain"
      />
      <DtIcon v-else name="palette" :size="14" />
    </div>
    <DtInput
      class="w-full"
      :model-value="current"
      size="sm"
      :disabled="disabled"
      :placeholder="placeholder"
      spellcheck="false"
      @update:model-value="emit('update', $event, true)"
    />
  </div>
</template>
