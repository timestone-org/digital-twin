<script setup lang="ts">
/**
 * @fileoverview 个人资料自服务：我是谁、我有什么权限、改资料与改密码。
 * 后两个动作都不要求任何权限码——它们只作用于自己。
 *
 * 权限一览放在这里而不是工作台：工作台是项目与大屏的操作面，
 * 「这个账号能做什么」属于账号自己的页，两者同框只会互相稀释。
 */
import { computed, onMounted, ref, watch, type Ref } from 'vue'
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

interface ProfileDraft {
  full_name: string
  email: string
  phone: string
}

function seedProfile(): ProfileDraft {
  return {
    full_name: auth.user?.full_name ?? '',
    email: auth.user?.email ?? '',
    phone: auth.user?.phone ?? '',
  }
}

let lastSeed = seedProfile()
const profile = ref<ProfileDraft>({ ...lastSeed })

/** 表单没被动过才用最新的用户资料回填，免得把缓存里的旧值整份写回服务端。 */
function reseedIfPristine(): void {
  const current = profile.value
  const pristine =
    current.full_name === lastSeed.full_name &&
    current.email === lastSeed.email &&
    current.phone === lastSeed.phone
  lastSeed = seedProfile()
  if (pristine) profile.value = { ...lastSeed }
}

// 资料与权限可能在别处被改过，进页面时对齐一次；失败静默，不阻断渲染
onMounted(async () => {
  await auth.syncMe()
  reseedIfPristine()
})
const passwords = ref({ current: '', next: '', confirm: '' })

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

/**
 * 一动表单就收掉上一次的成功提示：「已保存」一直挂着会让人以为改了一半的也存上了。
 * ⚠ 比的是「出结果那一刻」的表单快照：成功后程序自己清空/回填表单也会触发侦听，
 * 不比快照的话结果一出来就被自己抹掉。
 */
function clearNoteOnEdit<T>(form: Ref<T>, state: Ref<FormState>): void {
  let shown = ''
  watch(
    () => [JSON.stringify(form.value), state.value.note] as const,
    ([now, note], before) => {
      if (note !== before?.[1]) {
        shown = now
        return
      }
      // 只收成功提示；失败原因留到下一次提交，免得一回填就把错因抹了
      if (note !== null && state.value.ok && now !== shown) {
        state.value.note = null
      }
    },
  )
}

clearNoteOnEdit(profile, profileState)
clearNoteOnEdit(passwords, passwordState)

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
    lastSeed = { ...profile.value }
    await auth.syncMe()
    reseedIfPristine()
    profileState.value = { busy: false, note: '资料已保存', ok: true }
  } catch (caught) {
    profileState.value = {
      busy: false,
      note: describe(caught, '保存失败'),
      ok: false,
    }
  }
}

/** 提交前在本地就能判的两条：两次新密码一致、新旧不同。 */
function passwordProblem(): string | null {
  const { current, next, confirm } = passwords.value
  if (next !== confirm) return '两次输入的新密码不一致'
  if (next !== '' && next === current) return '新密码不能与当前密码相同'
  return null
}

async function onChangePassword(): Promise<void> {
  const problem = passwordProblem()
  if (problem !== null) {
    passwordState.value = { busy: false, note: problem, ok: false }
    return
  }
  passwordState.value = { busy: true, note: null, ok: true }
  try {
    await authApi.changeMyPassword(
      passwords.value.current,
      passwords.value.next,
    )
    passwords.value = { current: '', next: '', confirm: '' }
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
          <!-- novalidate：邮箱格式交给服务端判，回中文原因；浏览器自带的英文气泡不一致 -->
          <form
            class="flex flex-col items-stretch gap-4"
            novalidate
            @submit.prevent="onSaveProfile"
          >
            <DtInput v-model="profile.full_name" label="姓名" size="sm" />
            <DtInput
              v-model="profile.email"
              label="邮箱"
              type="email"
              size="sm"
              autocomplete="email"
            />
            <DtInput v-model="profile.phone" label="手机号" size="sm" />
            <DtButton
              type="submit"
              class="self-start"
              :loading="profileState.busy"
            >
              保存
            </DtButton>
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
              size="sm"
              autocomplete="current-password"
            />
            <DtInput
              v-model="passwords.next"
              label="新密码"
              type="password"
              size="sm"
              hint="至少 10 位，且同时包含字母与数字"
              autocomplete="new-password"
            />
            <DtInput
              v-model="passwords.confirm"
              label="确认新密码"
              type="password"
              size="sm"
              autocomplete="new-password"
            />
            <DtButton
              type="submit"
              class="self-start"
              :loading="passwordState.busy"
            >
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
