<script setup lang="ts">
/**
 * @fileoverview 项目自定义主题的增删改。不发请求，增删改都抛给父页面落库——
 * 一组主题整体存在项目行的 JSONB 数组里，读改写必须由持有事务的那一层做。
 *
 * ⚠ 删掉一套主题不联动改屏：引用它的大屏 resolve 时回退到项目默认或内置主题，
 * 所以删除前要说清「这几张屏会换回默认配色」，而不是问「确定删除吗」。
 */
import { computed, ref } from 'vue'
import { DtButton, DtColorInput, DtInput, DtSelect } from '@dt/ui'
import type { DtSelectOption, ProjectThemePayload } from '@dt/contracts'

import type {
  ProjectThemeCreateInput,
  ProjectThemePatchInput,
} from '@/api/projectThemes'
import {
  MODE_OPTIONS,
  THEME_COLOR_FIELDS,
  buildTokens,
  readColors,
  themeAccent,
} from './themeFields'

const props = withDefaults(
  defineProps<{
    themes: readonly ProjectThemePayload[]
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{
  create: [input: ProjectThemeCreateInput]
  update: [themeId: string, patch: ProjectThemePatchInput]
  delete: [theme: ProjectThemePayload]
}>()

/** 正在编辑的主题 id；`null` 表示没在编辑，`''` 表示在新建。 */
const editingId = ref<string | null>(null)
const draftName = ref('')
const draftMode = ref('dark')
const draftColors = ref<Record<string, string>>({})

const modeOptions = computed<readonly DtSelectOption[]>(() => MODE_OPTIONS)

function startCreate(): void {
  editingId.value = ''
  draftName.value = ''
  draftMode.value = 'dark'
  draftColors.value = readColors(undefined)
}

function startEdit(theme: ProjectThemePayload): void {
  editingId.value = theme.id
  draftName.value = theme.name
  draftMode.value = theme.mode
  draftColors.value = readColors(theme.tokens)
}

function onColor(path: string, value: string): void {
  draftColors.value = { ...draftColors.value, [path]: value }
}

function submit(): void {
  const name = draftName.value.trim()
  const editing = editingId.value
  if (name === '' || editing === null) return
  const mode = draftMode.value === 'light' ? 'light' : 'dark'
  const tokens = buildTokens(draftColors.value)
  if (editing === '') emit('create', { name, mode, tokens })
  else emit('update', editing, { name, mode, tokens })
  editingId.value = null
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <p class="text-xs text-text-secondary">
        自定义主题 {{ props.themes.length }}
      </p>
      <DtButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="busy"
        @click="startCreate"
      >
        新建主题
      </DtButton>
    </div>

    <div v-if="editingId !== null" class="dt-theme-edit">
      <div class="flex gap-2">
        <DtInput
          v-model="draftName"
          class="flex-1"
          aria-label="主题名称"
          placeholder="主题名称"
        />
        <DtSelect
          v-model="draftMode"
          class="w-28"
          aria-label="明暗档"
          :options="modeOptions"
        />
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DtColorInput
          v-for="field in THEME_COLOR_FIELDS"
          :key="field.path"
          :model-value="draftColors[field.path] ?? field.fallback"
          :label="field.label"
          :allow-text="false"
          size="sm"
          @update:model-value="onColor(field.path, $event)"
        />
      </div>
      <div class="flex justify-end gap-2">
        <DtButton variant="ghost" size="sm" @click="editingId = null">
          取消
        </DtButton>
        <DtButton
          size="sm"
          icon="save"
          :loading="busy ?? false"
          :disabled="draftName.trim() === ''"
          @click="submit"
        >
          {{ editingId === '' ? '创建' : '保存' }}
        </DtButton>
      </div>
    </div>

    <p v-if="themes.length === 0" class="text-2xs text-text-disabled">
      还没有自定义主题。新建一套后，项目内的大屏就能选它当配色。
    </p>

    <div v-for="theme in themes" :key="theme.id" class="dt-theme-row">
      <span
        class="dt-theme-row__dot"
        :style="{ background: themeAccent(theme.tokens) }"
      />
      <span class="dt-theme-row__name">{{ theme.name }}</span>
      <span class="text-2xs text-text-disabled">{{ theme.mode }}</span>
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑主题"
        :disabled="busy"
        @click="startEdit(theme)"
      />
      <DtButton
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除主题"
        :disabled="busy"
        @click="emit('delete', theme)"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-theme-edit {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.dt-theme-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);

  &__dot {
    width: 20px;
    height: 20px;
    border: 1px solid var(--border-default);
    border-radius: 50%;
  }

  &__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
