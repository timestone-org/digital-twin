/**
 * @fileoverview DtSwitch 的展示：三档尺寸、开关两态、禁用与无可见标签的写法。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtSwitch } from '../src'

const meta = {
  title: '表单/DtSwitch 开关',
  component: DtSwitch,
  parameters: {
    docs: {
      description: {
        component:
          '开关，`v-model` 收布尔值。' +
          '⚠ 它表示的是「立刻生效的开 / 关」——拨一下就该真的去写；' +
          '待提交的选项用 DtCheckbox。' +
          '没有可见标签时必须给 `ariaLabel`，否则读屏只会读出一个「switch」。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'boolean' },
    label: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    ariaLabel: { control: 'text', description: '无可见 label 时必须给' },
  },
  args: { modelValue: true, label: '自动重连', size: 'md', disabled: false },
} satisfies Meta<typeof DtSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtSwitch },
    setup() {
      const on = ref(true)
      return { args, on }
    },
    template: `
      <div class="sb-col">
        <DtSwitch v-bind="args" v-model="on" />
        <p class="sb-note">当前：{{ on ? '开' : '关' }}</p>
      </div>
    `,
  }),
}

/** 三档尺寸，与同档的输入控件同高。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtSwitch },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-row">
        <DtSwitch
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

/** 四种组合：开 / 关 × 可用 / 禁用。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtSwitch },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <DtSwitch v-bind="args" :model-value="true" label="开" />
        <DtSwitch v-bind="args" :model-value="false" label="关" />
        <DtSwitch v-bind="args" :model-value="true" disabled label="开 · 禁用" />
        <DtSwitch v-bind="args" :model-value="false" disabled label="关 · 禁用" />
      </div>
    `,
  }),
}

/** 无可见标签：标签由左侧文字承担时，开关自己要带 `aria-label`。 */
export const 无可见标签: Story = {
  render: (args) => ({
    components: { DtSwitch },
    setup() {
      const rows = ref([
        { id: 'ch-01', name: '通道 01 · 温度', on: true },
        { id: 'ch-02', name: '通道 02 · 压力', on: false },
        { id: 'ch-03', name: '通道 03 · 流量', on: true },
      ])
      return { args, rows }
    },
    template: `
      <div class="sb-col sb-w-md">
        <div v-for="row in rows" :key="row.id" class="sb-row" style="justify-content: space-between; width: 100%">
          <span class="sb-label">{{ row.name }}</span>
          <DtSwitch
            v-bind="args"
            v-model="row.on"
            :label="undefined"
            :aria-label="row.name + ' 采集开关'"
          />
        </div>
      </div>
    `,
  }),
}
