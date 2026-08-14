<script setup lang="ts">
/**
 * @fileoverview 个人资料自服务：我是谁、我有什么权限、改资料与改密码。
 * 后两个动作都不要求任何权限码——它们只作用于自己。
 *
 * 权限一览放在这里而不是工作台：工作台是项目与大屏的操作面，
 * 「这个账号能做什么」属于账号自己的页，两者同框只会互相稀释。
 */
import { computed, onMounted, ref } from 'vue'
import { ERROR_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtInput, DtNotice } from '@dt/ui'

import * as authApi from '@/api/auth'
import { BizError } from '@/api/client'
import { AppShell } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'
import IdentityCard from './components/IdentityCard.vue'
import PermissionCard from './components/PermissionCard.vue'

const auth = useAuthStore()

const roleCodes = computed(() => auth.user?.role_permissions ?? [])
const directCodes = computed(() => auth.user?.direct_permissions ?? [])

const permissionStats = computed(() => [
  { key: 'total', label: '有效权限码', value: auth.permissions.size },
  { key: 'role', label: '来自角色', value: roleCodes.value.length },
  { key: 'direct', label: '单独授予', value: directCodes.value.length },
])

// 权限可能在别处被改过，进页面时对齐一次；失败静默，不阻断渲染
onMounted(() => {
  void auth.syncMe()
})

const profile = ref({
  full_name: auth.user?.full_name ?? '',
  email: auth.user?.email ?? '',
  phone: auth.user?.phone ?? '',
})
const passwords = ref({ current: '', next: '' })

/**
 * ⚠ `ok` 不能省：成功与失败共用同一行文字时，两者只有措辞不同、颜色一样，
 * 「保存失败」看着和「已保存」一个样。
 */
interface FormState {
  busy: boolean
  note: string | null
  ok: boolean
}

const profileState = ref<FormState>({ busy: false, note: null, ok: true })
const passwordState = ref<FormState>({ busy: false, note: null, ok: true })

function describe(caught: unknown, fallback: string): string {
  if (caught instanceof BizError) {
    if (caught.code === ERROR_CODES.invalidCredentials) return '当前密码不正确'
    if (caught.code === ERROR_CODES.conflict) return '该邮箱已被占用'
    if (caught.code === ERROR_CODES.validationFailed) {
      return caught.message || '输入不符合要求'
    }
    return caught.message || fallback
  }
  return fallback
}

async function onSaveProfile(): Promise<void> {
  profileState.value = { busy: true, note: null, ok: true }
  try {
    await authApi.updateMe({
      full_name: profile.value.full_name,
      email: profile.value.email,
      phone: profile.value.phone,
    })
    await auth.syncMe()
    profileState.value = { busy: false, note: '资料已保存', ok: true }
  } catch (caught) {
    profileState.value = {
      busy: false,
      note: describe(caught, '保存失败'),
      ok: false,
    }
  }
}

async function onChangePassword(): Promise<void> {
  passwordState.value = { busy: true, note: null, ok: true }
  try {
    await authApi.changeMyPassword(
      passwords.value.current,
      passwords.value.next,
    )
    passwords.value = { current: '', next: '' }
    passwordState.value = { busy: false, note: '密码已修改', ok: true }
  } catch (caught) {
    passwordState.value = {
      busy: false,
      note: describe(caught, '修改失败'),
      ok: false,
    }
  }
}
</script>

<template>
  <AppShell title="个人资料" subtitle="身份、权限与账号设置">
    <!-- main 不滚了，这一页自己吃满高度并在内部滚 -->
    <div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto pr-1">
      <IdentityCard :user="auth.user" />

      <PermissionCard
        :stats="permissionStats"
        :role-name="auth.user?.role?.name ?? '—'"
        :role-codes="roleCodes"
        :direct-codes="directCodes"
      />

      <div class="grid gap-5 lg:grid-cols-2">
        <DtCard title="个人资料" icon="user" corners>
          <form
            class="flex flex-col items-stretch gap-4"
            @submit.prevent="onSaveProfile"
          >
            <DtInput v-model="profile.full_name" label="姓名" size="lg" />
            <DtInput
              v-model="profile.email"
              label="邮箱"
              type="email"
              size="lg"
              autocomplete="email"
            />
            <DtInput v-model="profile.phone" label="手机号" size="lg" />
            <DtButton type="submit" :loading="profileState.busy">保存</DtButton>
            <DtNotice
              v-if="profileState.note"
              :intent="profileState.ok ? 'success' : 'danger'"
            >
              {{ profileState.note }}
            </DtNotice>
          </form>
        </DtCard>

        <DtCard title="修改密码" icon="key-round" corners>
          <form
            class="flex flex-col items-stretch gap-4"
            @submit.prevent="onChangePassword"
          >
            <DtInput
              v-model="passwords.current"
              label="当前密码"
              type="password"
              size="lg"
              autocomplete="current-password"
            />
            <DtInput
              v-model="passwords.next"
              label="新密码"
              type="password"
              size="lg"
              hint="至少 10 位，且同时包含字母与数字"
              autocomplete="new-password"
            />
            <DtButton type="submit" :loading="passwordState.busy">
              修改密码
            </DtButton>
            <DtNotice
              v-if="passwordState.note"
              :intent="passwordState.ok ? 'success' : 'danger'"
            >
              {{ passwordState.note }}
            </DtNotice>
          </form>
        </DtCard>
      </div>
    </div>
  </AppShell>
</template>
