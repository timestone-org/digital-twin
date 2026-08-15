<script setup lang="ts">
/**
 * @fileoverview 孪生场景上的状态浮层：加载进度、空态与错误、以及「模型里没有
 * 这些部件节点」的告警。
 *
 * ⚠ 浮层一律 `pointer-events: none`：盖住画布的话，OrbitControls 收不到拖拽，
 * 表现是「模型转不动」，而这跟浮层看起来毫无关系。
 */
import { DtNotice, DtSpinner } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  status: 'empty' | 'loading' | 'ready' | 'error'
  /** 0 = 还没有进度信息，此时只说「加载中」不报百分比。 */
  progressPercent: number
  errorMessage: string
  /** 配置里引用了、模型里却没有的节点名。 */
  missingNodes: readonly string[]
}>()

const overlayMessage = computed(() =>
  props.status === 'error' ? props.errorMessage : '未选择模型',
)

const progressText = computed(() =>
  props.progressPercent > 0
    ? `模型加载中 ${props.progressPercent}%`
    : '模型加载中',
)

const missingText = computed(() => props.missingNodes.join('、'))
</script>

<template>
  <div v-if="status === 'loading'" class="twin-overlay">
    <DtSpinner />
    <span class="twin-overlay__progress">{{ progressText }}</span>
  </div>
  <div v-else-if="status !== 'ready'" class="twin-overlay">
    <DtNotice :intent="status === 'error' ? 'danger' : 'neutral'">
      {{ overlayMessage }}
    </DtNotice>
  </div>
  <DtNotice
    v-if="missingNodes.length > 0"
    class="twin-overlay__issue"
    intent="warning"
  >
    模型里没有这些部件节点：{{ missingText }}
  </DtNotice>
</template>

<style scoped lang="scss">
.twin-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  pointer-events: none;

  &__progress {
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.twin-overlay__issue {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  justify-content: center;
}
</style>
