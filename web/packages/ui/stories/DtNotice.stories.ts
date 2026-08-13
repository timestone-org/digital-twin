/**
 * @fileoverview DtNotice 的展示：六种语义色、自定义图标与长文案换行。
 * ⚠ role 跟着 intent 走，不给调用方选：danger 是 alert，其余是 status。
 */
import { DT_INTENTS } from '@dt/contracts'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtNotice } from '../src'

const meta = {
  title: '反馈/DtNotice 行内提示',
  component: DtNotice,
  parameters: {
    docs: {
      description: {
        component:
          '行内提示条，用于**就地**的操作反馈与失败原因（紧挨着表单或按钮）。' +
          '⚠ `role` 跟着 `intent` 走，不给调用方选：`danger` 是 `alert`（读屏立刻打断），' +
          '其余是 `status`（等当前朗读结束）。让每个页面自己填 role 的结果，' +
          '是一半的成功提示也用 alert 去打断用户。' +
          '瞬时反馈（保存成功、会话过期）请用 `useToast()`，不要用它。',
      },
    },
  },
  argTypes: {
    intent: { control: 'inline-radio', options: DT_INTENTS },
    icon: { control: 'text', description: '覆盖按 intent 自动选的图标' },
  },
  args: { intent: 'info' },
} satisfies Meta<typeof DtNotice>

export default meta
type Story = StoryObj<typeof meta>

export const 演练场: Story = {
  render: (args) => ({
    components: { DtNotice },
    setup: () => ({ args }),
    template: `
      <div class="sb-w-lg">
        <DtNotice v-bind="args">改动会在下一个采集周期生效，约 30 秒后。</DtNotice>
      </div>
    `,
  }),
}

/** 六种语义色，各配一句典型文案。 */
export const 语义色: Story = {
  render: (args) => ({
    components: { DtNotice },
    setup: () => ({
      args,
      items: [
        ['primary', '这条通道已被设为默认，新建设备会自动挂到它下面。'],
        ['success', '配置已保存，边缘网关将在下一个心跳拉取。'],
        [
          'warning',
          '有 3 个点位的数据类型与设备侧不一致，仍会采集但可能被截断。',
        ],
        ['danger', '连接失败：证书已过期（2026-07-30），请先更换证书再重试。'],
        ['info', '订阅推送需要设备侧支持；不支持时会自动退回轮询。'],
        ['neutral', '当前处于只读模式，你可以查看但不能修改。'],
      ],
    }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtNotice v-for="[intent, text] in items" :key="intent" v-bind="args" :intent="intent">
          {{ text }}
        </DtNotice>
      </div>
    `,
  }),
}

/** 自定义图标：默认图标按 intent 选，需要更具体的语义时覆盖它。 */
export const 自定义图标: Story = {
  render: (args) => ({
    components: { DtNotice },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtNotice v-bind="args" intent="warning" icon="key-round">
          令牌将在 5 分钟后过期，届时需要重新登录。
        </DtNotice>
        <DtNotice v-bind="args" intent="info" icon="shield-check">
          该操作会被记入审计日志。
        </DtNotice>
        <DtNotice v-bind="args" intent="neutral" icon="route">
          数据经边缘网关 EG-02 转发。
        </DtNotice>
      </div>
    `,
  }),
}

/** 长文案与富内容：插槽里可以放多段文字与操作入口。 */
export const 长文案与操作: Story = {
  render: (args) => ({
    components: { DtButton, DtNotice },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-lg">
        <DtNotice v-bind="args" intent="danger">
          导入失败：第 12、37、104 行的点位标识重复。
          重复的点位不会被写入，其余 97 行已成功导入；
          修正后可以只重传这三行，不必整份重来。
          <div class="sb-row" style="margin-top: 8px">
            <DtButton size="sm" variant="outline" intent="danger">下载错误明细</DtButton>
            <DtButton size="sm" variant="ghost" intent="neutral">重新导入</DtButton>
          </div>
        </DtNotice>
      </div>
    `,
  }),
}

/** 紧挨着表单：这是它与 toast 的分工——就地的原因写在这里。 */
export const 表单里的用法: Story = {
  render: (args) => ({
    components: { DtNotice },
    setup: () => ({ args }),
    template: `
      <div class="sb-col sb-w-md">
        <DtNotice v-bind="args" intent="danger">
          用户名或密码不正确，还可以再试 3 次。
        </DtNotice>
        <p class="sb-note">
          就地的校验与结果用 DtNotice；「保存成功」这类瞬时反馈用 useToast()。
        </p>
      </div>
    `,
  }),
}
