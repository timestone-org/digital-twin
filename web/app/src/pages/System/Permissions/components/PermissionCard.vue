<script setup lang="ts">
/**
 * @fileoverview 权限目录的一张只读参考卡：名称主、码次、档位在标题行、
 * 持有与来历排在底部一条状态轨上。
 * ⚠ 说明段缺席也要渲染 `—`：整行消失会让同一行三张卡的状态轨错位，
 * 而状态轨齐平正是「我持有哪些」可扫读的前提。
 */
import type { PermissionItem } from '@dt/contracts'
import { DtCard, DtIcon, DtTag } from '@dt/ui'

import PermissionKindTag from './PermissionKindTag.vue'
import PermissionOriginTag from './PermissionOriginTag.vue'

defineProps<{ item: PermissionItem; held: boolean }>()
</script>

<template>
  <DtCard padding="sm" class="permission-card flex min-w-0 flex-col">
    <template #header>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center justify-between gap-2">
          <h3
            class="m-0 min-w-0 truncate font-display text-sm font-semibold text-text-title"
            :title="item.name"
          >
            {{ item.name }}
          </h3>
          <PermissionKindTag :kind="item.kind" size="md" class="shrink-0" />
        </div>
        <p class="m-0 mt-1 truncate text-2xs" :title="item.code">
          <code class="font-mono text-accent-secondary">{{ item.code }}</code>
        </p>
      </div>
    </template>

    <div class="flex flex-1 flex-col gap-3">
      <p class="m-0 text-xs text-text-secondary">
        {{ item.description || '—' }}
      </p>
      <div class="mt-auto flex items-center justify-between gap-2">
        <DtTag v-if="held" intent="success">
          <DtIcon name="check" :size="10" />持有
        </DtTag>
        <span v-else class="text-3xs text-text-disabled">未持有</span>
        <PermissionOriginTag :is-builtin="item.is_builtin" />
      </div>
    </div>
  </DtCard>
</template>
