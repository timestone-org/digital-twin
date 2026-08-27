<script setup lang="ts">
/**
 * @fileoverview 样式库抽屉：预置库与文档里那两张表并成一列，新建 / 复制 / 删除 /
 * 恢复内置各一枚键，外加整包样式的导出与导入。
 *
 * ⚠ 「恢复内置」= 删掉文档里那条同 id 的覆盖，让它落回预置库（`styleOps` 的
 *   `restoreBuiltin*`），**不是**把预置数据写进文档：写死之后预置库将来升级就再也
 *   修不到这张图，而用户以为自己已经恢复了（§13.4）。
 * ⚠ 导入 id 撞了的三档摆在面上，缺省**改名并存**：静默覆盖会把用户正在用的那份样式
 *   换掉，而这一步没有确认框，撤销栈上也只表现为「导入」一格。
 * ⚠ 导出只带走**文档里**那两张表，预置库那些不带：预置样式在每张图上都有，抄一份进
 *   目标图等于把这一版预置就地写死（同「恢复内置是删覆盖」那条口径）。
 * ⚠ 导出的字节由 `twin2dStylePackageText` 排版、原样落盘：在这一层再 `JSON.stringify`
 *   一遍就是第二套排版口径，而「导出再导入不一致」这件事从界面上看不出来。
 * ⚠ 本层自己不碰文档：一切改动走 `styleOps` / `stylePackage` 算出整份新配置再上抛。
 * ⚠ 抽屉是 `role="dialog"`（DtModal），于是开着的时候整套键盘手势按
 *   `isTwin2dFormFocused` 的口径自动让位——不让位的话，在库里用方向键翻行会同时把
 *   画布上选中的节点 nudge 进撤销栈。
 */
import type { Twin2dConfig } from '@dt/twin2d'
import {
  DtButton,
  DtEmpty,
  DtFilePicker,
  DtInput,
  DtModal,
  DtSelect,
  useToast,
} from '@dt/ui'
import { computed, ref } from 'vue'

import { downloadText } from '@/utils/downloadJson'

import type { Twin2dStyleKind } from '../scripts/editorSelection'
import {
  twin2dStyleLibFilter,
  twin2dStyleLibRows,
} from '../scripts/styleLibrary'
import type { Twin2dStyleLibRow } from '../scripts/styleLibrary'
import {
  addEdgeStyle,
  addNodeStyle,
  duplicateEdgeStyle,
  duplicateNodeStyle,
  removeEdgeStyle,
  removeNodeStyle,
  restoreBuiltinEdgeStyle,
  restoreBuiltinNodeStyle,
  twin2dEdgeStyleOf,
  twin2dNodeStyleOf,
} from '../scripts/styleOps'
import type { Twin2dStyleRemoval } from '../scripts/styleOps'
import type { Twin2dAdded } from '../scripts/nodeOps'
import {
  TWIN_2D_IMPORT_MODES,
  exportTwin2dStylePackage,
  importTwin2dStyles,
  readTwin2dStylePackage,
  twin2dStylePackageText,
} from '../scripts/stylePackage'
import type {
  Twin2dImportMode,
  Twin2dImportReport,
} from '../scripts/stylePackage'

const props = withDefaults(
  defineProps<{
    /** 抽屉开着没有。 */
    open: boolean
    /** 整份配置；本层只读，改动一律整份上抛。 */
    config: Twin2dConfig
    /** 导出文件名（不含扩展名）。 */
    fileName?: string
  }>(),
  { fileName: 'twin2d-styles' },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  /** 一次动作改出来的整份新配置，落一步撤销。 */
  change: [config: Twin2dConfig]
  /** 请求把右栏切到这份样式上。 */
  focus: [kind: Twin2dStyleKind, id: string]
}>()

/** 三档撞名处理各自的说法；缺省那一档摆在第一位。 */
const MODE_LABELS: Readonly<Record<Twin2dImportMode, string>> = {
  rename: '改名并存（推荐）',
  overwrite: '覆盖同 id 的那一份',
  skip: '跳过同 id 的那一条',
}

const MODE_OPTIONS = TWIN_2D_IMPORT_MODES.map((value) => ({
  value,
  label: MODE_LABELS[value],
}))

const toast = useToast()

const keyword = ref('')
const mode = ref<Twin2dImportMode>('rename')

