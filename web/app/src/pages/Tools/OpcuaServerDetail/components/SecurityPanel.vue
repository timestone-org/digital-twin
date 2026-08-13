<script setup lang="ts">
/**
 * @fileoverview 接入凭据与 X509 信任白名单——决定「哪台上位机连得进来」。
 *
 * ⚠ 新建凭据的明文口令**只在创建回执里返回一次**，接住它的是
 * `IssuedPasswordDialog`——那里说清了为什么不能用 toast。
 *
 * 两张表用 `DtDataView` 而不是手写 `<ul>`：与系统管理各页同一套空态与表格
 * 样式。这里关掉视图切换器——两张小表各摆一个切换器只是噪音。
 */
import { onMounted, ref } from 'vue'

import type {
  DtDataColumn,
  DtDataViewMode,
  OpcuaCredential,
  OpcuaInstance,
  OpcuaTrustedCertificate,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtDataView,
  DtField,
  DtInput,
  DtModal,
  DtNotice,
  DtTextarea,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import IssuedPasswordDialog from './IssuedPasswordDialog.vue'

const props = defineProps<{ instance: OpcuaInstance }>()

const toast = useToast()
const confirm = useConfirm()

const CREDENTIAL_COLUMNS: readonly DtDataColumn[] = [
  { key: 'username', label: '用户名' },
  { key: 'actions', label: '操作', align: 'right', width: '6rem' },
]

const CERTIFICATE_COLUMNS: readonly DtDataColumn[] = [
  { key: 'subject', label: '主体' },
  { key: 'fingerprint', label: '指纹' },
  { key: 'actions', label: '操作', align: 'right', width: '6rem' },
]

const credentials = ref<OpcuaCredential[]>([])
const certificates = ref<OpcuaTrustedCertificate[]>([])
const error = ref<string | null>(null)
// 两张小表只用表格视图，切换器关掉——见文件头
const tableOnly = ref<DtDataViewMode>('table')

const credentialFormOpen = ref(false)
const certificateFormOpen = ref(false)
const newUsername = ref('')
const certificatePem = ref('')

/** ⚠ 只此一次的明文口令。非 null 时弹出，用户确认抄走后才清掉。 */
const issuedPassword = ref<{ username: string; password: string } | null>(null)

async function load(): Promise<void> {
  try {
    credentials.value = await opcua.listCredentials(props.instance.id)
    certificates.value = await opcua.listTrustedCertificates(props.instance.id)
    error.value = null
  } catch (caught) {
    error.value = describeError(caught)
  }
}

async function addCredential(): Promise<void> {
  const username = newUsername.value.trim()
  if (username === '') return
  try {
    const created = await opcua.createCredential(props.instance.id, {
      username,
    })
    credentialFormOpen.value = false
    newUsername.value = ''
    issuedPassword.value = {
      username: created.credential.username,
      password: created.password,
    }
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function removeCredential(credential: OpcuaCredential): Promise<void> {
  const ok = await confirm.ask({
    title: '删除凭据',
    message: `用「${credential.username}」连接的上位机将无法再建立新会话。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await opcua.deleteCredential(props.instance.id, credential.id)
    toast.success('凭据已删除')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function addCertificate(): Promise<void> {
  const pem = certificatePem.value.trim()
  if (pem === '') return
  try {
    await opcua.addTrustedCertificate(props.instance.id, pem)
    certificateFormOpen.value = false
    certificatePem.value = ''
    toast.success('证书已加入白名单')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function removeCertificate(
  certificate: OpcuaTrustedCertificate,
): Promise<void> {
  const ok = await confirm.ask({
    title: '移出白名单',
    message: `持有该证书的上位机将无法再建立新会话（${certificate.subject}）。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  try {
    await opcua.deleteTrustedCertificate(props.instance.id, certificate.id)
    toast.success('证书已移出白名单')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <DtNotice v-if="error" intent="danger" icon="alert-triangle">
      {{ error }}
    </DtNotice>

    <DtCard>
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="m-0 text-sm font-medium">接入凭据（UserName）</h3>
        <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
          <DtButton
            size="sm"
            variant="outline"
            icon="plus"
            @click="credentialFormOpen = true"
          >
            新建凭据
          </DtButton>
        </PermGuard>
      </div>

      <DtDataView
        v-model:view="tableOnly"
        :columns="CREDENTIAL_COLUMNS"
        :rows="credentials"
        :layout="{ toggle: false, fill: false, minWidth: '24rem' }"
        :empty="{
          title: '还没有凭据',
          hint: '上位机用用户名口令连接时需要',
        }"
      >
        <template #cell-username="{ row }">
          <span class="font-mono text-xs">{{ row.username }}</span>
        </template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              @click="removeCredential(row)"
            >
              删除
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
    </DtCard>

    <DtCard>
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="m-0 text-sm font-medium">信任证书（X509）</h3>
        <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
          <DtButton
            size="sm"
            variant="outline"
            icon="plus"
            @click="certificateFormOpen = true"
          >
            添加证书
          </DtButton>
        </PermGuard>
      </div>

      <DtDataView
        v-model:view="tableOnly"
        :columns="CERTIFICATE_COLUMNS"
        :rows="certificates"
        :layout="{ toggle: false, fill: false, minWidth: '32rem' }"
        :empty="{
          title: '白名单为空',
          hint: '只有列在这里的客户端证书才能建立会话',
        }"
      >
        <template #cell-subject="{ row }">
          <span class="truncate">{{ row.subject }}</span>
        </template>
        <template #cell-fingerprint="{ row }">
          <span class="font-mono text-2xs text-text-disabled">
            {{ row.fingerprint }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              @click="removeCertificate(row)"
            >
              移除
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
    </DtCard>

    <DtModal v-model="credentialFormOpen" title="新建接入凭据">
      <DtNotice intent="warning" icon="alert-triangle">
        口令由服务端生成，创建后只显示这一次，关掉就再也取不回来。
      </DtNotice>
      <DtField label="用户名" required>
        <DtInput v-model="newUsername" placeholder="scada-01" />
      </DtField>
      <template #footer>
        <DtButton variant="ghost" @click="credentialFormOpen = false">
          取消
        </DtButton>
        <DtButton :disabled="newUsername.trim() === ''" @click="addCredential">
          创建
        </DtButton>
      </template>
    </DtModal>

    <DtModal v-model="certificateFormOpen" title="添加信任证书">
      <DtField label="证书 PEM" required>
        <DtTextarea v-model="certificatePem" :rows="8" />
      </DtField>
      <template #footer>
        <DtButton variant="ghost" @click="certificateFormOpen = false">
          取消
        </DtButton>
        <DtButton
          :disabled="certificatePem.trim() === ''"
          @click="addCertificate"
        >
          添加
        </DtButton>
      </template>
    </DtModal>

    <IssuedPasswordDialog
      :issued="issuedPassword"
      @close="issuedPassword = null"
    />
  </div>
</template>
