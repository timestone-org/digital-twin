<script setup lang="ts">
/**
 * @fileoverview 素材缩略图：图片与图标直接画原件，模型给一个占位图标。
 *
 * ⚠ 模型这一格是占位图标不是坏了：列表里每行都装一个 WebGL 上下文的话，
 * 一屏五十行会把浏览器的上下文配额（多数只有 8～16 个）当场用光。模型的
 * 真预览在详情面里（`AssetPreviewStage`），一次只开一个。
 * ⚠ 取不到时**换成占位图标**而不是留着那个碎图标：碎图看着像页面坏了，
 * 而真实原因通常是这个素材的字节已经不在桶里了。
 */
import { assetUrl } from '@dt/contracts'
import { DtIcon } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { ASSET_BASE_URL } from '@/config/app'

const props = defineProps<{ asset: Asset }>()

const failed = ref(false)

const src = computed(() =>
  props.asset.kind === 'model' || failed.value
    ? ''
    : assetUrl(ASSET_BASE_URL, props.asset.kind, props.asset.ref),
)

// 同一个组件会被复用到另一行上，不重置的话上一行的失败会跟着传染
watch(
  () => props.asset.id,
  () => (failed.value = false),
)
</script>

<template>
  <span class="dt-asset-preview">
    <!-- alt 留空是刻意的：名字就在同一行，读屏再念一遍文件名只是噪音 -->
    <img
      v-if="src !== ''"
      :src="src"
      alt=""
      loading="lazy"
      @error="failed = true"
    />
    <DtIcon v-else name="layers" :size="16" />
  </span>
</template>

<style scoped lang="scss">
.dt-asset-preview {
  display: inline-flex;
  width: 2.5rem;
  height: 2.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-disabled);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
</style>
