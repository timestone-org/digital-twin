/**
 * @fileoverview DtSlider 的展示：取值域、步长、单位、数值读出与三档尺寸。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtSlider } from '../src'

const meta = {
  title: '表单/DtSlider 滑块',
  component: DtSlider,
  parameters: {
    docs: {
      description: {
        component:
          '滑块，`v-model` 收数字。底子是原生 `<input type="range">`——' +
          '用原生件是为了白拿键盘操作与读屏语义，自己画一个必然两样都缺。' +
          '轨道的填充比例跟着取值走；⚠ 非有限值算出的 `NaN%` 会让整条渐变作废、' +
          '轨道变全透明，所以组件对非有限值一律按 0 处理。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'number' },
    range: {
      control: 'object',
      description: '{ min, max, step }；缺省 0–100 步长 1',
    },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    unit: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    showValue: { control: 'boolean', description: '右侧数值读出' },
  },
  args: {
    modelValue: 60,
    label: '阀门开度',
    unit: '%',
    size: 'md',
    disabled: false,
    required: false,
    showValue: true,
  },
} satisfies Meta<typeof DtSlider>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtSlider },
    setup() {
      const value = ref(60)
      return { args, value }
    },
    template: `
      <div class="sb-w-md">
        <DtSlider v-bind="args" v-model="value" />
        <p class="sb-note">当前取值：{{ value }}</p>
      </div>
    `,
  }),
}

/** 不同取值域与步长；不给 `range` 就是 0–100 步长 1。 */
export const 取值域与步长: Story = {
  render: (args) => ({
    components: { DtSlider },
    setup() {
      const a = ref(60)
      const b = ref(2.5)
      const c = ref(750)
      return { args, a, b, c }
    },
    template: `
      <div class="sb-col sb-w-lg">
        <DtSlider v-bind="args" v-model="a" label="缺省 0–100 步长 1" />
        <DtSlider
          v-bind="args"
          v-model="b"
          label="0–5 步长 0.5"
          unit=" 倍"
          :range="{ min: 0, max: 5, step: 0.5 }"
        />
        <DtSlider
          v-bind="args"
          v-model="c"
          label="0–3000 步长 50"
          unit=" rpm"
          :range="{ min: 0, max: 3000, step: 50 }"
        />
      </div>
    `,
  }),
}

/** 数值读出可以关掉：读数已经画在别处（比如大屏读数牌）时不必重复。 */
export const 数值读出: Story = {
  render: (args) => ({
    components: { DtSlider },
    setup() {
      const a = ref(40)
      const b = ref(40)
      return { args, a, b }
    },
    template: `
      <div class="sb-col sb-w-lg">
        <DtSlider v-bind="args" v-model="a" label="showValue 开（缺省）" />
        <DtSlider v-bind="args" v-model="b" label="showValue 关" :show-value="false" />
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtSlider },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtSlider
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
        />
      </div>
    `,
  }),
}

/** 状态：必填、禁用、出错，以及两端极值。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtSlider },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtSlider v-bind="args" label="最小值" :model-value="0" />
        <DtSlider v-bind="args" label="最大值" :model-value="100" />
        <DtSlider v-bind="args" label="必填" required hint="拖到 0 以外" />
        <DtSlider v-bind="args" label="禁用" disabled />
        <DtSlider v-bind="args" label="出错" :model-value="95" error="超过安全开度 90%" />
      </div>
    `,
  }),
}
