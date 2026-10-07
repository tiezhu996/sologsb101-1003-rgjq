<script setup lang="ts">
/**
 * 应用根组件：外层主题与全局消息容器。
 * 内部布局组件（AppLayout）通过 useMessage 消费消息 API。
 */
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, zhCN, dateZhCN } from 'naive-ui';
import AppLayout from './AppLayout.vue';

/** 主题：电梯井道青绿 + 安全橙，工程台账观感 */
const themeOverrides = {
  common: {
    primaryColor: '#18a058',
    primaryColorHover: '#36ad6a',
    primaryColorPressed: '#0c7a43',
    primaryColorSuppl: '#36ad6a',
    infoColor: '#2080f0',
    warningColor: '#f0a020',
    errorColor: '#d03050',
    borderRadius: '8px',
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", system-ui, sans-serif',
  },
  Card: { borderColor: 'rgba(24, 160, 88, 0.18)' },
  DataTable: { thColor: '#f3f9f5' },
};
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <app-layout />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
