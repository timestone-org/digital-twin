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
import { DtButton, DtCard, DtEmpty, DtNotice, DtTag, useToast } from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useForceDelete } from './useForceDelete'
import { useSourceOps } from './useSourceOps'
import BrowsePanel from './components/BrowsePanel.vue'
import ForceDeleteDialog from './components/ForceDeleteDialog.vue'
import NodeTable from './components/NodeTable.vue'
import RuntimeParamsDialog from './components/RuntimeParamsDialog.vue'
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
const activeId = ref<string | null>(null)
/** 乱序响应防护：只认最新一次加载。 */
let loadSeq = 0

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
  const seq = ++loadSeq
  sourcesLoading.value = true
  try {
    const page = await collect.listSources({ size: LIST_SIZE })
    if (seq !== loadSeq) return
    sources.value = page.items
    sourcesError.value = null
    // 默认选中第一个，便于直接看到详情
    if (!page.items.some((one) => one.id === activeId.value)) {
      activeId.value = page.items[0]?.id ?? null
    }
  } catch (caught) {
    if (seq === loadSeq) sourcesError.value = describeError(caught)
  } finally {
    if (seq === loadSeq) sourcesLoading.value = false
  }
}

function selectSource(id: string): void {
  activeId.value = id
}

/* ---------------- 源上的写动作（启停 / 测试 / 建改） ---------------- */
const ops = useSourceOps(() => loadSources())

async function create(input: CollectSourceCreateInput): Promise<void> {
  const createdId = await ops.create(input)
  if (createdId !== null) activeId.value = createdId
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
      <PermGuard :codes="[PERMISSION_CODES.collectManage]">
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新增数据源
        </DtButton>
        <!-- 只读账号看不到写入口，这里如实说明原因，免得以为功能没做 -->
        <template #fallback>
          <DtTag size="sm">只读 · 当前账号仅可查看</DtTag>
        </template>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice
        v-if="stalledCount !== 0"
        intent="warning"
        icon="alert-triangle"
      >
        有 {{ stalledCount }}
        个已启用的数据源当前不在采集，它们的点位不会产生任何数据。
      </DtNotice>

      <div
        class="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]"
      >
        <!-- 左栏：数据源列表 -->
        <aside
          class="flex h-[15rem] min-w-0 shrink-0 flex-col xl:h-auto xl:min-h-0"
        >
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

            <!-- 浏览 + 点位表：<xl 竖排固定高，≥xl 铺满两栏内部滚动 -->
            <div
              class="grid min-h-0 grid-cols-1 gap-4 xl:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:grid-rows-1"
            >
              <BrowsePanel
                class="h-[20rem] shrink-0 xl:h-auto"
                :source="activeSource"
                @imported="onImported"
              />
              <NodeTable
                ref="nodeTableRef"
                class="h-[30rem] shrink-0 xl:h-auto"
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
