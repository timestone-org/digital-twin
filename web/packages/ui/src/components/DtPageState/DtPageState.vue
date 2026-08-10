<script setup lang="ts">
/**
 * @fileoverview DtPageState —— 取数三态（加载中 / 出错 / 空）的统一渲染。
 *
 * ⚠ 三态必须都有。各页自己写的结果一定是「有的页没有空态」——空列表和
 * 还没加载完在界面上长得一模一样，用户分不清是没数据还是卡住了。
 * 出错态必须带重试入口，否则唯一的恢复手段是刷新整页。
 */
import DtButton from '../DtButton/DtButton.vue'
import DtEmpty from '../DtEmpty/DtEmpty.vue'
import DtSpinner from '../DtSpinner/DtSpinner.vue'

withDefaults(
  defineProps<{
    loading?: boolean | undefined
    error?: string | null | undefined
    empty: boolean
    emptyTitle?: string | undefined
    emptyHint?: string | undefined
    emptyIcon?: string | undefined
  }>(),
  {
    loading: false,
    error: null,
    emptyTitle: '暂无数据',
    emptyIcon: 'alert-circle',
  },
)

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="loading" class="dt-page-state__center">
    <DtSpinner :size="24" />
  </div>
  <DtEmpty v-else-if="error" icon="alert-circle" title="加载失败" :hint="error">
    <DtButton variant="outline" size="sm" @click="emit('retry')">
      重试
    </DtButton>
  </DtEmpty>
  <DtEmpty
    v-else-if="empty"
    :icon="emptyIcon"
    :title="emptyTitle"
    :hint="emptyHint"
  />
  <slot v-else />
</template>

<style scoped lang="scss">
.dt-page-state__center {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
</style>