const rows = computed<readonly Twin2dStyleLibRow[]>(() =>
  twin2dStyleLibFilter(twin2dStyleLibRows(props.config), keyword.value),
)

/**
 * 换一份新配置，什么都没改就一步不动。
 * ⚠ 按引用比：换了新引用却什么都没改，撤销键上就多出一格按了没反应的空步。
 * @param next 整份新配置
 */
function push(next: Twin2dConfig): void {
  if (next !== props.config) emit('change', next)
}

/**
 * 新建落定：焦点转到新的那一份上，好接着改它的名字。
 * @param kind 哪条样式轴
 * @param added 新建或复制的结果
 */
function landed(kind: Twin2dStyleKind, added: Twin2dAdded): void {
  push(added.config)
  // ⚠ 加不进去时不动焦点：交一个落不到实处的 id 出去，右栏会画一份不存在的样式
  if (added.id !== null) emit('focus', kind, added.id)
}

function onAddNodeStyle(): void {
  landed('styles', addNodeStyle(props.config, { name: '新样式' }))
}

function onAddEdgeStyle(): void {
  landed('edgeStyles', addEdgeStyle(props.config, { name: '新连线样式' }))
}

/**
 * 复制一行。
 * ⚠ 收的是**当下生效**的那一份（文档 ∪ 预置库）：只按 id 复制的话，「把内置样式
 * 另存为自定义」这一支永远复制不出东西来。
 * @param row 这一行
 */
function onDuplicate(row: Twin2dStyleLibRow): void {
  if (row.kind === 'styles') {
    const source = twin2dNodeStyleOf(props.config, row.id)
    if (source !== null)
      landed(row.kind, duplicateNodeStyle(props.config, source))
    return
  }
  const source = twin2dEdgeStyleOf(props.config, row.id)
  if (source !== null)
    landed(row.kind, duplicateEdgeStyle(props.config, source))
}

/**
 * 恢复内置：删掉文档里那条同 id 的覆盖。
 * @param row 这一行
 */
function onRestore(row: Twin2dStyleLibRow): void {
  push(
    row.kind === 'styles'
      ? restoreBuiltinNodeStyle(props.config, row.id)
      : restoreBuiltinEdgeStyle(props.config, row.id),
  )
}

/**
 * 删掉一份自建样式。
 * ⚠ 引用它的实体不跟着删，只是再也解析不出样式——画面上那几个整个不见了。
 * 所以悬空的那几个要如实说出来，不能默默让它们退化成兜底。
 * @param row 这一行
 */
function onRemove(row: Twin2dStyleLibRow): void {
  const removal: Twin2dStyleRemoval =
    row.kind === 'styles'
      ? removeNodeStyle(props.config, row.id)
      : removeEdgeStyle(props.config, row.id)
  push(removal.config)
  if (removal.dangling.length > 0) {
    toast.error(
      `已删除，${removal.dangling.length} 个还在引用它的对象画不出来了`,
    )
  }
}

/** 导出文档里那两张表。 */
function onExport(): void {
  const pkg = exportTwin2dStylePackage(
    props.config.styles,
    props.config.edgeStyles,
  )
  if (pkg.styles.length + pkg.edgeStyles.length === 0) {
    toast.error('这张图里还没有自建或改过的样式，导出的会是一份空包')
    return
  }
  downloadText(twin2dStylePackageText(pkg), props.fileName)
}

/**
 * 一类样式导进来之后那句账。
 * @param what 这是哪一类
 * @param report 这一类的账
 */
function reportText(what: string, report: Twin2dImportReport): string {
  const parts = [`新增 ${report.added.length}`]
  if (report.renamed.length > 0) parts.push(`改名 ${report.renamed.length}`)
  if (report.overwritten.length > 0) {
    parts.push(`覆盖 ${report.overwritten.length}`)
  }
  if (report.skipped.length > 0) parts.push(`跳过 ${report.skipped.length}`)
  return `${what} ${parts.join(' · ')}`
}

/**
 * 读一份样式包并并进当前配置。
 * @param file 用户选中的那一份 JSON
 */
