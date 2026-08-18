<script setup lang="ts">
/**
 * @fileoverview 项目设置：常规 / 品牌 / 主题三档，外加危险区的删除入口。
 * 三个权限判定由父页面按码算好传进来——弹窗不碰 auth store，也不发写请求。
 */
import { computed, ref, watch } from 'vue'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtSegmented,
  DtSelect,
  DtTextarea,
} from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'
import { listThemes } from '@dt/tokens'
import type {
  DtSegmentedOption,
  DtSelectOption,
  ProjectThemePayload,
} from '@dt/contracts'

import type { ProjectSummary } from '@/api/dashboardWire'
import type {
  ProjectThemeCreateInput,
  ProjectThemePatchInput,
} from '@/api/projectThemes'
import CustomThemeManager from './CustomThemeManager.vue'
import { readText } from './themeFields'
import type { ProjectSettingsPayload } from '../payloads'

const props = withDefaults(
  defineProps<{
    open: boolean
    project: ProjectSummary | null
    canUpdate: boolean
    canDelete: boolean
    canManageTheme: boolean
    customThemes: readonly ProjectThemePayload[]
    loading?: boolean
    themeBusy?: boolean
  }>(),
  { loading: false, themeBusy: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [payload: ProjectSettingsPayload]
  'request-delete': []
  'create-theme': [input: ProjectThemeCreateInput]
  'update-theme': [themeId: string, patch: ProjectThemePatchInput]
  'delete-theme': [theme: ProjectThemePayload]
}>()

const TABS: readonly DtSegmentedOption[] = [
  { value: 'general', label: '常规', icon: 'settings' },
  { value: 'brand', label: '品牌', icon: 'sparkles' },
  { value: 'theme', label: '主题', icon: 'palette' },
]

/** 项目默认主题落在 `themeJson.__base` 上；空串即回退内置默认。 */
const BASE_KEY = '__base'

const tab = ref('general')
const name = ref('')
const description = ref('')
const productName = ref('')
const logoUrl = ref('')
const footerNote = ref('')
const themeBase = ref('')

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [name, description, productName, logoUrl, footerNote, themeBase],
  () => props.open,
)

const themeOptions = computed<DtSelectOption[]>(() => [
  { value: '', label: '内置默认' },
  ...listThemes().map((theme) => ({ value: theme.id, label: theme.name })),
  ...props.customThemes.map((theme) => ({
    value: theme.id,
    label: `${theme.name}（${theme.mode}）`,
  })),
])

const canSubmit = computed(
  () => props.canUpdate && !props.loading && name.value.trim() !== '',
)

watch(
  () => [props.open, props.project?.id] as const,
  ([open]) => {
    const project = props.project
    if (!open || project === null) return
    tab.value = 'general'
    name.value = project.name
    description.value = project.description ?? ''
    productName.value = readText(project.brandJson, 'productName')
    logoUrl.value = readText(project.brandJson, 'logoUrl')
    footerNote.value = readText(project.brandJson, 'footerNote')
    themeBase.value = readText(project.themeJson, BASE_KEY)
  },
  { immediate: true },
)

/** 改一套主题带两个参数，模板里的内联表达式只喂得进第一个，故走具名处理器。 */
function onThemeUpdate(themeId: string, patch: ProjectThemePatchInput): void {
  emit('update-theme', themeId, patch)
}

function save(): void {
  if (!canSubmit.value) return
  // 品牌里留空的项直接不写：空串会被当成「明确设成空」，从而盖掉平台默认
  const brandJson: Record<string, unknown> = {}
  if (productName.value.trim() !== '') {
    brandJson.productName = productName.value.trim()
  }
  if (logoUrl.value.trim() !== '') brandJson.logoUrl = logoUrl.value.trim()
  if (footerNote.value.trim() !== '') {
    brandJson.footerNote = footerNote.value.trim()
  }
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
    themeJson: themeBase.value === '' ? {} : { [BASE_KEY]: themeBase.value },
    brandJson,
  })
}
</script>

<template>
  <DtModal
    :model-value="open"
    :dirty="isDirty"
    title="项目设置"
    :description="project?.name"
    width="46rem"
    :close-on-backdrop="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtSegmented
        :model-value="tab"
        :options="TABS"
        variant="tabs"
        aria-label="设置分组"
        @update:model-value="tab = $event"
      />

      <div v-show="tab === 'general'" class="flex flex-col gap-4">
        <DtInput
          v-model="name"
          label="项目名称"
          required
          :disabled="!canUpdate"
        />
        <DtTextarea
          v-model="description"
          label="描述"
          rows="3"
          :disabled="!canUpdate"
        />
        <div v-if="canDelete" class="dt-danger">
          <div class="dt-danger__text">
            <p class="dt-danger__title">删除项目</p>
            <p class="text-2xs text-text-disabled">
              项目下的全部大屏会跟着一起删掉，不可撤销。
            </p>
          </div>
          <DtButton
            variant="outline"
            intent="danger"
            size="sm"
            icon="trash"
            @click="emit('request-delete')"
          >
            删除项目
          </DtButton>
        </div>
      </div>

      <div v-show="tab === 'brand'" class="flex flex-col gap-4">
        <DtNotice icon="circle-question">
          留空的项继承平台默认品牌，不会被改成空。
        </DtNotice>
        <DtInput
          v-model="productName"
          label="产品名称"
          placeholder="显示在大屏标题上"
          :disabled="!canUpdate"
        />
        <DtInput
          v-model="logoUrl"
          label="Logo 地址"
          placeholder="图片 URL"
          :disabled="!canUpdate"
        />
        <DtInput
          v-model="footerNote"
          label="底部署名"
          placeholder="如：数字孪生中心"
          :disabled="!canUpdate"
        />
      </div>

      <div v-show="tab === 'theme'" class="flex flex-col gap-4">
        <DtSelect
          v-model="themeBase"
          label="项目默认主题"
          hint="项目内的大屏默认用它，单张屏还能再覆盖。"
          :options="themeOptions"
          :disabled="!canUpdate"
        />
        <CustomThemeManager
          v-if="canManageTheme"
          :themes="customThemes"
          :busy="themeBusy ?? false"
          @create="emit('create-theme', $event)"
          @update="onThemeUpdate"
          @delete="emit('delete-theme', $event)"
        />
      </div>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        关闭
      </DtButton>
      <DtButton
        v-if="canUpdate"
        size="sm"
        icon="save"
        :loading="loading ?? false"
        :disabled="!canSubmit"
        @click="save"
      >
        保存设置
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-danger {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--state-danger);
  border-radius: var(--radius-md);

  &__text {
    min-width: 0;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    color: var(--state-danger);
  }
}
</style>
