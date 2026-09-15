<script setup lang="ts">
/** @fileoverview 批量复制配置与点位替换的影响预览，仅应用到草稿。 */
import type { BindingPayload } from '@dt/contracts'
import { remapTwinBindings, type TwinConfig } from '@dt/twin-config'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtModal,
  DtNotice,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'
import {
  COPY_SETTINGS,
  batchCandidates,
  copyPartSettings,
  replacementPlan,
  replacedBindings,
  type BatchKind,
  type CopySetting,
} from '../scripts/batchConfig'
import type { TwinSelection } from '../scripts/types'
import TwinBindingReplacementReview from './TwinBindingReplacementReview.vue'
import { usePointBatchCheck } from '../scripts/usePointBatchCheck'
const props = defineProps<{
  open: boolean
  config: TwinConfig
  bindings: readonly BindingPayload[]
  selection: TwinSelection
  animation: string | null
}>()
const emit = defineEmits<{
  'update:open': [boolean]
  copy: [TwinConfig]
  replace: [BindingPayload[]]
}>()
const mode = ref('copy'),
  sourceId = ref(''),
  kind = ref<BatchKind>('parts'),
  keyword = ref(''),
  find = ref(''),
  replace = ref('')
const selected = ref<string[]>([]),
  settings = ref<CopySetting[]>(['look'])
