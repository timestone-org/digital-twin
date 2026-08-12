<script setup lang="ts">
/**
 * @fileoverview 接入凭据与 X509 信任白名单——决定「哪台上位机连得进来」。
 *
 * ⚠ 新建凭据的明文口令**只在创建回执里返回一次**，之后任何接口都取不到。
 * 所以它必须当场、显眼地摆出来，并说清关掉就没了。做成一条 toast 一闪而过
 * 的话，用户会失去唯一一次抄走的机会，只能删了重建。
 */
import { onMounted, ref } from 'vue'
import type { OpcuaCredential, OpcuaTrustedCertificate } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
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

const props = defineProps<{ instanceId: string }>()

const toast = useToast()
const confirm = useConfirm()

const credentials = ref<OpcuaCredential[]>([])
const certificates = ref<OpcuaTrustedCertificate[]>([])
const error = ref<string | null>(null)

const credentialFormOpen = ref(false)
const certificateFormOpen = ref(false)
const newUsername = ref('')
const certificatePem = ref('')

/** ⚠ 只此一次的明文口令。非 null 时弹出，用户确认抄走后才清掉。 */
const issuedPassword = ref<{ username: string; password: string } | null>(null)

async function load(): Promise<void> {
  try {
    credentials.value = await opcua.listCredentials(props.instanceId)
    certificates.value = await opcua.listTrustedCertificates(props.instanceId)
    error.value = null
  } catch (caught) {
    error.value = describeError(caught)
  }
}

async function addCredential(): Promise<void> {
  const username = newUsername.value.trim()
  if (username === '') return
  try {
    const created = await opcua.createCredential(props.instanceId, { username })
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
    await opcua.deleteCredential(props.instanceId, credential.id)
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
    await opcua.addTrustedCertificate(props.instanceId, pem)
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
    await opcua.deleteTrustedCertificate(props.instanceId, certificate.id)
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

      <DtEmpty
        v-if="credentials.length === 0"
        title="还没有凭据"
        hint="上位机用用户名口令连接时需要"
      />
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="credential in credentials"
          :key="credential.id"
          class="flex items-center justify-between gap-2 text-xs"
        >
          <span class="font-mono">{{ credential.username }}</span>
          <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              @click="removeCredential(credential)"
            >
              删除
            </DtButton>
          </PermGuard>
        </li>
      </ul>
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

      <DtEmpty
        v-if="certificates.length === 0"
        title="白名单为空"
        hint="只有列在这里的客户端证书才能建立会话"
      />
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="certificate in certificates"
          :key="certificate.id"
          class="flex items-center justify-between gap-2 text-xs"
        >
          <span class="min-w-0">
            <span class="block truncate">{{ certificate.subject }}</span>
            <span class="block truncate font-mono text-2xs text-text-disabled">
              {{ certificate.fingerprint }}
            </span>
          </span>
          <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              @click="removeCertificate(certificate)"
            >
              移除
            </DtButton>
          </PermGuard>
        </li>
      </ul>
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

    <!-- ⚠ 只此一次：用独立弹窗而不是 toast，toast 会自己消失 -->
    <DtModal
      :model-value="issuedPassword !== null"
      title="口令只显示这一次"
      @update:model-value="issuedPassword = null"
    >
      <DtNotice intent="warning" icon="alert-triangle">
        现在就抄走。关掉这个窗口之后，任何接口都取不到它——只能删掉凭据重建。
      </DtNotice>
      <div v-if="issuedPassword" class="mt-3 flex flex-col gap-2 text-xs">
        <div>
          <span class="text-text-disabled">用户名</span>
          <p class="m-0 font-mono">{{ issuedPassword.username }}</p>
        </div>
        <div>
          <span class="text-text-disabled">口令</span>
          <p class="m-0 font-mono text-base">{{ issuedPassword.password }}</p>
        </div>
      </div>
      <template #footer>
        <DtButton @click="issuedPassword = null">我已抄走</DtButton>
      </template>
    </DtModal>
  </div>
</template>
