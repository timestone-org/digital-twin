/** @fileoverview 可调整布局的多栏、上下区块和响应式示例。 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtCard, DtResizableLayout } from '../src'

const meta = {
  title: '布局/DtResizableLayout 可调整区块',
  component: DtResizableLayout,
  args: {
    panes: [
      { id: 'outline', label: '大纲', size: 20 },
      { id: 'canvas', label: '画布', size: 55 },
      { id: 'inspector', label: '检查器', size: 25 },
    ],
    label: '编辑器布局',
    stackAt: 700,
    storageKey: 'dt.resizable-demo.layout',
  },
} satisfies Meta<typeof DtResizableLayout>
export default meta
type Story = StoryObj<typeof meta>

export const 多区块: Story = {
  render: (args) => ({
    components: { DtResizableLayout, DtCard },
    setup: () => ({
      args,
      nestedPanes: [
        { id: 'stage', label: '画布', size: 3, minSize: 100 },
        { id: 'diagnostics', label: '诊断', size: 1, minSize: 80 },
      ],
    }),
    template: `<div style="width: 100%; height: 480px"><DtResizableLayout v-bind="args"><template #outline><DtCard title="大纲">拖动分隔线调整宽高。</DtCard></template><template #canvas><DtResizableLayout :panes="nestedPanes" direction="vertical" storage-key="dt.resizable-demo.diagnostics" label="画布与诊断"><template #stage><DtCard title="画布">拖动左右分隔线调整宽度，拖动下方分隔线调整高度。窄屏会自动上下排列。</DtCard></template><template #diagnostics><DtCard title="诊断">调整后的比例会自动保存在当前浏览器。双击分隔线可复位。</DtCard></template></DtResizableLayout></template><template #inspector><DtCard title="检查器">方向键微调，Shift 加速；双击或 Enter 复位。</DtCard></template></DtResizableLayout></div>`,
  }),
}
export const 上下区块: Story = {
  ...多区块,
  args: {
    direction: 'vertical',
    stackAt: 0,
    panes: [
      { id: 'canvas', label: '画布', size: 3 },
      { id: 'inspector', label: '诊断', size: 1 },
    ],
  },
}
