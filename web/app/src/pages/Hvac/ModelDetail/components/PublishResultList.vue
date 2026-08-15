<script setup lang="ts">
/**
 * @fileoverview 「立刻下发一次」的逐点位回执。
 *
 * ⚠ 必须把哨兵值的含义写在这里：现场看到 -1 时，第一反应是「是不是零」。
 * 而 0 是合法预测值（多半一开机就达标），两者读反的后果落在开机决策上。
 */
import { MODEL_NO_PREDICTION } from '@dt/contracts'
import type { ModelPublishResult } from '@dt/contracts'

defineProps<{ result: ModelPublishResult }>()
</script>

<template>
  <section
    class="flex flex-col gap-1.5 rounded-md border border-border-subtle p-3"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs text-text-disabled">这一次下发</span>
      <span class="text-2xs text-text-disabled">
        写进 {{ result.written_count }} 个点位 · {{ MODEL_NO_PREDICTION }}
        表示这一拍算不出数（它不是 0，0 是「多半一开机就达标」）
      </span>
    </div>

    <!-- 三列共享列宽，值与原因才在行与行之间对得齐 -->
    <div
      class="grid items-center gap-x-3 gap-y-1"
      style="grid-template-columns: max-content max-content 1fr"
    >
      <template
        v-for="(item, at) in result.items"
        :key="`${item.set_key ?? 'region'}-${at}`"
      >
        <span class="font-mono text-2xs text-text-disabled">
          {{ item.set_key ?? '区域推荐' }}
        </span>
        <span class="font-mono text-xs text-text-primary">
          {{ item.value ?? '—' }}
        </span>
        <span class="text-2xs text-state-danger">
          {{ item.is_written ? '' : item.error }}
        </span>
      </template>
    </div>
  </section>
</template>
