/**
 * @fileoverview DtTooltip 的展示：四个方向、键盘聚焦触发、禁用与空内容。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DT_OVERLAY_SIDES, DtButton, DtIcon, DtTooltip } from '../src'

const meta = {
  title: '浮层/DtTooltip 提示气泡',
  component: DtTooltip,
  parameters: {
    docs: {
      description: {
        component:
          '指针悬停或键盘聚焦时弹出的一句话提示。默认插槽是触发器。' +
          '⚠ 它**只读不点**：内容里放按钮或链接，键盘与触屏用户永远够不着' +
          '（指针一移开就没了）。要能点的内容用 DtPopover。' +
          '⚠ 内容为空或组件被禁用时不挂 `aria-describedby`——' +
          '挂了会指向一个不存在的节点，读屏读出一段空。' +
          '需要长说明（可选中、可复制）时用 DtHelpTip。',
      },
    },
  },
  argTypes: {
    content: { control: 'text', description: '提示文案；空字符串等于不提示' },
    side: { control: 'inline-radio', options: DT_OVERLAY_SIDES },
    disabled: { control: 'boolean' },
  },
  args: { content: '重新拉取一次当前页的数据', side: 'top', disabled: false },
} satisfies Meta<typeof DtTooltip>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtTooltip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtTooltip v-bind="args">
          <DtButton variant="outline" intent="neutral" icon="activity">刷新</DtButton>
        </DtTooltip>
      </div>
    `,
  }),
}

/** 四个方向。空间不足时会在运行时翻到对侧，把窗口拉窄就能看到。 */
export const 方向: Story = {
  render: (args) => ({
    components: { DtButton, DtTooltip },
    setup: () => ({ args, sides: DT_OVERLAY_SIDES }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtTooltip v-for="side in sides" :key="side" v-bind="args" :side="side" :content="'side = ' + side">
            <DtButton variant="outline" intent="neutral">{{ side }}</DtButton>
          </DtTooltip>
        </div>
      </div>
    `,
  }),
}

/** 触发器可以是任何东西：按钮、图标、一段文字。 */
export const 触发器: Story = {
  render: (args) => ({
    components: { DtButton, DtIcon, DtTooltip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtTooltip v-bind="args" content="按钮：Tab 聚焦也会弹">
            <DtButton icon="upload" aria-label="下发" />
          </DtTooltip>
          <DtTooltip v-bind="args" content="图标：自己不可聚焦，只能靠悬停">
            <span><DtIcon name="shield-check" :size="20" /></span>
          </DtTooltip>
          <DtTooltip v-bind="args" content="一段文字也能当触发器">
            <span class="sb-label" tabindex="0">最近上报：3 秒前</span>
          </DtTooltip>
        </div>
      </div>
    `,
  }),
}

/** 禁用与空内容：两者都不弹，也都不会挂上指向空节点的 describedby。 */
export const 不弹的两种情况: Story = {
  render: (args) => ({
    components: { DtButton, DtTooltip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <DtTooltip v-bind="args" disabled content="这条不会出现">
            <DtButton variant="outline" intent="neutral">disabled</DtButton>
          </DtTooltip>
          <DtTooltip v-bind="args" content="">
            <DtButton variant="outline" intent="neutral">content 为空</DtButton>
          </DtTooltip>
        </div>
      </div>
    `,
  }),
}

/** 长文案：能显示，但这是 DtHelpTip 的活——一句话以上就该换。 */
export const 长文案: Story = {
  render: (args) => ({
    components: { DtButton, DtTooltip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtTooltip
          v-bind="args"
          content="轮询周期指两次读取之间的间隔；改小会增加网关与设备的负载，改大则会让曲线出现台阶。"
        >
          <DtButton variant="outline" intent="neutral">悬停看看</DtButton>
        </DtTooltip>
      </div>
    `,
  }),
}
