<script setup lang="ts">
/**
 * @fileoverview 模型管理：供应商目录、各用途走哪个模型、订阅账号，以及两个消费方
 * 此刻真在用什么（ADR-0039）。
 *
 * ⚠ 三个码各管各的：`llm:view` 看目录、`llm:manage` 改目录与测试端点、
 * `assistant:manage` 管订阅账号——订阅账号是助手一家的事，不随目录走。
 * ⚠ 目录没开（后端没配加密密钥）时供应商与用途两栏如实说「没开」并指向配置项，
 * 不摆一个永远空着的列表。
 */
import { computed, onMounted, ref } from 'vue'
import type { LlmProvider } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtNotice, useConfirm, useToast } from '@dt/ui'

import * as llm from '@/api/llmProviders'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useAuthStore } from '@/stores/auth'
import SystemTabs from '../components/SystemTabs.vue'
import SubscriptionAccounts from './components/SubscriptionAccounts.vue'
import EffectiveModelsCard from './components/EffectiveModelsCard.vue'
import ProviderFormDialog from './components/ProviderFormDialog.vue'
import ProviderTable from './components/ProviderTable.vue'
import PurposeBoard from './components/PurposeBoard.vue'
import { subscriptionAccounts } from './scripts/subscriptions'
import { useModelCatalog } from './scripts/useModelCatalog'

const toast = useToast()
const confirm = useConfirm()
const auth = useAuthStore()
const catalog = useModelCatalog()

const formOpen = ref(false)
const editing = ref<LlmProvider | null>(null)
const probing = ref<string | null>(null)

const canManage = computed(() => auth.can([PERMISSION_CODES.llmManage], 'all'))
/**
 * 要先登录的那几路。⚠ 按后端下发的形态判，不按名字猜。
 * 目录里没有订阅型供应商时才认环境变量那一路——它不在目录里，只在助手的
 * 能力面上露过一次面。
 */
const accounts = computed(() =>
  subscriptionAccounts(
    catalog.providers.value,
    catalog.kinds.value,
    (catalog.assistant.value?.models ?? []).map((one) => one.id),
  ),
)

/**
 * 订阅账号那一节只在真有这么一路、且持 assistant:manage 时摆出来：
 * 没接的部署不该出现一个点了报错的登录键，没那个码的人也不该看见它。
 */
const showsAccounts = computed(
  () =>
    auth.can([PERMISSION_CODES.assistantManage], 'all') &&
    accounts.value.length > 0,
)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(provider: LlmProvider): void {
  editing.value = provider
  formOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await catalog.reload()
}

async function probe(provider: LlmProvider): Promise<void> {
  probing.value = provider.id
  try {
    const result = await llm.probeProvider(provider.id)
    if (result.is_ok) toast.success(`${provider.name}：${result.message}`)
    else toast.error(`${provider.name}：${result.message}`)
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    probing.value = null
  }
}

async function remove(provider: LlmProvider): Promise<void> {
  const inUse = provider.assigned_purposes.length
  const ok = await confirm.ask({
    title: '删除供应商',
    message:
      inUse > 0
        ? `「${provider.name}」还被 ${inUse} 个用途指着，删不掉：先把那些用途改指别处。`
        : `将删除「${provider.name}」及它的密钥，且不可恢复。`,
    confirmText: inUse > 0 ? '知道了' : '删除',
    danger: inUse === 0,
  })
  if (!ok || inUse > 0) return
  try {
    await catalog.remove(provider)
    await afterWrite('供应商已删除')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function assign(
  purpose: string,
  providerId: string,
  modelName: string,
): Promise<void> {
  try {
    await catalog.assign(purpose, providerId, modelName)
    toast.success('用途已更新，两侧十秒内生效')
    await catalog.reloadEffective()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function clear(purpose: string): Promise<void> {
  try {
    await catalog.clear(purpose)
    toast.success('已清除，那一侧退回环境变量里的配置')
    await catalog.reloadEffective()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => void catalog.reload())
</script>

<template>
  <AppShell title="模型管理" subtitle="供应商、各用途走哪个模型、订阅账号">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.llmManage]" explain>
        <DtButton
          size="sm"
          icon="plus"
          :disabled="catalog.isDisabled.value"
          @click="openCreate"
        >
          新建供应商
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0：AppShell 的 main 不再滚动；本页分几节，滚动交给下面那层 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <!-- ⚠ PermGuard 是片段没有根节点，滚动容器得是它外面这一层 div -->
      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <PermGuard :codes="[PERMISSION_CODES.llmView]" explain>
          <DtNotice v-if="catalog.isDisabled.value" intent="warning">
            这套部署还没开模型供应商目录：给 platform-server 配上
            <code>PLATFORM_LLM_PROVIDER_SECRET</code>
            再回来。此刻助手与知识库各用各的环境变量配置。
          </DtNotice>

          <DtCard
            title="供应商"
            subtitle="按类型配：兼容端点填地址与密钥，订阅账号改为登录一次"
          >
            <ProviderTable
              :providers="catalog.providers.value"
              :kinds="catalog.kinds.value"
              :is-loading="catalog.isLoading.value"
              :error="catalog.error.value"
              :probing-id="probing"
              @probe="probe"
              @edit="openEdit"
              @remove="remove"
              @retry="catalog.reload()"
            />
          </DtCard>

          <DtCard
            title="用途分配"
            subtitle="助手与知识库的每一种用途走哪一路的哪个模型；没分配的沿用各自环境变量"
          >
            <PurposeBoard
              :purposes="catalog.purposes.value"
              :providers="catalog.providers.value"
              :can-manage="canManage"
              @assign="assign"
              @clear="clear"
            />
          </DtCard>

          <DtCard title="当前生效" subtitle="两个消费方自己报回来的状态">
            <EffectiveModelsCard
              :assistant="catalog.assistant.value"
              :knowledge="catalog.knowledge.value"
            />
          </DtCard>

          <DtCard
            v-if="showsAccounts"
            title="订阅账号"
            subtitle="上面配的每一路订阅各登录一次，助手专用"
          >
            <SubscriptionAccounts
              :accounts="accounts"
              @changed="catalog.reloadEffective()"
            />
          </DtCard>
        </PermGuard>
      </div>
    </div>

    <ProviderFormDialog
      v-model="formOpen"
      :provider="editing"
      :kinds="catalog.kinds.value"
      @saved="afterWrite"
    />
  </AppShell>
</template>
