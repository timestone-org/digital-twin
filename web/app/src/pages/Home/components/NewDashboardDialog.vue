<script setup lang="ts">
/**
 * @fileoverview 新建大屏：空白画布 / 复制现有屏 / 套模板三种起手方式合在一个
 * 弹窗里。出参是一条 `NewDashboardPayload`，由父页面按 `startMode` 分派到建屏、
 * 复制与模板实例化三个不同的端点——弹窗自己不发写请求。
 */
import { computed, ref, watch } from 'vue'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import { useFormDirty } from '@/composables/useFormDirty'
import type {
  DashboardTemplateSummary,
  DtSegmentedOption,
  DtSelectOption,
} from '@dt/contracts'

import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import TemplateGallery from './TemplateGallery.vue'
import {
  CUSTOM_PRESET_ID,
  DEFAULT_DESIGN_HEIGHT,
  DEFAULT_DESIGN_WIDTH,
  DESIGN_SIZE_RANGE,
  RATIO_PRESET_OPTIONS,
  clampDesignSize,
  findPreset,
  presetIdFor,
} from './ratioPresets'
import type { NewDashboardPayload } from '../payloads'

const props = withDefaults(
  defineProps<{
    open: boolean
    projects: readonly ProjectSummary[]
    currentProjectId: string | null
    dashboardsByProject: Record<string, DashboardSummary[]>
    /** 从模板库点「用此模板」进来时预选，弹窗直接落在套模板那一档。 */
    presetTemplate?: { id: string; name: string } | null
    loading?: boolean
  }>(),
  { presetTemplate: null, loading: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: NewDashboardPayload]
}>()

const MODES: readonly DtSegmentedOption[] = [
  { value: 'blank', label: '空白画布', icon: 'plus' },
  { value: 'copy', label: '复制现有', icon: 'copy' },
  { value: 'template', label: '套模板', icon: 'layers' },
]

const MODE_HINTS: Record<string, string> = {
  blank: '按下面的设计尺寸开一张空屏。',
  copy: '整份克隆一张已有的屏，包括节点与绑定。',
  template: '把模板实例化成新屏；尺寸沿用模板自带的。',
}

const startMode = ref<NewDashboardPayload['startMode']>('blank')
const projectId = ref('')
const name = ref('')
const width = ref(DEFAULT_DESIGN_WIDTH)
const height = ref(DEFAULT_DESIGN_HEIGHT)
const sourceDashboardId = ref('')
const templateId = ref('')

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [startMode, projectId, name, width, height, sourceDashboardId, templateId],
  () => props.open,
)

const projectOptions = computed<DtSelectOption[]>(() =>
  props.projects.map((project) => ({ value: project.id, label: project.name })),
)

/** 可复制的源屏跨项目列，标签带上项目名——同名大屏在不同项目里很常见。 */
const copyOptions = computed<DtSelectOption[]>(() =>
  props.projects.flatMap((project) =>
    (props.dashboardsByProject[project.id] ?? []).map((dashboard) => ({
      value: dashboard.id,
      label: `${project.name} / ${dashboard.name}`,
    })),
  ),
)

/** 目标项目下已有同名屏。项目内大屏名不唯一，故只提示不拦。 */
const hasDuplicateName = computed(() => {
  const trimmed = name.value.trim()
  if (projectId.value === '' || trimmed === '') return false
  const siblings = props.dashboardsByProject[projectId.value] ?? []
  return siblings.some((dashboard) => dashboard.name.trim() === trimmed)
})

const presetId = computed(() => presetIdFor(width.value, height.value))

const canSubmit = computed(() => {
  if (props.loading || projectId.value === '') return false
  if (startMode.value === 'template') return templateId.value !== ''
  if (name.value.trim() === '') return false
  return startMode.value !== 'copy' || sourceDashboardId.value !== ''
})

/** 从模板库带着模板进来时直接落在套模板那一档，并预填模板名。 */
function resetStart(): void {
  const preset = props.presetTemplate
  startMode.value = preset === null ? 'blank' : 'template'
  templateId.value = preset?.id ?? ''
  name.value = preset?.name ?? ''
}

