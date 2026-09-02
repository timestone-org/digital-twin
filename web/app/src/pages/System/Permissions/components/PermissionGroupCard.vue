<script setup lang="ts">
/**
 * @fileoverview 权限目录里的一个分组卡：一张按分组切出来的小表，卡片视图走
 * 本页专属的 PermissionCard。
 * ⚠ `fill=false`：这一页是「若干个分组各一张小表」，滚动归外层那一个容器，
 * 每张小表都按内容高度渲染，否则它们会互相抢高度、谁也拿不到有界高度。
 */
import type { DtDataColumn, PermissionItem } from '@dt/contracts'
import { DtCard, DtDataView, DtTag } from '@dt/ui'
import type { DtDataViewLayout } from '@dt/ui'

import PermissionCard from './PermissionCard.vue'
import PermissionKindTag from './PermissionKindTag.vue'
import PermissionOriginTag from './PermissionOriginTag.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '11rem', card: 'title' },
  { key: 'code', label: '权限码', width: '11rem', card: 'meta' },
  { key: 'kind', label: '档位', width: '8rem' },
  { key: 'held', label: '我是否持有', width: '6rem' },
  { key: 'description', label: '说明' },
]

const LAYOUT: DtDataViewLayout = {
  toggle: false,
  fill: false,
  minWidth: '48rem',
  cardColumns: 3,
  // 参考卡信息量小，可以比别处更早铺满三列
  cardMinWidth: '15rem',
}

defineProps<{
  title: string
  items: readonly PermissionItem[]
  view: 'table' | 'card'
  held: ReadonlySet<string>
}>()
</script>

<template>
  <DtCard :title="title" :subtitle="`${items.length} 个码`" padding="sm">
    <DtDataView :columns="COLUMNS" :rows="items" :view="view" :layout="LAYOUT">
      <template #cell-name="{ row }">{{ row.name }}</template>

      <template #cell-code="{ row }">
        <code class="text-accent-secondary">{{ row.code }}</code>
      </template>

      <template #cell-kind="{ row }">
        <span class="flex items-center gap-1.5">
          <PermissionKindTag :kind="row.kind" />
          <PermissionOriginTag :is-builtin="row.is_builtin" />
        </span>
      </template>

      <template #cell-held="{ row }">
        <DtTag v-if="held.has(row.code)" intent="success">持有</DtTag>
        <span v-else>—</span>
      </template>

      <template #cell-description="{ row }">
        {{ row.description || '—' }}
      </template>

      <template #card="{ row }">
        <PermissionCard :item="row" :held="held.has(row.code)" />
      </template>
    </DtDataView>
  </DtCard>
</template>
