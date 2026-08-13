/**
 * @fileoverview DtTable 的展示：列定义、单元格插槽、排序、定高滚动与空数据。
 * ⚠ 插槽名 `cell-<key>` 拼错不会报错，只会静静渲染成 `—`，这条单独摆一个 story。
 */
import { ref } from 'vue'
import type { DtTableColumn, DtTableSort } from '@dt/contracts'
import type { StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtTable, DtTag } from '../src'

interface ChannelRow {
  id: string
  name: string
  protocol: string
  status: 'online' | 'degraded' | 'offline'
  points: number
  latency: number
}

const COLUMNS: DtTableColumn[] = [
  { key: 'name', label: '通道名称', width: '16rem', sortable: true },
  { key: 'protocol', label: '协议', width: '9rem' },
  { key: 'status', label: '状态', width: '8rem', align: 'center' },
  {
    key: 'points',
    label: '点位数',
    width: '8rem',
    align: 'right',
    sortable: true,
  },
  {
    key: 'latency',
    label: '时延',
    width: '8rem',
    align: 'right',
    sortable: true,
  },
  { key: 'actions', label: '操作', width: '10rem', align: 'right' },
]

const ROWS: ChannelRow[] = [
  {
    id: 'ch-01',
    name: '1 号进料泵',
    protocol: 'OPC UA',
    status: 'online',
    points: 42,
    latency: 12,
  },
  {
    id: 'ch-02',
    name: '2 号进料泵',
    protocol: 'OPC UA',
    status: 'degraded',
    points: 42,
    latency: 380,
  },
  {
    id: 'ch-03',
    name: '反应釜温控',
    protocol: 'Modbus TCP',
    status: 'online',
    points: 128,
    latency: 24,
  },
  {
    id: 'ch-04',
    name: '冷却塔风机',
    protocol: 'Modbus TCP',
    status: 'offline',
    points: 16,
    latency: 0,
  },
  {
    id: 'ch-05',
    name: '成品线计数',
    protocol: 'MQTT',
    status: 'online',
    points: 8,
    latency: 45,
  },
]

const STATUS_TEXT = { online: '在线', degraded: '延迟', offline: '离线' }
const STATUS_INTENT = {
  online: 'success',
  degraded: 'warning',
  offline: 'danger',
}

/**
 * ⚠ 这份 meta 不写 `satisfies Meta<typeof DtTable>`，模板里也用 `<component :is>`
 * 而不是把它登记进 `components`：带 `generic="TRow"` 的 SFC 在类型上是一个**泛型
 * 函数**，而 Vue 的 `Component` 与 Storybook 的 `component` 字段都只收具体化的
 * 组件对象，接不住它。运行期是同一个组件，只是 args 的类型收窄弱一档。
 */
const meta = {
  title: '数据展示/DtTable 表格',
  component: DtTable,
  parameters: {
    docs: {
      description: {
        component:
          '列定义驱动的表格，全仓表格只有这一套皮肤。单元格走具名插槽 `cell-<列 key>`，' +
          '插槽拿到 `{ row, index }`；没给插槽的列渲染成 `—`。' +
          '排序**不在组件内做**，只抛 `update:sort`——数据通常在服务端分页。' +
          '⚠ 页面里要「表格 / 卡片可切换」请直接用 **DtDataView**；' +
          'DtTable 适用于外面已经有别的容器与三态的场合。',
      },
    },
  },
  argTypes: {
    minWidth: { control: 'text', description: '表格最小宽度，窄屏横向滚动' },
    caption: { control: 'text', description: '读屏用的表格说明' },
    fill: { control: 'boolean', description: '吃满外层高度、表体内部滚动' },
  },
  args: {
    columns: COLUMNS,
    rows: ROWS,
    sort: null,
    minWidth: '52rem',
    fill: false,
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** 完整一张表：状态列走标签，操作列走按钮，都由 `cell-*` 插槽渲染。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtTag },
    setup: () => ({ args, DtTable, STATUS_TEXT, STATUS_INTENT }),
    template: `
      <component :is="DtTable" v-bind="args">
        <template #cell-name="{ row }">{{ row.name }}</template>
        <template #cell-protocol="{ row }">
          <DtTag mono>{{ row.protocol }}</DtTag>
        </template>
        <template #cell-status="{ row }">
          <DtTag :intent="STATUS_INTENT[row.status]">{{ STATUS_TEXT[row.status] }}</DtTag>
        </template>
        <template #cell-points="{ row }">{{ row.points }}</template>
        <template #cell-latency="{ row }">{{ row.latency }} ms</template>
        <template #cell-actions>
          <DtButton size="sm" variant="ghost" intent="neutral" icon="pencil" aria-label="编辑" />
          <DtButton size="sm" variant="ghost" intent="danger" icon="trash" aria-label="删除" />
        </template>
      </component>
    `,
  }),
}

