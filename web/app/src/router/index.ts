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
    path: '/hvac/spaces',
    name: 'hvac-spaces',
    component: () => import('@/pages/Hvac/Spaces/index.vue'),
    meta: {
      title: '空间配置',
      permissions: [PERMISSION_CODES.acView],
    },
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
