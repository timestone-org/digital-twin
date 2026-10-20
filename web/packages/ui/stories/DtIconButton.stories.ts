/** @fileoverview 常见图标操作的工具栏、禁用与加载状态。 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtIconButton } from '../src'

const meta = {
  title: '通用/DtIconButton 图标按钮',
  component: DtIconButton,
  args: { icon: 'plus', label: '添加点位' },
  argTypes: {
    label: { control: 'text' },
    tooltip: { control: 'text' },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    variant: {
      control: 'inline-radio',
      options: ['ghost', 'soft', 'outline', 'solid'],
    },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
} satisfies Meta<typeof DtIconButton>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtIconButton },
    setup: () => ({ args }),
    template: '<DtIconButton v-bind="args" />',
  }),
}

export const 常用操作: Story = {
  render: () => ({
    components: { DtIconButton },
    template: `
      <div class="sb-col">
        <div class="sb-row" role="group" aria-label="编辑操作">
          <DtIconButton icon="undo" label="撤销" />
          <DtIconButton icon="redo" label="重做" disabled />
          <DtIconButton icon="plus" label="添加点位" variant="solid" intent="primary" />
          <DtIconButton icon="pencil" label="编辑" />
          <DtIconButton icon="copy" label="复制" />
          <DtIconButton icon="trash" label="删除" intent="danger" />
          <DtIconButton icon="save" label="保存" variant="solid" intent="primary" />
        </div>
        <div class="sb-row" role="group" aria-label="视图与文件操作">
          <DtIconButton icon="refresh-cw" label="刷新" loading />
          <DtIconButton icon="eye" label="预览" />
          <DtIconButton icon="focus" label="定位选中" />
          <DtIconButton icon="zoom-in" label="放大" />
          <DtIconButton icon="zoom-out" label="缩小" />
          <DtIconButton icon="upload" label="导入 CSV" />
          <DtIconButton icon="download" label="导出 CSV" />
          <DtIconButton icon="arrow-up" label="上移" />
          <DtIconButton icon="arrow-down" label="下移" />
        </div>
      </div>
    `,
  }),
}
