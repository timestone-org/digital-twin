<script setup lang="ts">
/**
 * @fileoverview 抽取批次的状态条：当前批次、进度、时间窗与两条提醒。
 *
 * ⚠ 指纹不符（`is_stale`）说明屏幕上这份数据是按**另一套规则**算出来的，
 * 必须显式提醒重算；没算过是另一回事，要人做的事不同。
 * ⚠ `unmatched_exclusion_count` 非零要说出来：那些人工排除在重算后对不上任何
 * 事件了，人的判断正在悄悄流失。
 * ⚠ 重算键要 ac:manage：页面是 ac:view 进得来的，但后端三个写端点挂的是
 * ManageDep，不挡的话只读账号会点出一串 403。
 */
import { computed } from 'vue'
import type { StartupBatch } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtProgress, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { batchProgress, formatWindow } from '../startupView'

const props = defineProps<{
  batch: StartupBatch | null
  isStale: boolean
  rebuilding: boolean
}>()

const emit = defineEmits<{ rebuild: [] }>()

const isRunning = computed(() => props.batch?.status === 'running')
const progress = computed(() =>
  props.batch === null ? 0 : batchProgress(props.batch),
)
const unmatched = computed(() => props.batch?.unmatched_exclusion_count ?? 0)
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtNotice v-if="batch === null" intent="info">
      这个房间还没有抽取过开机事件。
    </DtNotice>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <DtTag :intent="batch.status === 'failed' ? 'danger' : 'neutral'">
          {{ batch.episode_count }} 条事件
        </DtTag>
        <span class="text-text-secondary">{{ formatWindow(batch) }}</span>
        <span class="text-text-disabled">
          逻辑版本 v{{ batch.logic_version }}
        </span>
        <!-- ⚠ 触发重算要 ac:manage（后端挂的是 ManageDep），页面本身只要
           ac:view——只读账号不该看见一颗点了就 403 的键 -->
        <PermGuard :codes="[PERMISSION_CODES.acManage]">
          <DtButton
            class="ml-auto"
            size="sm"
            variant="outline"
            :loading="rebuilding"
            :disabled="isRunning"
            @click="emit('rebuild')"
          >
            重新抽取
          </DtButton>
        </PermGuard>
      </div>

      <!-- 重算期间照常显示上一批次的完整数据，这里只多一条进度 -->
      <div v-if="isRunning" class="flex items-center gap-2">
        <DtProgress class="flex-1" :value="progress" />
        <span class="text-xs text-text-secondary">
          正在抽取 {{ batch.shard_done }} / {{ batch.shard_total }} 个分片；
          下面仍是上一批次的完整结果
        </span>
      </div>

      <DtNotice v-if="isStale" intent="warning">
        抽取参数或判定逻辑已经变过，屏幕上这份数据是按旧规则算出来的，
        重新抽取后才与当前规则一致。
      </DtNotice>

      <DtNotice v-if="unmatched > 0" intent="warning">
        有 {{ unmatched }} 条人工排除在这一批里对不上任何事件，
        它们标记的那几次开机可能已经不在结果中了，请复核。
      </DtNotice>

      <DtNotice v-if="batch.status === 'failed'" intent="danger">
        上一次抽取失败了，屏幕上的数据可能不完整，请重新抽取。
      </DtNotice>
    </template>
  </div>
</template>
