/**
 * 路由表（路径与项目提示词逐字一致）
 * /elevators、/plans、/plans/:id/items、/rescues、/rectifies
 * 全部页面按路由懒加载，构建时自动分包。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

/** 路由常量：页面跳转统一引用，避免硬编码字符串 */
export const ROUTES = {
  elevators: '/elevators',
  plans: '/plans',
  planItems: (planId: string): string => `/plans/${planId}/items`,
  rescues: '/rescues',
  rectifies: '/rectifies',
} as const;

export const appRoutes: RouteRecordRaw[] = [
  { path: '/', redirect: ROUTES.elevators },
  {
    path: ROUTES.elevators,
    name: 'elevators',
    component: () => import('../pages/ElevatorList.vue'),
    meta: { title: '电梯档案' },
  },
  {
    path: ROUTES.plans,
    name: 'plans',
    component: () => import('../pages/PlanList.vue'),
    meta: { title: '保养计划' },
  },
  {
    path: '/plans/:id/items',
    name: 'plan-items',
    component: () => import('../pages/PlanExecute.vue'),
    meta: { title: '保养执行' },
  },
  {
    path: ROUTES.rescues,
    name: 'rescues',
    component: () => import('../pages/RescueTimeline.vue'),
    meta: { title: '困人救援时间线' },
  },
  {
    path: ROUTES.rectifies,
    name: 'rectifies',
    component: () => import('../pages/RectifyList.vue'),
    meta: { title: '年检整改与预警' },
  },
  { path: '/:pathMatch(.*)*', redirect: ROUTES.elevators },
];

export const router = createRouter({
  // 使用 history 模式：与 nginx `try_files $uri $uri/ /index.html` 配合，
  // 直接访问 /elevators、/plans/:id/items 等深链接可命中对应页面并支持刷新
  history: createWebHistory(),
  routes: appRoutes,
});

export default router;