function resetSizing(): void {
  width.value = DEFAULT_DESIGN_WIDTH
  height.value = DEFAULT_DESIGN_HEIGHT
  sourceDashboardId.value = copyOptions.value[0]?.value ?? ''
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    projectId.value = props.currentProjectId ?? props.projects[0]?.id ?? ''
    resetSizing()
    resetStart()
  },
  { immediate: true },
)

/** 分段器只认字符串，这里收窄回三档之一——认不出的取值一律不动当前档。 */
function onMode(value: string): void {
  if (value === 'blank' || value === 'copy' || value === 'template') {
    startMode.value = value
  }
}

function applyPreset(id: string): void {
  const preset = findPreset(id)
  if (preset === undefined) return
  width.value = preset.width
  height.value = preset.height
}

function onWidth(value: number | undefined): void {
  width.value = clampDesignSize(value ?? Number.NaN)
}

function onHeight(value: number | undefined): void {
  height.value = clampDesignSize(value ?? Number.NaN)
}

function onTemplateSelect(template: DashboardTemplateSummary): void {
  templateId.value = template.id
  if (name.value.trim() === '') name.value = template.name
}

function submit(): void {
  if (!canSubmit.value) return
  const payload: NewDashboardPayload = {
    startMode: startMode.value,
    projectId: projectId.value,
    name: name.value.trim(),
    designWidth: clampDesignSize(width.value),
    designHeight: clampDesignSize(height.value),
  }
  if (startMode.value === 'copy') {
    payload.sourceDashboardId = sourceDashboardId.value
  }
  if (startMode.value === 'template') payload.templateId = templateId.value
  emit('submit', payload)
}
</script>

<template>
  <DtModal
    :model-value="open"
    :dirty="isDirty"
    title="新建大屏"
    width="46rem"
    :close-on-backdrop="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtSegmented
        :model-value="startMode"
        :options="MODES"
        aria-label="起手方式"
        @update:model-value="onMode"
      />
      <p class="text-2xs text-text-disabled">{{ MODE_HINTS[startMode] }}</p>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DtSelect
          v-model="projectId"
          label="所属项目"
          :options="projectOptions"
          required
        />
        <DtInput
          v-model="name"
          label="大屏名称"
          :required="startMode !== 'template'"
          :placeholder="
            startMode === 'template' ? '留空则沿用模板名' : '未命名大屏'
          "
          @enter="submit"
        />
      </div>

      <DtNotice v-if="hasDuplicateName" intent="warning" icon="alert-triangle">
        这个项目下已经有同名大屏了。仍可创建，两张屏靠 id 区分。
      </DtNotice>

      <template v-if="startMode === 'copy'">
        <DtSelect
          v-if="copyOptions.length > 0"
          v-model="sourceDashboardId"
          label="复制来源"
          :options="copyOptions"
          required
        />
        <DtNotice v-else intent="warning" icon="alert-triangle">
          还没有任何大屏可以复制，换「空白画布」或「套模板」起手。
        </DtNotice>
      </template>

      <div v-if="startMode === 'template'" class="flex flex-col gap-2">
        <p class="text-xs text-text-secondary">选择模板</p>
        <TemplateGallery
          :active="open"
          :selected-id="templateId"
          @select="onTemplateSelect"
        />
      </div>

      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DtSelect
          label="设计尺寸"
          :model-value="presetId"
          :options="RATIO_PRESET_OPTIONS"
          @update:model-value="applyPreset"
        />
        <DtNumberInput
          label="宽度（px）"
          :model-value="width"
          :range="DESIGN_SIZE_RANGE"
          @update:model-value="onWidth"
        />
        <DtNumberInput
          label="高度（px）"
          :model-value="height"
          :range="DESIGN_SIZE_RANGE"
          @update:model-value="onHeight"
        />
      </div>

      <p
        v-if="presetId === CUSTOM_PRESET_ID"
        class="text-2xs text-text-disabled"
      >
        当前是自定义尺寸 {{ width }} × {{ height }}。
      </p>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        取消
      </DtButton>
      <DtButton
        size="sm"
        icon="plus"
        :loading="loading ?? false"
        :disabled="!canSubmit"
        @click="submit"
      >
        创建大屏
      </DtButton>
    </template>
  </DtModal>
</template>
