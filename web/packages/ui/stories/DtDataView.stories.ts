/**
 * @fileoverview DtDataView 的展示：同一份数据的表格 / 卡片两种呈现、取数三态、
 * 工具条与分页，以及 `card` 角色如何决定卡片视图的排布。
 */
import { computed, ref } from 'vue'
import type { DtDataColumn, DtTableSort } from '@dt/contracts'
import type { StoryObj } from '@storybook/vue3-vite'
import { DtButton, DtDataView, DtInput, DtSelect, DtTag } from '../src'

interface DeviceRow {
  id: string
  name: string
  line: string
  protocol: string
  status: 'online' | 'degraded' | 'offline'
  points: number
  updatedAt: string
}

/** `card` 决定这一列在卡片视图里的角色；不标就是正文里的一行字段。 */
const COLUMNS: DtDataColumn[] = [
  {
    key: 'name',
    label: '设备名称',
    width: '16rem',
    sortable: true,
    card: 'title',
  },
  {
    key: 'status',
    label: '状态',
    width: '8rem',
    align: 'center',
    card: 'meta',
  },
  { key: 'line', label: '所属产线', width: '10rem', card: 'meta' },
  { key: 'protocol', label: '协议', width: '10rem' },
  {
    key: 'points',
    label: '点位数',
    width: '8rem',
    align: 'right',
    sortable: true,
  },
  { key: 'updatedAt', label: '最近上报', width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    width: '10rem',
    align: 'right',
    card: 'actions',
  },
]

const ROWS: DeviceRow[] = [
  {
    id: 'd-01',
    name: '1 号进料泵',
    line: 'A 线',
    protocol: 'OPC UA',
    status: 'online',
    points: 42,
    updatedAt: '3 秒前',
  },
  {
    id: 'd-02',
    name: '2 号进料泵',
    line: 'A 线',
    protocol: 'OPC UA',
    status: 'degraded',
    points: 42,
    updatedAt: '2 分钟前',
  },
  {
    id: 'd-03',
    name: '反应釜温控',
    line: 'B 线',
    protocol: 'Modbus TCP',
    status: 'online',
    points: 128,
    updatedAt: '5 秒前',
  },
  {
    id: 'd-04',
    name: '冷却塔风机',
    line: 'B 线',
    protocol: 'Modbus TCP',
    status: 'offline',
    points: 16,
    updatedAt: '1 小时前',
  },
  {
    id: 'd-05',
    name: '成品线计数器',
    line: 'C 线',
    protocol: 'MQTT',
    status: 'online',
    points: 8,
    updatedAt: '11 秒前',
  },
  {
    id: 'd-06',
    name: '包装机视觉',
    line: 'C 线',
    protocol: 'MQTT',
    status: 'online',
    points: 24,
    updatedAt: '9 秒前',
  },
]

const STATUS_TEXT = { online: '在线', degraded: '延迟', offline: '离线' }
const STATUS_INTENT = {
  online: 'success',
  degraded: 'warning',
  offline: 'danger',
}

/** 六条 `cell-*` 插槽在多个 story 里一模一样，抽出来免得改一处漏五处。 */
const CELLS = `
  <template #cell-name="{ row }">{{ row.name }}</template>
  <template #cell-status="{ row }">
    <DtTag :intent="STATUS_INTENT[row.status]">{{ STATUS_TEXT[row.status] }}</DtTag>
  </template>
  <template #cell-line="{ row }">{{ row.line }}</template>
  <template #cell-protocol="{ row }"><DtTag mono>{{ row.protocol }}</DtTag></template>
  <template #cell-points="{ row }">{{ row.points }}</template>
  <template #cell-updatedAt="{ row }">{{ row.updatedAt }}</template>
  <template #cell-actions>
    <DtButton size="sm" variant="ghost" intent="neutral" icon="pencil" aria-label="编辑" />
    <DtButton size="sm" variant="ghost" intent="danger" icon="trash" aria-label="删除" />
  </template>
`

/**
 * ⚠ 与 DtTable 同因：`generic="TRow"` 的 SFC 在类型上是泛型函数，
 * 接不进 `components` 映射，也放不进 `satisfies Meta<…>` 的 `component` 字段。
 */
