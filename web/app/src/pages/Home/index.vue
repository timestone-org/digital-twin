<script setup lang="ts">
/**
 * @fileoverview 工作台：左侧项目栏选项目，右侧网格列出该项目下的大屏。
 *
 * ⚠ 这一页是路由守卫的兜底目的地，自身**不能**挂 `meta.permissions`（挂了会与
 * 守卫互相弹成死循环）。所以「没有 dashboard:view」只能靠不发请求 + 渲染空态
 * 表达；落成错误态的话，只管账号的角色一进系统就撞上一片红。
 */
import { computed, onMounted } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty, DtPageState, DtSkeleton, useToast } from '@dt/ui'

import { updateProject } from '@/api/dashboard'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { useAuthStore } from '@/stores/auth'
import DashboardCard from './components/DashboardCard.vue'
import DashboardGridEmpty from './components/DashboardGridEmpty.vue'
import ProjectSidebar from './components/ProjectSidebar.vue'
import WorkbenchDialogs from './components/WorkbenchDialogs.vue'
import WorkbenchToolbar from './components/WorkbenchToolbar.vue'
import { useCardActions } from './scripts/useCardActions'
import { useWorkbench } from './scripts/useWorkbench'
import { useWorkbenchDialogs } from './scripts/useWorkbenchDialogs'

const VIEW_CODES = [PERMISSION_CODES.dashboardView]
const MANAGE_CODES = [PERMISSION_CODES.dashboardManage]

/** 骨架卡片的固定身份，免得拿下标当 key。 */
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

/** 卡片入场错峰的步长与封顶张数。 */
const CARD_STAGGER_MS = 45
const MAX_STAGGERED_CARDS = 12

/** 卡片网格：按可用宽度自动铺列，最窄 16rem。 */
const GRID_CLASS =
  'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]'

const auth = useAuthStore()
const toast = useToast()
const dialogs = useWorkbenchDialogs()

const {
  canView,
  projects,
  dashboards,
  dashboardTotal,
  selectedProject,
  selectedProjectId,
  search,
  visibleDashboards,
  isLoading,
  error,
  load,
  reloadProjects,
  reloadDashboards,
  selectProject,
} = useWorkbench()

const cards = useCardActions(reloadDashboards)

const canManage = computed(() => auth.can(MANAGE_CODES))

function onSearch(keyword: string): void {
  search.value = keyword
}

/**
 * 改项目名。改完重拉项目列表而不是就地改：项目行还带着大屏计数，
 * 只把名字补上会让这一行的其余字段停在改名前那一刻。
 * @param projectId 项目 id
 * @param name 新名字
 */
