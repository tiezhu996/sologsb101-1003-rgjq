/**
 * 保养计划状态（Pinia）
 * 维护计划生成规则、执行人指派、状态流转与完成度派生值。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  ROW_REVISION,
  findPlanByElevatorDate,
  listCheckItems,
  listCheckItemsByPlan,
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
import { itemsForCycle, missingItemsForCycle } from '../types/checkItem';
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

/** 批量生成中「整台阻断」的明细 */
export interface BatchBlockDetail {
  elevatorId: string;
  /** 电梯展示名（注册代码 + 使用单位） */
  elevatorName: string;
  /** 撞期的计划日期 */
  planDate: string;
}

/** 批量生成结果：新增 / 合入 / 阻断分类计数 */
export interface BatchGenerateResult {
  /** 新建计划期数 */
  created: number;
  /** 合入既有未签署计划的期数（不新建计划，仅补齐缺的必检项） */
  merged: number;
  /** 合入时实际补充的保养项总数 */
  mergedItems: number;
  /** 因同期计划已签署而整台阻断的明细（电梯 + 日期） */
  blocked: BatchBlockDetail[];
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
   * 撞期口径：按电梯 + 计划日期先查既有计划——
   * 1. 无计划：新建一期并生成该周期必检项；
   * 2. 已有未签署计划：不再新建，把本周期缺的必检项合入原计划，
   *    保留已填结果、备注与自定义项，计划周期以先创建的一期为准（避免下一期日期漂移）；
   * 3. 已有已签署计划：不可改动，整台电梯本次阻断（不新增也不合入），结果中列明电梯与日期。
   * 同一批次内同一电梯多期相撞按同一口径处理。
   */
  async function batchGenerate(input: BatchGenerateInput): Promise<BatchGenerateResult> {
    const result: BatchGenerateResult = { created: 0, merged: 0, mergedItems: 0, blocked: [] };
    const executor = input.executor.trim();
    const newPlans: PlanRow[] = [];
    const newItems: CheckItemRow[] = [];
    const mergedItems: CheckItemRow[] = [];
    /** 批内已知的「电梯 + 日期 → 计划」，同批多期相撞时与库内计划同口径 */
    const known = new Map<string, PlanRow>();

    for (const elevatorId of [...new Set(input.elevatorIds)]) {
      const dates = planDatesFrom(input.startDate, input.cycleType, input.periods);
      const creates: string[] = [];
      const merges: Array<{ plan: PlanRow; missing: string[]; nextSeq: number }> = [];
      const blockedDates: string[] = [];

      // 先查后写：该电梯全部期次判定完再落库，任一日期撞上已签署计划即整台阻断
      for (const planDate of dates) {
        const key = `${elevatorId}|${planDate}`;
        let existing = known.get(key);
        if (!existing) {
          existing = await findPlanByElevatorDate(elevatorId, planDate);
          if (existing) known.set(key, existing);
        }
        if (!existing) {
          creates.push(planDate);
          continue;
        }
        if (existing.state === 'signed') {
          blockedDates.push(planDate);
          continue;
        }
        const items = await listCheckItemsByPlan(existing.id);
        merges.push({
          plan: existing,
          missing: missingItemsForCycle(input.cycleType, items.map((item) => item.itemName)),
          nextSeq: items.reduce((max, item) => Math.max(max, item.seq), 0),
        });
      }

      if (blockedDates.length > 0) {
        const elevator = elevators.value.find((item) => item.id === elevatorId);
        const elevatorName = elevator ? `${elevator.regCode}（${elevator.owner}）` : elevatorId;
        for (const planDate of blockedDates) {
          result.blocked.push({ elevatorId, elevatorName, planDate });
        }
        continue;
      }

      for (const planDate of creates) {
        const id = uuid();
        const row: PlanRow = {
          id,
          elevatorId,
          cycleType: input.cycleType,
          planDate,
          executor,
          state: 'pending',
          signedAt: null,
          createdAt: nowDateTime(),
          revision: ROW_REVISION,
        };
        newPlans.push(row);
        known.set(`${elevatorId}|${planDate}`, row);
        newItems.push(
          ...itemsForCycle(input.cycleType).map((itemName, index) => ({
            id: `chk-${id}-${index + 1}`,
            planId: id,
            seq: index + 1,
            itemName,
            result: null,
            value: '',
            remark: '',
            createdAt: nowDateTime(),
            revision: ROW_REVISION,
          })),
        );
        result.created += 1;
      }

      for (const merge of merges) {
        result.merged += 1;
        let seq = merge.nextSeq;
        for (const itemName of merge.missing) {
          seq += 1;
          mergedItems.push({
            id: uuid(),
            planId: merge.plan.id,
            seq,
            itemName,
            result: null,
            value: '',
            remark: '',
            createdAt: nowDateTime(),
            revision: ROW_REVISION,
          });
        }
        result.mergedItems += merge.missing.length;
      }
    }

    if (newPlans.length > 0) await putPlans(newPlans);
    const allItems = [...newItems, ...mergedItems];
    if (allItems.length > 0) await putCheckItems(allItems);
    if (newPlans.length > 0 || allItems.length > 0) emitChange();
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
