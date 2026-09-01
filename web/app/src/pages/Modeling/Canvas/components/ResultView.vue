<script setup lang="ts">
/**
 * @fileoverview 结果视图的派发件。**只认 `kind`**，见 `scripts/preview.ts` 文件头。
 */
import { DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import { previewOf } from '../scripts/preview'

import FrameView from './FrameView.vue'
import MetricsView from './MetricsView.vue'
import ModelView from './ModelView.vue'

const props = defineProps<{ payload: Record<string, unknown> }>()

const preview = computed(() => previewOf(props.payload))
</script>

<template>
  <FrameView v-if="preview.kind === 'frame'" :preview="preview" />
  <ModelView v-else-if="preview.kind === 'model'" :preview="preview" />
  <MetricsView v-else-if="preview.kind === 'metrics'" :preview="preview" />
  <DtEmpty v-else :title="preview.note" />
</template>
