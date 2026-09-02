<script setup lang="ts">
/**
 * @fileoverview 工作台左侧项目栏：项目列表、每项的大屏计数、内联重命名与新建入口。
 * 它填的是 AppShell 的 `#sidebar` 插槽，紧贴常驻的 AppNavRail；品牌、全局入口与
 * 登出统一由 AppNavRail 承载，这里只管项目。
 */
import { ref } from 'vue'
import { DtButton, DtIcon, DtTag } from '@dt/ui'

import type { ProjectSummary } from '@/api/dashboardWire'
import InlineRenameField from './InlineRenameField.vue'

const props = withDefaults(
  defineProps<{
    projects: readonly ProjectSummary[]
    selectedProjectId: string | null
    /** 能不能建项目与改项目名（`dashboard:manage`）。 */
    canManage?: boolean
  }>(),
  { canManage: false },
)

const emit = defineEmits<{
  select: [projectId: string]
  create: []
  rename: [projectId: string, name: string]
}>()

const renamingId = ref<string | null>(null)

function startRename(projectId: string): void {
  if (props.canManage) renamingId.value = projectId
}

function onRenamed(projectId: string, name: string): void {
  renamingId.value = null
  emit('rename', projectId, name)
}
</script>

<template>
  <aside
    class="dt-scanlines flex h-full w-60 shrink-0 flex-col border-r border-border-subtle bg-surface-panel/60"
    aria-label="项目"
  >
    <div class="flex items-center justify-between px-4 pb-2 pt-5">
      <p
        class="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-text-secondary"
      >
        <DtIcon name="folder" :size="13" />
        项目
        <span class="text-text-disabled">{{ projects.length }}</span>
      </p>
      <DtButton
        v-if="canManage"
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="plus"
        aria-label="新建项目"
        data-test="sidebar-create-project"
        @click="emit('create')"
      />
    </div>

    <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
      <p
        v-if="projects.length === 0"
        class="px-3 py-6 text-center text-xs text-text-disabled"
      >
        暂无项目
      </p>

      <TransitionGroup name="project-row">
        <div
          v-for="project in projects"
          :key="project.id"
          class="group relative flex min-h-13 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors"
          :class="
            selectedProjectId === project.id
              ? 'bg-accent-primary/10 text-accent-on-surface'
              : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
          "
          data-test="project-row"
          @click="emit('select', project.id)"
        >
          <!-- 选中态的发光竖条。底色差别在暗色主题下很弱，只靠它一眼分得出选中的是哪个 -->
          <span
            v-if="selectedProjectId === project.id"
            class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent-primary shadow-[0_0_8px_var(--accent-primary)]"
            aria-hidden="true"
            data-test="project-active-bar"
          />

          <DtIcon
            :name="selectedProjectId === project.id ? 'folder-open' : 'folder'"
            :size="16"
            class="shrink-0"
          />

          <InlineRenameField
            v-if="renamingId === project.id"
            :value="project.name"
            label="项目名称"
            @commit="(name) => onRenamed(project.id, name)"
            @cancel="renamingId = null"
          />
          <span
            v-else
            class="min-w-0 flex-1 truncate"
            data-test="project-name"
            @dblclick.stop="startRename(project.id)"
          >
            {{ project.name }}
          </span>

          <template v-if="renamingId !== project.id">
            <!-- ⚠ hidden 不能直接挂在 DtButton / DtTag 上：它们的 display 写在未分层的组件样式里，压得过 @layer utilities 里的 .hidden -->
            <span
              v-if="canManage"
              class="hidden shrink-0 group-hover:inline-flex"
            >
              <DtButton
                size="sm"
                variant="ghost"
                intent="neutral"
                icon="pencil"
                aria-label="重命名项目"
                data-test="project-rename"
                @click.stop="startRename(project.id)"
              />
            </span>
            <span class="shrink-0" :class="{ 'group-hover:hidden': canManage }">
              <DtTag data-test="project-count">
                {{ project.dashboardCount }}
              </DtTag>
            </span>
          </template>
        </div>
      </TransitionGroup>
    </nav>

    <div v-if="canManage" class="px-3 pb-3">
      <DtButton
        size="sm"
        variant="soft"
        icon="plus"
        block
        data-test="sidebar-create-project-wide"
        @click="emit('create')"
      >
        新建项目
      </DtButton>
    </div>
  </aside>
</template>

<style scoped>
/* 新建/删除项目时让那一行滑进滑出，而不是整列表瞬间重排 */
.project-row-enter-active,
.project-row-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.project-row-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}
.project-row-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* ⚠ 动效敏感的用户要能关掉：这条不是装饰性偏好，是无障碍要求 */
@media (prefers-reduced-motion: reduce) {
  .project-row-enter-active,
  .project-row-leave-active {
    transition-duration: 0.001ms;
  }
}
</style>
