<script setup lang="ts">
/**
 * @fileoverview 公开分享：发布 / 撤回一张屏，并把公开链接摆出来供复制。
 *
 * ⚠ 每次发布都换一个新令牌，旧链接当场失效。「再点一次发布」不是幂等的——
 * 它会把已经发出去的那条链接全废掉，所以再次发布走二次确认而不是直接发。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  useConfirm,
  useToast,
} from '@dt/ui'

import type { DashboardPublication } from '@dt/contracts'

import { getDashboard } from '@/api/dashboard'
import { publishDashboard, unpublishDashboard } from '@/api/dashboardShare'
import type { DashboardSummary } from '@/api/dashboardWire'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = defineProps<{
  open: boolean
  dashboard: DashboardSummary | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  updated: [payload: DashboardPublication]
}>()

const confirm = useConfirm()
const toast = useToast()

const isPublic = ref(false)
const token = ref<string | null>(null)
const busy = ref(false)
const raced = useRacedFetch()
let disposed = false

/** ⚠ 公开面的路径是 `/public/<token>`，与登录态的 `/dashboards/:id` 不是同一条。 */
const link = computed(() =>
  token.value === null ? '' : `${location.origin}/public/${token.value}`,
)

/**
 * 列表项里没有 `publicToken`（那是详情才有的字段），已公开的屏得再拉一次详情
 * 才拿得到链接。拉不到就只是没有链接可展示，不当成错误打断用户。
 */
async function loadToken(dashboardId: string): Promise<void> {
  await raced.run(() => getDashboard(dashboardId), {
    ok: (detail) => {
      if (!disposed) token.value = detail.publicToken
    },
    fail: () => undefined,
    settled: () => undefined,
  })
}

watch(
  () => [props.open, props.dashboard?.id] as const,
  ([open]) => {
    const target = props.dashboard
    if (!open || target === null) return
    isPublic.value = target.isPublic
    token.value = null
    if (target.isPublic) void loadToken(target.id)
  },
  { immediate: true },
)

// 弹窗开着时被卸载（切走页面），在途那次回来仍会写一个已经不在的状态
onUnmounted(() => {
  disposed = true
})

function absorb(result: DashboardPublication): void {
  isPublic.value = result.isPublic
  token.value = result.publicToken
  emit('updated', result)
}

function reason(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

async function publish(): Promise<void> {
  const target = props.dashboard
  if (target === null || busy.value) return
  if (
    isPublic.value &&
    !(await confirm.ask({
      title: '重新发布会换一条链接',
      message:
        '重新发布会生成新的公开令牌，当前这条链接立即失效——已经发出去的人会打不开。确定要换吗？',
      confirmText: '换新链接',
      danger: true,
    }))
  ) {
    return
  }
  busy.value = true
  try {
    absorb(await publishDashboard(target.id))
    toast.success('已生成公开链接')
  } catch (caught) {
    toast.error(reason(caught, '发布失败'))
  } finally {
    busy.value = false
  }
}

async function unpublish(): Promise<void> {
  const target = props.dashboard
  if (target === null || busy.value) return
  const agreed = await confirm.ask({
    title: '撤回公开链接',
    message:
      '撤回后这条链接立即失效，且再次发布会是一条新链接，撤不回原来那条。',
    confirmText: '撤回',
    danger: true,
  })
  if (!agreed) return
  busy.value = true
  try {
    absorb(await unpublishDashboard(target.id))
    toast.success('已撤回，链接立即失效')
  } catch (caught) {
    toast.error(reason(caught, '撤回失败'))
  } finally {
    busy.value = false
  }
}

async function copyLink(): Promise<void> {
  if (link.value === '') return
  try {
    await navigator.clipboard.writeText(link.value)
    toast.success('链接已复制')
  } catch {
    toast.error('复制失败，请手动选中链接复制')
  }
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="公开分享"
    :description="dashboard?.name"
    width="38rem"
    :close-on-backdrop="!busy"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtNotice v-if="isPublic" intent="success" icon="share">
        这张屏已公开，任何人拿到下面的链接都能匿名只读访问，不需要登录。
        画面上的数值是<strong>实时</strong>的；配了跳转的目标屏若也已发布，
        同样能从这条链接点进去。
      </DtNotice>
      <DtNotice v-else icon="circle-question">
        还没有公开。发布后会生成一条匿名可读的链接，随时可以撤回。
      </DtNotice>

      <DtInput
        v-if="isPublic && link !== ''"
        :model-value="link"
        label="公开链接"
        readonly
      />
      <DtNotice v-else-if="isPublic" icon="circle-question">
        正在取这张屏当前的公开链接。
      </DtNotice>

      <DtNotice intent="warning" icon="alert-triangle">
        每次发布都会换一个新令牌：已经公开的屏再点一次「重新发布」，
        之前发出去的链接会立即失效。
      </DtNotice>
    </div>

    <template #footer>
      <template v-if="isPublic">
        <DtButton
          variant="ghost"
          intent="danger"
          size="sm"
          icon="close"
          :disabled="busy"
          @click="unpublish"
        >
          撤回公开
        </DtButton>
        <DtButton
          variant="outline"
          size="sm"
          icon="refresh-cw"
          :loading="busy"
          @click="publish"
        >
          重新发布
        </DtButton>
        <DtButton
          size="sm"
          icon="copy"
          :disabled="busy || link === ''"
          @click="copyLink"
        >
          复制链接
        </DtButton>
      </template>
      <template v-else>
        <DtButton
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          取消
        </DtButton>
        <DtButton size="sm" icon="share" :loading="busy" @click="publish">
          发布并生成链接
        </DtButton>
      </template>
    </template>
  </DtModal>
</template>
