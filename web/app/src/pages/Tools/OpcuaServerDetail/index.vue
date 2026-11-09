<script setup lang="ts">
/**
 * @fileoverview 单个 OPC UA 实例的详情：起停、地址空间、会话、安全。
 *
 * ⚠ 页顶必须把「已保存但未生效」的字段照实列出来。API 回的 `pending_fields`
 * 一旦被吞掉，用户会以为改动已经生效，而上位机读到的还是旧值——那是最难
 * 排查的一类故障，因为界面上一切正常。
 */
import { computed, onMounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import type { OpcuaInstance } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtPageState, DtTag } from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import type { AppTabItem } from '@/components/layout'
import { AppShell, AppTabNav } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import InstanceStatusTag from '../components/InstanceStatusTag.vue'
import { pendingFieldLabels } from '../scripts/pendingFields'
import type { InstanceVerb } from '../scripts/useInstanceActions'
import { useInstanceActions } from '../scripts/useInstanceActions'

const route = useRoute()
const raced = useRacedFetch()

const instanceId = computed(() => String(route.params.instanceId ?? ''))
const instance = ref<OpcuaInstance | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** 三个分区是子路由，页签因此是真链接：可收藏、可中键新开、后退可用。 */
const tabs = computed<AppTabItem[]>(() => {
  const base = `/tools/opcua-servers/${instanceId.value}`
  return [
    {
      key: 'nodes',
      label: '地址空间',
      icon: 'layout-grid',
      to: `${base}/nodes`,
    },
    {
      key: 'sessions',
      label: '在线会话',
      icon: 'users',
      to: `${base}/sessions`,
    },
    {
      key: 'security',
      label: '接入安全',
      icon: 'shield-check',
      to: `${base}/security`,
    },
  ]
})

const pendingLabels = computed(() =>
  pendingFieldLabels(instance.value?.pending_fields ?? []),
)

async function load(): Promise<void> {
  loading.value = true
  await raced.run(() => opcua.getInstance(instanceId.value), {
    ok: (result) => {
      instance.value = result
      error.value = null
    },
    fail: (caught) => {
      error.value = describeError(caught)
      instance.value = null
    },
    settled: () => (loading.value = false),
  })
}

const actions = useInstanceActions(load)
const busy = computed(() => loading.value || actions.pending.value)

function act(verb: InstanceVerb): void {
  if (instance.value !== null) void actions.act(instance.value, verb)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <AppShell :title="instance?.name ?? 'OPC UA 实例'" subtitle="实例详情">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.opcuaOperate]" explain>
        <div v-if="instance" class="flex items-center gap-2">
          <DtButton
            v-if="!instance.is_running"
            size="sm"
            :disabled="busy"
            @click="act('start')"
          >
            启动
          </DtButton>
          <template v-else>
            <DtButton
              size="sm"
              variant="outline"
              :disabled="busy"
              @click="act('restart')"
            >
              重启
            </DtButton>
            <DtButton
              size="sm"
              variant="outline"
              :disabled="busy"
              @click="act('stop')"
            >
              停止
            </DtButton>
          </template>
        </div>
      </PermGuard>
    </template>

    <!-- 起停后的重取不进整页加载态：那会卸掉分区里的选择、搜索与写值草稿 -->
    <DtPageState
      :loading="loading && instance === null"
      :error="error"
      :empty="instance === null && !loading && error === null"
      empty-title="实例不存在"
      @retry="load()"
    >
      <div v-if="instance" class="flex h-full min-h-0 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <InstanceStatusTag
            :is-running="instance.is_running"
            :desired-state="instance.desired_state"
          />
          <DtTag mono size="sm">{{ instance.endpoint_url }}</DtTag>
          <DtTag
            v-if="instance.is_anonymous_allowed"
            intent="warning"
            size="sm"
          >
            允许匿名
          </DtTag>
          <DtTag
            v-for="policy in instance.security_policies"
            :key="policy"
            size="sm"
          >
            {{ policy }}
          </DtTag>
        </div>

        <DtNotice
          v-if="pendingLabels.length > 0"
          intent="warning"
          icon="alert-triangle"
        >
          {{ pendingLabels.join('、') }}
          已保存但尚未生效，重启实例后才对上位机可见。
        </DtNotice>

        <DtNotice
          v-if="instance.certificate.expires_at === null"
          intent="info"
          icon="alert-circle"
        >
          该实例还没有服务器证书，首次启动时会自签一张。私钥只写在挂载卷上，不入库。
        </DtNotice>

        <AppTabNav :items="tabs" label="实例详情分区" />

        <div class="min-h-0 flex-1 overflow-auto">
          <!-- ⚠ 三个分区组件都收 `instance` 这一个 prop。写错 prop 名时
               typecheck 与 lint 双双放行，靠 `sections.contract.spec.ts` 兜 -->
          <RouterView v-slot="{ Component }">
            <component :is="Component" :instance="instance" />
          </RouterView>
        </div>
      </div>
    </DtPageState>
  </AppShell>
</template>
