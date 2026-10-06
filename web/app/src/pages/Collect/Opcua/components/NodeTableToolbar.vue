<script setup lang="ts">
/**
 * @fileoverview 点位表工具栏：搜索 + 全选本页 + 新建 / CSV 导入导出入口。
 * 全部动作冒泡给点位表，本组件不发请求。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIcon, DtInput } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

defineProps<{
  keyword: string
  hasRows: boolean
  exporting: boolean
}>()

defineEmits<{
  'update:keyword': [value: string]
  search: []
  selectPage: []
  create: []
  importCsv: []
  exportCsv: []
}>()
</script>

<template>
  <DtInput
    :model-value="keyword"
    class="w-56"
    size="sm"
    placeholder="搜索名称或编码"
    @update:model-value="$emit('update:keyword', $event)"
    @enter="$emit('search')"
  >
    <template #leading><DtIcon name="search" :size="14" /></template>
  </DtInput>
  <DtButton variant="outline" size="sm" @click="$emit('search')">
    查询
  </DtButton>
  <PermGuard :codes="[PERMISSION_CODES.collectManage]">
    <DtButton
      v-if="hasRows"
      variant="ghost"
      size="sm"
      @click="$emit('selectPage')"
    >
      全选本页
    </DtButton>
    <DtButton size="sm" icon="plus" @click="$emit('create')">
      新建点位
    </DtButton>
    <DtButton
      variant="outline"
      size="sm"
      icon="upload"
      @click="$emit('importCsv')"
    >
      批量导入
    </DtButton>
  </PermGuard>
  <DtButton
    variant="outline"
    size="sm"
    icon="download"
    :loading="exporting"
    @click="$emit('exportCsv')"
  >
    导出 CSV
  </DtButton>
</template>
