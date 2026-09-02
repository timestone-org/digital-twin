<script setup lang="ts">
/**
 * @fileoverview OPC UA 采集的主从单页：左侧数据源列表，右侧详情 + 在线浏览 +
 * 已导入点位表。一个协议一个页面，配置里不再选协议。
 *
 * ⚠ 「连接 / 断开」按钮改的是 `is_enabled`：本架构没有手动会话动作，采集器按
 * 计划自动收敛（docs/COLLECT_DESIGN.md §4.4），点下去几秒内生效。按钮旁的
 * 状态徽标显示的是**真实运行态**——「配置说它该采」与「它此刻真在采」必须
 * 分开呈现（§9.2）。
 *
 * ⚠ 运行态按周期重取：它来自采集侧写的另一张表，没有推送通道，这一页上的
 * 状态最迟落后一个周期。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CollectSource, CollectSourceCreateInput } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtEmpty, DtNotice, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useActiveSource } from './scripts/useActiveSource'
import { useForceDelete } from './scripts/useForceDelete'
import { useSourceOps } from './scripts/useSourceOps'
import BrowsePanel from './components/BrowsePanel.vue'
import ForceDeleteDialog from './components/ForceDeleteDialog.vue'
import NodeTable from './components/NodeTable.vue'
import RuntimeParamsDialog from '@/components/runtime/RuntimeParamsDialog.vue'
import SourceDetailHeader from './components/SourceDetailHeader.vue'
import SourceFormDialog from './components/SourceFormDialog.vue'
import SourceListPanel from './components/SourceListPanel.vue'

/** 运行态刷新周期。⚠ 只刷这一页看得见的源，不随数据源数量增长。 */
const REFRESH_MS = 10_000
/** 左栏一次拉多少个源。⚠ 与后端单页上限对齐。 */
const LIST_SIZE = 100

const toast = useToast()

/* ---------------- 源加载 ---------------- */
const sources = ref<CollectSource[]>([])
const sourcesLoading = ref(false)
const sourcesError = ref<string | null>(null)
// 选中哪个源同步在地址栏上：刷新不丢、链接可分享（见 useActiveSource）
const { activeId, select: selectSource, reconcile } = useActiveSource()
/** 乱序响应防护：只认最新一次加载。 */
const raced = useRacedFetch()

const activeSource = computed(
  () => sources.value.find((one) => one.id === activeId.value) ?? null,
)

/** 有几个源配了点位却没在采。它是「配了没人读」最外层的一道提示。 */
const stalledCount = computed(
  () =>
    sources.value.filter(
      (one) =>
        one.is_enabled && one.point_count > 0 && one.runtime.state !== 'online',
    ).length,
)

async function loadSources(): Promise<void> {
  sourcesLoading.value = true
  await raced.run(() => collect.listSources({ size: LIST_SIZE }), {
    ok: (page) => {
      sources.value = page.items
      sourcesError.value = null
      // 地址栏指的源没了（被删或链接过期）就落到第一个，便于直接看到详情
      reconcile(page.items.map((one) => one.id))
    },
    fail: (caught) => (sourcesError.value = describeError(caught)),
    settled: () => (sourcesLoading.value = false),
  })
}

/* ---------------- 源上的写动作（启停 / 测试 / 建改） ---------------- */
const ops = useSourceOps(() => loadSources())

async function create(input: CollectSourceCreateInput): Promise<void> {
  const createdId = await ops.create(input)
  if (createdId !== null) selectSource(createdId)
}

/* ---------------- 删除源（带引用守卫，可强删） ---------------- */
const removal = useForceDelete<CollectSource>(
  (source, force) => collect.deleteSource(source.id, force),
  (source, message) =>
    `${message}。强制删除会连同其下 ${source.point_count} 个点位一起移除，` +
    '仍绑着它们的大屏引用就此失效。',
  () => loadSources(),
)

/* ---------------- 浏览导入 → 刷新点位表 ---------------- */
const nodeTableRef = ref<InstanceType<typeof NodeTable> | null>(null)

function onImported(count: number): void {
  toast.success(`已导入 ${count} 个点位`)
  // 分页下导入不本地 merge，导入完成后刷新点位表当前页与源的点位计数
  void nodeTableRef.value?.reload()
  void loadSources()
}

/* ---------------- 运行参数 ---------------- */
const collectParamsOpen = ref(false)
const archiveParamsOpen = ref(false)

/* ---------------- 周期刷新 ---------------- */
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void loadSources()
  // ⚠ 卸载时必须清掉：不清的话切走的页面还在打接口并更新已经不在的状态
  timer = setInterval(() => void loadSources(), REFRESH_MS)
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
  // ⚠ 不作废的话，卸载后才返回的那一拍还会写进一个已经没人看的页面
  raced.cancel()
})
</script>

