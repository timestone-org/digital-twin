<script setup lang="ts">
/**
 * @fileoverview 中栏：把当前草稿按运行态的口径渲染成一格。
 * ⚠ 值走清单的 `preview.values` 假件，**不连实时数据**：正在调观感的人不需要真值，
 * 而真值会让预览随点位跳动、看不清刚改的那一项。
 * ⚠ 取数源要在本子树 `provide`：不装就是「诚实空源」，每条绑定都返回 error，
 * 卡片上画的是缺值占位而不是演示数字。
 */
import {
  ModuleRenderer,
  provideRuntimeData,
  type GetModuleManifest,
} from '@dt/runtime'
import { DtSegmented } from '@dt/ui'
import { computed } from 'vue'

import { previewBindings } from '@/features/dashboard/previewBindings'
import { createBindingReader } from '@/runtime/bindingReader'

const props = defineProps<{
  moduleType: string
  config: Record<string, unknown>
  getManifest: GetModuleManifest
  width: number
  height: number
}>()

const backdrop = defineModel<string>('backdrop', { default: 'screen' })

/** 底色三档。⚠ 深浅两档刻意用主题无关的纯黑纯白：拿主题变量当底等于什么都没验到。 */
const BACKDROPS = [
  { value: 'screen', label: '大屏底' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

// ⚠ 常量绑定不查任何快照缓存，故「读一个点位」那一半给恒空的函数即可
provideRuntimeData({ readBinding: () => createBindingReader(() => undefined) })

const manifest = computed(() => props.getManifest(props.moduleType))

const bindings = computed(() =>
  previewBindings(manifest.value?.bindings ?? [], manifest.value?.preview),
)

const boxStyle = computed(() => ({
  width: `${String(props.width)}px`,
  height: `${String(props.height)}px`,
}))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div
      class="ce-stage flex min-h-0 flex-1 overflow-auto rounded p-6"
      :class="`ce-stage--${backdrop}`"
    >
      <!-- 居中靠 m-auto 而不是 justify-center：卡片比舞台宽时后者会把左半边推出可滚动范围 -->
      <div :style="boxStyle" class="m-auto shrink-0">
        <ModuleRenderer
          class="h-full w-full"
          :module-type="moduleType"
          :config="config"
          :bindings="bindings"
          :get-manifest="getManifest"
        />
      </div>
    </div>
    <DtSegmented
      v-model="backdrop"
      :options="BACKDROPS"
      aria-label="预览底色"
      size="sm"
    />
  </div>
</template>

<style scoped>
.ce-stage--screen {
  background: var(--surface-base);
}

.ce-stage--dark {
  background: var(--fx-const-opaque);
}

.ce-stage--light {
  background: var(--fx-const-lighten);
}
</style>
