/** @fileoverview 通用折叠分区的初始折叠与受控展开示例。 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { DtDisclosure, DtInput } from '../src'

const meta = {
  title: '布局/DtDisclosure 折叠分区',
  component: DtDisclosure,
  args: { title: '高级参数', defaultOpen: false },
} satisfies Meta<typeof DtDisclosure>

export default meta
type Story = StoryObj<typeof meta>

export const 默认折叠: Story = {
  render: (args) => ({
    components: { DtDisclosure, DtInput },
    setup: () => ({ args }),
    template:
      '<DtDisclosure v-bind="args"><DtInput label="名称" model-value="参数配置" /></DtDisclosure>',
  }),
}

export const 受控展开: Story = {
  render: (args) => ({
    components: { DtDisclosure, DtInput },
    setup: () => ({ args, open: ref(true) }),
    template:
      '<DtDisclosure v-bind="args" v-model:open="open" unmount-on-close><DtInput label="名称" model-value="参数配置" /></DtDisclosure>',
  }),
}
