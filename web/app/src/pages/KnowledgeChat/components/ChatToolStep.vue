<script setup lang="ts">
/** @fileoverview 知识库步骤中的实时卡片分派。 */
import { computed } from 'vue'
import AiToolCard from '@/components/ai/AiToolCard.vue'
import { livePointOfStep } from '@/features/knowledgeChat/liveTools'
import type { RunnerStep } from '@/features/ai/turnLoop'
import ChatLivePoint from './ChatLivePoint.vue'
const props = defineProps<{ step: RunnerStep; enabled: boolean }>()
const point = computed(() => livePointOfStep(props.step))
</script>
<template>
  <ChatLivePoint v-if="point" :point="point" :enabled="enabled" />
  <AiToolCard v-else :step="step" />
</template>
