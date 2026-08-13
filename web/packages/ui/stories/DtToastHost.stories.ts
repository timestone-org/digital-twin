/**
 * @fileoverview DtToastHost 与 useToast 的展示：四种语义、标题、时长与手动关闭。
 * 宿主全应用只挂一次（App.vue），业务侧只管入队——这里为了能看见，story 里各挂一个。
 */
import { onUnmounted } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtToastHost, useToast } from '../src'

const meta = {
  title: '反馈/DtToastHost 消息条',
  component: DtToastHost,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '瞬时反馈（写操作成功 / 失败、会话过期）的渲染宿主，' +
          '**全应用挂一次**，业务侧用 `useToast()` 入队即可。' +
          '`error` 默认 6 秒、其余 3.5 秒——失败要读完，成功一眼扫过就行；' +
          '`duration: 0` 表示不自动消失，必须用户手动关。' +
          '⚠ 队列是模块级单例：定时器句柄会被存下来，手动关掉时一并清掉，' +
          '不然组件卸载后还有待触发的回调。' +
          '就地的校验与失败原因用 DtNotice，别用它。',
      },
    },
  },
} satisfies Meta<typeof DtToastHost>

export default meta
type Story = StoryObj<typeof meta>

/** 四种语义各推一条。右上角出现的就是宿主渲染的消息条。 */
export const 四种语义: Story = {
  render: () => ({
    components: { DtButton, DtToastHost },
    setup() {
      const toast = useToast()
      // story 之间不互相污染：离开这一页就清空队列
      onUnmounted(() => toast.clear())
      return { toast }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton intent="info" @click="toast.info('边缘网关已接入，正在同步点位表')">info</DtButton>
          <DtButton intent="success" @click="toast.success('配置已保存')">success</DtButton>
          <DtButton intent="warning" @click="toast.warning('有 3 个点位的数据类型与设备侧不一致')">warning</DtButton>
          <DtButton intent="danger" @click="toast.error('下发失败：设备拒绝写入（BadUserAccessDenied）')">error</DtButton>
        </div>
        <p class="sb-note">error 默认停 6 秒，其余 3.5 秒。</p>
        <DtToastHost />
      </div>
    `,
  }),
}

/** 标题：一行标题 + 一行正文，用于「做了什么 + 结果怎样」。 */
export const 带标题: Story = {
  render: () => ({
    components: { DtButton, DtToastHost },
    setup() {
      const toast = useToast()
      onUnmounted(() => toast.clear())
      return { toast }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton @click="toast.success('12 个点位已写入', { title: '批量下发完成' })">
            带标题的成功
          </DtButton>
          <DtButton
            intent="danger"
            @click="toast.error('证书已于 2026-07-30 过期，请更换后重试', { title: '连接失败' })"
          >带标题的失败</DtButton>
        </div>
        <DtToastHost />
      </div>
    `,
  }),
}

/** 时长：可以更短、更长，或者干脆不自动消失。 */
export const 时长: Story = {
  render: () => ({
    components: { DtButton, DtToastHost },
    setup() {
      const toast = useToast()
      onUnmounted(() => toast.clear())
      return { toast }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton variant="outline" intent="neutral" @click="toast.info('1 秒就走', { duration: 1000 })">
            1 秒
          </DtButton>
          <DtButton variant="outline" intent="neutral" @click="toast.info('停 10 秒', { duration: 10000 })">
            10 秒
          </DtButton>
          <DtButton variant="outline" intent="neutral" @click="toast.warning('要你自己关掉', { duration: 0 })">
            不自动消失
          </DtButton>
        </div>
        <DtToastHost />
      </div>
    `,
  }),
}

/** 多条堆叠与整队清空：队列是单例，clear() 会把所有人的消息一起清掉。 */
export const 堆叠与清空: Story = {
  render: () => ({
    components: { DtButton, DtToastHost },
    setup() {
      const toast = useToast()
      function pushMany(): void {
        toast.info('① 正在校验证书')
        toast.success('② 证书有效')
        toast.warning('③ 有 2 个点位不可写')
        toast.error('④ 通道 CH-04 无响应')
      }
      onUnmounted(() => toast.clear())
      return { toast, pushMany }
    },
    template: `
      <div class="sb-col">
        <div class="sb-row">
          <DtButton @click="pushMany">一次推 4 条</DtButton>
          <DtButton variant="outline" intent="neutral" @click="toast.clear()">全部清空</DtButton>
        </div>
        <p class="sb-note">每条右侧都有关闭键；关掉时对应的定时器会一并清掉。</p>
        <DtToastHost />
      </div>
    `,
  }),
}
