/**
 * @fileoverview DtRadio 的展示：单个圆点的选中 / 未选 / 禁用与三档尺寸。
 * ⚠ 单独用它不构成一组——方向键导航与 roving tabindex 都在 DtRadioGroup 里。
 */
import { ref } from 'vue'
import { DT_SIZES } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtRadio } from '../src'

const meta = {
  title: '表单/DtRadio 单选圆点',
  component: DtRadio,
  parameters: {
    docs: {
      description: {
        component:
          '一个单选圆点。选中态由父组件下发（`checked`），自己不持状态，' +
          '被点时只抛 `select`。' +
          '⚠ 日常请直接用 **DtRadioGroup**：一组单选的键盘契约（方向键在可用项之间' +
          '环绕移动并即时选中、组内只有一项能被 Tab 进入）在组件里，' +
          '自己拿若干个 DtRadio 摆一排是拿不到这些的。',
      },
    },
  },
  argTypes: {
    value: { control: 'text', description: '本项的取值，被点时原样抛出' },
    checked: { control: 'boolean', description: '选中态，由父组件下发' },
    label: { control: 'text' },
    size: { control: 'inline-radio', options: DT_SIZES },
    disabled: { control: 'boolean' },
    tabindex: {
      control: 'number',
      description: 'roving tabindex：组内只有一项是 0，其余 -1',
    },
  },
  args: {
    value: 'pull',
    checked: true,
    label: '主动轮询',
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof DtRadio>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtRadio },
    setup() {
      const picked = ref('pull')
      return { args, picked }
    },
    template: `
      <DtRadio v-bind="args" :checked="picked === args.value" @select="picked = $event" />
    `,
  }),
}

/** 四种组合：选中 / 未选 × 可用 / 禁用。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtRadio },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <DtRadio v-bind="args" :checked="true" label="选中" />
        <DtRadio v-bind="args" :checked="false" label="未选" />
        <DtRadio v-bind="args" :checked="true" disabled label="选中 · 禁用" />
        <DtRadio v-bind="args" :checked="false" disabled label="未选 · 禁用" />
      </div>
    `,
  }),
}

/** 三档尺寸。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtRadio },
    setup: () => ({ args, sizes: DT_SIZES }),
    template: `
      <div class="sb-row">
        <DtRadio
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
