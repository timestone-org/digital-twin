<script setup lang="ts">
/**
 * @fileoverview 公开分享：发布 / 撤回一张屏，并把公开链接摆出来供复制。
 *
 * ⚠ 每次发布都换一个新令牌，旧链接当场失效。「再点一次发布」不是幂等的——
 * 它会把已经发出去的那条链接全废掉，所以再次发布走二次确认而不是直接发。
 * ⚠ 正因如此，「读当前链接」必须有自己的端点：拿重新发布去凑，等于每看一眼
 * 链接就把它换掉一次。
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

import {
  getDashboardPublication,
  publishDashboard,
  unpublishDashboard,
} from '@/api/dashboardShare'
import type { DashboardSummary } from '@/api/dashboardWire'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { copyText } from '@/utils/clipboard'

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
/** 当前链接还在取的路上。⚠ 取完仍然没有链接要另说一句：把「正在取」一直
 * 挂着的话，一次失败的读看上去和一条永远加载不完的链接一模一样。 */
const loading = ref(false)
const busy = ref(false)
const raced = useRacedFetch()

/** ⚠ 公开面的路径是 `/public/<token>`，与登录态的 `/dashboards/:id` 不是同一条。 */
const link = computed(() =>
  token.value === null ? '' : `${location.origin}/public/${token.value}`,
)

/**
 * 取这张屏此刻的发布态。列表项里只有 `isPublic`，令牌得单独问发布面要。
 * @param dashboardId 大屏 id
 */
async function loadPublication(dashboardId: string): Promise<void> {
  loading.value = true
  await raced.run((signal) => getDashboardPublication(dashboardId, signal), {
    ok: (publication) => {
      isPublic.value = publication.isPublic
      token.value = publication.publicToken
    },
    fail: () => undefined,
    settled: () => {
      loading.value = false
    },
  })
}

watch(
  () => [props.open, props.dashboard?.id] as const,
  ([open]) => {
    const target = props.dashboard
    // 关掉时作废在飞的那一次：不作废的话它之后返回，会写进一个已经没人看的
    // 状态，下次打开还没取完就先闪一条上一张屏的链接
    raced.cancel()
    if (!open || target === null) return
    isPublic.value = target.isPublic
    token.value = null
    if (target.isPublic) void loadPublication(target.id)
  },
  { immediate: true },
)

onUnmounted(() => {
  raced.cancel()
})

/**
 * 开始一次写。
 * ⚠ 必须先作废在飞的那次读：发布换发的新令牌是这一刻的真相，而先发出去的读
 * 回来的是换发**之前**那一个，晚一步落地就把新链接盖回旧的——链接看着没变，
 * 复制出去的那条已经作废了。
 */
function beginWrite(): void {
  raced.cancel()
  loading.value = false
  busy.value = true
}

/**
 * 问完之后，弹窗还开着、且还指着同一张屏。
 * ⚠ 每条二次确认之后都要查一次：等回答的这段时间里弹窗可能已经被关掉。答
 * 「确定」于是变成对着一张已经不在眼前的屏换链接——人回到工作台，只知道旧链接
 * 没了，新的那条压根没露过面。
 * @param target 发起这次操作时瞄准的那张屏
 */
function stillTargets(target: DashboardSummary): boolean {
  return props.open && props.dashboard?.id === target.id
}

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
  if (!stillTargets(target)) return
  beginWrite()
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
  if (!agreed || !stillTargets(target)) return
  beginWrite()
  try {
    absorb(await unpublishDashboard(target.id))
    toast.success('已撤回，链接立即失效')
  } catch (caught) {
    toast.error(reason(caught, '撤回失败'))
  } finally {
    busy.value = false
  }
}

/**
 * 复制公开链接。
 * ⚠ 走 `copyText` 而不是直接 `navigator.clipboard`：本平台按内网 IP 走纯
 * HTTP 交付，那里 `navigator.clipboard` 是 undefined——开发机（localhost）
 * 是安全上下文，永远复现不了。
 */
async function copyLink(): Promise<void> {
  if (link.value === '') return
  if (await copyText(link.value)) toast.success('链接已复制')
  else toast.error('复制失败，请手动选中链接复制')
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
      <DtNotice v-else-if="isPublic && loading" icon="circle-question">
        正在取这张屏当前的公开链接。
      </DtNotice>
      <DtNotice v-else-if="isPublic" intent="warning" icon="alert-triangle">
        取不到这张屏当前的公开链接。「重新发布」能换一条新的，
        但已经发出去的那条会立即失效。
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
          icon="close"
          :disabled="busy"
          @click="unpublish"
        >
          撤回公开
        </DtButton>
        <DtButton
          variant="outline"
          icon="refresh-cw"
          :loading="busy"
          @click="publish"
        >
          重新发布
        </DtButton>
        <DtButton icon="copy" :disabled="busy || link === ''" @click="copyLink">
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
