/**
 * @fileoverview DtNumberInput 的展示：取值域、步长、小数位、单位、步进键与四种状态。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtNumberInput } from '../src'

const meta = {
  title: '表单/DtNumberInput 数字输入',
  component: DtNumberInput,
  parameters: {
    docs: {
      description: {
        component:
          '数字步进输入，`v-model` 收 `number | undefined`（清空即 undefined）。' +
          '上下限、步长与小数位聚在 `range` 对象里——它们总是一起给。' +
          '归一发生在**落定时**而不是键入时：键入过程中就夹取的话，' +
          '「先删一位再补」会变成不可能。' +
          '⚠ `readonly` 只挡得住键入，步进键与上下方向键是另外两条改值路径，' +
          '组件把它们一并锁住了。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'number' },
    range: { control: 'object', description: '{ min, max, step, precision }' },
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    unit: { control: 'text', description: '右侧单位' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    steppers: { control: 'boolean', description: '关掉 +/- 键，省约 76px' },
  },
  args: {
    modelValue: 1000,
    range: { min: 100, max: 60000, step: 100 },
    label: '采样周期',
    hint: '范围 100–60000',
    unit: 'ms',
    size: 'md',
    disabled: false,
    required: false,
    steppers: true,
  },
} satisfies Meta<typeof DtNumberInput>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup() {
      const value = ref<number | undefined>(1000)
      return { args, value }
    },
    template: `
      <div class="sb-w-md">
        <DtNumberInput v-bind="args" v-model="value" />
        <p class="sb-note">当前取值：{{ value === undefined ? 'undefined（已清空）' : value }}</p>
      </div>
    `,
  }),
}

/** 取值域与步长：越界值在落定时被夹回范围内。 */
export const 取值域与步长: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup() {
      const percent = ref<number | undefined>(50)
      const gain = ref<number | undefined>(1)
      const offset = ref<number | undefined>(0)
      return { args, percent, gain, offset }
    },
    template: `
      <div class="sb-grid">
        <DtNumberInput
          v-bind="args"
          v-model="percent"
          label="开度 0–100 步长 5"
          hint="试着敲 999 再失焦"
          unit="%"
          :range="{ min: 0, max: 100, step: 5 }"
        />
        <DtNumberInput
          v-bind="args"
          v-model="gain"
          label="增益 0.1–10 步长 0.1"
          hint=""
          :unit="undefined"
          :range="{ min: 0.1, max: 10, step: 0.1, precision: 1 }"
        />
        <DtNumberInput
          v-bind="args"
          v-model="offset"
          label="偏置（无上下限）"
          hint="不给 min/max 就不夹"
          :unit="undefined"
          :range="{ step: 1 }"
        />
      </div>
    `,
  }),
}

/** 小数位：`precision` 决定落定后保留几位，键入过程中不动。 */
export const 小数位: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup() {
      const p0 = ref<number | undefined>(3.14159)
      const p2 = ref<number | undefined>(3.14159)
      const p4 = ref<number | undefined>(3.14159)
      return { args, p0, p2, p4 }
    },
    template: `
      <div class="sb-grid">
        <DtNumberInput v-bind="args" v-model="p0" label="precision 0" hint="" :unit="undefined" :range="{ step: 1, precision: 0 }" />
        <DtNumberInput v-bind="args" v-model="p2" label="precision 2" hint="" :unit="undefined" :range="{ step: 0.01, precision: 2 }" />
        <DtNumberInput v-bind="args" v-model="p4" label="precision 4" hint="" :unit="undefined" :range="{ step: 0.0001, precision: 4 }" />
      </div>
    `,
  }),
}

/** 步进键可以关掉：窄栏里两个键要吃掉约 76px，方向键仍然能增减。 */
export const 关掉步进键: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup() {
      const a = ref<number | undefined>(1000)
      const b = ref<number | undefined>(1000)
      return { args, a, b }
    },
    template: `
      <div class="sb-grid">
        <DtNumberInput v-bind="args" v-model="a" label="steppers 开（缺省）" hint="" />
        <DtNumberInput v-bind="args" v-model="b" label="steppers 关" hint="↑↓ 仍可增减" :steppers="false" />
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-grid">
        <DtNumberInput
          v-for="size in sizes"
          :key="size"
          v-bind="args"
          :size="size"
          :label="'size = ' + size"
          hint=""
        />
      </div>
    `,
  }),
}

/** 状态：空值、必填、只读、禁用、出错。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtNumberInput },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid">
        <DtNumberInput v-bind="args" label="空值" hint="清空即 undefined" :model-value="undefined" />
        <DtNumberInput v-bind="args" label="必填" required hint="" :model-value="undefined" />
        <DtNumberInput v-bind="args" label="只读" readonly hint="步进键也一并锁住" />
        <DtNumberInput v-bind="args" label="禁用" disabled hint="" />
        <DtNumberInput v-bind="args" label="出错" hint="" :model-value="30" error="不能低于 100ms" />
      </div>
    `,
  }),
}
