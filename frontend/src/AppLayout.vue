<script setup lang="ts">
/**
 * 应用外壳：左侧导航 + 顶栏统计 + 内容出口。
 * 首屏在此处初始化 IndexedDB 并播种演示数据（store.bootstrap 幂等）。
 */
import { computed, onMounted } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import {
  NBadge,
  NButton,
  NLayout,
  NLayoutContent,
  NLayoutFooter,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NSpace,
  NTag,
  NText,
  useMessage,
  type MenuOption,
} from 'naive-ui';
import { ROUTES } from './router';
import { useElevatorStore } from './stores/elevatorStore';
import { usePlanStore } from './stores/planStore';
import { useCheckStore } from './stores/checkStore';
import { useRescueStore } from './stores/rescueStore';
import { useRectifyStore } from './stores/rectifyStore';
import { formatAverageMinutes } from './utils/duration';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const elevatorStore = useElevatorStore();
const planStore = usePlanStore();
const checkStore = useCheckStore();
const rescueStore = useRescueStore();
const rectifyStore = useRectifyStore();

onMounted(async () => {
  try {
    await elevatorStore.bootstrap();
    await Promise.all([planStore.bootstrap(), checkStore.bootstrap(), rescueStore.bootstrap(), rectifyStore.bootstrap()]);
  } catch (error) {
    message.error(`本地数据库初始化失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
});

/** 侧边导航：保养执行页归入保养计划菜单 */
const selectedKey = computed(() => {
  if (route.path.startsWith('/plans')) return ROUTES.plans;
  if (route.path.startsWith('/rescues')) return ROUTES.rescues;
  if (route.path.startsWith('/rectifies')) return ROUTES.rectifies;
  return ROUTES.elevators;
});

const menuOptions = computed<MenuOption[]>(() => [
  { label: '电梯档案', key: ROUTES.elevators },
  {
    label: `保养计划（${planStore.planViews.length}）`,
    key: ROUTES.plans,
  },
  { label: `困人救援时间线（${rescueStore.rescueViews.length}）`, key: ROUTES.rescues },
  {
    label: `年检整改与预警${rectifyStore.overdueViews.length > 0 ? `（超期 ${rectifyStore.overdueViews.length}）` : ''}`,
    key: ROUTES.rectifies,
  },
]);

function onMenuSelect(key: string): void {
  void router.push(key);
}
</script>

<template>
  <n-layout class="app-shell">
    <n-layout-sider width="240" class="app-sider" :native-scrollbar="false">
      <div class="app-brand">
        <div class="app-brand-title">电梯维保工序与困人救援台账</div>
        <div class="app-brand-sub">gbelevsvc · 周期保养 / 逐项签署 / 救援复盘</div>
        <div class="app-brand-bar" />
      </div>
      <n-menu
        :value="selectedKey"
        :options="menuOptions"
        :root-indent="18"
        @update:value="onMenuSelect"
      />
      <div class="app-side-stats">
        <div>电梯 {{ elevatorStore.elevators.length }} 台</div>
        <div>
          计划 {{ planStore.planViews.length }} 期 · 逾期
          {{ planStore.planViews.filter((item) => item.overdue).length }}
        </div>
        <div>
          困人均值 {{ formatAverageMinutes(rescueStore.rescueViews.reduce((sum, item) => sum + item.rescueMinutes, 0), rescueStore.rescueViews.length) }}
        </div>
        <div>待整改 {{ rectifyStore.pendingViews.length }} 项</div>
      </div>
    </n-layout-sider>

    <n-layout class="app-main">
      <n-layout-header class="app-header" bordered>
        <n-space align="center" :size="10" :wrap="true">
          <n-text strong>当前电梯：</n-text>
          <n-tag v-if="elevatorStore.activeElevator" type="success" round>
            {{ elevatorStore.activeElevator.regCode }} · {{ elevatorStore.activeElevator.owner }}
          </n-tag>
          <n-tag v-else round>未选择电梯</n-tag>
          <n-tag v-if="elevatorStore.activeElevator" round>
            载重 {{ elevatorStore.activeElevator.loadKg }}kg · {{ elevatorStore.activeElevator.stops }} 层站
          </n-tag>
        </n-space>
        <n-space align="center" :size="10" :wrap="true">
          <n-badge
            :value="planStore.planViews.filter((item) => item.overdue).length"
            :max="99"
            type="error"
            :show-zero="true"
          >
            <n-tag round>逾期计划</n-tag>
          </n-badge>
          <n-badge :value="rectifyStore.overdueViews.length" :max="99" type="warning" :show-zero="true">
            <n-tag round>超期整改</n-tag>
          </n-badge>
          <n-button size="small" type="primary" @click="router.push(ROUTES.plans)">进入保养计划</n-button>
        </n-space>
      </n-layout-header>

      <n-layout-content class="app-content" :native-scrollbar="false">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </n-layout-content>

      <n-layout-footer class="app-footer">
        数据仅保存在本机浏览器 IndexedDB（库名 gbelevsvc）· 纯前端 SPA，无后端与外部接口
      </n-layout-footer>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-sider {
  background: #0b3b2e;
  color: #d8f2ec;
}
.app-brand {
  padding: 18px 16px 10px;
}
.app-brand-title {
  color: #d8f2ec;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.app-brand-sub {
  color: rgba(216, 242, 236, 0.62);
  font-size: 12px;
  margin-top: 6px;
}
.app-brand-bar {
  height: 3px;
  margin-top: 10px;
  border-radius: 3px;
  background: linear-gradient(90deg, #18a058, #63e2b7 60%, #2080f0);
}
.app-side-stats {
  margin: 14px 16px 20px;
  padding-top: 12px;
  border-top: 1px dashed rgba(216, 242, 236, 0.25);
  color: rgba(216, 242, 236, 0.72);
  font-size: 12px;
  line-height: 2;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 18px;
  background: #ffffff;
}
.app-content {
  padding: 18px;
  background: #f2f8f4;
  min-height: 320px;
}
.app-footer {
  text-align: center;
  padding: 12px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  background: transparent;
}
</style>
