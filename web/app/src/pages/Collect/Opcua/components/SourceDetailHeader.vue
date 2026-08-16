<script setup lang="ts">
/**
 * @fileoverview 选中数据源的详情头：名称 / 状态徽标 / 端点与描述 / 操作按钮 /
 * 元信息行。
 *
 * ⚠ 「连接 / 断开」按钮改的是 `is_enabled`（采集器按计划自动收敛），旁边的
 * 状态徽标显示真实运行态——「配置说它该采」与「它此刻真在采」分开呈现。
 */
import { computed } from 'vue'
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtIcon, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'
import { errorSummary, missingPoints } from '../sourceState'
import SourceStateTag from './SourceStateTag.vue'

const props = defineProps<{
  source: CollectSource
  /** 启停 / 连通性测试进行中（按钮 loading）。 */
  busy: boolean
  /** 列表刷新进行中。 */
  refreshing: boolean
}>()

defineEmits<{
  connect: []
  disconnect: []
  test: []
  refresh: []
  edit: []
  remove: []
}>()

const reason = computed(() => errorSummary(props.source.runtime))

/** 配了却没订上的点位差额；对得上是 null。 */
const missingGap = computed(() =>
  missingPoints(props.source.point_count, props.source.runtime),
)

const stateUpdatedAt = computed(() =>
  formatDateTime(props.source.runtime.updated_at, ''),
)
</script>

<template>
  <DtCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2
            class="m-0 truncate text-lg font-semibold"
            data-test="active-source-name"
          >
            {{ source.name }}
          </h2>
          <SourceStateTag
            :runtime="source.runtime"
            :is-enabled="source.is_enabled"
          />
          <DtTag mono size="sm">{{ source.code }}</DtTag>
        </div>
        <p
          class="mt-1 truncate font-mono text-xs text-text-secondary"
          :title="source.endpoint"
        >
          {{ source.endpoint }}
        </p>
        <p
          v-if="source.description"
          class="mt-1 truncate text-xs text-text-secondary"
        >
          {{ source.description }}
        </p>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <!-- 连接/断开 = 启停采集配置，采集器按计划自动收敛；
             与「编辑/删除配置」同为 collect:manage -->
        <PermGuard :codes="[PERMISSION_CODES.collectManage]">
          <DtButton
            v-if="!source.is_enabled"
            size="sm"
            icon="power"
            :loading="busy"
            data-test="connect-source"
            @click="$emit('connect')"
          >
            连接
          </DtButton>
          <DtButton
            v-else
            variant="outline"
            size="sm"
            icon="power-off"
            :loading="busy"
            data-test="disconnect-source"
            @click="$emit('disconnect')"
          >
            断开
          </DtButton>
        </PermGuard>
        <!-- 连通性测试会走命令总线让采集进程真连一次现场 -->
        <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
          <DtButton
            variant="ghost"
            size="sm"
            icon="activity"
            :loading="busy"
            @click="$emit('test')"
          >
            连通性测试
          </DtButton>
        </PermGuard>
        <!-- 刷新状态是纯读，不设门禁 -->
        <DtButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          aria-label="刷新连接状态"
          :loading="refreshing"
          @click="$emit('refresh')"
        />
        <PermGuard :codes="[PERMISSION_CODES.collectManage]">
          <DtButton
            variant="ghost"
            size="sm"
            icon="pencil"
            aria-label="编辑"
            @click="$emit('edit')"
          />
          <DtButton
            variant="ghost"
            size="sm"
            icon="trash"
            aria-label="删除"
            @click="$emit('remove')"
          />
        </PermGuard>
      </div>
    </div>

    <!-- 元信息行 -->
    <div
      class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border-subtle pt-3 text-xs"
    >
      <span class="text-text-secondary">
        读取方式
        <span class="text-text-primary">
          {{ source.read_mode === 'poll' ? '轮询' : '订阅' }}
          {{ source.poll_interval_ms }}ms
        </span>
      </span>
      <span v-if="source.username" class="text-text-secondary">
        账户 <span class="text-text-primary">{{ source.username }}</span>
      </span>
      <span class="text-text-secondary">
        订阅点位
        <span class="text-text-primary">
          {{ source.runtime.point_count }} / {{ source.point_count }}
        </span>
      </span>
      <span v-if="missingGap !== null" class="text-state-warning">
        {{ missingGap }} 个没订上
      </span>
      <span v-if="stateUpdatedAt" class="text-text-secondary">
        状态更新于
        <span class="text-text-primary">{{ stateUpdatedAt }}</span>
      </span>
      <span
        v-if="reason"
        class="flex items-center gap-1 text-state-danger"
        :title="reason"
      >
        <DtIcon name="alert-circle" :size="13" />
        <span class="max-w-[18rem] truncate">{{ reason }}</span>
      </span>
    </div>
  </DtCard>
</template>
