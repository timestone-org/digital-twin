/**
 * @fileoverview 路由表与守卫。
 * ⚠ `meta.permissions` 是闸 3：它只决定「看不看得见入口」，
 * 真正的拦截在 auth-server 的路由规则与端点权限上。
 */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { PERMISSION_CODES } from '@dt/contracts'

import { installAuthGuard } from './guards'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/Login/index.vue'),
    meta: { anonymous: true, title: '登录' },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/Home/index.vue'),
    meta: { title: '控制台' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/pages/Profile/index.vue'),
    meta: { title: '个人资料' },
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
