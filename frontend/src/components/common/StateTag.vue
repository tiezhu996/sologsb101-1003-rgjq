<script setup lang="ts">
/**
 * <StateTag> 状态徽标
 * 按待执行/执行中/已签署、待整改/已复核渲染状态底色，
 * 被保养计划页、保养执行页、整改页消费。
 */
import { computed } from 'vue';
import { NTag } from 'naive-ui';
import { CHECK_RESULT_LABEL, type CheckResult } from '../../types/checkItem';
import { PLAN_STATE_LABEL, type PlanState } from '../../types/plan';
import { RECTIFY_STATE_LABEL, type RectifyState } from '../../types/rectify';

type TagTone = 'default' | 'success' | 'warning' | 'error' | 'info';

const props = withDefaults(
  defineProps<{
    /** 状态值：计划状态 / 整改状态 / 保养项结果三选一 */
    value: PlanState | RectifyState | CheckResult;
    /** 状态口径，缺省按计划状态渲染 */
    kind?: 'plan' | 'rectify' | 'result';
    /** 是否附带超期提示 */
    overdue?: boolean;
    /** 超期天数 */
    overdueDays?: number;
  }>(),
  { kind: 'plan', overdue: false, overdueDays: 0 },
);

const PLAN_TONE: Record<PlanState, TagTone> = {
  pending: 'default',
  executing: 'info',
  signed: 'success',
};

const RECTIFY_TONE: Record<RectifyState, TagTone> = {
  pending: 'warning',
  reviewed: 'success',
};

const RESULT_TONE: Record<CheckResult, TagTone> = {
  normal: 'success',
  abnormal: 'error',
  advice: 'warning',
};

const label = computed(() => {
  if (props.kind === 'plan') return PLAN_STATE_LABEL[props.value as PlanState] ?? '未知';
  if (props.kind === 'rectify') return RECTIFY_STATE_LABEL[props.value as RectifyState] ?? '未知';
  return CHECK_RESULT_LABEL[props.value as CheckResult] ?? '未知';
});

const tone = computed<TagTone>(() => {
  if (props.kind === 'plan') return PLAN_TONE[props.value as PlanState] ?? 'default';
  if (props.kind === 'rectify') return RECTIFY_TONE[props.value as RectifyState] ?? 'default';
  return RESULT_TONE[props.value as CheckResult] ?? 'default';
});
</script>

<template>
  <span class="state-tag">
    <n-tag :type="tone" size="small" round :bordered="false">{{ label }}</n-tag>
    <n-tag v-if="overdue" type="error" size="small" round style="margin-left: 6px">
      超期{{ overdueDays > 0 ? ` ${overdueDays} 天` : '' }}
    </n-tag>
  </span>
</template>

<style scoped>
.state-tag {
  display: inline-flex;
  align-items: center;
}
</style>