<template>
  <AppShell title="OPC UA 采集" subtitle="去连现场设备的数据源与点位">
    <template #actions>
      <!-- 运行参数：只读账号也进得来（看得见节拍不等于能改），保存按钮由弹窗自己判写码 -->
      <PermGuard :codes="[PERMISSION_CODES.collectView]">
        <DtButton
          variant="ghost"
          size="sm"
          icon="settings"
          data-test="open-collect-params"
          @click="collectParamsOpen = true"
        >
          采集参数
        </DtButton>
        <DtButton
          variant="ghost"
          size="sm"
          icon="database"
          data-test="open-archive-params"
          @click="archiveParamsOpen = true"
        >
          归档参数
        </DtButton>
      </PermGuard>
      <!-- explain：只读账号看不到写入口，这里如实说明原因，免得以为功能没做 -->
      <PermGuard :codes="[PERMISSION_CODES.collectManage]" explain>
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新增数据源
        </DtButton>
      </PermGuard>
    </template>

    <!-- ⚠ 这一页必须自己能滚：窄屏时左栏 15rem（<xl）+ 浏览 20rem + 点位表
         37.5rem（<2xl）是竖着堆的，加起来必然高过视口，而 AppShell 的 `<main>` 是
         overflow-hidden、自己不滚。装不下又没处滚，多出来的部分既看不见也够
         不着；更糟的是 overflow-hidden **能被程序滚动**——点一下裁切线以下
         的勾选框，浏览器会把 `<main>` 滚过去露出焦点元素，而它没有滚动条，
         用户只看到整页内容凭空消失且再也回不来。 -->
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <DtNotice
        v-if="stalledCount !== 0"
        intent="warning"
        icon="alert-triangle"
      >
        有 {{ stalledCount }}
        个已启用的数据源当前不在采集，它们的点位不会产生任何数据。
      </DtNotice>

      <!-- ⚠ `flex-1` 只在 ≥xl 给：窄屏时要让这块按内容撑开，交给外面那层滚，
           否则栅格行被压扁、内容溢出到行外，滚动条也就无从出现 -->
      <div
        class="grid min-h-0 grid-cols-1 gap-4 xl:flex-1 xl:grid-cols-[20rem_minmax(0,1fr)]"
      >
        <!-- 左栏：数据源列表 -->
        <aside class="flex h-80 min-w-0 shrink-0 flex-col xl:h-auto xl:min-h-0">
          <SourceListPanel
            :sources="sources"
            :loading="sourcesLoading"
            :error="sourcesError"
            :active-id="activeId"
            @select="selectSource"
            @reload="loadSources"
            @create="ops.openCreate"
          />
        </aside>

        <!-- 右栏：详情 -->
        <section class="flex min-h-0 min-w-0 flex-col gap-4">
          <template v-if="activeSource">
            <SourceDetailHeader
              :source="activeSource"
              :busy="ops.busyId.value === activeSource.id"
              :refreshing="sourcesLoading"
              @connect="ops.setEnabled(activeSource, true)"
              @disconnect="ops.setEnabled(activeSource, false)"
              @test="ops.test(activeSource)"
              @refresh="loadSources"
              @edit="ops.openEdit(activeSource)"
              @remove="removal.ask(activeSource)"
            />

            <!-- 浏览 + 点位表：<2xl 竖排固定高、交给外层滚；≥2xl 并排铺满内部滚动。
                 ⚠ 并排的门槛是 2xl 不是 xl：xl 那一档右区只剩八百多像素，点位表分到
                 五百像素时工具条要折三行、表体只剩两行，浏览树那边连「在线浏览」四个
                 字都竖着排——与知识库页同一条口径 -->
            <div
              class="grid min-h-0 grid-cols-1 gap-4 2xl:flex-1 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] 2xl:grid-rows-1"
            >
              <BrowsePanel
                class="h-80 shrink-0 2xl:h-auto"
                :source="activeSource"
                @imported="onImported"
              />
              <NodeTable
                ref="nodeTableRef"
                class="h-150 shrink-0 2xl:h-auto"
                :source="activeSource"
              />
            </div>
          </template>

          <!-- 未选中源（新增入口在左栏与顶栏，这里只指路不再塞第三个按钮） -->
          <DtCard v-else class="flex min-h-0 flex-1 flex-col justify-center">
            <DtEmpty
              icon="database"
              title="选择一个数据源"
              hint="从左侧选择数据源以查看连接状态、浏览地址空间并管理已导入点位。"
            />
          </DtCard>
        </section>
      </div>
    </div>

    <!-- 弹窗 -->
    <SourceFormDialog
      v-model="ops.formOpen.value"
      :source="ops.formSource.value"
      @create="create"
      @update="ops.update"
    />
    <ForceDeleteDialog
      v-model="removal.open.value"
      title="删除数据源"
      :name="removal.target.value?.name"
      message="将同时移除其下已导入点位，此操作不可撤销。"
      :conflict="removal.conflict.value"
      :loading="removal.busy.value"
      @confirm="removal.confirm"
    />

    <!-- 采集调优与归档两组运行参数各开一个弹窗：混在一屏里找不到东西 -->
    <RuntimeParamsDialog
      v-model="collectParamsOpen"
      section="collect"
      title="运行参数 · OPC UA 采集"
      intro="环境变量给的是默认值，这里改过的项会压过它。改动随采集计划下发，最迟半分钟生效；每项旁边的徽标说明它多久生效。"
    />
    <RuntimeParamsDialog
      v-model="archiveParamsOpen"
      section="archive"
      title="运行参数 · 点位历史归档"
      intro="总开关在这里拨一下、最迟半分钟生效，不必重启采集进程。关闭总开关与调小容量是危险方向，要再确认一次。"
    />
  </AppShell>
</template>
