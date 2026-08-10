<script setup lang="ts">
/**
 * @fileoverview 登录表单：账号口令、大写锁定提示、失败文案与提交。
 * 页面外框与品牌面板在上层，见 pages/Login/index.vue。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ERROR_CODES } from '@dt/contracts'
import { DtButton, DtIcon, DtInput } from '@dt/ui'

import { BizError, TransportError } from '@/api/client'
import { appConfig } from '@/config/app'
import { safeReturnTarget } from '@/router/guards'
import { useAuthStore } from '@/stores/auth'
import LoginMobileBrand from './LoginMobileBrand.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const form = ref({ username: '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const capsOn = ref(false)

const canSubmit = computed(
  () =>
    form.value.username.trim() !== '' &&
    form.value.password !== '' &&
    !loading.value,
)

/** 按错误码归一为登录场景的文案。⚠ 不按 message 分支——文案会改、会翻译。 */
function loginErrorMessage(caught: unknown): string {
  if (caught instanceof BizError) {
    if (caught.code === ERROR_CODES.invalidCredentials) {
      return '用户名或密码错误'
    }
    if (caught.code === ERROR_CODES.accountDisabled) {
      return '账号已停用，请联系管理员'
    }
    if (caught.code === ERROR_CODES.tooManyLoginAttempts) {
      return '登录失败次数过多，请稍后再试'
    }
    return caught.message || '登录失败，请重试'
  }
  if (caught instanceof TransportError) return caught.message
  return '登录失败，请重试'
}

function onCapsCheck(event: KeyboardEvent): void {
  capsOn.value = event.getModifierState?.('CapsLock') ?? false
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) {
    error.value = '请输入用户名和密码'
    return
  }
  error.value = null
  loading.value = true
  try {
    await auth.login(form.value.username.trim(), form.value.password)
    await router.replace(safeReturnTarget(route.query.returnUrl))
  } catch (caught) {
    error.value = loginErrorMessage(caught)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="login-form">
    <LoginMobileBrand />

    <header class="login-form__head dt-animate-fade-up">
      <h1 class="login-form__title">接入控制台</h1>
      <p class="login-form__subtitle">登录以管理项目、大屏与孪生场景</p>
    </header>

    <form class="login-form__form" @submit.prevent="onSubmit">
      <DtInput
        v-model="form.username"
        class="dt-animate-fade-up login-form__field"
        style="--i: 1"
        label="用户名"
        name="username"
        autocomplete="username"
        placeholder="请输入用户名"
        size="lg"
        @keystate="onCapsCheck"
      >
        <template #leading><DtIcon name="user" :size="16" /></template>
      </DtInput>

      <div
        class="login-form__password dt-animate-fade-up login-form__field"
        style="--i: 2"
      >
        <DtInput
          v-model="form.password"
          label="密码"
          name="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="请输入密码"
          size="lg"
          @keystate="onCapsCheck"
        >
          <template #leading><DtIcon name="lock" :size="16" /></template>
          <template #trailing>
            <button
              type="button"
              class="login-form__reveal"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              tabindex="-1"
              @click="showPassword = !showPassword"
            >
              <DtIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
            </button>
          </template>
        </DtInput>
        <span v-if="capsOn" class="login-form__caps">
          <DtIcon name="alert-triangle" :size="12" /> 大写锁定已开启
        </span>
      </div>

      <!-- role=alert：登录失败必须对读屏可感知，否则用户分不清「失败」与「按钮没响应」 -->
      <p v-if="error" class="login-form__error" role="alert">
        <DtIcon name="alert-circle" :size="14" />
        <span>{{ error }}</span>
      </p>

      <DtButton
        type="submit"
        size="lg"
        block
        :loading="loading"
        :disabled="!canSubmit"
        icon-right="arrow-right"
        class="login-form__submit dt-animate-fade-up login-form__field"
        style="--i: 3"
      >
        {{ loading ? '登录中…' : '登 录' }}
      </DtButton>
    </form>

    <footer
      class="login-form__foot dt-animate-fade-up login-form__field"
      style="--i: 4"
    >
      <span class="login-form__foot-safe">
        <DtIcon name="shield" :size="13" />
        安全加密连接
      </span>
      <span>© {{ appConfig.name }}</span>
    </footer>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.login-form {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40px 28px;

  @include t.from(t.$bp-sm) {
    padding: 40px;
  }

  &__head {
    margin-bottom: 28px;
  }

  &__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--text-primary);
  }

  &__subtitle {
    margin: 6px 0 0;
    font-size: 14px;
    color: var(--text-secondary);
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  // 入场交错：延时挂在类上，模板里不写内联样式
  // 入场依次错开：只差延时的四个类合成一个，序号由 --i 给
  &__field {
    animation-delay: calc(var(--i) * 60ms);
  }

  &__password {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__reveal {
    display: inline-flex;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-disabled);
    cursor: pointer;
    transition: color 0.18s ease;

    &:hover {
      color: var(--accent-primary);
    }
  }

  &__caps {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--state-warning);
  }

  &__error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid rgba(var(--state-danger-rgb), 0.4);
    border-radius: var(--radius-md);
    background: rgba(var(--state-danger-rgb), 0.08);
    font-size: 12px;
    color: var(--state-danger);
  }

  &__submit {
    margin-top: 4px;
    letter-spacing: 0.2em;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
    font-size: 11px;
    color: var(--text-disabled);
  }

  &__foot-safe {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: rgba(var(--accent-primary-rgb), 0.6);
  }
}
</style>
