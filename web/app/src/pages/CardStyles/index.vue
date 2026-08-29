<script setup lang="ts">
/**
 * @fileoverview 卡片样式库：左栏名单、中栏边配边看、右栏两段表单。
 *
 * 一条**卡片样式**是用户自己存下来的一整套观感取值，分外壳与内芯两段
 * （docs/CARD_STYLE_LIBRARY_DESIGN.md）。这一页填的是仓里原本的一个空缺：
 * 四十个外壳旋钮只有两档写死的风格可选，调出来的样子存不下来，也没有名字可以指。
 *
 * ⚠ 三栏与大屏编辑器同构（窄 / 宽 / 窄），不是为了好看：用户在两页之间来回，
 * 换一种版面就得重新找东西在哪。
 */
import type { CardChrome, ModuleManifest } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { getModule } from '@dt/modules'
import type { GetModuleManifest } from '@dt/runtime'
import {
  DtButton,
  DtNotice,
  DtSegmented,
  DtSelect,
  useConfirm,
  useToast,
} from '@dt/ui'
import { computed, onMounted, ref } from 'vue'

import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { installDashboardModules } from '@/bootstrap/dashboard'
import StyleCreateDialog from './components/StyleCreateDialog.vue'
import StyleFormPanel from './components/StyleFormPanel.vue'
import StyleListPanel from './components/StyleListPanel.vue'
import StylePreviewStage from './components/StylePreviewStage.vue'
import type { LibraryEntry, StyleGroup } from './scripts/libraryEntries'
import {
  builtinChromeEntries,
  builtinPresetEntries,
  entryToDraft,
} from './scripts/libraryEntries'
import type { StyleDraft } from './scripts/styleDraft'
import { newDraft, styleCapableModules } from './scripts/styleDraft'
import { useStyleLibrary } from './scripts/useStyleLibrary'

