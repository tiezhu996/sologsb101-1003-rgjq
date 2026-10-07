<script setup lang="ts">
/**
 * <StatBadge> 计数与占比徽标
 * 展示计划完成率、超期数、平均救援时长等指标，被电梯档案页、困人救援页、整改页消费。
 */
import { computed } from 'vue';
import { NCard, NProgress, NStatistic } from 'naive-ui';

const props = withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    /** 单位后缀 */
    suffix?: string;
    /** 占比（0~100），提供时展示进度条 */
    percent?: number;
    /** 主色 */
    color?: string;
    /** 是否内联（无卡片外壳，用于卡片头部） */
    inline?: boolean;
    /** 说明文案 */
    hint?: string;
  }>(),
  { suffix: '', percent: undefined, color: '#18a058', inline: false, hint: '' },
);

const percentValue = computed(() =>
  typeof props.percent === 'number' ? Math.max(0, Math.min(100, Number(props.percent.toFixed(1)))) : null,
);
</script>

<template>
  <component :is="inline ? 'div' : NCard" v-bind="inline ? {} : { size: 'small', class: 'stat-badge-card' }">
    <div class="stat-badge">
      <n-statistic :label="title" :value="value">
        <template v-if="suffix" #suffix>{{ suffix }}</template>
      </n-statistic>
      <n-progress
        v-if="percentValue !== null"
        type="line"
        :percentage="percentValue"
        :color="color"
        :height="6"
        :show-indicator="false"
        style="margin-top: 6px"
      />
      <div v-if="hint" class="stat-badge-hint">{{ hint }}</div>
      <div v-if="percentValue !== null" class="stat-badge-percent" :style="{ color }">
        {{ percentValue.toFixed(1) }}%
      </div>
    </div>
  </component>
</template>

<style scoped>
.stat-badge {
  position: relative;
  min-width: 0;
}
.stat-badge :deep(.n-statistic-value__content) {
  font-size: 22px;
  font-weight: 600;
}
.stat-badge-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #8a8f99;
  line-height: 1.5;
}
.stat-badge-percent {
  position: absolute;
  right: 0;
  top: 0;
  font-size: 12px;
  font-weight: 600;
}
.stat-badge-card {
  border-radius: 10px;
}
</style>