/** 排序：点表头抛 `update:sort`，排序由调用方去做（这里演示本地排）。 */
export const 排序: Story = {
  render: (args) => ({
    components: { DtTag },
    setup() {
      const sort = ref<DtTableSort | null>({ key: 'latency', desc: true })
      const rows = ref([...ROWS])
      function onSort(next: DtTableSort): void {
        sort.value = next
        const factor = next.desc ? -1 : 1
        rows.value = [...rows.value].sort((a, b) => {
          const left = a[next.key as keyof ChannelRow]
          const right = b[next.key as keyof ChannelRow]
          return left > right ? factor : left < right ? -factor : 0
        })
      }
      return { args, DtTable, sort, rows, onSort }
    },
    template: `
      <div class="sb-col">
        <p class="sb-note">
          当前排序：{{ sort ? sort.key + (sort.desc ? ' 降序' : ' 升序') : '（默认序）' }}
          —— 只有 columns 里标了 sortable 的列可点。
        </p>
        <component :is="DtTable" v-bind="args" :rows="rows" :sort="sort" @update:sort="onSort">
          <template #cell-name="{ row }">{{ row.name }}</template>
          <template #cell-protocol="{ row }"><DtTag mono>{{ row.protocol }}</DtTag></template>
          <template #cell-status="{ row }">{{ row.status }}</template>
          <template #cell-points="{ row }">{{ row.points }}</template>
          <template #cell-latency="{ row }">{{ row.latency }} ms</template>
        </component>
      </div>
    `,
  }),
}

/** 对齐：列定义里的 `align` 决定表头与单元格的对齐，数值列一律右对齐。 */
export const 列对齐与列宽: Story = {
  render: (args) => ({
    setup: () => ({
      DtTable,
      args,
      columns: [
        { key: 'left', label: '左对齐（缺省）', width: '16rem' },
        { key: 'center', label: '居中', width: '12rem', align: 'center' },
        { key: 'right', label: '右对齐', width: '12rem', align: 'right' },
      ] as DtTableColumn[],
      rows: [
        {
          id: 'r1',
          left: '通道名称这类文本',
          center: '在线',
          right: '1,284.05',
        },
        { id: 'r2', left: '短', center: '离线', right: '9.5' },
      ],
    }),
    template: `
      <component :is="DtTable" v-bind="args" :columns="columns" :rows="rows" min-width="40rem">
        <template #cell-left="{ row }">{{ row.left }}</template>
        <template #cell-center="{ row }">{{ row.center }}</template>
        <template #cell-right="{ row }">{{ row.right }}</template>
      </component>
    `,
  }),
}

/** 定高滚动：`fill` 开着时表体在自己的容器里滚，表头保持钉住。 */
export const 定高滚动: Story = {
  render: (args) => ({
    components: { DtTag },
    setup: () => ({
      DtTable,
      args,
      many: Array.from({ length: 40 }, (_unused, i) => ({
        id: `row-${i}`,
        name: `采集通道 ${String(i + 1).padStart(2, '0')}`,
        protocol: i % 2 === 0 ? 'OPC UA' : 'Modbus TCP',
        status: 'online',
        points: 8 + i,
        latency: 10 + i,
      })),
    }),
    template: `
      <div class="sb-scroll">
        <component :is="DtTable" v-bind="args" :rows="many" fill>
          <template #cell-name="{ row }">{{ row.name }}</template>
          <template #cell-protocol="{ row }"><DtTag mono>{{ row.protocol }}</DtTag></template>
          <template #cell-status="{ row }">{{ row.status }}</template>
          <template #cell-points="{ row }">{{ row.points }}</template>
          <template #cell-latency="{ row }">{{ row.latency }} ms</template>
        </component>
      </div>
    `,
  }),
}

/** 没有数据：表格只剩表头。三态提示要由外面的 DtPageState / DtDataView 给。 */
export const 空数据: Story = {
  args: { rows: [] },
  render: (args) => ({
    setup: () => ({ args, DtTable }),
    template: `<component :is="DtTable" v-bind="args" />`,
  }),
}

/** ⚠ 插槽名拼错：`cell-latency` 写成了 `cell-latancy`，那一列静静变成 `—`。 */
export const 插槽名拼错: Story = {
  render: (args) => ({
    setup: () => ({ args, DtTable }),
    template: `
      <div class="sb-col">
        <p class="sb-note">
          typecheck 与 lint 对这类错误双双放行，只能靠契约测试双向锁死
          （插槽必须对得上列、每一列必须有插槽）。
        </p>
        <component :is="DtTable" v-bind="args">
          <template #cell-name="{ row }">{{ row.name }}</template>
          <template #cell-protocol="{ row }">{{ row.protocol }}</template>
          <template #cell-status="{ row }">{{ row.status }}</template>
          <template #cell-points="{ row }">{{ row.points }}</template>
          <template #cell-latancy="{ row }">{{ row.latency }} ms</template>
        </component>
      </div>
    `,
  }),
}

/** caption：读屏在进入表格时会先读它，视觉上不占位。 */
export const 表格说明: Story = {
  args: { caption: '边缘网关 EG-02 上的全部采集通道，共 5 条' },
  render: (args) => ({
    setup: () => ({ args, DtTable }),
    template: `
      <component :is="DtTable" v-bind="args">
        <template #cell-name="{ row }">{{ row.name }}</template>
        <template #cell-protocol="{ row }">{{ row.protocol }}</template>
        <template #cell-status="{ row }">{{ row.status }}</template>
        <template #cell-points="{ row }">{{ row.points }}</template>
        <template #cell-latency="{ row }">{{ row.latency }} ms</template>
      </component>
    `,
  }),
}