/** 预览底色三档。⚠ 外壳的色都是 `var(--)` 引用，深浅两种底下都得看一眼。 */
const BACKDROPS = [
  { value: 'screen', label: '大屏底' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
] as const

// ⚠ 这一页直连进来时没有别的页面替它注册过模块，不装的话中栏渲染的是
//   「未知模块类型」，且没有任何报错
installDashboardModules()

const toast = useToast()
const confirm = useConfirm()
const library = useStyleLibrary((message) => toast.error(message))

const getManifest: GetModuleManifest = (moduleType: string) =>
  getModule(moduleType)

/** 本页覆盖的那几个模块，按清单里的中文名摆。 */
const moduleOptions = computed(() =>
  styleCapableModules().map((one) => ({
    value: one.type,
    label: one.displayName,
  })),
)

/* ---------------- 选中与草稿 ---------------- */

const activeKey = ref<string | null>(null)
const draft = ref<StyleDraft>(newDraft(null, null))
/**
 * 通用外壳样式拿哪个模块当样板；绑了模块的样式不看它。
 * ⚠ 缺省取名单里的第一个，不写死某个类型名。
 */
const sampleType = ref<string>(styleCapableModules()[0]?.type ?? '')
const backdrop = ref<'screen' | 'dark' | 'light'>('screen')
const createOpen = ref(false)

const draftManifest = computed<ModuleManifest | null>(() =>
  draft.value.moduleType === null
    ? null
    : (getModule(draft.value.moduleType) ?? null),
)

/** 中栏真正渲染的那个模块。 */
const previewType = computed(() => draft.value.moduleType ?? sampleType.value)

const previewSize = computed(() => {
  const size = getModule(previewType.value)?.defaultSize
  return { width: size?.width ?? 420, height: size?.height ?? 220 }
})

/* ---------------- 左栏名单 ---------------- */

const groups = computed<StyleGroup[]>(() => {
  const saved = library.savedEntries.value
  const out: StyleGroup[] = [
    {
      title: '通用外壳',
      items: [
        ...builtinChromeEntries(),
        ...saved.filter((one) => one.moduleType === null),
      ],
    },
  ]
  for (const option of moduleOptions.value) {
    const manifest = getModule(option.value)
    const items: LibraryEntry[] = [
      ...(manifest === undefined ? [] : builtinPresetEntries(manifest)),
      ...saved.filter((one) => one.moduleType === option.value),
    ]
    if (items.length > 0) out.push({ title: option.label, items })
  }
  return out
})

/* ---------------- 动作 ---------------- */

function select(entry: LibraryEntry): void {
  activeKey.value = entry.key
  draft.value = entryToDraft(
    entry,
    entry.moduleType === null ? null : (getModule(entry.moduleType) ?? null),
  )
}

function startCreate(moduleType: string | null, name: string): void {
  activeKey.value = null
  const created = newDraft(
    moduleType,
    moduleType === null ? null : (getModule(moduleType) ?? null),
  )
  created.name = name
  draft.value = created
}

async function save(): Promise<void> {
  if (draft.value.name.trim() === '') {
    toast.error('样式得先有个名字')
    return
  }
  const savedId = await library.save(draft.value, draftManifest.value)
  activeKey.value = `saved:${savedId}`
  draft.value = { ...draft.value, id: savedId }
  toast.success('样式已保存')
}

async function remove(entry: LibraryEntry): Promise<void> {
  if (entry.savedId === null) return
  const ok = await confirm.ask({
    title: '删除样式',
    message: `将删除样式「${entry.label}」，且不可恢复。已经套用过它的大屏不受影响——样式是一次性写进节点的，不是引用。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await library.remove(entry.savedId)
  if (activeKey.value === entry.key) {
    activeKey.value = null
    draft.value = newDraft(null, null)
  }
  toast.success('样式已删除')
}

function writeChrome(next: CardChrome): void {
  draft.value = { ...draft.value, chrome: next }
}

function writeConfig(key: string, value: unknown): void {
  draft.value = {
    ...draft.value,
    config: { ...draft.value.config, [key]: value },
  }
}

onMounted(library.reload)
</script>

<template>
  <AppShell title="卡片样式库" subtitle="把一整套观感存成能复用的样式">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.dashboardManage]" explain>
        <DtButton
          size="sm"
          icon="save"
          :loading="library.saving.value"
          data-test="save-style"
          @click="save"
        >
          {{ draft.id === null ? '存为新样式' : '保存' }}
        </DtButton>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 gap-3">
      <aside class="w-56 shrink-0">
        <StyleListPanel
          :groups="groups"
          :active-key="activeKey"
          :loading="library.loading.value"
          @select="select"
          @remove="remove"
          @create="createOpen = true"
        />
      </aside>

      <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <DtNotice v-if="library.error.value !== null" intent="danger">
          {{ library.error.value }}
        </DtNotice>
        <StylePreviewStage
          class="min-h-0 flex-1"
          :module-type="previewType"
          :chrome="draft.chrome"
          :config="draft.config"
          :get-manifest="getManifest"
          :width="previewSize.width"
          :height="previewSize.height"
          :backdrop="backdrop"
        />
        <div class="flex shrink-0 items-end gap-3">
          <!-- 绑了模块的样式换不了样板：它的内芯只有那个模块认得 -->
          <DtSelect
            v-if="draft.moduleType === null"
            v-model="sampleType"
            :options="moduleOptions"
            label="样板模块"
            size="sm"
          />
          <DtSegmented
            v-model="backdrop"
            :options="BACKDROPS"
            aria-label="预览底色"
            size="sm"
          />
        </div>
      </section>

      <aside class="w-72 shrink-0">
        <StyleFormPanel
          :name="draft.name"
          :description="draft.description"
          :chrome="draft.chrome"
          :config="draft.config"
          :manifest="draftManifest"
          @update:name="draft = { ...draft, name: $event }"
          @update:description="draft = { ...draft, description: $event }"
          @update:chrome="writeChrome"
          @config="writeConfig"
        />
      </aside>
    </div>

    <StyleCreateDialog
      v-model="createOpen"
      :module-options="moduleOptions"
      @create="startCreate"
    />
  </AppShell>
</template>
