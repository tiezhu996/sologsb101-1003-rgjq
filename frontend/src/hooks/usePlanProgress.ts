/**
 * 计划完成率汇总 hook
 * 按周期类型汇总计划完成率、逾期清单与签署覆盖率，被保养计划页、电梯档案页消费。
 */
import { computed, type ComputedRef } from 'vue';
import { usePlanStore } from '../stores/planStore';
import type { MaintCycle } from '../types/elevator';
import { MAINT_CYCLE_LABEL } from '../types/elevator';
import type { PlanView } from '../types/plan';
import { todayDate } from '../utils/duration';

export interface CycleGroupStat {
  cycleType: MaintCycle;
  label: string;
  total: number;
  signed: number;
  overdue: number;
  /** 完成率（%） */
  completion: number;
  /** 平均完成度（%） */
  averageProgress: number;
}

export interface PlanProgressResult {
  /** 全量计划视图 */
  plans: ComputedRef<PlanView[]>;
  /** 按周期分组统计 */
  cycleStats: ComputedRef<CycleGroupStat[]>;
  /** 逾期清单（按计划日期升序） */
  overduePlans: ComputedRef<PlanView[]>;
  /** 整体完成率（%） */
  overallCompletion: ComputedRef<number>;
  /** 签署覆盖率（%）：已完成保养项的占比 */
  signCoverage: ComputedRef<number>;
  /** 待执行 / 执行中数量 */
  stateCounts: ComputedRef<{ pending: number; executing: number; signed: number }>;
  /** 未来 7 天内到期的计划 */
  dueSoonPlans: ComputedRef<PlanView[]>;
}

/** 逾期清单与完成率派生 */
export function usePlanProgress(): PlanProgressResult {
  const planStore = usePlanStore();
  const plans = computed(() => planStore.planViews);

  const cycleStats = computed<CycleGroupStat[]>(() =>
    (Object.keys(MAINT_CYCLE_LABEL) as MaintCycle[]).map((cycleType) => {
      const scoped = plans.value.filter((item) => item.cycleType === cycleType);
      const signed = scoped.filter((item) => item.state === 'signed').length;
      const overdue = scoped.filter((item) => item.overdue).length;
      const total = scoped.length;
      return {
        cycleType,
        label: MAINT_CYCLE_LABEL[cycleType],
        total,
        signed,
        overdue,
        completion: total === 0 ? 0 : Number(((signed / total) * 100).toFixed(1)),
        averageProgress:
          total === 0
            ? 0
            : Number((scoped.reduce((sum, item) => sum + item.progress, 0) / total).toFixed(1)),
      };
    }),
  );

  const overduePlans = computed(() =>
    plans.value.filter((item) => item.overdue).sort((a, b) => a.planDate.localeCompare(b.planDate)),
  );

  const overallCompletion = computed(() => {
    const total = plans.value.length;
    if (total === 0) return 0;
    const signed = plans.value.filter((item) => item.state === 'signed').length;
    return Number(((signed / total) * 100).toFixed(1));
  });

  const signCoverage = computed(() => {
    const items = plans.value.reduce((sum, item) => sum + item.itemCount, 0);
    if (items === 0) return 0;
    const filled = plans.value.reduce((sum, item) => sum + item.filledCount, 0);
    return Number(((filled / items) * 100).toFixed(1));
  });

  const stateCounts = computed(() => ({
    pending: plans.value.filter((item) => item.state === 'pending').length,
    executing: plans.value.filter((item) => item.state === 'executing').length,
    signed: plans.value.filter((item) => item.state === 'signed').length,
  }));

  const dueSoonPlans = computed(() => {
    const today = todayDate();
    const limit = new Date(`${today}T00:00:00`);
    limit.setDate(limit.getDate() + 7);
    const limitText = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(
      limit.getDate(),
    ).padStart(2, '0')}`;
    return plans.value.filter(
      (item) => item.state !== 'signed' && item.planDate >= today && item.planDate <= limitText,
    );
  });

  return {
    plans,
    cycleStats,
    overduePlans,
    overallCompletion,
    signCoverage,
    stateCounts,
    dueSoonPlans,
  };
}