const meta = {
  title: '数据展示/DtDataView 数据视图',
  component: DtDataView,
  parameters: {
    docs: {
      description: {
        component:
          '一份数据、两种呈现（表格 / 卡片），用户可就地切换。' +
          '`columns` 是唯一真源：列的 `card` 字段决定它在卡片视图里当标题、当 meta、' +
          '当操作区还是当正文字段；`cell-<key>` 插槽同时喂给两种视图，' +
          '所以「表格里改了、卡片里忘了改」这种漂移不会发生。' +
          '取数三态（加载 / 出错 + 重试 / 空）与分页器都内建，' +
          '`pagination` 给了才渲染分页器。' +
          '⚠ 用了 `card` 插槽就等于把同一份数据的标记写了两份，漂移风险就回到页面上。',
      },
    },
  },
  args: {
    columns: COLUMNS,
    rows: ROWS,
    view: 'table',
    loading: false,
    error: null,
    sort: null,
    pagination: null,
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** 完整用法：右上角切换表格 / 卡片，表头可排序。 */
export const 演练场: Story = {
  render: (args) => ({
    components: { DtButton, DtTag },
    setup() {
      const view = ref('table')
      const sort = ref<DtTableSort | null>(null)
      return { args, view, sort, DtDataView, STATUS_TEXT, STATUS_INTENT }
    },
    template: `
      <div style="height: 520px">
        <component
          :is="DtDataView"
          v-bind="args"
          :view="view"
          :sort="sort"
          @update:view="view = $event"
          @update:sort="sort = $event"
        >${CELLS}</component>
      </div>
    `,
  }),
}

/** 卡片视图：title / meta / actions 由列的 `card` 角色决定，其余列铺成字段表。 */
export const 卡片视图: Story = {
  args: { view: 'card' },
  render: (args) => ({
    components: { DtButton, DtTag },
    setup: () => ({ args, DtDataView, STATUS_TEXT, STATUS_INTENT }),
    template: `
      <div style="height: 520px">
        <component :is="DtDataView" v-bind="args">${CELLS}</component>
      </div>
    `,
  }),
}

/** 工具条与汇总：筛选控件放 toolbar，条数统计放 summary，两者都不跟着列表滚。 */
export const 工具条与汇总: Story = {
  render: (args) => ({
    components: { DtButton, DtInput, DtSelect, DtTag },
    setup() {
      const view = ref('table')
      const keyword = ref('')
      const line = ref('')
      const rows = computed(() =>
        ROWS.filter(
          (row) =>
            (keyword.value === '' || row.name.includes(keyword.value)) &&
            (line.value === '' || row.line === line.value),
        ),
      )
      const lines = [
        { value: '', label: '全部产线' },
        { value: 'A 线', label: 'A 线' },
        { value: 'B 线', label: 'B 线' },
        { value: 'C 线', label: 'C 线' },
      ]
      return {
        args,
        view,
        keyword,
        line,
        rows,
        lines,
        DtDataView,
        STATUS_TEXT,
        STATUS_INTENT,
      }
    },
    template: `
      <div style="height: 520px">
        <component
          :is="DtDataView"
          v-bind="args"
          :rows="rows"
          :view="view"
          @update:view="view = $event"
        >
          <template #toolbar>
            <div class="sb-row">
              <div class="sb-w-sm">
                <DtInput v-model="keyword" size="sm" aria-label="按名称搜索" placeholder="按名称搜索" />
              </div>
              <div class="sb-w-xs">
                <DtSelect v-model="line" size="sm" aria-label="产线" :options="lines" />
              </div>
            </div>
          </template>
          <template #summary>
            <span class="sb-label">共 {{ rows.length }} 台设备</span>
          </template>
          ${CELLS}
        </component>
      </div>
    `,
  }),
}

/** 取数三态：加载中 / 出错（带重试）/ 空。空态文案由 `empty` 给。 */
export const 取数三态: Story = {
  render: (args) => ({
    components: { DtButton, DtTag },
    setup() {
      const state = ref('loading')
      const retried = ref(0)
      const rows = computed(() => (state.value === 'empty' ? [] : ROWS))
      return {
        args,
        state,
        retried,
        rows,
        DtDataView,
        STATUS_TEXT,
        STATUS_INTENT,
      }
    },
    template: `
      <div class="sb-col" style="height: 560px">
        <div class="sb-row">
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'loading'">加载中</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'error'">出错</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'empty'">空</DtButton>
          <DtButton size="sm" variant="outline" intent="neutral" @click="state = 'ok'">有数据</DtButton>
          <span class="sb-label">点了 {{ retried }} 次重试</span>
        </div>
        <component
          :is="DtDataView"
          v-bind="args"
          :rows="rows"
          :loading="state === 'loading'"
          :error="state === 'error' ? '读取设备列表失败：网关无响应（504）' : null"
          :empty="{ title: '这条产线还没有设备', hint: '先在边缘网关上登记，再回来这里绑定点位' }"
          @retry="retried += 1; state = 'ok'"
        >${CELLS}</component>
      </div>
    `,
  }),
}

/** 分页：给了 `pagination` 才渲染分页器；换每页条数会自动回到第 1 页。 */
export const 分页: Story = {
  render: (args) => ({
    components: { DtButton, DtTag },
    setup() {
      const page = ref(1)
      const size = ref(10)
      const all = Array.from({ length: 43 }, (_unused, i) => ({
        ...ROWS[i % ROWS.length],
        id: `dev-${i}`,
        name: `设备 ${String(i + 1).padStart(2, '0')}`,
      }))
      const rows = computed(() =>
        all.slice((page.value - 1) * size.value, page.value * size.value),
      )
      const pagination = computed(() => ({
        page: page.value,
        size: size.value,
        total: all.length,
      }))
      return {
        args,
        page,
        size,
        rows,
        pagination,
        DtDataView,
        STATUS_TEXT,
        STATUS_INTENT,
      }
    },
    template: `
      <div style="height: 560px">
        <component
          :is="DtDataView"
          v-bind="args"
          :rows="rows"
          :pagination="pagination"
          @update:page="page = $event"
          @update:size="size = $event"
        >${CELLS}</component>
      </div>
    `,
  }),
}

/** 布局：卡片视图每行最多几张、切换器关不关、要不要吃满高度。 */
export const 布局选项: Story = {
  args: { view: 'card' },
  render: (args) => ({
    components: { DtButton, DtTag },
    setup: () => ({ args, DtDataView, STATUS_TEXT, STATUS_INTENT }),
    template: `
      <div class="sb-col">
        <div class="sb-group">
          <p class="sb-group__title">cardColumns = 1 · 关掉内置切换器 · 不吃满高度</p>
          <component
            :is="DtDataView"
            v-bind="args"
            :rows="args.rows.slice(0, 2)"
            :layout="{ cardColumns: 1, toggle: false, fill: false }"
          >${CELLS}</component>
        </div>
        <div class="sb-group">
          <p class="sb-group__title">cardColumns = 3 · 卡片最小宽度 14rem</p>
          <component
            :is="DtDataView"
            v-bind="args"
            :rows="args.rows.slice(0, 3)"
            :layout="{ cardColumns: 3, cardMinWidth: '14rem', toggle: false, fill: false }"
          >${CELLS}</component>
        </div>
      </div>
    `,
  }),
}

/** 自定义卡片：给了 `card` 插槽，整张卡就由调用方渲染，列的 `card` 角色不再生效。 */
export const 自定义卡片: Story = {
  args: { view: 'card' },
  render: (args) => ({
    components: { DtButton, DtTag },
    setup: () => ({ args, DtDataView, STATUS_TEXT, STATUS_INTENT }),
    template: `
      <div style="height: 520px">
        <component
          :is="DtDataView"
          v-bind="args"
          :layout="{ cardColumns: 3, toggle: false }"
        >
          ${CELLS}
          <template #card="{ row }">
            <div class="sb-group">
              <p class="sb-group__title">{{ row.name }}</p>
              <div class="sb-row">
                <DtTag :intent="STATUS_INTENT[row.status]">{{ STATUS_TEXT[row.status] }}</DtTag>
                <DtTag mono>{{ row.protocol }}</DtTag>
              </div>
              <p class="sb-note">{{ row.line }} · {{ row.points }} 个点位 · {{ row.updatedAt }}</p>
            </div>
          </template>
        </component>
      </div>
    `,
  }),
}
