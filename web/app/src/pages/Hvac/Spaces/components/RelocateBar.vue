<script setup lang="ts">
/**
 * @fileoverview 批量改派条：选中若干台空调后出现，把它们一起挪进某个房间。
 * ⚠ 后端对整批做全有全无——任一 id 不存在就整批拒绝，不会静默跳过几台，
 * 所以这里不需要也不应该显示「部分成功」。
 */
import { ref, watch } from 'vue'
import type { DtSelectOption } from '@dt/contracts'
import { DtButton, DtSelect } from '@dt/ui'

const props = defineProps<{
  count: number
  roomOptions: readonly DtSelectOption[]
  isBusy: boolean
}>()

const emit = defineEmits<{
  relocate: [roomId: string]
  clear: []
}>()

const targetRoomId = ref('')

// 换车间时整批房间选项都换了，旧的目标房间已经不在这一批里
watch(
  () => props.roomOptions,
  () => {
    targetRoomId.value = ''
  },
)
</script>

<template>
  <div class="relocate-bar">
    <span class="relocate-bar__count">已选 {{ props.count }} 台</span>
    <div class="relocate-bar__picker">
      <DtSelect
        v-model="targetRoomId"
        size="sm"
        aria-label="改派到哪个房间"
        :options="props.roomOptions"
        :disabled="props.isBusy"
      />
    </div>
    <DtButton
      size="sm"
      :loading="props.isBusy"
      :disabled="targetRoomId === ''"
      @click="emit('relocate', targetRoomId)"
    >
      改派到这个房间
    </DtButton>
    <DtButton
      variant="ghost"
      intent="neutral"
      size="sm"
      :disabled="props.isBusy"
      @click="emit('clear')"
    >
      取消选择
    </DtButton>
  </div>
</template>

<style scoped lang="scss">
.relocate-bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--accent-primary);
  border-radius: var(--card-radius);
  background: rgba(var(--accent-primary-rgb), 0.1);

  &__count {
    color: var(--text-title);
    font-weight: 600;
  }

  &__picker {
    width: 12rem;
  }
}
</style>