async function renameProject(projectId: string, name: string): Promise<void> {
  try {
    await updateProject(projectId, { name })
    await reloadProjects()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/**
 * 弹窗改完库之后按范围重拉。
 * ⚠ 项目那一侧走整份 `load()` 而不是只刷项目列表：删掉当前项目之后选中态会
 * 回落到第一个项目，不跟着刷大屏的话，网格里留着的还是那个已经不存在的项目的屏。
 * @param scope 改动波及的范围
 */
function onDialogChanged(scope: 'projects' | 'dashboards'): void {
  void (scope === 'projects' ? load() : reloadDashboards())
}

/**
 * 卡片入场的错峰延迟。⚠ 封顶在第 12 张：不封顶的话第 40 张要等将近两秒才出现，
 * 看着像没加载出来。
 * @param index 卡片在网格里的序号
 */
function cardDelay(index: number): string {
  return `${Math.min(index, MAX_STAGGERED_CARDS) * CARD_STAGGER_MS}ms`
}

onMounted(() => {
  void load()
})
</script>

<template>
  <AppShell title="工作台" subtitle="数字孪生 · 项目与大屏管理">
    <template #sidebar>
      <ProjectSidebar
        v-if="canView"
        :projects="projects"
        :selected-project-id="selectedProjectId"
        :can-manage="canManage"
        @select="selectProject"
        @create="dialogs.open('new-project')"
        @rename="renameProject"
      />
    </template>

    <template #actions>
      <div class="flex items-center gap-2">
        <PermGuard :codes="VIEW_CODES">
          <DtButton
            size="sm"
            variant="ghost"
            intent="neutral"
            icon="layers"
            aria-haspopup="dialog"
            :aria-expanded="dialogs.isOpen('template-library')"
            data-test="open-template-library"
            @click="dialogs.open('template-library')"
          >
            模板库
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            intent="neutral"
            icon="settings"
            aria-haspopup="dialog"
            :aria-expanded="dialogs.isOpen('runtime-params')"
            data-test="open-runtime-params"
            @click="dialogs.open('runtime-params')"
          >
            运行参数
          </DtButton>
        </PermGuard>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtEmpty
        v-if="!canView"
        icon="lock"
        title="当前账号没有大屏查看权限"
        hint="你的角色没有被授予项目与大屏的查看权限。请从左侧导航进入你有权限的页面，或联系管理员开通。"
        data-test="no-view-permission"
      />

      <template v-else>
        <WorkbenchToolbar
          :project="selectedProject"
          :total="dashboardTotal"
          :listed="dashboards.length"
          :search="search"
          @update:search="onSearch"
          @settings="dialogs.open('project-settings')"
          @import="dialogs.open('import')"
          @create="dialogs.open('new-dashboard')"
        />

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <div v-if="isLoading" :class="GRID_CLASS" aria-busy="true">
            <DtSkeleton
              v-for="key in SKELETON_KEYS"
              :key="key"
              class="block h-48 w-full"
            />
          </div>

          <DtEmpty
            v-else-if="error === null && projects.length === 0"
            icon="folder"
            title="还没有任何项目"
            :hint="
              canManage
                ? '先建一个项目，大屏都挂在项目下。'
                : '当前还没有可查看的项目，请联系管理员创建。'
            "
            data-test="no-projects"
          >
            <PermGuard :codes="MANAGE_CODES">
              <DtButton
                size="sm"
                icon="plus"
                data-test="empty-create-project"
                @click="dialogs.open('new-project')"
              >
                新建项目
              </DtButton>
            </PermGuard>
          </DtEmpty>

          <DtPageState v-else :error="error" :empty="false" @retry="load">
            <DashboardGridEmpty
              v-if="visibleDashboards.length === 0"
              :search="search"
              :can-manage="canManage"
              @create="dialogs.open('new-dashboard')"
              @import="dialogs.open('import')"
            />

            <div v-else :class="GRID_CLASS">
              <DashboardCard
                v-for="(item, index) in visibleDashboards"
                :key="item.id"
                class="dt-animate-rise-in"
                :style="{ animationDelay: cardDelay(index) }"
                :dashboard="item"
                :busy="cards.busyDashboardId.value === item.id"
                :busy-label="cards.busyLabel.value"
                @preview="cards.preview(item)"
                @edit="cards.edit(item)"
                @duplicate="cards.duplicate(item)"
                @rename="(name) => cards.rename(item, name)"
                @export="cards.exportOne(item)"
                @delete="cards.remove(item)"
                @share="dialogs.open('share', item)"
                @save-as-template="dialogs.open('save-as-template', item)"
                @validate="dialogs.open('validate', item)"
              />
            </div>
          </DtPageState>
        </div>
      </template>
    </div>

    <!-- 十个弹窗聚合成一个标签，理由见 WorkbenchDialogs.vue 的文件头 -->
    <WorkbenchDialogs
      :open-name="dialogs.openName.value"
      :target="dialogs.target.value"
      :projects="projects"
      :selected-project-id="selectedProjectId"
      :dashboards="dashboards"
      @close="dialogs.close"
      @changed="onDialogChanged"
      @select-project="selectProject"
    />
  </AppShell>
</template>
