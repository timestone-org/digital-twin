/**
 * @fileoverview DtCheckbox 的展示：勾选态、禁用、label 与默认插槽两种写法。
 */
import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtCheckbox } from '../src'

const meta = {
  title: '表单/DtCheckbox 勾选框',
  component: DtCheckbox,
  parameters: {
    docs: {
      description: {
        component:
          '勾选框，`v-model` 收布尔值。底子是原生 `<input type="checkbox">`，' +
          '键盘与读屏语义白拿，视觉靠伪元素叠加。' +
          '⚠ 它表示的是「待提交的选项」；点了就立刻生效的开关用 DtSwitch。' +
          '文案既可以走 `label` prop，也可以走默认插槽（需要塞链接或标签时用后者）。',
      },
    },
  },
  argTypes: {
    modelValue: { control: 'boolean' },
    label: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: { modelValue: true, label: '导出时包含历史数据', disabled: false },
} satisfies Meta<typeof DtCheckbox>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtCheckbox },
    setup() {
      const checked = ref(true)
      return { args, checked }
    },
    template: `<DtCheckbox v-bind="args" v-model="checked" />`,
  }),
}

/** 四种组合：勾选 / 未勾选 × 可用 / 禁用。 */
export const 状态: Story = {
  render: (args) => ({
    components: { DtCheckbox },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <DtCheckbox v-bind="args" :model-value="true" label="已勾选" />
        <DtCheckbox v-bind="args" :model-value="false" label="未勾选" />
        <DtCheckbox v-bind="args" :model-value="true" disabled label="已勾选 · 禁用" />
        <DtCheckbox v-bind="args" :model-value="false" disabled label="未勾选 · 禁用" />
      </div>
    `,
  }),
}

/** 默认插槽：文案里要放链接、标签或强调时用它，`label` 就不给了。 */
export const 插槽文案: Story = {
  render: (args) => ({
    components: { DtCheckbox },
    setup() {
      const agreed = ref(false)
      return { args, agreed }
    },
    template: `
      <DtCheckbox v-bind="args" v-model="agreed" :label="undefined">
        我已阅读并同意
        <a href="#" @click.prevent>《数据留存策略》</a>
      </DtCheckbox>
    `,
  }),
}

/** 一组多选：常见的「全选 + 子项」结构，全选态由调用方自己算。 */
export const 多选组: Story = {
  render: (args) => ({
    components: { DtCheckbox },
    setup() {
      const options = ['温度', '压力', '流量', '转速']
      const picked = ref<string[]>(['温度', '流量'])
      function toggle(name: string, on: boolean): void {
        picked.value = on
          ? [...picked.value, name]
          : picked.value.filter((item) => item !== name)
      }
      function toggleAll(on: boolean): void {
        picked.value = on ? [...options] : []
      }
      return { args, options, picked, toggle, toggleAll }
    },
    template: `
      <div class="sb-col">
        <DtCheckbox
          v-bind="args"
          :model-value="picked.length === options.length"
          label="全选"
          @update:model-value="toggleAll"
        />
        <div class="sb-col" style="padding-left: 20px">
          <DtCheckbox
            v-for="name in options"
            :key="name"
            v-bind="args"
            :model-value="picked.includes(name)"
            :label="name"
            @update:model-value="(on) => toggle(name, on)"
          />
        </div>
        <p class="sb-note">已选：{{ picked.join('、') || '（无）' }}</p>
      </div>
    `,
  }),
}