const modes = [
  { value: 'copy', label: '复制部件配置' },
  { value: 'replace', label: '批量替换点位' },
]
const kinds = [
  { value: 'parts', label: '部件' },
  { value: 'panels', label: '信息牌' },
  { value: 'anchors', label: '锚点' },
  { value: 'arrows', label: '箭头' },
  { value: 'flows', label: '能量流' },
  { value: 'animations', label: '动画' },
] as const
const sources = computed(() =>
  props.config.parts.map((part) => ({
    value: part.id,
    label: part.name || part.id,
  })),
)
const candidates = computed(() =>
  batchCandidates(
    props.config,
    mode.value === 'copy' ? 'parts' : kind.value,
  ).filter((item) => mode.value !== 'copy' || item.id !== sourceId.value),
)
const ids = computed(() =>
  selected.value.filter((id) =>
    candidates.value.some((item) => item.id === id),
  ),
)
const visible = computed(() =>
  candidates.value
    .filter((item) =>
      `${item.name} ${item.id}`
        .toLowerCase()
        .includes(keyword.value.toLowerCase()),
    )
    .map((item) => ({ ...item, checked: ids.value.includes(item.id) })),
)
const allChecked = computed(
  () => visible.value.length > 0 && visible.value.every((item) => item.checked),
)
const settingOptions = computed(() =>
  COPY_SETTINGS.map((item) => ({
    ...item,
    checked: settings.value.includes(item.value),
  })),
)
const nextConfig = computed(() =>
  copyPartSettings(props.config, sourceId.value, ids.value, settings.value),
)
const changedParts = computed(() =>
  props.config.parts.filter(
    (part) =>
      JSON.stringify(part) !==
      JSON.stringify(
        nextConfig.value.parts.find((item) => item.id === part.id),
      ),
  ),
)
const removedBindings = computed(
  () =>
    props.bindings.length -
    remapTwinBindings(props.config, nextConfig.value, props.bindings).length,
)
const plan = computed(() =>
  mode.value === 'replace'
    ? replacementPlan(props.config, props.bindings, kind.value, ids.value, {
        find: find.value,
        replace: replace.value,
      })
    : [],
)
const check = usePointBatchCheck(
  () => plan.value,
  () => props.open,
)
const canApply = computed(() =>
  mode.value === 'copy' ? changedParts.value.length > 0 : check.valid.value,
)
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const selection = props.selection
    mode.value =
      selection.kind === 'parts' || selection.kind === 'model'
        ? 'copy'
        : 'replace'
    sourceId.value =
      selection.kind === 'parts'
        ? selection.id
        : (props.config.parts[0]?.id ?? '')
    kind.value =
      kinds.find((item) => item.value === selection.kind)?.value ?? 'parts'
    if (props.animation !== null) {
      mode.value = 'replace'
      kind.value = 'animations'
    }
    selected.value = []
    keyword.value = ''
    find.value = ''
    replace.value = ''
    settings.value = ['look']
  },
  { immediate: true },
)
watch([mode, kind], () => {
  selected.value = []
  keyword.value = ''
})
function chooseKind(value: string): void {
  const item = kinds.find((item) => item.value === value)
  if (item) kind.value = item.value
}
function toggle(id: string, checked: boolean): void {
  selected.value = checked
    ? [...new Set([...selected.value, id])]
    : selected.value.filter((item) => item !== id)
}
function toggleAll(): void {
  const shown = new Set(visible.value.map((item) => item.id))
  selected.value = allChecked.value
    ? selected.value.filter((id) => !shown.has(id))
    : [...new Set([...selected.value, ...shown])]
}
function toggleSetting(value: CopySetting, checked: boolean): void {
  settings.value = checked
    ? [...settings.value, value]
    : settings.value.filter((item) => item !== value)
}
function apply(): void {
  if (!canApply.value) return
  if (mode.value === 'copy') emit('copy', nextConfig.value)
  else emit('replace', replacedBindings(props.bindings, plan.value))
  emit('update:open', false)
}
</script>
<template>
  <DtModal
    :model-value="open"
    title="批量配置"
    width="56rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <DtSegmented
        v-model="mode"
        :options="modes"
        size="sm"
        block
        aria-label="批量操作类型"
      />
      <div class="grid min-w-0 gap-3 md:grid-cols-2">
        <section class="flex min-w-0 flex-col gap-2">
          <DtSelect
            v-if="mode === 'copy'"
            v-model="sourceId"
            :options="sources"
            label="来源部件"
            size="sm"
          />
          <DtSelect
            v-else
            :model-value="kind"
            :options="kinds"
            label="对象类别"
            size="sm"
            @update:model-value="chooseKind"
          />
          <DtInput
            v-model="keyword"
            size="sm"
            label="目标对象"
            placeholder="搜索名称或标识"
          />
          <div class="flex items-center justify-between gap-2 text-xs">
            <DtButton size="xs" variant="ghost" @click="toggleAll">
              {{ allChecked ? '取消当前结果' : '全选当前结果' }}
            </DtButton>
            <span>已选 {{ ids.length }} / {{ candidates.length }}</span>
          </div>
          <div
            class="flex max-h-64 flex-col gap-2 overflow-x-hidden overflow-y-auto rounded-sm border border-border-subtle p-2"
          >
            <DtCheckbox
              v-for="item in visible"
              :key="item.id"
              :model-value="item.checked"
              :label="item.name"
              :title="item.name"
              class="min-w-0 break-words"
              @update:model-value="toggle(item.id, $event)"
            />
            <p v-if="!visible.length" class="text-xs text-text-secondary">
              没有可选目标
            </p>
          </div>
        </section>
        <section class="flex min-w-0 flex-col gap-2">
          <template v-if="mode === 'copy'">
            <strong class="text-xs"> 复制内容 </strong>
            <DtCheckbox
              v-for="item in settingOptions"
              :key="item.value"
              :label="item.label"
              :model-value="item.checked"
              @update:model-value="toggleSetting(item.value, $event)"
            />
            <p class="text-xs text-text-secondary">
              目标名称、模型节点、上级关系及取景保持不变。绑定不会从来源复制；同键字段保留目标原绑定。
            </p>
            <DtNotice v-if="removedBindings > 0" intent="warning">
              替换字段或染色规则将移除
              {{ removedBindings }} 条原绑定，可整体撤销。
            </DtNotice>
            <strong class="text-xs">
              将更新 {{ changedParts.length }} 个部件
            </strong>
            <div class="max-h-36 overflow-y-auto text-xs">
              <p v-for="part in changedParts" :key="part.id">
                {{ part.name || part.id }}
              </p>
            </div>
          </template>
          <template v-else>
            <DtInput
              v-model="find"
              label="查找点位身份中的文本"
              placeholder="按字面量匹配，不使用正则"
              size="sm"
            />
            <DtInput v-model="replace" label="替换为" size="sm" />
            <p class="text-xs text-text-secondary">
              只处理所选对象的实时点位绑定。先核对前后变化，再校验目标点位；全部有效后才能应用。
            </p>
            <strong class="text-xs"> 将替换 {{ plan.length }} 条绑定 </strong>
            <TwinBindingReplacementReview
              :plan="plan"
              :results="check.results.value"
            />
            <DtNotice v-if="check.error.value" intent="danger">
              {{ check.error.value }}
            </DtNotice>
            <DtButton
              size="sm"
              :disabled="!plan.length"
              :loading="check.loading.value"
              @click="check.check"
            >
              校验目标点位
            </DtButton>
          </template>
        </section>
      </div>
      <p class="text-xs text-text-secondary">
        应用后进入草稿，撤销一次恢复整批；点击页面保存后才持久化，不会写入设备值。
      </p>
      <div class="flex justify-end gap-2">
        <DtButton size="sm" variant="ghost" @click="emit('update:open', false)">
          取消
        </DtButton>
        <DtButton size="sm" :disabled="!canApply" @click="apply">
          应用到草稿
        </DtButton>
      </div>
    </div>
  </DtModal>
</template>
