<script setup lang="ts">
/**
 * @fileoverview API 密钥管理：签发、查看、吊销（ADR-0013）。
 *
 * ⚠ 这一页管的是**发给第三方系统的凭据**，本前端自己从不使用它们——前端一律
 * 用账号令牌。密钥不过期，落进浏览器就是把一把长期钥匙交给了 XSS。
 *
 * ⚠ 列表里永远没有明文，只有前缀。明文只在签发那一次弹窗里出现，之后库里只
 * 剩散列，我们自己也取不回来。
 *
 * ⚠ 只吊销不删除，所以已吊销的行会一直堆着——默认筛掉，要看得自己勾。
 */
import { computed, onMounted, ref } from 'vue'
import type { ApiKey, DtDataColumn, UserListItem } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtSwitch, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import * as apiKeys from '@/api/apiKeys'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import SystemTabs from '../components/SystemTabs.vue'
import IssueKeyDialog from './components/IssueKeyDialog.vue'
import KeyStateTag from './components/KeyStateTag.vue'
import SecretRevealDialog from './components/SecretRevealDialog.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '用途', card: 'title' },
  { key: 'owner', label: '归属账号', width: '12rem' },
  { key: 'state', label: '状态', width: '7rem' },
  { key: 'lastUsed', label: '最近使用', width: '12rem' },
  { key: 'expires', label: '过期', width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '7rem',
    card: 'actions',
  },
]

const toast = useToast()
const confirm = useConfirm()

const view = useViewMode('system-api-keys')
const users = ref<UserListItem[]>([])
const showRevoked = ref(false)
const issueOpen = ref(false)
const issued = ref<{ name: string; secret: string } | null>(null)

const list = useAsyncList<ApiKey>((query) =>
  apiKeys.listApiKeys({
    should_include_revoked: showRevoked.value ? true : undefined,
    ...query,
  }),
)

/** user_id → 账号名。列表只回 id，光看 UUID 认不出这是哪个系统的钥匙。 */
const userNames = computed(() => {
  const names = new Map<string, string>()
  for (const user of users.value) names.set(user.id, user.username)
  return names
})

async function loadUsers(): Promise<void> {
  try {
    users.value = (await admin.listUsers({ size: 200 })).items
  } catch {
    // 只用于归属列与签发下拉，拉不到不该让整页红
    users.value = []
  }
}

async function toggleRevoked(next: boolean): Promise<void> {
  showRevoked.value = next
  await list.reloadFromFirstPage()
}

async function onIssued(result: {
  name: string
  secret: string
}): Promise<void> {
  // ⚠ 先亮明文再刷列表：刷新失败也不能吃掉这唯一一次展示的机会
  issued.value = result
  await list.reload()
}

async function revoke(row: ApiKey): Promise<void> {
  const ok = await confirm.ask({
    title: '吊销密钥',
    message:
      `「${row.name}」（${row.prefix}…）将立刻失效，` +
      '正在用它的第三方系统会当场收到 401。此操作不可撤销。',
    confirmText: '吊销',
    danger: true,
  })
  if (!ok) return
  try {
    await apiKeys.revokeApiKey(row.id)
    toast.success('密钥已吊销')
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(async () => {
  await Promise.all([loadUsers(), list.reload()])
})
</script>

<template>
  <AppShell title="API 密钥" subtitle="第三方系统的常驻凭据">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.userManage]">
        <DtButton size="sm" icon="plus" @click="issueOpen = true">
          签发密钥
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0：AppShell 的 main 不再滚动，根节点不吃满高度的话
         表格拿不到有界高度，超出的行会被裁掉且滚不到 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :layout="{ minWidth: '58rem', cardColumns: 3, cardMinWidth: '19rem' }"
        :empty="{
          hint: '还没有签发过密钥。第三方系统要写点位时，在这里发一枚',
        }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtSwitch
            :model-value="showRevoked"
            label="显示已吊销"
            size="sm"
            @update:model-value="toggleRevoked"
          />
        </template>

        <template #summary>共 {{ list.total.value }} 枚密钥</template>

        <template #cell-name="{ row }">
          <p class="m-0 text-text-primary">{{ row.name }}</p>
          <!-- 明文只有这 8 位留得下来，吊销时靠它对上是哪一枚 -->
          <p class="m-0 font-mono text-2xs text-text-disabled">
            dtk_{{ row.prefix }}_••••
          </p>
        </template>

        <template #cell-owner="{ row }">
          {{ userNames.get(row.user_id) ?? row.user_id }}
        </template>

        <template #cell-state="{ row }">
          <KeyStateTag :api-key="row" />
        </template>

        <template #cell-lastUsed="{ row }">
          {{ formatDateTime(row.last_used_at, '从未使用') }}
        </template>

        <template #cell-expires="{ row }">
          {{ formatDateTime(row.expires_at, '永不过期') }}
        </template>

        <template #cell-actions="{ row }">
          <PermGuard :codes="[PERMISSION_CODES.userManage]">
            <DtButton
              v-if="row.revoked_at === null"
              variant="ghost"
              intent="danger"
              size="sm"
              icon="lock"
              aria-label="吊销"
              title="吊销"
              @click="revoke(row)"
            />
          </PermGuard>
        </template>
      </DtDataView>
    </div>

    <IssueKeyDialog v-model="issueOpen" :users="users" @issued="onIssued" />
    <SecretRevealDialog :issued="issued" @close="issued = null" />
  </AppShell>
</template>
