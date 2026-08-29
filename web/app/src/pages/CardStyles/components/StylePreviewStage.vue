<script setup lang="ts">
/**
 * @fileoverview 中栏：把当前草稿按运行态的口径渲染成一格。
 *
 * ⚠ 值走清单的 `preview.values` 假件，**不连实时数据**：正在调观感的人不需要
 * 真值，而真值会让预览随点位跳动、看不清刚改的那一项。
 * ⚠ 取数源要在本子树 `provide`：不装就是「诚实空源」，每条绑定都返回
 * `state: 'error'`，卡片上画的是缺值占位而不是演示数字。
 * ⚠ 渲染哪个模块由**上层**定：通用外壳样式没有绑定的模块类型，得能换着看
 * 同一套外壳套在不同模块上的样子。
 */
import type { CardChrome } from '@dt/contracts'
import {
  ModuleRenderer,
  provideRuntimeData,
  type GetModuleManifest,
} from '@dt/runtime'
import { computed } from 'vue'

import { previewBindings } from '@/features/dashboard/previewBindings'
import { createBindingReader } from '@/runtime/bindingReader'

const props = defineProps<{
  /** 这一格渲染哪个模块。 */
  moduleType: string
  chrome: CardChrome
  /** 内芯；通用外壳样式给空对象。 */
  config: Record<string, unknown>
  getManifest: GetModuleManifest
  width: number
  height: number
  /**
   * 底色档。外壳的色都是 `var(--)` 引用，深浅两种底下都得各看一眼。
   * ⚠ 深 / 浅两档刻意用主题**无关**的纯黑纯白：拿主题变量当底的话，换肤时
   * 底跟着卡片一起变，等于什么都没验到。
   */
  backdrop: 'screen' | 'dark' | 'light'
}>()

// ⚠ 常量绑定不查任何快照缓存，故「读一个点位」那一半给恒空的函数即可
provideRuntimeData({ readBinding: () => createBindingReader(() => undefined) })

const manifest = computed(() => props.getManifest(props.moduleType))

/** 演示配置只铺没配过的键：草稿里已有的一律赢过它。 */
const config = computed<Record<string, unknown>>(() => ({
  ...(manifest.value?.preview?.config ?? {}),
  ...props.config,
}))

const bindings = computed(() =>
  previewBindings(manifest.value?.bindings ?? [], manifest.value?.preview),
)

const boxStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
}))
</script>

<template>
  <div
    class="dt-stage flex h-full min-h-0 items-center justify-center overflow-auto rounded p-6"
    :class="`dt-stage--${backdrop}`"
  >
    <div :style="boxStyle" class="shrink-0">
      <ModuleRenderer
        class="h-full w-full"
        :module-type="moduleType"
        :card-chrome="chrome"
        :config="config"
        :bindings="bindings"
        :get-manifest="getManifest"
      />
    </div>
  </div>
</template>

<style scoped>
.dt-stage--screen {
  background: var(--surface-base);
}

.dt-stage--dark {
  background: var(--fx-const-opaque);
}

.dt-stage--light {
  background: var(--fx-const-lighten);
}
</style>
