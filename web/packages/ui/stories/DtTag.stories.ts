/**
 * @fileoverview DtTag 的展示：六种语义色 × 两档高度，外加等宽字形。
 * ⚠ 它自成一轴（20/24px 高），不跟控件的 32/40px 走——摆进表格行里不会把行撑高。
 */
import { DT_INTENTS } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtTag } from '../src'

const meta = {
  title: '通用/DtTag 标签',
  component: DtTag,
  parameters: {
    docs: {
      description: {
        component:
          '行内徽标，用于状态、类型、角色这类**独立的一块**标注。' +
          '与 DtBadge 的分工：Badge 必须挂在别的元素身上（右上角的红点或计数），' +
          'Tag 是自己站着的一块。',
      },
    },
  },
  argTypes: {
    intent: { control: 'inline-radio', options: DT_INTENTS },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    mono: {
      control: 'boolean',
      description: '等宽字形，用于点位名、ID 这类要对齐着扫的内容',
    },
  },
  args: { intent: 'neutral', size: 'sm', mono: false },
} satisfies Meta<typeof DtTag>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({ args }),
    template: `<DtTag v-bind="args">运行中</DtTag>`,
  }),
}

/** 六种语义色。含义要和别处一致：绿=正常、黄=注意、红=故障。 */
export const 语义色: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({
      args,
      items: [
        ['primary', '主要'],
        ['success', '在线'],
        ['warning', '延迟'],
        ['danger', '离线'],
        ['info', '同步中'],
        ['neutral', '未启用'],
      ],
    }),
    template: `
      <div class="sb-row">
        <DtTag v-for="[intent, label] in items" :key="intent" v-bind="args" :intent="intent">
          {{ label }}
        </DtTag>
      </div>
    `,
  }),
}

/** 两档高度：sm 给密集表格，md 给卡片与详情页。 */
export const 尺寸: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({ args, intents: DT_INTENTS }),
    template: `
      <div class="sb-col">
        <div v-for="size in ['sm', 'md']" :key="size" class="sb-group">
          <p class="sb-group__title">size = {{ size }}</p>
          <div class="sb-row">
            <DtTag
              v-for="intent in intents"
              :key="intent"
              v-bind="args"
              :intent="intent"
              :size="size"
            >{{ intent }}</DtTag>
          </div>
        </div>
      </div>
    `,
  }),
}

/** 等宽：一列 ID 摆在一起时，等宽字形才对得齐。 */
export const 等宽字形: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({ args }),
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtTag v-bind="args" mono>ns=2;s=Line1.Pump</DtTag>
          <DtTag v-bind="args" mono>ns=2;i=1102</DtTag>
        </div>
        <div class="sb-row">
          <DtTag v-bind="args">ns=2;s=Line1.Pump</DtTag>
          <DtTag v-bind="args">ns=2;i=1102</DtTag>
        </div>
        <p class="sb-note">上面一行 mono，下面一行不开——差别在数字与字母的字宽。</p>
      </div>
    `,
  }),
}

/** 放进正文里：行高不被撑开，是它与按钮尺寸轴分开的意义。 */
export const 行内使用: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({ args }),
    template: `
      <p class="sb-label sb-w-lg">
        采集通道 <DtTag v-bind="args" mono>CH-07</DtTag> 当前
        <DtTag v-bind="args" intent="success">在线</DtTag>，
        上一次心跳在 3 秒前；另有两个通道处于
        <DtTag v-bind="args" intent="warning">延迟</DtTag> 状态。
      </p>
    `,
  }),
}
