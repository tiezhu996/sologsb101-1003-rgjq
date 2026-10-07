/**
 * 保养项状态（Pinia）
 * 维护当前执行计划的保养项清单、逐项签署结果与异常项转整改。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  ROW_REVISION,
  listCheckItems,
  listElevators,
  listPlans,
  putCheckItem,
  putCheckItems,
  removeCheckItem,
  type CheckItemRow,
  type ElevatorRow,
  type PlanRow,
} from '../utils/db';
import {
  itemsForCycle,
  isAbnormal,
  type CheckItemDraft,
  type CheckItemView,
  type CheckResult,
} from '../types/checkItem';
import { nowDateTime } from '../utils/duration';
import { uuid } from '../utils/export';
import { emitChange, onChange } from '../utils/events';

export const useCheckStore = defineStore('check', () => {
  const items = ref<CheckItemRow[]>([]);
  const plans = ref<PlanRow[]>([]);
  const elevators = ref<ElevatorRow[]>([]);
  /** 当前执行的计划 */
  const activePlanId = ref<string>('');
  const loading = ref(false);
  const error = ref('');
  const initialized = ref(false);
  let subscribed = false;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [itemRows, planRows, elevatorRows] = await Promise.all([
        listCheckItems(),
        listPlans(),
        listElevators(),
      ]);
      items.value = itemRows;
      plans.value = planRows;
      elevators.value = elevatorRows;
      error.value = '';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保养项读取失败';
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

  function setActivePlan(planId: string): void {
    activePlanId.value = planId;
  }

  /** 当前计划的保养项（按序号） */
  const activeItems = computed(() =>
    items.value.filter((item) => item.planId === activePlanId.value).sort((a, b) => a.seq - b.seq),
  );

  /** 保养项视图：补充计划与电梯上下文 */
  const itemViews = computed<CheckItemView[]>(() =>
    items.value.map((item) => {
      const plan = plans.value.find((row) => row.id === item.planId);
      const elevator = plan ? elevators.value.find((row) => row.id === plan.elevatorId) : undefined;
      return {
        ...item,
        elevatorId: elevator?.id ?? '',
        elevatorName: elevator ? `${elevator.regCode}（${elevator.owner}）` : '已删除电梯',
        cycleType: plan?.cycleType ?? 'halfMonth',
        planDate: plan?.planDate ?? '',
      };
    }),
  );

  /** 当前计划下的视图行 */
  const activeItemViews = computed(() =>
    itemViews.value
      .filter((item) => item.planId === activePlanId.value)
      .sort((a, b) => a.seq - b.seq),
  );

  /** 完成进度（%） */
  const activeProgress = computed(() => {
    const scoped = activeItems.value;
    if (scoped.length === 0) return 0;
    const filled = scoped.filter((item) => item.result !== null).length;
    return Number(((filled / scoped.length) * 100).toFixed(1));
  });

  /** 当前计划的异常项 */
  const activeAbnormalItems = computed(() => activeItems.value.filter((item) => isAbnormal(item.result)));

  /** 结果分布统计 */
  const resultCounts = computed(() => {
    const scoped = activeItems.value;
    return {
      normal: scoped.filter((item) => item.result === 'normal').length,
      abnormal: scoped.filter((item) => item.result === 'abnormal').length,
      advice: scoped.filter((item) => item.result === 'advice').length,
      pending: scoped.filter((item) => item.result === null).length,
    };
  });

  /** 保存单项结果 */
  async function saveItem(itemId: string, draft: CheckItemDraft): Promise<void> {
    const existing = items.value.find((item) => item.id === itemId);
    if (!existing) return;
    await putCheckItem({
      ...existing,
      itemName: draft.itemName.trim(),
      result: draft.result,
      value: draft.value.trim(),
      remark: draft.remark.trim(),
    });
    emitChange();
  }

  /** 批量保存当前计划的全部结果 */
  async function saveAll(planId: string, drafts: Array<{ id: string } & CheckItemDraft>): Promise<number> {
    const rows: CheckItemRow[] = [];
    for (const draft of drafts) {
      const existing = items.value.find((item) => item.id === draft.id);
      if (!existing) continue;
      rows.push({
        ...existing,
        itemName: draft.itemName.trim(),
        result: draft.result,
        value: draft.value.trim(),
        remark: draft.remark.trim(),
      });
    }
    if (rows.length === 0) return 0;
    await putCheckItems(rows);
    void planId;
    emitChange();
    return rows.length;
  }

  /** 快捷设置某一项结果 */
  async function setResult(itemId: string, result: CheckResult): Promise<void> {
    const existing = items.value.find((item) => item.id === itemId);
    if (!existing) return;
    await putCheckItem({ ...existing, result });
    emitChange();
  }

  /** 一键将当前计划全部未填项标为正常 */
  async function fillRestNormal(planId: string): Promise<number> {
    const targets = items.value.filter((item) => item.planId === planId && item.result === null);
    if (targets.length === 0) return 0;
    await putCheckItems(
      targets.map((item) => ({
        ...item,
        result: 'normal' as CheckResult,
        value: item.value || '符合要求',
        remark: item.remark || '',
      })),
    );
    emitChange();
    return targets.length;
  }

  /** 追加自定义保养项 */
  async function addItem(planId: string, itemName: string, seq?: number): Promise<CheckItemRow> {
    const scoped = items.value.filter((item) => item.planId === planId);
    const row: CheckItemRow = {
      id: uuid(),
      planId,
      seq: seq ?? scoped.length + 1,
      itemName: itemName.trim(),
      result: null,
      value: '',
      remark: '自定义补充项',
      createdAt: nowDateTime(),
      revision: ROW_REVISION,
    };
    await putCheckItem(row);
    emitChange();
    return row;
  }

  async function deleteItem(itemId: string): Promise<void> {
    await removeCheckItem(itemId);
    emitChange();
  }

  /** 重置某计划的保养项为出厂清单（保留自定义项之外的结构） */
  async function resetItemsToLibrary(planId: string): Promise<number> {
    const plan = plans.value.find((item) => item.id === planId);
    const cycle = plan?.cycleType ?? 'halfMonth';
    const scoped = items.value.filter((item) => item.planId === planId);
    await Promise.all(scoped.map((item) => removeCheckItem(item.id)));
    const rows: CheckItemRow[] = itemsForCycle(cycle).map((itemName, index) => ({
      id: `chk-${planId}-${index + 1}`,
      planId,
      seq: index + 1,
      itemName,
      result: null,
      value: '',
      remark: '',
      createdAt: nowDateTime(),
      revision: ROW_REVISION,
    }));
    await putCheckItems(rows);
    emitChange();
    return rows.length;
  }

  return {
    items,
    plans,
    elevators,
    activePlanId,
    loading,
    error,
    initialized,
    load,
    bootstrap,
    setActivePlan,
    activeItems,
    itemViews,
    activeItemViews,
    activeProgress,
    activeAbnormalItems,
    resultCounts,
    saveItem,
    saveAll,
    setResult,
    fillRestNormal,
    addItem,
    deleteItem,
    resetItemsToLibrary,
  };
});
