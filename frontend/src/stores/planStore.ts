/**
 * 保养计划状态（Pinia）
 * 维护计划生成规则、执行人指派、状态流转与完成度派生值。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  ROW_REVISION,
  listCheckItems,
  listElevators,
  listPlans,
  planDatesFrom,
  putPlan,
  putPlans,
  putCheckItems,
  removePlan,
  type CheckItemRow,
  type ElevatorRow,
  type PlanRow,
} from '../utils/db';
import { itemsForCycle } from '../types/checkItem';
import { isPlanOverdue, planProgress, type PlanDraft, type PlanState, type PlanView } from '../types/plan';
import type { MaintCycle } from '../types/elevator';
import { nowDateTime, todayDate } from '../utils/duration';
import { uuid } from '../utils/export';
import { emitChange, onChange } from '../utils/events';

export interface BatchGenerateInput {
  elevatorIds: string[];
  cycleType: MaintCycle;
  startDate: string;
  /** 连续生成期数 */
  periods: number;
  executor: string;
}

/** 批量生成结果：新增 / 合入 / 阻断 分类计数 */
export interface BatchGenerateResult {
  /** 新增计划期数 */
  created: number;
  /** 合入已有未签计划的期数（不新增计划，仅补必检项） */
  merged: number;
  /** 因已签署同期计划被整台阻断的电梯数 */
  blocked: number;
  /** 阻断明细：电梯与冲突日期 */
  blockedDetails: Array<{ elevatorId: string; elevatorLabel: string; planDate: string }>;
}

