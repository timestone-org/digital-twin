/**
 * @fileoverview DtEmpty 的展示：图标、标题、提示与插槽里的补救动作。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtCard, DtEmpty } from '../src'

const meta = {
  title: '反馈/DtEmpty 空态',
  component: DtEmpty,
  parameters: {
    docs: {
      description: {
        component:
          '空列表必须有明确的空态，否则用户分不清「没有数据」与「还没加载出来」。' +
          '标题说清是什么空了，提示说清**下一步该做什么**——' +
          '只写「暂无数据」等于把用户留在原地。' +
          '默认插槽用来放补救动作（新建、清筛选、去登记）。' +
          '取数三态（加载 / 出错 / 空）请直接用 DtPageState，它内部就用了这个组件。',
      },
    },
  },
  argTypes: {
    icon: { control: 'text', description: '图标名，缺省 alert-circle' },
    title: { control: 'text' },
    hint: { control: 'text', description: '下一步该做什么' },
  },
  args: {
    icon: 'alert-circle',
    title: '暂无数据',
    hint: '这条产线还没有登记任何设备',
  },
} satisfies Meta<typeof DtEmpty>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtEmpty },
    setup: () => ({ args }),
    template: `<DtEmpty v-bind="args" />`,
  }),
}

/** 只给标题：最简的一种，适合小块区域。 */
export const 最简: Story = {
  args: { hint: undefined },
  render: (args) => ({
    components: { DtEmpty },
    setup: () => ({ args }),
    template: `<DtEmpty v-bind="args" title="暂无告警" />`,
  }),
}

/** 带补救动作：空态的价值在于给出下一步。 */
export const 带动作: Story = {
  render: (args) => ({
    components: { DtButton, DtEmpty },
    setup: () => ({ args }),
    template: `
      <DtEmpty v-bind="args" icon="users" title="还没有任何用户" hint="先创建一个管理员账号，再邀请同事">
        <DtButton icon="plus">新建用户</DtButton>
      </DtEmpty>
    `,
  }),
}

/** 不同场景配不同图标与文案：空 ≠ 没搜到 ≠ 没权限。 */
export const 常见场景: Story = {
  render: (args) => ({
    components: { DtButton, DtEmpty },
    setup: () => ({ args }),
    template: `
      <div class="sb-grid sb-grid--wide">
        <DtEmpty v-bind="args" icon="table" title="这条产线还没有设备" hint="先在边缘网关上登记，再回来绑定点位">
          <DtButton size="sm" icon="plus">登记设备</DtButton>
        </DtEmpty>
        <DtEmpty v-bind="args" icon="search" title="没有匹配的结果" hint="换个关键词，或清掉筛选条件再看看">
          <DtButton size="sm" variant="outline" intent="neutral">清除筛选</DtButton>
        </DtEmpty>
        <DtEmpty v-bind="args" icon="lock" title="没有查看权限" hint="需要「设备:读」权限，可以找管理员申请" />
        <DtEmpty v-bind="args" icon="activity" title="所选时间段内没有数据" hint="把范围拉长到近 7 天试试" />
      </div>
    `,
  }),
}

/** 放进卡片里：空态自己不带外框，外框由 DtCard 给。 */
export const 卡片里的空态: Story = {
  render: (args) => ({
    components: { DtCard, DtEmpty },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-lg">
        <DtCard title="最近告警" icon="alert-triangle">
          <DtEmpty v-bind="args" icon="shield-check" title="近 24 小时没有告警" hint="一切正常" />
        </DtCard>
      </div>
    `,
  }),
}
