/**
 * @fileoverview DtInput 的展示：三档尺寸、五种 type、前后插槽与四种状态。
 * 原生属性（placeholder / readonly / maxlength …）经 $attrs 直落 input，不另立 prop。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtIcon, DtInput } from '../src'

const meta = {
  title: '表单/DtInput 文本输入',
  component: DtInput,
  parameters: {
    docs: {
      description: {
        component:
          '文本输入，`v-model` 收字符串，外壳复用 DtField。' +
          'IME 组合输入期间不 emit——不这样做的话，拼音的半成品会一路写进 `v-model`。' +
          '除 `enter` 外还抛 `keystate`（原始 KeyboardEvent），需要监听方向键的场景用它。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    type: {
      control: 'inline-radio',
      options: ['text', 'password', 'email', 'search', 'tel'],
    },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
  },
  args: {
    modelValue: '',
    label: '设备名称',
    hint: '同一条产线内不可重名',
    type: 'text',
    size: 'md',
    disabled: false,
    required: false,
  },
} satisfies Meta<typeof DtInput>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtInput },
    setup() {
      const value = ref('')
      return { args, value }
    },
    template: `
      <div class="sb-w-md">
        <DtInput v-bind="args" v-model="value" placeholder="例如 1 号进料泵" />
        <p class="sb-note">当前取值：{{ value || '（空）' }}</p>
      </div>
    `,
  }),
}

/** 三档尺寸，与同档的按钮、下拉等高。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtInput },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid">
        <DtInput
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          :model-value="'示例文本'"
        />
      </div>
    `,
  }),
}

/** 四种状态：常态、必填、禁用、出错。出错时 hint 让位给 error。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtInput },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid">
        <DtInput v-bind="args" label="常态" model-value="常态取值" />
        <DtInput v-bind="args" label="必填" required model-value="" />
        <DtInput v-bind="args" label="禁用" disabled model-value="不可编辑" />
        <DtInput v-bind="args" label="只读" readonly model-value="只读但可复制" />
        <DtInput
          v-bind="args"
          label="出错"
          required
          model-value="1 号泵"
          error="该名称已被占用"
        />
      </div>
    `,
  }),
}

/** 五种 type。password 只影响原生行为，显隐开关由 trailing 插槽自己搭。 */
export const 输入类型: Story = {
  render: (args) => ({
    components: { DtInput },
    setup: () => ({
      args,
      types: [
        ['text', '普通文本', '一段文字'],
        ['password', '密码', 'super-secret'],
        ['email', '邮箱', 'ops@example.com'],
        ['search', '搜索', '泵'],
        ['tel', '电话', '13800000000'],
      ],
    }),
    template: `
      <div class="sb-grid">
        <DtInput
          v-for="[type, label, value] in types"
          :key="type"
          v-bind="args"
          :type="type"
          :label="label"
          :model-value="value"
          hint=""
        />
      </div>
    `,
  }),
}

/** leading / trailing 插槽：搜索图标、单位后缀、密码显隐开关。 */
export const 前后插槽: Story = {
  render: (args) => ({
    components: { DtButton, DtIcon, DtInput },
    setup() {
      const keyword = ref('')
      const secret = ref('')
      const visible = ref(false)
      return { args, keyword, secret, visible }
    },
    template: `
      <div class="sb-grid">
        <DtInput v-bind="args" v-model="keyword" label="搜索" hint="" placeholder="按名称或点位">
          <template #leading><DtIcon name="search" :size="16" /></template>
        </DtInput>

        <DtInput v-bind="args" label="超时时间" hint="" model-value="30">
          <template #trailing><span class="sb-label">秒</span></template>
        </DtInput>

        <DtInput
          v-bind="args"
          v-model="secret"
          label="密码"
          hint=""
          :type="visible ? 'text' : 'password'"
          placeholder="至少 12 位"
        >
          <template #leading><DtIcon name="lock" :size="16" /></template>
          <template #trailing>
            <DtButton
              variant="ghost"
              intent="neutral"
              size="sm"
              :icon="visible ? 'eye-off' : 'eye'"
              :aria-label="visible ? '隐藏密码' : '显示密码'"
              @click="visible = !visible"
            />
          </template>
        </DtInput>
      </div>
    `,
  }),
}

/** 回车与按键：`enter` 只在非组合输入时抛，中文输入法回车确认候选词不会误触发。 */
export const 回车提交: Story = {
  render: (args) => ({
    components: { DtInput },
    setup() {
      const keyword = ref('')
      const submitted = ref<string[]>([])
      function onEnter(): void {
        if (keyword.value.trim() === '') return
        submitted.value = [keyword.value, ...submitted.value].slice(0, 5)
        keyword.value = ''
      }
      return { args, keyword, submitted, onEnter }
    },
    template: `
      <div class="sb-w-md">
        <DtInput
          v-bind="args"
          v-model="keyword"
          label="按回车提交"
          hint="输入后按 Enter"
          @enter="onEnter"
        />
        <p class="sb-note">已提交：{{ submitted.join('、') || '（还没有）' }}</p>
      </div>
    `,
  }),
}
