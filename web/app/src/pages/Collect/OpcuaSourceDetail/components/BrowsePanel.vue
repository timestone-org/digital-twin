<script setup lang="ts">
/**
 * @fileoverview 地址空间浏览：一层层展开设备的节点树，勾中变量节点批量建点。
 *
 * ⚠ 浏览由**持有会话的采集进程**执行，平台侧不建连接。所以设备没连上时这里
 * 一定是空的，而那不是「这台设备没有点位」——两者必须分开说，静默摆一棵空树
 * 会让人去查配置，而问题在连接（ADR-0011）。
 *
 * ⚠ 一次只展开一层：递归遍历整棵地址空间对 PLC 是实打实的负载，几万个节点
 * 的设备会把一次「展开」拖成分钟级。
 */
import { computed, onMounted, ref } from 'vue'
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtPageState, DtTag, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import {
  findNode,
  toNodes,
  toPointItems,
  variableIndex,
  type TreeNode,
} from '../browseTree'
import { importPoints } from '../pointImport'
import BrowseTreeNode from './BrowseTreeNode.vue'

/** 扫已有点位时一次取多少条。⚠ 与后端单页上限对齐。 */
const SCAN_PAGE_SIZE = 100

const props = defineProps<{ source: CollectSource }>()

const toast = useToast()

const roots = ref<TreeNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref(new Set<string>())
const busy = ref(false)

/** 库里已经建过点位的寻址串与编码。重复建会以 409 整批被拒。 */
const takenAddresses = ref(new Set<string>())
const takenCodes = ref(new Set<string>())

const index = computed(() => variableIndex(roots.value))

const selectedCount = computed(() => selected.value.size)

async function loadRoot(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await collect.browseSource(props.source.id, null)
    roots.value = toNodes(result.items)
  } catch (caught) {
    error.value = describeError(caught)
    roots.value = []
  } finally {
    loading.value = false
  }
}

/** 展开或收起一个节点。已经展开过的直接收起，不再打一次设备。 */
async function expand(address: string): Promise<void> {
  const node = findNode(roots.value, address)
  if (node === null || node.isLoading) return
  if (node.children !== null) {
    node.children = null
    return
  }
  node.isLoading = true
  node.error = null
  try {
    const result = await collect.browseSource(props.source.id, address)
    node.children = toNodes(result.items)
  } catch (caught) {
    node.error = describeError(caught)
  } finally {
    node.isLoading = false
  }
}

function toggle(address: string): void {
  const next = new Set(selected.value)
  if (next.has(address)) next.delete(address)
  else next.add(address)
  selected.value = next
}

async function scanExisting(): Promise<void> {
  const addresses = new Set<string>()
  const codes = new Set<string>()
  let page = 1
  for (;;) {
    const chunk = await collect.listPoints({
      sourceId: props.source.id,
      page,
      size: SCAN_PAGE_SIZE,
    })
    for (const point of chunk.items) {
      addresses.add(point.address)
      codes.add(point.code)
    }
    if (codes.size >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  takenAddresses.value = addresses
  takenCodes.value = codes
}

/** 把勾中的变量节点建成点位。编码由寻址串推，撞名自动挂序号。 */
async function createSelected(): Promise<void> {
  if (busy.value || selectedCount.value === 0) return
  busy.value = true
  try {
    const { items, skipped } = toPointItems(
      [...selected.value],
      index.value,
      takenCodes.value,
    )
    const outcome = await importPoints(props.source.id, items)
    if (outcome.created > 0) {
      toast.success(`已建 ${outcome.created} 个点位`)
      selected.value = new Set()
      await scanExisting()
    }
    for (const failure of outcome.failures) {
      toast.error(`第 ${failure.batch} 批没进去：${failure.message}`)
    }
    if (skipped.length > 0) {
      toast.warning(
        `${skipped.length} 个节点推不出合法编码，已跳过，请到点位页手工添加`,
      )
    }
    if (outcome.unverified > 0) {
      toast.warning(`${outcome.unverified} 条寻址串这次没能到现场确认`)
    }
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    busy.value = false
  }
}

/** 已有点位取不到不阻断浏览：它只影响「已建」标记与编码去重。 */
async function loadTaken(): Promise<void> {
  try {
    await scanExisting()
  } catch {
    takenAddresses.value = new Set<string>()
    takenCodes.value = new Set<string>()
  }
}

onMounted(() => {
  void loadRoot()
  void loadTaken()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtNotice
      v-if="source.runtime.state !== 'online'"
      intent="warning"
      icon="alert-triangle"
    >
      这个数据源当前不在采集，地址空间由持有会话的采集进程读取——现在多半浏览不出
      东西。空树的意思是「读不到」，不是「设备没有点位」。
    </DtNotice>

    <div class="flex flex-wrap items-center gap-2">
      <DtButton
        variant="outline"
        size="sm"
        icon="refresh-cw"
        :loading="loading"
        @click="loadRoot"
      >
        重新浏览
      </DtButton>
      <DtTag v-if="selectedCount > 0" intent="info">
        已选 {{ selectedCount }} 个变量
      </DtTag>
      <PermGuard :codes="[PERMISSION_CODES.collectManage]">
        <DtButton
          size="sm"
          icon="plus"
          :disabled="selectedCount === 0"
          :loading="busy"
          @click="createSelected"
        >
          建成点位
        </DtButton>
      </PermGuard>
    </div>

    <DtPageState
      class="min-h-0 flex-1"
      :loading="loading"
      :error="error"
      :empty="!loading && error === null && roots.length === 0"
      empty-title="没有浏览到任何节点"
      empty-hint="设备没连上时这里一定是空的，先到列表页做一次连通性测试。"
      @retry="loadRoot"
    >
      <ul class="m-0 h-full overflow-auto p-0">
        <BrowseTreeNode
          v-for="node in roots"
          :key="node.address"
          :node="node"
          :depth="0"
          :selected="selected"
          :taken="takenAddresses"
          @expand="expand"
          @toggle="toggle"
        />
      </ul>
    </DtPageState>
  </div>
</template>