async function importFrom(file: File): Promise<void> {
  const read = readTwin2dStylePackage(await file.text())
  if (!read.ok) {
    toast.error(read.reason)
    return
  }
  const result = importTwin2dStyles(props.config, read.pkg, mode.value)
  push(result.config)
  const dropped = read.dropped > 0 ? `，丢弃 ${read.dropped} 条读不出的` : ''
  toast.success(
    `${reportText('节点样式', result.styles)}；${reportText(
      '连线样式',
      result.edgeStyles,
    )}${dropped}`,
  )
}

/**
 * 选中了要导入的文件。
 * ⚠ 只取第一份：多份一起导会让三档撞名处理在包与包之间也生效，而那是没定义的。
 * @param files 选中的文件
 */
function onPickFile(files: readonly File[]): void {
  const first = files[0]
  if (first !== undefined) void importFrom(first)
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="样式库"
    description="预置库与这张图里的样式并成一列；改过的内置样式随时能恢复回去。"
    width="44rem"
    data-test="style-library"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <DtInput
          v-model="keyword"
          size="sm"
          label="搜索"
          placeholder="按名字或 id 找"
          class="min-w-40 flex-1"
          data-test="style-lib-search"
        />
        <DtButton
          size="sm"
          variant="outline"
          intent="primary"
          icon="plus"
          data-test="style-lib-add-node"
          @click="onAddNodeStyle"
        >
          新建节点样式
        </DtButton>
        <DtButton
          size="sm"
          variant="outline"
          intent="primary"
          icon="plus"
          data-test="style-lib-add-edge"
          @click="onAddEdgeStyle"
        >
          新建连线样式
        </DtButton>
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <DtSelect
          v-model="mode"
          :options="MODE_OPTIONS"
          size="sm"
          label="导入时 id 撞了怎么办"
          hint="缺省改名并存：静默覆盖会把正在用的那份样式换掉"
          class="min-w-56 flex-1"
          data-test="style-lib-mode"
        />
        <DtFilePicker
          accept="application/json,.json"
          label="导入样式包"
          size="sm"
          data-test="style-lib-import"
          @select="onPickFile"
        />
        <DtButton
          size="sm"
          variant="outline"
          intent="neutral"
          icon="download"
          data-test="style-lib-export"
          @click="onExport"
        >
          导出样式包
        </DtButton>
      </div>

      <DtEmpty
        v-if="rows.length === 0"
        size="inline"
        icon="palette"
        title="没有匹配的样式"
        hint="换个关键字试试。"
        data-test="style-lib-empty"
      />
      <ul v-else class="flex flex-col gap-1" data-test="style-lib-rows">
        <li
          v-for="row in rows"
          :key="row.key"
          class="flex items-center gap-2 rounded border border-border-subtle px-2 py-1.5"
          :data-test="`style-lib-row-${row.key}`"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col text-left leading-tight"
            :title="`${row.name} · ${row.note}`"
            :data-test="`style-lib-open-${row.key}`"
            @click="emit('focus', row.kind, row.id)"
          >
            <span class="truncate text-xs text-text-primary">{{
              row.name
            }}</span>
            <span class="truncate text-3xs text-text-disabled">{{
              row.note
            }}</span>
          </button>
          <span class="shrink-0 text-3xs text-text-disabled">
            {{ row.originLabel }} · {{ row.usedBy }} 个在用
          </span>
          <DtButton
            size="xs"
            variant="ghost"
            intent="primary"
            icon="copy"
            aria-label="复制一份"
            title="复制一份"
            :data-test="`style-lib-copy-${row.key}`"
            @click="onDuplicate(row)"
          />
          <DtButton
            v-if="row.canRestore"
            size="xs"
            variant="ghost"
            intent="neutral"
            icon="refresh-cw"
            aria-label="恢复内置"
            title="删掉本图里的这份覆盖，让它落回预置库那一份"
            :data-test="`style-lib-restore-${row.key}`"
            @click="onRestore(row)"
          />
          <DtButton
            v-if="row.canRemove"
            size="xs"
            variant="ghost"
            intent="danger"
            icon="trash"
            aria-label="删除这份样式"
            :title="
              row.usedBy === 0
                ? '删除这份样式'
                : `删除这份样式（还有 ${row.usedBy} 个在用）`
            "
            :data-test="`style-lib-remove-${row.key}`"
            @click="onRemove(row)"
          />
        </li>
      </ul>
    </div>

    <template #footer>
      <DtButton variant="outline" intent="neutral" @click="close">
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>
