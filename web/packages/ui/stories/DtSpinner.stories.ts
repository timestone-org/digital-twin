/**
 * @fileoverview DtSpinner 的展示：尺寸、可访问名称与三种常见摆法。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtCard, DtSpinner } from '../src'

const meta = {
  title: '反馈/DtSpinner 加载指示',
  component: DtSpinner,
  parameters: {
    docs: {
      description: {
        component:
          '转圈的加载指示。`label` 只给读屏用，视觉上是隐藏的——' +
          '不给的话读屏遇到它只会跳过，用户不知道页面在忙。' +
          '按钮内部的加载态不必自己摆它：`DtButton` 的 `loading` 已经内建。' +
          '整块区域的取数三态用 DtPageState，它内部也用的是这个组件。',
      },
    },
  },
  argTypes: {
    size: { control: { type: 'range', min: 12, max: 64, step: 2 } },
    label: { control: 'text', description: '读屏读出的文案，视觉隐藏' },
  },
  args: { size: 20, label: '加载中' },
} satisfies Meta<typeof DtSpinner>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {}

/** 尺寸：正文里 16–20，区块中央 28–36，整页 48 以上。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtSpinner },
    setup: () => ({ args, sizes: [16, 20, 28, 36, 48, 64] }),
    template: `
      <div class="sb-row">
        <div v-for="size in sizes" :key="size" class="sb-col">
          <DtSpinner v-bind="args" :size="size" />
          <span class="sb-label">{{ size }}px</span>
        </div>
      </div>
    `,
  }),
}

/** 三种摆法：跟在文字后、区块中央、按钮内部（后者由 DtButton 自己给）。 */
export const 常见摆法: Story = {
  render: (args) => ({
    components: { DtButton, DtCard, DtSpinner },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtSpinner v-bind="args" :size="16" />
          <span class="sb-label">正在同步 3 个通道…</span>
        </div>
        <DtCard title="实时曲线" padding="sm">
          <div class="sb-stage">
            <DtSpinner v-bind="args" :size="36" label="正在加载曲线" />
          </div>
        </DtCard>
        <div class="sb-row">
          <DtButton loading>提交中</DtButton>
          <span class="sb-label">按钮内部的 spinner 由 DtButton 的 loading 给，不必自己摆</span>
        </div>
      </div>
    `,
  }),
}

/** 可访问名称：按场景写具体一点，一页里有多个时才分得清。 */
export const 可访问名称: Story = {
  render: (args) => ({
    components: { DtSpinner },
    setup: () => ({
      args,
      labels: ['加载中', '正在加载设备列表', '正在校验证书', '正在写入设备'],
    }),
    template: `
      <div class="sb-col">
        <div v-for="label in labels" :key="label" class="sb-row">
          <DtSpinner v-bind="args" :label="label" />
          <span class="sb-label sb-label--mono">label = "{{ label }}"</span>
        </div>
      </div>
    `,
  }),
}
