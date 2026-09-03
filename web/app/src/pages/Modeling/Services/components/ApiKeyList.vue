<script setup lang="ts">
/**
 * @fileoverview 一个对外服务下的密钥表。
 *
 * ⚠ 表里**没有明文**，只有前 12 位前缀——明文只在铸出来那一次的回执里出现，
 * 之后任何接口都取不回来（docs/MODELING_PLATFORM_DESIGN.md D13）。
 */
import type { DtDataColumn, DtIntent, ModelApiKey } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime, nowStamp } from '@/utils/datetime'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '用途', card: 'title' },
  { key: 'key_prefix', label: '前缀', width: '11rem' },
  { key: 'state', label: '状态', width: '6rem' },
  { key: 'last_used_at', label: '最后用过', width: '11rem' },
  { key: 'actions', label: '', align: 'right', width: '6rem', card: 'actions' },
]

const EMPTY = {
  title: '还没有密钥',
  hint: '没有密钥时这个服务谁也调不了——铸一把交给对接方。',
}

const props = defineProps<{ rows: readonly ModelApiKey[] }>()

defineEmits<{ revoke: [key: ModelApiKey] }>()

/** 一把钥匙现在能不能用。三档各自一句话。 */
function stateOf(key: ModelApiKey): { text: string; intent: DtIntent } {
  if (key.revoked_at !== null) return { text: '已撤销', intent: 'neutral' }
  const expires = key.expires_at
  if (expires !== null && expires <= nowStamp().toISOString()) {
    return { text: '已过期', intent: 'warning' }
  }
  return { text: '有效', intent: 'success' }
}
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="props.rows"
    :empty="EMPTY"
    :layout="{ fixedLayout: true, minWidth: '38rem' }"
  >
    <template #cell-name="{ row }">{{ row.name }}</template>
    <template #cell-key_prefix="{ row }">
      <code>{{ row.key_prefix }}…</code>
    </template>
    <template #cell-state="{ row }">
      <DtTag :intent="stateOf(row).intent" size="sm">
        {{ stateOf(row).text }}
      </DtTag>
    </template>
    <template #cell-last_used_at="{ row }">
      {{ row.last_used_at ? formatDateTime(row.last_used_at) : '从未' }}
    </template>
    <template #cell-actions="{ row }">
      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtButton
          v-if="row.revoked_at === null"
          variant="ghost"
          size="xs"
          @click="$emit('revoke', row)"
        >
          撤销
        </DtButton>
      </PermGuard>
    </template>
  </DtDataView>
</template>

<style scoped lang="scss">
code {
  font-family: var(--font-mono);
}
</style>
