/**
 * @fileoverview DtHelpTip 的展示：标签旁的问号气泡，四个方向与长说明。
 */
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DT_OVERLAY_SIDES, DtHelpTip, DtInput, DtNumberInput } from '../src'

const LONG_TEXT =
  '轮询周期指两次读取之间的间隔。改小会增加网关与设备的负载，' +
  '设备侧可能因此丢帧；改大则会让曲线出现台阶，报警的发现时间也会相应变长。' +
  '一般从 1000ms 起调，遇到丢帧再往上加。'

const meta = {
  title: '浮层/DtHelpTip 说明气泡',
  component: DtHelpTip,
  parameters: {
    docs: {
      description: {
        component:
          '标签旁的问号气泡，装一段**成句**的说明，浮层复用 DtPopover。' +
          '⚠ 与 DtTooltip 的分工：这个是点开的，所以内容可以长、可以选中复制；' +
          '一句话的短提示用 DtTooltip，别让用户为了看一行字先点一下。' +
          '同一页有多个时，把 `label` 写成各自的字段名——' +
          '全叫「说明」的话，读屏用户听到的是一串一模一样的按钮。',
      },
    },
  },
  argTypes: {
    text: { control: 'text', description: '说明正文' },
    label: { control: 'text', description: '无障碍名称，缺省「说明」' },
    side: { control: 'inline-radio', options: DT_OVERLAY_SIDES },
  },
  args: { text: LONG_TEXT, label: '采样周期说明', side: 'top' },
} satisfies Meta<typeof DtHelpTip>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtHelpTip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <DtHelpTip v-bind="args" />
      </div>
    `,
  }),
}

/** 四个方向。 */
export const 方向: Story = {
  render: (args) => ({
    components: { DtHelpTip },
    setup: () => ({ args, sides: DT_OVERLAY_SIDES }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <span v-for="side in sides" :key="side" class="sb-row">
            <span class="sb-label">{{ side }}</span>
            <DtHelpTip v-bind="args" :side="side" :text="'side = ' + side + '：' + args.text" />
          </span>
        </div>
      </div>
    `,
  }),
}

/** 贴在字段标签旁：它最常见的位置。 */
export const 字段标签旁: Story = {
  render: (args) => ({
    components: { DtHelpTip, DtInput, DtNumberInput },
    setup: () => ({ args, LONG_TEXT }),
    template: `
      <div class="sb-col sb-w-md">
        <div class="sb-row">
          <span class="sb-label">采样周期</span>
          <DtHelpTip v-bind="args" label="采样周期说明" :text="LONG_TEXT" />
        </div>
        <DtNumberInput :model-value="1000" unit="ms" :range="{ min: 100, max: 60000, step: 100 }" />

        <div class="sb-row">
          <span class="sb-label">点位路径</span>
          <DtHelpTip
            v-bind="args"
            label="点位路径说明"
            text="OPC UA 的 NodeId，形如 ns=2;s=Line1.Pump.Speed。ns 是命名空间索引，s 表示字符串标识；不同网关上的 ns 可能不同，导入前请先核对。"
          />
        </div>
        <DtInput model-value="ns=2;s=Line1.Pump.Speed" />
      </div>
    `,
  }),
}

/** 短文案也能用，但那多半该换成 DtTooltip。 */
export const 短文案: Story = {
  args: { text: '只读，由边缘网关上报。' },
  render: (args) => ({
    components: { DtHelpTip },
    setup: () => ({ args }),
    template: `
      <div class="sb-stage">
        <div class="sb-row">
          <span class="sb-label">最近上报时间</span>
          <DtHelpTip v-bind="args" label="最近上报时间说明" />
        </div>
      </div>
    `,
  }),
}
