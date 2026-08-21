<script setup lang="ts">
/**
 * @fileoverview 整屏模板网格：自己取数、四态（加载 / 出错 / 空 / 网格），
 * 选中与删除都只抛事件。新建大屏与模板库两处共用，故取数放在这里而不是各自弹窗。
 *
 * ⚠ 取数走 `useRacedFetch`：宿主弹窗可能被连着开关，慢的那次后返回会盖掉快的
 * 那次的结果，界面显示的是上一轮的模板列表且没有任何报错。
 */
import { onUnmounted, ref, watch } from 'vue'
import { DtButton, DtIcon, DtPageState } from '@dt/ui'
import type { DashboardTemplateSummary } from '@dt/contracts'

import { listDashboardTemplates } from '@/api/dashboardTemplates'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = withDefaults(
  defineProps<{
    /** 关着的时候不取数，也不渲染网格。 */
    active: boolean
    selectedId?: string | null
    deletable?: boolean
  }>(),
  { selectedId: null, deletable: false },
)

const emit = defineEmits<{
  select: [template: DashboardTemplateSummary]
  delete: [template: DashboardTemplateSummary]
}>()

/** 一次拉够：模板是人工另存出来的，量级在几十条。 */
const PAGE_SIZE = 100

const templates = ref<DashboardTemplateSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const raced = useRacedFetch()
let disposed = false

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  await raced.run(() => listDashboardTemplates({ size: PAGE_SIZE }), {
    ok: (page) => {
      if (!disposed) templates.value = page.items
    },
    fail: (caught) => {
      if (!disposed) {
        error.value = caught instanceof Error ? caught.message : '加载模板失败'
      }
    },
    settled: () => {
      if (!disposed) loading.value = false
    },
  })
}

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)

// 组件卸载后在途那次回来仍会走 ok/fail，写一个已经不在的状态
onUnmounted(() => {
  disposed = true
})

defineExpose({ reload: load })
</script>

<template>
  <DtPageState
    :loading="loading"
    :error="error"
    :empty="templates.length === 0"
    empty-icon="layers"
    empty-title="还没有模板"
    empty-hint="在大屏卡片菜单里选「另存为模板」即可攒下可复用的整屏。"
    @retry="load"
  >
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div
        v-for="template in templates"
        :key="template.id"
        class="dt-tpl"
        :class="{ 'dt-tpl--on': template.id === selectedId }"
      >
        <button
          type="button"
          class="dt-tpl__pick"
          :aria-current="template.id === selectedId ? 'true' : undefined"
          @click="emit('select', template)"
        >
          <img
            v-if="template.thumbnail"
            :src="template.thumbnail"
            alt=""
            class="dt-tpl__shot"
            draggable="false"
          />
          <span v-else class="dt-tpl__shot dt-tpl__shot--blank dt-grid-bg">
            <DtIcon name="layout-grid" :size="24" :stroke-width="1.5" />
          </span>
          <span class="dt-tpl__name">{{ template.name }}</span>
          <span class="dt-tpl__meta">{{ template.category ?? '未分类' }}</span>
        </button>
        <DtButton
          v-if="deletable"
          class="dt-tpl__del"
          size="sm"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除模板"
          title="删除模板"
          @click="emit('delete', template)"
        />
      </div>
    </div>
  </DtPageState>
</template>

<style scoped lang="scss">
.dt-tpl {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-panel);

  &--on {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary);
  }

  &__pick {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0 0 8px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  &__shot {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: var(--surface-sunken);

    &--blank {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-disabled);
    }
  }

  &__name {
    margin: 8px 10px 0;
    overflow: hidden;
    font-size: 12px;
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    margin: 2px 10px 0;
    font-size: 10px;
    color: var(--text-disabled);
  }

  /* 只管把删除键钉到卡片右上角。⚠ 长相（尺寸/描边/底色/悬停色）一律交给
     DtButton —— 在这里再写一份等于把按钮的皮重做一遍，换肤时它不会跟着变 */
  &__del {
    position: absolute;
    top: 6px;
    right: 6px;
    background: var(--surface-overlay);
  }
}
</style>
