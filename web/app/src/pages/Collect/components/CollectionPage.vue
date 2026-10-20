<script setup lang="ts">
/** @fileoverview 协议采集页共用的主从布局、数据源操作与点位管理。 */
import { computed, ref } from 'vue'
import type {
  CollectProtocol,
  CollectSource,
  CollectSourceCreateInput,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtNotice,
  useToast,
  DtIconButton,
} from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { COLLECT_PROTOCOL_PAGES } from '@/features/collect/protocols'
import { SOURCE_LIST_SIZE, useSourceList } from '../scripts/useSourceList'
import { useForceDelete } from '../scripts/useForceDelete'
import { useSourceOps } from '../scripts/useSourceOps'
import BrowsePanel from './BrowsePanel.vue'
import ForceDeleteDialog from './ForceDeleteDialog.vue'
import NodeTable from './NodeTable.vue'
import RuntimeParamsDialog from '@/components/runtime/RuntimeParamsDialog.vue'
import SourceDetailHeader from './SourceDetailHeader.vue'
import SourceFormDialog from './SourceFormDialog.vue'
import SourceListPanel from './SourceListPanel.vue'

const props = defineProps<{ protocol: CollectProtocol }>()
const pageConfig = computed(() => COLLECT_PROTOCOL_PAGES[props.protocol])
const toast = useToast()
const browseOpen = ref(false)
const {
  sources,
  sourcesLoading,
  sourcesError,
  sourceKeyword,
  sourceQuery,
  sourcePage,
  sourceTotal,
  activeId,
  activeSource,
  selectSource,
  loadSources,
  searchSources,
  changeSourcePage,
} = useSourceList(() => props.protocol)

/** 有几个源配了点位却没在采。它是「配了没人读」最外层的一道提示。 */
const stalledCount = computed(
  () =>
    sources.value.filter(
      (one) =>
        one.is_enabled && one.point_count > 0 && one.runtime.state !== 'online',
    ).length,
)

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
</script>

<template>
  <AppShell :title="pageConfig.title" :subtitle="pageConfig.subtitle">
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
        <DtIconButton
          size="sm"
          variant="solid"
          intent="primary"
          icon="plus"
          label="新增数据源"
          @click="ops.openCreate"
        />
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
        当前列表中有 {{ stalledCount }}
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
            v-model:keyword="sourceKeyword"
            :protocol="protocol"
            :page="sourcePage"
            :total="sourceTotal"
            :size="SOURCE_LIST_SIZE"
            :is-filtered="sourceQuery !== ''"
            :sources="sources"
            :loading="sourcesLoading"
            :error="sourcesError"
            :active-id="activeId"
            @search="searchSources"
            @page="changeSourcePage"
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

            <DtButton
              v-if="activeSource.protocol === 'opcua'"
              variant="outline"
              size="sm"
              :aria-expanded="browseOpen"
              @click="browseOpen = !browseOpen"
            >
              {{ browseOpen ? '收起地址浏览' : '浏览并导入点位' }}
            </DtButton>
            <!-- 浏览 + 点位表：<2xl 竖排固定高、交给外层滚；≥2xl 并排铺满内部滚动。
                 ⚠ 并排的门槛是 2xl 不是 xl：xl 那一档右区只剩八百多像素，点位表分到
                 五百像素时工具条要折三行、表体只剩两行，浏览树那边连「在线浏览」四个
                 字都竖着排——与知识库页同一条口径 -->
            <div
              class="grid min-h-0 grid-cols-1 gap-4 2xl:flex-1 2xl:grid-rows-1"
              :class="{
                '2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]': browseOpen,
              }"
            >
              <BrowsePanel
                v-if="browseOpen && activeSource.protocol === 'opcua'"
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
              :hint="pageConfig.selectionHint"
            />
          </DtCard>
        </section>
      </div>
    </div>

    <!-- 弹窗 -->
    <SourceFormDialog
      v-model="ops.formOpen.value"
      :source="ops.formSource.value"
      :fixed-protocol="protocol"
      :loading="ops.formSaving.value"
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
      title="运行参数 · 工业数据采集"
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
