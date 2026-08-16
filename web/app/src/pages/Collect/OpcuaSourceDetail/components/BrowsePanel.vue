<script setup lang="ts">
/**
 * @fileoverview 地址空间浏览：一层层展开设备的节点树，勾中变量批量建点。
 *
 * ⚠ 浏览由**持有会话的采集进程**执行，平台侧不建连接。所以设备没连上时这里
 * 一定是空的，而那不是「这台设备没有点位」——两者必须分开说，静默摆一棵空树
 * 会让人去查配置，而问题在连接（ADR-0011）。
 *
 * 树的状态与展开/勾选的口径在 `useBrowseTree`；这里只管「把勾中的变量建成
 * 点位」与呈现。
 */
import { onMounted, ref } from 'vue'
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtPageState, DtTag, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { toPointItems } from '../browseTree'
import { importPoints } from '../pointImport'
import { MAX_SUBTREE_NODES, useBrowseTree } from '../useBrowseTree'
import BrowseTreeNode from './BrowseTreeNode.vue'

/** 扫已有点位时一次取多少条。⚠ 与后端单页上限对齐。 */
const SCAN_PAGE_SIZE = 100

const props = defineProps<{ source: CollectSource }>()

const toast = useToast()
const busy = ref(false)

/** 库里已经建过点位的寻址串与编码。重复建会以 409 整批被拒。 */
const takenAddresses = ref(new Set<string>())
const takenCodes = ref(new Set<string>())

const tree = useBrowseTree(() => props.source.id, takenAddresses)

/**
 * 勾一个节点。上层节点勾的是它下面的全部变量；补拉到上限就如实说出来——
 * 静默只勾一半，用户会以为这一层就这么多点位。
 */
async function toggle(address: string): Promise<void> {
  if (!(await tree.toggle(address))) {
    toast.warning(
      `这一层下面的节点超过 ${MAX_SUBTREE_NODES} 个，只勾上了已经读回来的那些——` +
        '再往下请逐层展开。',
    )
  }
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
  if (busy.value || tree.selectedCount.value === 0) return
  busy.value = true
  try {
    const { items, skipped } = toPointItems(
      [...tree.selected.value],
      tree.index.value,
      takenCodes.value,
    )
    const outcome = await importPoints(props.source.id, items)
    if (outcome.created > 0) {
      toast.success(`已建 ${outcome.created} 个点位`)
      tree.clear()
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
  void tree.loadRoot()
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
        :loading="tree.loading.value"
        @click="tree.loadRoot"
      >
        重新浏览
      </DtButton>
      <DtTag v-if="tree.selectedCount.value > 0" intent="info">
        已选 {{ tree.selectedCount.value }} 个变量
      </DtTag>
      <PermGuard :codes="[PERMISSION_CODES.collectManage]">
        <DtButton
          size="sm"
          icon="plus"
          :disabled="tree.selectedCount.value === 0"
          :loading="busy"
          @click="createSelected"
        >
          建成点位
        </DtButton>
      </PermGuard>
    </div>

    <!-- ⚠ 外面这层 div 不能省：DtPageState 渲染的是 fragment，直接挂在它上面
         的 class 会被 Vue 静默丢掉（只在控制台留一行 warn），树区域于是没有
         高度约束、撑破整页而不是自己滚 -->
    <div class="min-h-0 flex-1">
      <DtPageState
        :loading="tree.loading.value"
        :error="tree.error.value"
        :empty="
          !tree.loading.value &&
          tree.error.value === null &&
          tree.roots.value.length === 0
        "
        empty-title="没有浏览到任何节点"
        empty-hint="设备没连上时这里一定是空的，先到列表页做一次连通性测试。"
        @retry="tree.loadRoot"
      >
        <ul class="m-0 h-full overflow-auto p-0">
          <BrowseTreeNode
            v-for="node in tree.roots.value"
            :key="node.address"
            :node="node"
            :depth="0"
            :states="tree.states.value"
            :taken="takenAddresses"
            @expand="tree.expand"
            @toggle="toggle"
          />
        </ul>
      </DtPageState>
    </div>
  </div>
</template>
