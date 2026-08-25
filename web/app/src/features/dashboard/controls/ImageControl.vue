<script setup lang="ts">
/**
 * @fileoverview `type: 'image'` 的控件：从素材库挑一张，或手填图片 URL / CSS background 值。
 *
 * ⚠ 挑素材落库的是 `asset:<uuid>` 引用不是 URL：URL 换一次部署 / 换一个桶就 404，
 * 而存量配置里那条链接没有任何一处会报错，表现只是那张屏上的图不见了（ADR-0015 四）。
 * ⚠ 预览按来源分三条路画（素材引用先摊成地址，判别在 `@dt/modules`），塞错了看着就像素材坏了。
 */
import { parseAssetRef } from '@dt/contracts'
import {
  imageSourceKind,
  isAssetRef,
  readText,
  resolveImageValue,
} from '@dt/modules'
import { DtButton, DtIcon, DtInput } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import AssetPickerDialog from '@/components/assets/AssetPickerDialog.vue'
import { getAsset } from '@/api/assets'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const current = computed(() => readText(props.value))
const isRef = computed(() => isAssetRef(current.value))
/** 预览与画布看同一个摊平结果：两处各摊各的必然有一处对不上。 */
const resolved = computed(() => resolveImageValue(current.value))
const kind = computed(() => imageSourceKind(resolved.value))
const placeholder = computed(
  () => props.field.placeholder ?? 'https://… 或 linear-gradient(…)',
)

const pickerOpen = ref(false)
/** 素材显示名，纯展示；落库的只有引用。取不到名字就退回引用串本身。 */
const assetName = ref('')
const assetLabel = computed(() =>
  assetName.value === '' ? current.value : assetName.value,
)

/**
 * 引用换了就去问一次名字。
 * ⚠ 失败只是没有名字，不是配置坏了：这里吞掉错误，界面退回显示引用串本身。
 */
watch(
  current,
  (value) => {
    assetName.value = ''
    const id = parseAssetRef(value)
    if (id === null) return
    const wanted = value
    void getAsset(id)
      .then((asset) => {
        // 迟到的响应不许盖新值：连点两次素材时，先发的那条可能后到
        if (current.value === wanted) assetName.value = asset.name
      })
      .catch(() => undefined)
  },
  { immediate: true },
)

function onPick(assetRef: string, asset: { name: string }): void {
  assetName.value = asset.name
  emit('update', assetRef, true)
}

function clearAsset(): void {
  emit('update', '', true)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border-subtle bg-surface-sunken"
    >
      <div
        v-if="kind === 'css'"
        class="h-full w-full"
        :style="{ background: resolved }"
      />
      <img
        v-else-if="kind === 'url'"
        :src="resolved"
        alt=""
        class="h-full w-full object-contain"
      />
      <DtIcon v-else name="palette" :size="14" />
    </div>

    <!-- 挑过素材就不再摆输入框：那一格里是 `asset:<uuid>`，摆出来只会诱人手改成 URL -->
    <div
      v-if="isRef"
      class="flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-border-subtle px-2 py-1"
    >
      <span class="min-w-0 flex-1 truncate text-xs" :title="assetLabel">
        {{ assetLabel }}
      </span>
      <DtButton
        variant="ghost"
        size="xs"
        icon="close"
        aria-label="清除素材"
        :disabled="disabled"
        @click="clearAsset"
      />
    </div>
    <DtInput
      v-else
      class="min-w-0 flex-1"
      :model-value="current"
      size="sm"
      :disabled="disabled"
      :placeholder="placeholder"
      spellcheck="false"
      @update:model-value="emit('update', $event, true)"
    />

    <DtButton
      variant="soft"
      size="sm"
      icon="folder-open"
      aria-label="从素材库选择"
      :disabled="disabled"
      @click="pickerOpen = true"
    />

    <AssetPickerDialog
      v-model="pickerOpen"
      kind="image"
      title="选择图片"
      @pick="onPick"
    />
  </div>
</template>
