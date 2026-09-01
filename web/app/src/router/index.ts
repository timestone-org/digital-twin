/**
 * @fileoverview 路由表与守卫。
 * ⚠ `meta.permissions` 是闸 3：它只决定「看不看得见入口」，
 * 真正的拦截在 auth-server 的路由规则与端点权限上。
 */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { PERMISSION_CODES } from '@dt/contracts'

import { installAuthGuard } from './guards'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/Login/index.vue'),
    meta: { anonymous: true, title: '登录' },
  },
  {
    // 公开大屏：拿链接就能看，**不需要登录**（ADR-0014）。
    // ⚠ 全站唯一一条匿名的业务路由。授权凭据是地址里那个令牌，由后端按
    // 「已发布」核对；前端这边不做任何判定，也不许在这里加权限码。
    path: '/public/:publicToken',
    name: 'public-dashboard',
    component: () => import('@/pages/PublicDashboard/index.vue'),
    meta: { anonymous: true, title: '大屏' },
  },
  {
    // 工作台即大屏的管理面：项目与大屏都在这一页里管，没有另一张列表页。
    // ⚠ 它是路由守卫的兜底目的地，因此**自身不能挂 meta.permissions**——
    // 挂了就会「没权限 → 跳 403 → 403 也要鉴权 → 再跳」绕成死循环。
    // 无权看大屏的账号由页面自己渲染空态。
    path: '/',
    name: 'home',
    component: () => import('@/pages/Home/index.vue'),
    meta: { title: '工作台' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/pages/Profile/index.vue'),
    meta: { title: '个人资料' },
  },
  {
    // 旧的大屏列表页已并进工作台。留一条重定向而不是直接删：
    // 收藏夹与外发链接里还躺着这个地址，直接删就是一个 404。
    path: '/dashboards',
    redirect: { name: 'home' },
  },
  {
    // 每张大屏一个的**运行态**路由，因此不进 NAV_ITEMS——那张表里每一项都要有
    // 静态路径，且由契约测试钉着。
    path: '/dashboards/:dashboardId',
    name: 'dashboard-view',
    component: () => import('@/pages/DashboardView/index.vue'),
    meta: {
      title: '大屏',
      permissions: [PERMISSION_CODES.dashboardView],
    },
  },
  {
    path: '/dashboards/:dashboardId/edit',
    name: 'dashboard-editor',
    component: () => import('@/pages/DashboardEditor/index.vue'),
    meta: {
      title: '大屏编辑器',
      permissions: [PERMISSION_CODES.dashboardEdit],
    },
  },
  {
    // 挂在大屏编辑器下面：改的是某个节点的一段 config，权限与它同一档
    path: '/dashboards/:dashboardId/edit/twin/:nodeId',
    name: 'twin-editor',
    component: () => import('@/pages/TwinEditor/index.vue'),
    meta: {
      title: '孪生编辑器',
      permissions: [PERMISSION_CODES.dashboardEdit],
    },
  },
  {
    // 2D 孪生子编辑器：与三维那条平级，改的同样是某个节点的一段 config。
    // ⚠ 路径必须同时接 `:dashboardId` 与 `:nodeId`：属性面板的入口按这两个
    // 参数跳，少一个就跳到一个空页，而 `sub-editor-routes` 契约按字面查这两段
    path: '/dashboards/:dashboardId/edit/twin-2d/:nodeId',
    name: 'twin-2d-editor',
    component: () => import('@/pages/Twin2dEditor/index.vue'),
    meta: {
      title: '2D 孪生编辑器',
      permissions: [PERMISSION_CODES.dashboardEdit],
    },
  },
  {
    // 卡片子编辑器：与两条孪生平级，改的同样是某个节点的一段 config。
    // ⚠ 路径必须同时接 `:dashboardId` 与 `:nodeId`：入口按这两个参数跳，
    // 少一个就跳到一个空页，而 `sub-editor-routes` 契约按字面查这两段
    path: '/dashboards/:dashboardId/edit/card/:nodeId',
    name: 'card-editor',
    component: () => import('@/pages/CardEditor/index.vue'),
    meta: {
      title: '自定义卡片',
      permissions: [PERMISSION_CODES.dashboardEdit],
    },
  },
  {
    // 素材是跨大屏的公共资源，故不挂在某张大屏或某个项目下面
    path: '/assets',
    name: 'assets',
    component: () => import('@/pages/Assets/index.vue'),
    meta: {
      title: '素材库',
      permissions: [PERMISSION_CODES.assetView],
    },
  },
  {
    // 知识库是**跨大屏、跨模块**的公共资源，故与素材同级挂在顶层。
    // ⚠ 这一条只挂**读码**：写码（knowledge:write / knowledge:manage）在页内
    // 逐个入口门控，挂到路由上会把只读账号整个挡在门外——而他们本该能检索
    path: '/knowledge',
    name: 'knowledge',
    component: () => import('@/pages/Knowledge/index.vue'),
    meta: {
      title: '知识库',
      permissions: [PERMISSION_CODES.knowledgeUse],
    },
  },
  {
    // 数据采集：一个协议一个页面（主从单页，左列表右详情）。第二个驱动进来
    // 时它是同级的另一条，而不是把这条改成通配——协议不同，配置字段就不同
    path: '/collect/opcua',
    name: 'collect-opcua',
    component: () => import('@/pages/Collect/Opcua/index.vue'),
    meta: {
      title: 'OPC UA 采集',
      permissions: [PERMISSION_CODES.collectView],
    },
  },
  {
    // 数据台账：从点位历史汇总出来的业务派生层。这一条只挂**读码**——
    // 写码（dataset:manage）在页内逐个入口门控，挂到路由上会把只读账号
    // 整个挡在门外（docs/DATASET_DESIGN.md §7.1）。
    path: '/datasets',
    name: 'dataset-tables',
    component: () => import('@/pages/Dataset/Tables/index.vue'),
    meta: {
      title: '数据台账',
      permissions: [PERMISSION_CODES.datasetView],
    },
  },
  {
    // 详情的三个分区是**子路由**而不是页内状态：地址会变，于是「把列配置发给
    // 同事」「刷新还停在这一页」「后退回上一个分区」都成立。
    // ⚠ 子路由不重复写 permissions——`to.meta` 是全部匹配记录的合并，父级这一条
    // 就管住了整棵子树，两处各写一份反而会漂（docs/DATASET_DESIGN.md §7.1）。
    // ⚠ 带 `:tableId` 故不进 NAV_ITEMS；回列表靠 AppShell 的 backTo。
    path: '/datasets/:tableId',
    component: () => import('@/pages/Dataset/TableDetail/index.vue'),
    meta: {
      title: '台账详情',
      permissions: [PERMISSION_CODES.datasetView],
    },
    children: [
      {
        path: '',
        name: 'dataset-table-detail',
        redirect: (to) => ({
          name: 'dataset-table-columns',
          params: { tableId: to.params.tableId },
        }),
      },
      {
        path: 'columns',
        name: 'dataset-table-columns',
        component: () =>
          import('@/pages/Dataset/TableDetail/components/ColumnsPanel.vue'),
        meta: { title: '列配置' },
      },
      {
        path: 'records',
        name: 'dataset-table-records',
        component: () =>
          import('@/pages/Dataset/TableDetail/components/RecordsPanel.vue'),
        meta: { title: '数据' },
      },
      {
        path: 'trend',
        name: 'dataset-table-trend',
        component: () =>
          import('@/pages/Dataset/TableDetail/components/TrendPanel.vue'),
        meta: { title: '趋势' },
      },
    ],
  },
  {
    // 公式库：跨台账的全局资源，故与台账列表**平级**而不是挂在它下面——
    // 挂成子路由就得先选一张台账，才能改一条影响全部台账的东西。
    // ⚠ 只挂读码 `formula:view`：它与 `dataset:view` 分家，看得见某一张台账
    // 不等于看得见全局口径；写码 `formula:manage` 在页内逐个入口门控
    // （docs/DATASET_DESIGN.md §6、§9）。
    path: '/formulas',
    name: 'dataset-formulas',
    component: () => import('@/pages/Dataset/Formulas/index.vue'),
    meta: {
      title: '公式库',
      permissions: [PERMISSION_CODES.formulaView],
    },
  },
  {
    // 趋势分析：点位历史与台账曲线合在一页。
    // ⚠ 两个源的读码互不蕴含，故按**下界**放行（`permissionMode: 'any'`）：
    // 只有其中一个码的账号该看得到自己那一半，而不是被整页挡在门外。页内按
    // 各自的码决定哪一面渲染得出来（docs/DATASET_DESIGN.md §7.1）。
    path: '/trend',
    name: 'trend',
    component: () => import('@/pages/Trend/index.vue'),
    meta: {
      title: '趋势分析',
      permissions: [PERMISSION_CODES.collectView, PERMISSION_CODES.datasetView],
      permissionMode: 'any',
    },
  },
  {
    path: '/hvac/units',
    name: 'hvac-units',
    component: () => import('@/pages/Hvac/Units/index.vue'),
    meta: {
      title: '空调台账',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    // ⚠ 每台空调一个的**详情**路由，因此不进 NAV_ITEMS——那张表里每一项都要有
    // 静态路径，且由契约测试钉着。回台账靠 AppShell 的 backTo。
    path: '/hvac/ac-units/:acUnitId/data',
    name: 'hvac-ac-data',
    component: () => import('@/pages/Hvac/AcData/index.vue'),
    meta: {
      title: '空调数据',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    path: '/hvac/startups',
    name: 'hvac-startups',
    component: () => import('@/pages/Hvac/Startups/index.vue'),
    meta: {
      title: '开机事件',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    path: '/hvac/models',
    name: 'hvac-models',
    component: () => import('@/pages/Hvac/Models/index.vue'),
    meta: {
      title: '达标预测',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    // 每个模型一个的**详情**路由，不进 NAV_ITEMS；回列表靠 AppShell 的 backTo
    path: '/hvac/models/:modelId',
    name: 'hvac-model-detail',
    component: () => import('@/pages/Hvac/ModelDetail/index.vue'),
    meta: {
      title: '模型详情',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    path: '/hvac/spaces',
    name: 'hvac-spaces',
    component: () => import('@/pages/Hvac/Spaces/index.vue'),
    meta: {
      title: '空间配置',
      permissions: [PERMISSION_CODES.acView],
    },
  },
  {
    path: '/tools/opcua-servers',
    name: 'tools-opcua-servers',
    component: () => import('@/pages/Tools/OpcuaServers/index.vue'),
    meta: {
      title: 'OPC UA 服务端',
      permissions: [PERMISSION_CODES.opcuaView],
    },
  },
  {
    // 详情的三个分区是**子路由**而不是页内状态：地址会变，于是「把安全页
    // 发给同事」「刷新还停在这一页」「浏览器后退回上一个分区」都成立。
    // ⚠ 子路由不重复写 permissions——`to.meta` 是全部匹配记录的合并，
    // 父级这一条就管住了整棵子树，两处各写一份反而会漂。
    path: '/tools/opcua-servers/:instanceId',
    component: () => import('@/pages/Tools/OpcuaServerDetail/index.vue'),
    meta: {
      title: 'OPC UA 实例',
      permissions: [PERMISSION_CODES.opcuaView],
    },
    children: [
      {
        path: '',
        name: 'tools-opcua-server-detail',
        redirect: (to) => ({
          name: 'tools-opcua-server-nodes',
          params: { instanceId: to.params.instanceId },
        }),
      },
      {
        path: 'nodes',
        name: 'tools-opcua-server-nodes',
        component: () =>
          import('@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'),
        meta: { title: '地址空间' },
      },
      {
        path: 'sessions',
        name: 'tools-opcua-server-sessions',
        component: () =>
          import('@/pages/Tools/OpcuaServerDetail/components/SessionsPanel.vue'),
        meta: { title: '在线会话' },
      },
      {
        path: 'security',
        name: 'tools-opcua-server-security',
        component: () =>
          import('@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'),
        meta: { title: '接入安全' },
      },
    ],
  },
  {
    path: '/system/users',
    name: 'system-users',
    component: () => import('@/pages/System/Users/index.vue'),
    meta: {
      title: '用户管理',
      permissions: [PERMISSION_CODES.userView],
    },
  },
  {
    path: '/system/roles',
    name: 'system-roles',
    component: () => import('@/pages/System/Roles/index.vue'),
    meta: {
      title: '角色管理',
      permissions: [PERMISSION_CODES.userView],
    },
  },
  {
    path: '/system/permissions',
    name: 'system-permissions',
    component: () => import('@/pages/System/Permissions/index.vue'),
    meta: {
      title: '权限目录',
      // 配角色的人不一定有用户面的读码，但角色编辑弹窗必须铺得出权限树
      permissions: [PERMISSION_CODES.userView, PERMISSION_CODES.roleManage],
      permissionMode: 'any',
    },
  },
  {
    path: '/system/route-rules',
    name: 'system-route-rules',
    component: () => import('@/pages/System/RouteRules/index.vue'),
    meta: {
      title: '路由规则',
      permissions: [PERMISSION_CODES.routeRuleView],
    },
  },
  {
    // 读面挂 userView 与用户管理同档：列表只出前缀，不出明文
    path: '/system/api-keys',
    name: 'system-api-keys',
    component: () => import('@/pages/System/ApiKeys/index.vue'),
    meta: {
      title: 'API 密钥',
      permissions: [PERMISSION_CODES.userView],
    },
  },
  {
    // 管的是整套部署共用的那一份模型凭据，故比 assistant:use 严一档
    path: '/system/assistant',
    name: 'system-assistant',
    component: () => import('@/pages/System/Assistant/index.vue'),
    meta: {
      title: '助手模型',
      permissions: [PERMISSION_CODES.assistantManage],
    },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/pages/Forbidden/index.vue'),
    meta: { title: '无权访问' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFound/index.vue'),
    meta: { anonymous: true, title: '页面不存在' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

installAuthGuard(router)
