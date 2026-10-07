/**
 * 电梯档案状态（Pinia）
 * 维护电梯列表、使用单位分组、当前选中电梯与卡片回显派生值（超期项 / 待整改数）。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  ROW_REVISION,
  initDatabase,
  listElevators,
  listPlans,
  listRectifies,
  listRescues,
  putElevator,
  removeElevator,
  type ElevatorRow,
  type PlanRow,
  type RectifyRow,
  type RescueRow,
} from '../utils/db';
import type { ElevatorDraft, ElevatorView } from '../types/elevator';
import { isPlanOverdue } from '../types/plan';
import { overdueDaysOf } from '../types/rectify';
import { rescueMinutes } from '../utils/duration';
import { nextPlanDate } from '../utils/cycle';
import { nowDateTime } from '../utils/duration';
import { uuid } from '../utils/export';
import { emitChange, onChange } from '../utils/events';

export const useElevatorStore = defineStore('elevator', () => {
  const elevators = ref<ElevatorRow[]>([]);
  const plans = ref<PlanRow[]>([]);
  const rescues = ref<RescueRow[]>([]);
  const rectifies = ref<RectifyRow[]>([]);
  const activeElevatorId = ref<string>('');
  const loading = ref(false);
  const error = ref('');
  const initialized = ref(false);

  let subscribed = false;

  /** 读取全部相关表并按引用组装 */
  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [elevatorRows, planRows, rescueRows, rectifyRows] = await Promise.all([
        listElevators(),
        listPlans(),
        listRescues(),
        listRectifies(),
      ]);
      elevators.value = elevatorRows;
      plans.value = planRows;
      rescues.value = rescueRows;
      rectifies.value = rectifyRows;
      error.value = '';
      if (!activeElevatorId.value || !elevatorRows.some((item) => item.id === activeElevatorId.value)) {
        activeElevatorId.value = elevatorRows[0]?.id ?? '';
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '电梯数据读取失败';
    } finally {
      loading.value = false;
    }
  }

  /** 首屏初始化：打开库、按需播种、订阅变更（只执行一次） */
  async function bootstrap(): Promise<void> {
    if (!initialized.value) {
      await initDatabase();
      initialized.value = true;
    }
    if (!subscribed) {
      subscribed = true;
      onChange(() => {
        void load();
      });
    }
    await load();
  }

  async function createElevator(draft: ElevatorDraft): Promise<ElevatorRow> {
    const row: ElevatorRow = {
      id: uuid(),
      regCode: draft.regCode.trim(),
      owner: draft.owner.trim(),
      loadKg: draft.loadKg,
      stops: draft.stops,
      useDate: draft.useDate,
      maintCycle: draft.maintCycle,
      createdAt: nowDateTime(),
      revision: ROW_REVISION,
    };
    await putElevator(row);
    activeElevatorId.value = row.id;
    emitChange();
    return row;
  }

  async function updateElevator(id: string, draft: ElevatorDraft): Promise<void> {
    const existing = elevators.value.find((item) => item.id === id);
    if (!existing) return;
    await putElevator({
      ...existing,
      regCode: draft.regCode.trim(),
      owner: draft.owner.trim(),
      loadKg: draft.loadKg,
      stops: draft.stops,
      useDate: draft.useDate,
      maintCycle: draft.maintCycle,
    });
    emitChange();
  }

  async function deleteElevator(id: string): Promise<void> {
    await removeElevator(id);
    if (activeElevatorId.value === id) activeElevatorId.value = '';
    emitChange();
  }

  function setActive(id: string): void {
    activeElevatorId.value = id;
  }

  /** 使用单位分组 */
  const ownerGroups = computed(() => {
    const buckets = new Map<string, ElevatorRow[]>();
    for (const item of elevators.value) {
      const list = buckets.get(item.owner);
      if (list) list.push(item);
      else buckets.set(item.owner, [item]);
    }
    return [...buckets.entries()]
      .map(([owner, items]) => ({ owner, count: items.length, items }))
      .sort((a, b) => b.count - a.count);
  });

  /** 当前选中电梯 */
  const activeElevator = computed(
    () => elevators.value.find((item) => item.id === activeElevatorId.value) ?? null,
  );

  /** 电梯卡片视图：回显超期项与待整改数 */
  const elevatorViews = computed<ElevatorView[]>(() =>
    elevators.value.map((elevator) => {
      const ownedPlans = plans.value.filter((item) => item.elevatorId === elevator.id);
      const overduePlanCount = ownedPlans.filter((item) => isPlanOverdue(item)).length;
      const pendingRectifyCount = rectifies.value.filter((item) => {
        if (item.elevatorId !== elevator.id) return false;
        return item.state === 'pending' && overdueDaysOf(item.dueDate, item.state) >= 0;
      }).length;
      const ownedRescues = rescues.value
        .filter((item) => item.elevatorId === elevator.id)
        .sort((a, b) => b.alarmAt.localeCompare(a.alarmAt));
      const lastRescue = ownedRescues[0];
      const signed = ownedPlans.filter((item) => item.state === 'signed');
      const lastSignedDate =
        signed.length > 0
          ? signed.map((item) => item.planDate).sort((a, b) => b.localeCompare(a))[0]
          : elevator.useDate;
      return {
        ...elevator,
        planCount: ownedPlans.length,
        overduePlanCount,
        pendingRectifyCount,
        lastRescueMinutes: lastRescue ? rescueMinutes(lastRescue.alarmAt, lastRescue.rescueAt) : null,
        nextPlanDate: nextPlanDate(lastSignedDate, elevator.maintCycle),
      };
    }),
  );

  const pendingRectifyTotal = computed(
    () => rectifies.value.filter((item) => item.state === 'pending').length,
  );

  return {
    elevators,
    plans,
    rescues,
    rectifies,
    activeElevatorId,
    loading,
    error,
    initialized,
    load,
    bootstrap,
    createElevator,
    updateElevator,
    deleteElevator,
    setActive,
    ownerGroups,
    activeElevator,
    elevatorViews,
    pendingRectifyTotal,
  };
});
