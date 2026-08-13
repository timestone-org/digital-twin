/**
 * @fileoverview DtRadioGroup 的展示：横竖两种排布、禁用项、整组禁用与出错态。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { DtRadioOption } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtRadioGroup } from '../src'

const MODES: DtRadioOption[] = [
  { value: 'pull', label: '主动轮询' },
  { value: 'push', label: '订阅推送' },
  { value: 'hybrid', label: '混合（先订阅，断了退回轮询）' },
  { value: 'manual', label: '手动触发（需要边缘网关 ≥ 2.4）', disabled: true },
]

const meta = {
  title: '表单/DtRadioGroup 单选组',
  component: DtRadioGroup,
  parameters: {
    docs: {
      description: {
        component:
          '一组单选，`v-model` 收字符串，外壳复用 DtField。' +
          '键盘契约：方向键在**可用项**之间环绕移动并即时选中，组内只有一项能被 ' +
          'Tab 进入（roving tabindex）。' +
          '⚠ 导航起点取当前焦点所在项而不是 `modelValue` 推出来的位置——' +
          '父组件拒绝或异步回写时两者会脱节，焦点会卡在原地反复抛同一个值。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean', description: '整组禁用' },
    required: { control: 'boolean' },
    orientation: {
      control: 'inline-radio',
      options: ['vertical', 'horizontal'],
    },
    ariaLabel: { control: 'text', description: '可见标签在别处时用它命名整组' },
  },
  args: {
    modelValue: 'pull',
    options: MODES,
    label: '采集方式',
    hint: '订阅推送需要设备侧支持',
    size: 'md',
    disabled: false,
    required: false,
    orientation: 'vertical',
  },
} satisfies Meta<typeof DtRadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtRadioGroup },
    setup() {
      const mode = ref('pull')
      return { args, mode }
    },
    template: `
      <div class="sb-w-md">
        <DtRadioGroup v-bind="args" v-model="mode" />
        <p class="sb-note">当前取值：{{ mode }}</p>
      </div>
    `,
  }),
}

/** 竖排（缺省）与横排。选项文案长的一律竖排，横排会挤成两行。 */
export const 排布方向: Story = {
  render: (args) => ({
    components: { DtRadioGroup },
    setup() {
      const a = ref('pull')
      const b = ref('push')
      const short: DtRadioOption[] = [
        { value: 'pull', label: '轮询' },
        { value: 'push', label: '推送' },
        { value: 'hybrid', label: '混合' },
      ]
      return { args, a, b, short }
    },
    template: `
      <div class="sb-col">
        <div class="sb-group sb-w-md">
          <p class="sb-group__title">vertical（缺省）</p>
          <DtRadioGroup v-bind="args" v-model="a" :label="undefined" hint="" />
        </div>
        <div class="sb-group sb-w-md">
          <p class="sb-group__title">horizontal</p>
          <DtRadioGroup
            v-bind="args"
            v-model="b"
            :label="undefined"
            hint=""
            orientation="horizontal"
            :options="short"
          />
        </div>
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtRadioGroup },
    setup: () => ({
      args,
      sizes: DT_SIZES,
      short: [
        { value: 'pull', label: '轮询' },
        { value: 'push', label: '推送' },
      ] as DtRadioOption[],
    }),
    template: `
      <div class="sb-grid">
        <DtRadioGroup
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          hint=""
          :options="short"
          orientation="horizontal"
        />
      </div>
    `,
  }),
}

/** 状态：含禁用项、整组禁用、必填未选、出错。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtRadioGroup },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtRadioGroup v-bind="args" label="含禁用项" hint="方向键会跳过最后一项" />
        <DtRadioGroup v-bind="args" label="整组禁用" disabled hint="" />
        <DtRadioGroup v-bind="args" label="必填未选" required model-value="" hint="" />
        <DtRadioGroup
          v-bind="args"
          label="出错"
          required
          model-value=""
          hint=""
          error="请选择一种采集方式"
        />
      </div>
    `,
  }),
}