export const usePlanStore = defineStore('plan', () => {
  const plans = ref<PlanRow[]>([]);
  const elevators = ref<ElevatorRow[]>([]);
  const checkItems = ref<CheckItemRow[]>([]);
  const activePlanId = ref<string>('');
  /** 列表筛选：周期类型（空数组表示全部） */
  const cycleFilters = ref<MaintCycle[]>([]);
  /** 列表筛选：状态 */
  const stateFilters = ref<PlanState[]>([]);
  const loading = ref(false);
  const error = ref('');
  const initialized = ref(false);
  let subscribed = false;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [planRows, elevatorRows, itemRows] = await Promise.all([
        listPlans(),
        listElevators(),
        listCheckItems(),
      ]);
      plans.value = planRows;
      elevators.value = elevatorRows;
      checkItems.value = itemRows;
      error.value = '';
      if (!activePlanId.value || !planRows.some((item) => item.id === activePlanId.value)) {
        activePlanId.value = planRows[0]?.id ?? '';
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保养计划读取失败';
    } finally {
      loading.value = false;
    }
  }

  async function bootstrap(): Promise<void> {
    if (!initialized.value) initialized.value = true;
    if (!subscribed) {
      subscribed = true;
      onChange(() => {
        void load();
      });
    }
    await load();
  }

  function setCycleFilters(values: MaintCycle[]): void {
    cycleFilters.value = values;
  }

  function setStateFilters(values: PlanState[]): void {
    stateFilters.value = values;
  }

  function setActivePlan(id: string): void {
    activePlanId.value = id;
  }

  /** 为指定电梯生成一期计划（同时生成保养项清单） */
  async function createPlan(draft: PlanDraft): Promise<PlanRow> {
    const row: PlanRow = {
      id: uuid(),
      elevatorId: draft.elevatorId,
      cycleType: draft.cycleType,
      planDate: draft.planDate,
      executor: draft.executor.trim(),
      state: 'pending',
      signedAt: null,
      createdAt: nowDateTime(),
      revision: ROW_REVISION,
    };
    await putPlan(row);
    await putCheckItems(
      itemsForCycle(row.cycleType).map((itemName, index) => ({
        id: `chk-${row.id}-${index + 1}`,
        planId: row.id,
        seq: index + 1,
        itemName,
        result: null,
        value: '',
        remark: '',
        createdAt: nowDateTime(),
        revision: ROW_REVISION,
      })),
    );
    emitChange();
    return row;
  }

  /**
   * 按周期批量生成计划（多电梯 × 多期）
   * 去重口径：先按电梯 + 计划日期查已有计划——
   * - 有未签计划：不重复生成，把后到周期缺的必检项合入原计划（周期按先创建那一期，
   *   保留已填结果、备注与自定义项）；
   * - 有已签署计划：不能改动，整台阻断并记录电梯与日期；
   * - 无同期计划：正常新增。同一电梯多期相撞逐期按此口径处理。
   */
  async function batchGenerate(input: BatchGenerateInput): Promise<BatchGenerateResult> {
    const result: BatchGenerateResult = { created: 0, merged: 0, blocked: 0, blockedDetails: [] };
    const newPlans: PlanRow[] = [];
    const newItems: CheckItemRow[] = [];
    const stamp = nowDateTime();

    for (const elevatorId of input.elevatorIds) {
      const dates = planDatesFrom(input.startDate, input.cycleType, input.periods);
      // 按电梯 + 计划日期查已有计划（一期可能撞上多条历史重复数据，取先创建的一期为准）
      const existingOf = (planDate: string): PlanRow[] =>
        plans.value
          .filter((item) => item.elevatorId === elevatorId && item.planDate === planDate)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      // 已签署的同期计划不能改动：整台阻断并说明电梯和日期
      const signedDates = dates.filter((planDate) =>
        existingOf(planDate).some((item) => item.state === 'signed'),
      );
      if (signedDates.length > 0) {
        const elevator = elevators.value.find((item) => item.id === elevatorId);
        const elevatorLabel = elevator ? `${elevator.regCode}（${elevator.owner}）` : elevatorId;
        result.blocked += 1;
        for (const planDate of signedDates) {
          result.blockedDetails.push({ elevatorId, elevatorLabel, planDate });
        }
        continue;
      }

      for (const planDate of dates) {
        const target = existingOf(planDate)[0];
        if (!target) {
          // 无同期计划：新增一期并生成必检项清单
          const id = uuid();
          newPlans.push({
            id,
            elevatorId,
            cycleType: input.cycleType,
            planDate,
            executor: input.executor.trim(),
            state: 'pending',
            signedAt: null,
            createdAt: stamp,
            revision: ROW_REVISION,
          });
          newItems.push(
            ...itemsForCycle(input.cycleType).map((itemName, index) => ({
              id: `chk-${id}-${index + 1}`,
              planId: id,
              seq: index + 1,
              itemName,
              result: null,
              value: '',
              remark: '',
              createdAt: stamp,
              revision: ROW_REVISION,
            })),
          );
          result.created += 1;
          continue;
        }
        // 已有未签计划：周期保持先创建那一期，仅补后到周期缺的必检项，
        // 已填结果、备注与自定义项原样保留
        result.merged += 1;
        const existingItems = checkItems.value.filter((item) => item.planId === target.id);
        const existingNames = new Set(existingItems.map((item) => item.itemName));
        let seq = existingItems.reduce((max, item) => Math.max(max, item.seq), 0);
        for (const itemName of itemsForCycle(input.cycleType)) {
          if (existingNames.has(itemName)) continue;
          seq += 1;
          newItems.push({
            id: `chk-${target.id}-${seq}`,
            planId: target.id,
            seq,
            itemName,
            result: null,
            value: '',
            remark: '',
            createdAt: stamp,
            revision: ROW_REVISION,
          });
        }
      }
    }

    if (newPlans.length > 0) await putPlans(newPlans);
    if (newItems.length > 0) await putCheckItems(newItems);
    if (newPlans.length > 0 || newItems.length > 0) emitChange();
    return result;
  }

  async function updatePlan(id: string, draft: PlanDraft): Promise<void> {
    const existing = plans.value.find((item) => item.id === id);
    if (!existing) return;
    await putPlan({
      ...existing,
      elevatorId: draft.elevatorId,
      cycleType: draft.cycleType,
      planDate: draft.planDate,
      executor: draft.executor.trim(),
    });
    emitChange();
  }

  /** 指派执行人 */
  async function assignExecutor(id: string, executor: string): Promise<void> {
    const existing = plans.value.find((item) => item.id === id);
    if (!existing) return;
    await putPlan({ ...existing, executor: executor.trim() });
    emitChange();
  }

  /** 状态流转：待执行 → 执行中 → 已签署 */
  async function updateState(id: string, state: PlanState): Promise<void> {
    const existing = plans.value.find((item) => item.id === id);
    if (!existing) return;
    await putPlan({
      ...existing,
      state,
      signedAt: state === 'signed' ? nowDateTime() : null,
    });
    emitChange();
  }

  /** 签署：要求全部保养项已填写结果 */
  async function signPlan(id: string): Promise<{ ok: boolean; message: string }> {
    const existing = plans.value.find((item) => item.id === id);
    if (!existing) return { ok: false, message: '计划不存在' };
    const items = checkItems.value.filter((item) => item.planId === id);
    const unfilled = items.filter((item) => item.result === null);
    if (items.length === 0) return { ok: false, message: '该计划没有保养项' };
    if (unfilled.length > 0) {
      return { ok: false, message: `还有 ${unfilled.length} 项未填写结果，无法签署` };
    }
    await putPlan({ ...existing, state: 'signed', signedAt: nowDateTime() });
    emitChange();
    return { ok: true, message: '签署完成' };
  }

  async function deletePlan(id: string): Promise<void> {
    await removePlan(id);
    if (activePlanId.value === id) activePlanId.value = '';
    emitChange();
  }

  /** 计划视图：附带电梯上下文、完成度与逾期判定 */
  const planViews = computed<PlanView[]>(() =>
    plans.value.map((plan) => {
      const elevator = elevators.value.find((item) => item.id === plan.elevatorId);
      const items = checkItems.value.filter((item) => item.planId === plan.id);
      const filledCount = items.filter((item) => item.result !== null).length;
      const abnormalCount = items.filter(
        (item) => item.result === 'abnormal' || item.result === 'advice',
      ).length;
      return {
        ...plan,
        elevatorName: elevator ? `${elevator.regCode}（${elevator.owner}）` : '已删除电梯',
        owner: elevator?.owner ?? '-',
        itemCount: items.length,
        filledCount,
        abnormalCount,
        overdue: isPlanOverdue(plan),
        progress: planProgress(filledCount, items.length),
      };
    }),
  );

  /** 应用列表筛选后的计划 */
  const filteredPlans = computed(() =>
    planViews.value.filter((plan) => {
      if (cycleFilters.value.length > 0 && !cycleFilters.value.includes(plan.cycleType)) return false;
      if (stateFilters.value.length > 0 && !stateFilters.value.includes(plan.state)) return false;
      return true;
    }),
  );

  /** 未来待执行计划（用于生成提示） */
  const upcomingPlans = computed(() =>
    planViews.value
      .filter((plan) => plan.state !== 'signed')
      .sort((a, b) => a.planDate.localeCompare(b.planDate)),
  );

  const planOfId = computed(() => (id: string) => planViews.value.find((item) => item.id === id) ?? null);

  const executorOptions = computed(() => {
    const names = new Set(plans.value.map((item) => item.executor).filter(Boolean));
    for (const fallback of ['刘建国', '张海涛', '陈志远', '李强']) names.add(fallback);
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  });

  const todayPlanCount = computed(
    () => plans.value.filter((item) => item.planDate === todayDate()).length,
  );

  return {
    plans,
    elevators,
    checkItems,
    activePlanId,
    cycleFilters,
    stateFilters,
    loading,
    error,
    initialized,
    load,
    bootstrap,
    setCycleFilters,
    setStateFilters,
    setActivePlan,
    createPlan,
    batchGenerate,
    updatePlan,
    assignExecutor,
    updateState,
    signPlan,
    deletePlan,
    planViews,
    filteredPlans,
    upcomingPlans,
    planOfId,
    executorOptions,
    todayPlanCount,
  };
});
