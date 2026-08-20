<script setup lang="ts">
/**
 * @fileoverview 挑用哪一档压缩产物：原件 / 高画质 / 中等 / 轻量。
 *
 * ⚠ 未就绪的档禁选并说明原因。选了一档不代表它已经压好，而**选中一个没压好的
 * 档，现场就是一块永远转圈的黑屏**——所以拦在选的这一步，而不是等到渲染时。
 * ⚠ 档位不写进 `asset:<uuid>` 引用串，是 `TwinModelRef` 上单独一个字段
 * （ADR-0022）：引用语法在三处各有一份实现，塞进去漏一处只表现为「取不到」。
 */
import { MODEL_VARIANTS } from '@dt/contracts'
import type { ModelVariant } from '@dt/contracts'
import { DtNotice, DtSelect, DtSpinner } from '@dt/ui'
import type { DtSelectOption } from '@dt/contracts'
import { computed, ref, watch } from 'vue'

import { getAsset } from '@/api/assets'
import type { Asset, AssetVariant } from '@/api/assets'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { formatSize } from '@/utils/filesize'

const props = defineProps<{
  /** 素材引用；空串 = 还没挑模型。 */
  assetRef: string
  modelValue: ModelVariant
}>()

const emit = defineEmits<{ 'update:modelValue': [ModelVariant] }>()

const asset = ref<Asset | null>(null)
const isLoading = ref(false)
const error = ref('')
const raced = useRacedFetch()

/** 档名 → 那一行；原件不在其中，它不是派生件。 */
const byName = computed<Map<string, AssetVariant>>(
  () => new Map((asset.value?.variants ?? []).map((one) => [one.variant, one])),
)

/**
 * 一档在下拉里显示成什么。
 * ⚠ 体积要摆出来：选档的人问的正是「小多少」，而那个数只有这里有。
 */
function labelOf(name: ModelVariant): string {
  if (name === 'original') {
    const bytes = asset.value?.sizeBytes ?? 0
    return bytes === 0 ? '原件' : `原件 · ${formatSize(bytes)}`
  }
  const row = byName.value.get(name)
  if (row === undefined) return name
  if (row.status !== 'ready') {
    return `${row.label} · ${row.status === 'pending' ? '压缩中' : '压缩失败'}`
  }
  return `${row.label} · ${formatSize(row.sizeBytes ?? 0)}`
}

const options = computed<DtSelectOption[]>(() =>
  MODEL_VARIANTS.map((name) => ({
    value: name,
    label: labelOf(name),
    // 原件永远可选（它是压缩失败时唯一的退路）；派生档只有 ready 才给选
    disabled: name !== 'original' && byName.value.get(name)?.status !== 'ready',
  })),
)

/** 当前选中的那一档还能不能用——存量配置可能指着一个后来失败了的档。 */
const staleWarning = computed(() => {
  if (props.modelValue === 'original' || asset.value === null) return ''
  const row = byName.value.get(props.modelValue)
  if (row === undefined || row.status === 'ready') return ''
  return row.status === 'pending'
    ? '这一档还在压。压好之前大屏会走原件。'
    : `这一档压失败了，大屏会走原件。原因：${row.error}`
})

function onPick(next: string): void {
  const found = MODEL_VARIANTS.find((name) => name === next)
  if (found !== undefined) emit('update:modelValue', found)
}

// 换模型就重取一次。⚠ 竞态防护走 useRacedFetch：快速连着换模型时，慢的那次
// 后返回会把档位列表覆盖成上一个模型的，而没有任何一处报错
watch(
  () => props.assetRef,
  async (ref) => {
    asset.value = null
    error.value = ''
    if (ref === '') return
    const id = ref.replace('asset:', '')
    isLoading.value = true
    await raced.run(() => getAsset(id), {
      ok: (found) => (asset.value = found),
      fail: () => (error.value = '取不到这个模型的压缩档'),
      settled: () => (isLoading.value = false),
    })
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="assetRef !== ''" class="flex flex-col gap-1.5">
    <DtSelect
      :model-value="modelValue"
      :options="options"
      label="使用档位"
      size="sm"
      hint="按这块屏要多清楚来选。原件最清楚也最慢"
      @update:model-value="onPick"
    />
    <DtSpinner v-if="isLoading" />
    <DtNotice v-if="error !== ''" intent="danger">{{ error }}</DtNotice>
    <DtNotice v-else-if="staleWarning !== ''" intent="warning">
      {{ staleWarning }}
    </DtNotice>
  </div>
</template>
