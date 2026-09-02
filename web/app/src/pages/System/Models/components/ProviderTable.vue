<script setup lang="ts">
/**
 * @fileoverview 供应商清单：端点、密钥尾巴、登记的模型、被几个用途指着，以及行内三个动作。
 *
 * ⚠ 列表里永远没有密钥明文，只有尾巴几位；写按钮套 PermGuard，无权限时不存在于 DOM。
 * ⚠ 拆成独立组件不只为了行数：页面入口的模板嵌套有上限，把表格连同它的单元格
 * 插槽留在入口里会把「卡片 → 表格 → 单元格 → 标签」四层全压在那一页上。
 */
import type { DtDataColumn, LlmProvider } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { useViewMode } from '@/composables/useViewMode'

defineProps<{
  providers: readonly LlmProvider[]
  isLoading: boolean
  error: string | null
  /** 正在探的那一路的 id；没有就是 null */
  probingId: string | null
}>()

const emit = defineEmits<{
  probe: [provider: LlmProvider]
  edit: [provider: LlmProvider]
  remove: [provider: LlmProvider]
  retry: []
}>()

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '供应商', card: 'title' },
  { key: 'models', label: '登记的模型' },
  { key: 'usage', label: '用途', width: '10rem' },
  { key: 'state', label: '状态', width: '6rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '10rem',
    card: 'actions',
  },
]

const view = useViewMode('system-models')
</script>

<template>
  <DtDataView
    v-model:view="view"
    :columns="COLUMNS"
    :rows="providers"
    :loading="isLoading"
    :error="error"
    :layout="{
      minWidth: '52rem',
      cardColumns: 2,
      cardMinWidth: '20rem',
      fill: false,
    }"
    :empty="{
      title: '还没有供应商',
      hint: '新建一路，填上端点与密钥，登记要用的模型',
    }"
    @retry="emit('retry')"
  >
    <template #summary>共 {{ providers.length }} 路</template>

    <template #cell-name="{ row }">
      <p class="m-0 text-text-primary">{{ row.name }}</p>
      <p class="m-0 font-mono text-2xs text-text-disabled">
        {{ row.base_url }} · 密钥 {{ row.api_key_hint }}
      </p>
    </template>

    <template #cell-models="{ row }">
      <div class="flex flex-wrap gap-1">
        <DtTag
          v-for="model in row.models"
          :key="model.name"
          size="sm"
          :intent="model.kind === 'embedding' ? 'info' : 'neutral'"
          mono
        >
          {{ model.name }}
        </DtTag>
        <span
          v-if="row.models.length === 0"
          class="text-2xs text-text-disabled"
        >
          未登记
        </span>
      </div>
    </template>

    <template #cell-usage="{ row }">
      <span class="text-2xs text-text-secondary">
        {{
          row.assigned_purposes.length > 0
            ? `${row.assigned_purposes.length} 个用途在用`
            : '没有用途指着'
        }}
      </span>
    </template>

    <template #cell-state="{ row }">
      <DtTag :intent="row.is_enabled ? 'success' : 'neutral'" size="sm">
        {{ row.is_enabled ? '启用' : '停用' }}
      </DtTag>
    </template>

    <template #cell-actions="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.llmManage]">
        <div class="flex justify-end gap-1">
          <DtButton
            variant="ghost"
            size="sm"
            icon="link"
            aria-label="测试连接"
            title="测试连接"
            :loading="probingId === row.id"
            @click="emit('probe', row)"
          />
          <DtButton
            variant="ghost"
            size="sm"
            icon="pencil"
            aria-label="编辑"
            title="编辑"
            @click="emit('edit', row)"
          />
          <DtButton
            variant="ghost"
            intent="danger"
            size="sm"
            icon="trash"
            aria-label="删除"
            title="删除"
            @click="emit('remove', row)"
          />
        </div>
      </PermGuard>
    </template>
  </DtDataView>
</template>
