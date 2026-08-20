<script setup lang="ts">
/**
 * @fileoverview 素材的大图预览台：图片与图标画原件，三维模型交给可交互的查看器。
 *
 * ⚠ 三维查看器是**异步组件**：它静态依赖整个 three，同步引进来会让素材页
 * 每次打开都先下几百 KB，而多数时候用户看的只是一张图。
 * ⚠ 底板是棋盘格而不是纯色：透明的 PNG 与 SVG 在纯色底上看不出哪里是透明的，
 * 用户会以为素材本身带了一块白底。
 */
import { assetUrl } from '@dt/contracts'
import { DtEmpty, DtSpinner } from '@dt/ui'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { ASSET_BASE_URL } from '@/config/app'

const AssetModelViewer = defineAsyncComponent({
  loader: () => import('./AssetModelViewer.vue'),
  loadingComponent: DtSpinner,
})

const props = defineProps<{ asset: Asset }>()

const failed = ref(false)

const src = computed(() =>
  assetUrl(ASSET_BASE_URL, props.asset.kind, props.asset.ref),
)
const isModel = computed(() => props.asset.kind === 'model')

// 换一个素材时把上一个的失败态清掉，否则它会跟着传染到下一个身上
watch(
  () => props.asset.id,
  () => (failed.value = false),
)
</script>

<template>
  <div class="dt-asset-stage" :class="{ 'is-model': isModel }">
    <!-- ⚠ `:key` 挂素材 id：不换 key 的话切到另一个模型时 Vue 会复用同一个
         查看器实例，而它的场景是在 onMounted 里装的——画面停在上一个模型上 -->
    <AssetModelViewer v-if="isModel" :key="asset.id" :url="src" />
    <DtEmpty
      v-else-if="failed"
      icon="image"
      title="取不到这个素材的字节"
      hint="它可能已被从对象存储里删掉；这一行的元信息还在，但文件没了"
    />
    <img
      v-else
      :src="src"
      :alt="asset.name"
      class="dt-asset-stage__image"
      @error="failed = true"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-asset-stage {
  display: flex;
  min-height: 20rem;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  // 棋盘格：两层 45° 渐变错开半格，透明区域才看得出来
  background-color: var(--surface-sunken);
  background-image:
    linear-gradient(
      45deg,
      var(--border-subtle) 25%,
      transparent 25% 75%,
      var(--border-subtle) 75%
    ),
    linear-gradient(
      45deg,
      var(--border-subtle) 25%,
      transparent 25% 75%,
      var(--border-subtle) 75%
    );
  background-position:
    0 0,
    8px 8px;
  background-size: 16px 16px;

  // 模型自己铺满整块，棋盘格与内边距都让开
  &.is-model {
    padding: 0;
    background-image: none;
  }

  &__image {
    max-width: 100%;
    max-height: 26rem;
    object-fit: contain;
  }
}
</style>
