<script setup lang="ts">
/**
 * @fileoverview 供应商清单：类型、端点或登录、登记的模型、被几个用途指着，以及行内动作。
 *
 * ⚠ 「测试连接」只对有端点的那些形态摆：靠登录的那一路没有地址可探，
 * 摆出来的话点下去收到的是一条 400。
 *
 * ⚠ 列表里永远没有密钥明文，只有尾巴几位；写按钮套 PermGuard，无权限时不存在于 DOM。
 * ⚠ 拆成独立组件不只为了行数：页面入口的模板嵌套有上限，把表格连同它的单元格
 * 插槽留在入口里会把「卡片 → 表格 → 单元格 → 标签」四层全压在那一页上。
 */
import type { DtDataColumn, LlmProvider, LlmProviderKind } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { useViewMode } from '@/composables/useViewMode'

const props = defineProps<{
  providers: readonly LlmProvider[]
  /** 后端下发的形态清单；摆哪几个动作按它判 */
  kinds: readonly LlmProviderKind[]
  isLoading: boolean
  error: string | null
  /** 正在探的那一路的 id；没有就是 null */
  probingId: string | null
}>()

/** 这一路的形态；清单还没拉到时是 undefined。 */
function kindOf(provider: LlmProvider): LlmProviderKind | undefined {
  return props.kinds.find((one) => one.code === provider.kind)
}

/** 这一路探不探得了：没有端点就没得探。 */
function isProbable(provider: LlmProvider): boolean {
  return kindOf(provider)?.is_endpoint_required !== false
}

/** 这一路在界面上的类型名；认不出就把码原样显示出来。 */
function kindLabel(provider: LlmProvider): string {
  return kindOf(provider)?.label ?? provider.kind
}

const emit = defineEmits<{
  probe: [provider: LlmProvider]
  edit: [provider: LlmProvider]
  remove: [provider: LlmProvider]
  retry: []
}>()

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '供应商', card: 'title' },
  { key: 'kind', label: '类型', width: '9rem' },
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
      minWidth: '58rem',
      cardColumns: 2,
      cardMinWidth: '20rem',
      fill: false,
    }"
    :empty="{
      title: '还没有供应商',
      hint: '新建一路：选类型，配它要的那几格，登记要用的模型',
    }"
    @retry="emit('retry')"
  >
    <template #summary>共 {{ providers.length }} 路</template>

    <template #cell-name="{ row }">
      <p class="m-0 text-text-primary">{{ row.name }}</p>
      <p v-if="row.base_url" class="m-0 font-mono text-2xs text-text-disabled">
        {{ row.base_url }} · 密钥 {{ row.api_key_hint }}
      </p>
      <p v-else class="m-0 text-2xs text-text-disabled">
        登录一次即可，不按 token 计费
      </p>
    </template>

    <template #cell-kind="{ row }">
      <DtTag size="sm" intent="neutral">{{ kindLabel(row) }}</DtTag>
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
            v-if="isProbable(row)"
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
