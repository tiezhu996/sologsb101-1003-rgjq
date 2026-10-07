/**
 * 困人救援状态（Pinia）
 * 维护困人事件时间线与到场 / 救出时长派生值，并做响应时限判定。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  ROW_REVISION,
  listElevators,
  listRescues,
  putRescue,
  removeRescue,
  type ElevatorRow,
  type RescueRow,
} from '../utils/db';
import {
  ARRIVE_LIMIT_MINUTES,
  type RescueDraft,
  type RescueTimelineNode,
  type RescueView,
} from '../types/rescue';
import { arriveMinutes, nowDateTime, rescueMinutes } from '../utils/duration';
import { uuid } from '../utils/export';
import { emitChange, onChange } from '../utils/events';

export const useRescueStore = defineStore('rescue', () => {
  const rescues = ref<RescueRow[]>([]);
  const elevators = ref<ElevatorRow[]>([]);
  /** 复盘选中的事件 */
  const activeRescueId = ref<string>('');
  const loading = ref(false);
  const error = ref('');
  const initialized = ref(false);
  let subscribed = false;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [rescueRows, elevatorRows] = await Promise.all([listRescues(), listElevators()]);
      rescues.value = rescueRows;
      elevators.value = elevatorRows;
      error.value = '';
      if (!activeRescueId.value || !rescueRows.some((item) => item.id === activeRescueId.value)) {
        activeRescueId.value = rescueRows[0]?.id ?? '';
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '困人事件读取失败';
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

  async function createRescue(draft: RescueDraft): Promise<RescueRow> {
    const row: RescueRow = {
      id: uuid(),
      elevatorId: draft.elevatorId,
      alarmAt: draft.alarmAt,
      arriveAt: draft.arriveAt,
      rescueAt: draft.rescueAt,
      cause: draft.cause.trim(),
      trappedCount: draft.trappedCount,
      responder: draft.responder.trim(),
      createdAt: nowDateTime(),
      revision: ROW_REVISION,
    };
    await putRescue(row);
    activeRescueId.value = row.id;
    emitChange();
    return row;
  }

  async function updateRescue(id: string, draft: RescueDraft): Promise<void> {
    const existing = rescues.value.find((item) => item.id === id);
    if (!existing) return;
    await putRescue({
      ...existing,
      elevatorId: draft.elevatorId,
      alarmAt: draft.alarmAt,
      arriveAt: draft.arriveAt,
      rescueAt: draft.rescueAt,
      cause: draft.cause.trim(),
      trappedCount: draft.trappedCount,
      responder: draft.responder.trim(),
    });
    emitChange();
  }

  async function deleteRescue(id: string): Promise<void> {
    await removeRescue(id);
    if (activeRescueId.value === id) activeRescueId.value = '';
    emitChange();
  }

  function setActive(id: string): void {
    activeRescueId.value = id;
  }

  /** 困人事件视图：自动算到场与救援时长、时间线回放节点 */
  const rescueViews = computed<RescueView[]>(() =>
    rescues.value.map((rescue) => {
      const elevator = elevators.value.find((item) => item.id === rescue.elevatorId);
      const arrive = arriveMinutes(rescue.alarmAt, rescue.arriveAt);
      const total = rescueMinutes(rescue.alarmAt, rescue.rescueAt);
      const timeline: RescueTimelineNode[] = [
        {
          label: '接警',
          at: rescue.alarmAt,
          minutesFromAlarm: 0,
          tone: 'alarm',
          detail: `监控中心接到报警，被困 ${rescue.trappedCount} 人`,
        },
        {
          label: '到场',
          at: rescue.arriveAt,
          minutesFromAlarm: arrive,
          tone: 'arrive',
          detail:
            arrive <= ARRIVE_LIMIT_MINUTES
              ? `按时到场（${arrive} 分钟，限 ${ARRIVE_LIMIT_MINUTES} 分钟）`
              : `到场超时（${arrive} 分钟，限 ${ARRIVE_LIMIT_MINUTES} 分钟）`,
        },
        {
          label: '救出',
          at: rescue.rescueAt,
          minutesFromAlarm: total,
          tone: 'rescue',
          detail: `原因：${rescue.cause}，救援人：${rescue.responder}`,
        },
      ];
      return {
        ...rescue,
        elevatorName: elevator ? `${elevator.regCode}（${elevator.owner}）` : '已删除电梯',
        owner: elevator?.owner ?? '-',
        arriveMinutes: arrive,
        rescueMinutes: total,
        arriveInTime: arrive > 0 && arrive <= ARRIVE_LIMIT_MINUTES,
        timeline,
      };
    }),
  );

  const activeRescue = computed(
    () => rescueViews.value.find((item) => item.id === activeRescueId.value) ?? null,
  );

  /** 平均救援时长（分钟） */
  const averageRescueMinutes = computed(() => {
    if (rescueViews.value.length === 0) return 0;
    const total = rescueViews.value.reduce((sum, item) => sum + item.rescueMinutes, 0);
    return Math.round(total / rescueViews.value.length);
  });

  /** 平均到场时长（分钟） */
  const averageArriveMinutes = computed(() => {
    if (rescueViews.value.length === 0) return 0;
    const total = rescueViews.value.reduce((sum, item) => sum + item.arriveMinutes, 0);
    return Math.round(total / rescueViews.value.length);
  });

  /** 到场超时事件 */
  const lateArriveViews = computed(() => rescueViews.value.filter((item) => !item.arriveInTime));

  /** 按电梯复盘分组 */
  const byElevator = computed(() => {
    const buckets = new Map<string, RescueView[]>();
    for (const view of rescueViews.value) {
      const list = buckets.get(view.elevatorId);
      if (list) list.push(view);
      else buckets.set(view.elevatorId, [view]);
    }
    return [...buckets.entries()]
      .map(([elevatorId, items]) => ({
        elevatorId,
        elevatorName: items[0]?.elevatorName ?? '-',
        count: items.length,
        averageRescueMinutes: Math.round(
          items.reduce((sum, item) => sum + item.rescueMinutes, 0) / items.length,
        ),
        trappedTotal: items.reduce((sum, item) => sum + item.trappedCount, 0),
        items: items.sort((a, b) => b.alarmAt.localeCompare(a.alarmAt)),
      }))
      .sort((a, b) => b.count - a.count);
  });

  const trappedTotal = computed(() =>
    rescueViews.value.reduce((sum, item) => sum + item.trappedCount, 0),
  );

  const onTimeRate = computed(() => {
    if (rescueViews.value.length === 0) return 0;
    const ok = rescueViews.value.filter((item) => item.arriveInTime).length;
    return Number(((ok / rescueViews.value.length) * 100).toFixed(1));
  });

  return {
    rescues,
    elevators,
    activeRescueId,
    loading,
    error,
    initialized,
    load,
    bootstrap,
    createRescue,
    updateRescue,
    deleteRescue,
    setActive,
    rescueViews,
    activeRescue,
    averageRescueMinutes,
    averageArriveMinutes,
    lateArriveViews,
    byElevator,
    trappedTotal,
    onTimeRate,
    ARRIVE_LIMIT_MINUTES,
  };
});
