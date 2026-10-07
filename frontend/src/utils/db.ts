/**
 * IndexedDB 持久化层（Dexie 封装）· 电梯维保工序与困人救援台账
 * - 数据结构版本号 + 升级迁移逻辑
 * - 各实体表增删改查（含级联删除）
 * - 首屏自动播种互相引用的演示数据（电梯 → 计划 → 保养项 / 困人事件 / 整改单）
 * 纯前端应用：不依赖任何后端或数据库服务
 */
import Dexie, { type Table } from 'dexie';
import type { Elevator } from '../types/elevator';
import type { Plan } from '../types/plan';
import type { CheckItem, CheckResult } from '../types/checkItem';
import { itemsForCycle } from '../types/checkItem';
import type { Rescue } from '../types/rescue';
import type { Rectify } from '../types/rectify';
import { ROW_REVISION, type Revisioned } from '../types/persistence';
import { addDays, generatePlanDates, nextPlanDate } from './cycle';
import { nowDateTime, rescueMinutes, todayDate } from './duration';

/** 浏览器 IndexedDB 库名 */
export const DB_NAME = 'gbelevsvc';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

export { ROW_REVISION };
export type { Revisioned };

export type ElevatorRow = Elevator;
export type PlanRow = Plan;
export type CheckItemRow = CheckItem;
export type RescueRow = Rescue;
export type RectifyRow = Rectify;

class ElevatorServiceDatabase extends Dexie {
  elevators!: Table<ElevatorRow, string>;
  plans!: Table<PlanRow, string>;
  checkItems!: Table<CheckItemRow, string>;
  rescues!: Table<RescueRow, string>;
  rectifies!: Table<RectifyRow, string>;
  settings!: Table<{ id: string; value: string; updatedAt: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构（保留历史数据）
    this.version(1).stores({
      elevators: 'id, regCode, owner, maintCycle',
      plans: 'id, elevatorId, cycleType, state, planDate',
      checkItems: 'id, planId, seq, result',
      rescues: 'id, elevatorId, alarmAt',
      rectifies: 'id, elevatorId, state, dueDate',
    });

    // v2：新增 revision 行修订号；计划补充 executor 索引，保养项补充 itemName 索引，
    //     困人事件补充 responder 索引，并新增 settings 表存放自定义字典
    this.version(DB_SCHEMA_VERSION)
      .stores({
        elevators: 'id, regCode, owner, maintCycle, useDate',
        plans: 'id, elevatorId, cycleType, state, planDate, executor, [elevatorId+planDate]',
        checkItems: 'id, planId, seq, result, itemName, [planId+seq]',
        rescues: 'id, elevatorId, alarmAt, responder',
        rectifies: 'id, elevatorId, state, dueDate, reviewer',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const tables: Array<Table<Record<string, unknown>, string>> = [
          tx.table('elevators'),
          tx.table('plans'),
          tx.table('checkItems'),
          tx.table('rescues'),
          tx.table('rectifies'),
        ];
        for (const table of tables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            row.revision = ROW_REVISION;
            if (typeof row.createdAt !== 'string') row.createdAt = nowDateTime();
          });
        }
        // 迁移：旧版计划的执行人字段 executorName → executor
        await tx.table('plans').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.executor !== 'string' && typeof row.executorName === 'string') {
            row.executor = row.executorName;
          }
        });
        // 迁移：旧版保养项 checkedAt 作为签署时间的兜底
        await tx.table('checkItems').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.remark !== 'string') row.remark = '';
          if (row.result === undefined) row.result = null;
        });
      });
  }
}

export const db = new ElevatorServiceDatabase();

/* ============================== 演示数据播种 ============================== */

interface SeedPlanSpec {
  cycleType: Plan['cycleType'];
  offsetDays: number;
  executor: string;
  state: Plan['state'];
  /** 异常项序号（从 1 开始），空数组表示全正常 */
  abnormalSeq: number[];
  adviceSeq: number[];
}

interface SeedElevatorSpec {
  regCode: string;
  owner: string;
  loadKg: number;
  stops: number;
  useDate: string;
  maintCycle: Elevator['maintCycle'];
  plans: SeedPlanSpec[];
  rescues: Array<{
    offsetDays: number;
    alarmHour: number;
    arriveLagMinutes: number;
    rescueLagMinutes: number;
    cause: string;
    trappedCount: number;
    responder: string;
  }>;
  rectifies: Array<{ item: string; dueOffsetDays: number; state: Rectify['state']; reviewer: string }>;
}

const SEED_ELEVATORS: SeedElevatorSpec[] = [
  {
    regCode: 'DT-3101-2021-0087',
    owner: '云锦花园物业管理处',
    loadKg: 1000,
    stops: 18,
    useDate: '2021-08-16',
    maintCycle: 'halfMonth',
    plans: [
      { cycleType: 'halfMonth', offsetDays: -22, executor: '刘建国', state: 'signed', abnormalSeq: [], adviceSeq: [] },
      { cycleType: 'halfMonth', offsetDays: -7, executor: '刘建国', state: 'signed', abnormalSeq: [3], adviceSeq: [] },
      { cycleType: 'halfMonth', offsetDays: 6, executor: '张海涛', state: 'executing', abnormalSeq: [], adviceSeq: [] },
      { cycleType: 'quarter', offsetDays: -35, executor: '张海涛', state: 'signed', abnormalSeq: [], adviceSeq: [7] },
    ],
    rescues: [
      {
        offsetDays: -12,
        alarmHour: 19,
        arriveLagMinutes: 18,
        rescueLagMinutes: 41,
        cause: '门锁回路故障',
        trappedCount: 2,
        responder: '刘建国',
      },
      {
        offsetDays: -3,
        alarmHour: 8,
        arriveLagMinutes: 36,
        rescueLagMinutes: 68,
        cause: '变频器故障',
        trappedCount: 1,
        responder: '张海涛',
      },
    ],
    rectifies: [
      { item: '层门门锁啮合深度不足', dueOffsetDays: -5, state: 'pending', reviewer: '王敏' },
      { item: '轿厢应急照明失效', dueOffsetDays: 12, state: 'pending', reviewer: '王敏' },
    ],
  },
  {
    regCode: 'DT-3102-2018-0233',
    owner: '锦华商务中心',
    loadKg: 1600,
    stops: 26,
    useDate: '2018-03-05',
    maintCycle: 'quarter',
    plans: [
      { cycleType: 'quarter', offsetDays: -50, executor: '陈志远', state: 'signed', abnormalSeq: [], adviceSeq: [] },
      { cycleType: 'quarter', offsetDays: 4, executor: '陈志远', state: 'pending', abnormalSeq: [], adviceSeq: [] },
      { cycleType: 'year', offsetDays: -180, executor: '陈志远', state: 'signed', abnormalSeq: [5], adviceSeq: [] },
    ],
    rescues: [
      {
        offsetDays: -26,
        alarmHour: 14,
        arriveLagMinutes: 22,
        rescueLagMinutes: 35,
        cause: '停电困人',
        trappedCount: 3,
        responder: '陈志远',
      },
    ],
    rectifies: [
      { item: '制动器制动力矩不足', dueOffsetDays: 8, state: 'pending', reviewer: '王敏' },
    ],
  },
  {
    regCode: 'DT-3103-2022-0119',
    owner: '云锦花园物业管理处',
    loadKg: 800,
    stops: 11,
    useDate: '2022-11-21',
    maintCycle: 'halfMonth',
    plans: [
      { cycleType: 'halfMonth', offsetDays: -31, executor: '刘建国', state: 'signed', abnormalSeq: [], adviceSeq: [] },
      { cycleType: 'halfMonth', offsetDays: -2, executor: '刘建国', state: 'pending', abnormalSeq: [], adviceSeq: [] },
    ],
    rescues: [],
    rectifies: [
      { item: '超载保护装置失灵', dueOffsetDays: -11, state: 'reviewed', reviewer: '李强' },
      { item: '钢丝绳断丝超标', dueOffsetDays: 20, state: 'pending', reviewer: '李强' },
    ],
  },
];

/** 生成保养项：按周期类型选必检项，套用预设异常/建议序号 */
function buildCheckItems(
  planId: string,
  cycleType: Plan['cycleType'],
  abnormalSeq: number[],
  adviceSeq: number[],
  createdAt: string,
): CheckItemRow[] {
  return itemsForCycle(cycleType).map((itemName, index) => {
    const seq = index + 1;
    let result: CheckResult | null = null;
    let value = '';
    let remark = '';
    if (abnormalSeq.includes(seq)) {
      result = 'abnormal';
      value = itemName.includes('间隙') ? '4.8mm（标准 ≤3mm）' : '动作迟缓，需调整';
      remark = '已现场标记，需转整改单跟踪';
    } else if (adviceSeq.includes(seq)) {
      result = 'advice';
      value = '偏差处于临界值';
      remark = '建议下次保养重点复查';
    } else {
      result = 'normal';
      value = itemName.includes('平层') ? '±2mm' : itemName.includes('温度') ? '31℃' : '符合要求';
      remark = '';
    }
    return {
      id: `chk-${planId}-${seq}`,
      planId,
      seq,
      itemName,
      result,
      value,
      remark,
      createdAt,
      revision: ROW_REVISION,
    };
  });
}

/** 播种：3 台电梯 × 2~4 个计划 × 每计划 5~10 个保养项 + 困人事件 + 整改单 */
async function seedDatabase(): Promise<void> {
  const stamp = nowDateTime();
  const elevators: ElevatorRow[] = [];
  const plans: PlanRow[] = [];
  const checkItems: CheckItemRow[] = [];
  const rescues: RescueRow[] = [];
  const rectifies: RectifyRow[] = [];

  SEED_ELEVATORS.forEach((spec, elevatorIndex) => {
    const elevatorId = `elev-${elevatorIndex + 1}`;
    elevators.push({
      id: elevatorId,
      regCode: spec.regCode,
      owner: spec.owner,
      loadKg: spec.loadKg,
      stops: spec.stops,
      useDate: spec.useDate,
      maintCycle: spec.maintCycle,
      createdAt: stamp,
      revision: ROW_REVISION,
    });

    spec.plans.forEach((planSpec, planIndex) => {
      const planId = `plan-${elevatorIndex + 1}-${planIndex + 1}`;
      const planDate = addDays(todayDate(), planSpec.offsetDays);
      plans.push({
        id: planId,
        elevatorId,
        cycleType: planSpec.cycleType,
        planDate,
        executor: planSpec.executor,
        state: planSpec.state,
        signedAt: planSpec.state === 'signed' ? `${planDate} 16:20` : null,
        createdAt: stamp,
        revision: ROW_REVISION,
      });
      checkItems.push(
        ...buildCheckItems(planId, planSpec.cycleType, planSpec.abnormalSeq, planSpec.adviceSeq, stamp),
      );
    });

    spec.rescues.forEach((rescueSpec, rescueIndex) => {
      const date = addDays(todayDate(), rescueSpec.offsetDays);
      const alarmAt = `${date} ${String(rescueSpec.alarmHour).padStart(2, '0')}:05`;
      const arriveAt = `${date} ${String(
        rescueSpec.alarmHour + Math.floor((5 + rescueSpec.arriveLagMinutes) / 60),
      ).padStart(2, '0')}:${String((5 + rescueSpec.arriveLagMinutes) % 60).padStart(2, '0')}`;
      const rescueAt = `${date} ${String(
        rescueSpec.alarmHour + Math.floor((5 + rescueSpec.rescueLagMinutes) / 60),
      ).padStart(2, '0')}:${String((5 + rescueSpec.rescueLagMinutes) % 60).padStart(2, '0')}`;
      rescues.push({
        id: `rescue-${elevatorIndex + 1}-${rescueIndex + 1}`,
        elevatorId,
        alarmAt,
        arriveAt,
        rescueAt,
        cause: rescueSpec.cause,
        trappedCount: rescueSpec.trappedCount,
        responder: rescueSpec.responder,
        createdAt: stamp,
        revision: ROW_REVISION,
      });
    });

    spec.rectifies.forEach((rectifySpec, rectifyIndex) => {
      rectifies.push({
        id: `rect-${elevatorIndex + 1}-${rectifyIndex + 1}`,
        elevatorId,
        item: rectifySpec.item,
        dueDate: addDays(todayDate(), rectifySpec.dueOffsetDays),
        state: rectifySpec.state,
        reviewer: rectifySpec.reviewer,
        reviewedAt: rectifySpec.state === 'reviewed' ? `${addDays(todayDate(), -3)} 10:30` : null,
        createdAt: stamp,
        revision: ROW_REVISION,
      });
    });
  });

  await db.transaction(
    'rw',
    [db.elevators, db.plans, db.checkItems, db.rescues, db.rectifies],
    async () => {
      await db.elevators.bulkPut(elevators);
      await db.plans.bulkPut(plans);
      await db.checkItems.bulkPut(checkItems);
      await db.rescues.bulkPut(rescues);
      await db.rectifies.bulkPut(rectifies);
    },
  );
}

/* ============================== 初始化 ============================== */

/** 打开数据库；电梯表为空时播种演示数据（幂等） */
export async function initDatabase(): Promise<void> {
  await db.open();
  const count = await db.elevators.count();
  if (count === 0) {
    await seedDatabase();
  }
}

/* ============================== 电梯 ============================== */

export async function listElevators(): Promise<ElevatorRow[]> {
  const rows = await db.elevators.toArray();
  return rows.sort((a, b) => a.regCode.localeCompare(b.regCode));
}

export async function putElevator(row: ElevatorRow): Promise<void> {
  await db.elevators.put(row);
}

/** 删除电梯并级联清理计划、保养项、困人事件与整改单 */
export async function removeElevator(id: string): Promise<void> {
  await db.transaction('rw', [db.elevators, db.plans, db.checkItems, db.rescues, db.rectifies], async () => {
    const plans = await db.plans.where('elevatorId').equals(id).toArray();
    const planIds = plans.map((item) => item.id);
    if (planIds.length > 0) {
      await db.checkItems.where('planId').anyOf(planIds).delete();
    }
    await db.plans.where('elevatorId').equals(id).delete();
    await db.rescues.where('elevatorId').equals(id).delete();
    await db.rectifies.where('elevatorId').equals(id).delete();
    await db.elevators.delete(id);
  });
}

/* ============================== 计划 ============================== */

export async function listPlans(): Promise<PlanRow[]> {
  const rows = await db.plans.toArray();
  return rows.sort((a, b) => b.planDate.localeCompare(a.planDate));
}

export async function listPlansByElevator(elevatorId: string): Promise<PlanRow[]> {
  const rows = await db.plans.where('elevatorId').equals(elevatorId).toArray();
  return rows.sort((a, b) => a.planDate.localeCompare(b.planDate));
}

/** 按电梯 + 计划日期查询计划（命中 [elevatorId+planDate] 复合索引，供批量生成前查重） */
export async function findPlanByElevatorDate(
  elevatorId: string,
  planDate: string,
): Promise<PlanRow | undefined> {
  return db.plans.where('[elevatorId+planDate]').equals([elevatorId, planDate]).first();
}

export async function putPlan(row: PlanRow): Promise<void> {
  await db.plans.put(row);
}

export async function putPlans(rows: PlanRow[]): Promise<void> {
  await db.plans.bulkPut(rows);
}

/** 删除计划并级联删除保养项 */
export async function removePlan(id: string): Promise<void> {
  await db.transaction('rw', [db.plans, db.checkItems], async () => {
    await db.checkItems.where('planId').equals(id).delete();
    await db.plans.delete(id);
  });
}

/* ============================= 保养项 ============================= */

export async function listCheckItems(): Promise<CheckItemRow[]> {
  return db.checkItems.toArray();
}

export async function listCheckItemsByPlan(planId: string): Promise<CheckItemRow[]> {
  const rows = await db.checkItems.where('planId').equals(planId).toArray();
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function putCheckItem(row: CheckItemRow): Promise<void> {
  await db.checkItems.put(row);
}

export async function putCheckItems(rows: CheckItemRow[]): Promise<void> {
  await db.checkItems.bulkPut(rows);
}

export async function removeCheckItem(id: string): Promise<void> {
  await db.checkItems.delete(id);
}

/* ============================ 困人事件 ============================ */

export async function listRescues(): Promise<RescueRow[]> {
  const rows = await db.rescues.toArray();
  return rows.sort((a, b) => b.alarmAt.localeCompare(a.alarmAt));
}

export async function putRescue(row: RescueRow): Promise<void> {
  await db.rescues.put(row);
}

export async function removeRescue(id: string): Promise<void> {
  await db.rescues.delete(id);
}

/* ============================= 整改单 ============================= */

export async function listRectifies(): Promise<RectifyRow[]> {
  const rows = await db.rectifies.toArray();
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function putRectify(row: RectifyRow): Promise<void> {
  await db.rectifies.put(row);
}

export async function removeRectify(id: string): Promise<void> {
  await db.rectifies.delete(id);
}

/* ========================== 整库导入导出 ========================== */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  elevators: Elevator[];
  plans: Plan[];
  checkItems: CheckItem[];
  rescues: Rescue[];
  rectifies: Rectify[];
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [elevators, plans, checkItems, rescues, rectifies] = await Promise.all([
    listElevators(),
    listPlans(),
    listCheckItems(),
    listRescues(),
    listRectifies(),
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowDateTime(),
    elevators,
    plans,
    checkItems,
    rescues,
    rectifies,
  };
}

export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [db.elevators, db.plans, db.checkItems, db.rescues, db.rectifies],
    async () => {
      await Promise.all([
        db.elevators.clear(),
        db.plans.clear(),
        db.checkItems.clear(),
        db.rescues.clear(),
        db.rectifies.clear(),
      ]);
      await db.elevators.bulkPut(snapshot.elevators ?? []);
      await db.plans.bulkPut(snapshot.plans ?? []);
      await db.checkItems.bulkPut(snapshot.checkItems ?? []);
      await db.rescues.bulkPut(snapshot.rescues ?? []);
      await db.rectifies.bulkPut(snapshot.rectifies ?? []);
    },
  );
}

/** 清空并重新播种 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.elevators, db.plans, db.checkItems, db.rescues, db.rectifies],
    async () => {
      await Promise.all([
        db.elevators.clear(),
        db.plans.clear(),
        db.checkItems.clear(),
        db.rescues.clear(),
        db.rectifies.clear(),
      ]);
    },
  );
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [elevators, plans, checkItems, rescues, rectifies] = await Promise.all([
    db.elevators.count(),
    db.plans.count(),
    db.checkItems.count(),
    db.rescues.count(),
    db.rectifies.count(),
  ]);
  return { elevators, plans, checkItems, rescues, rectifies };
}

/** 结构版本信息 */
export interface SchemaInfo {
  dbName: string;
  schemaVersion: number;
  rowRevision: number;
  today: string;
}

export function schemaInfo(): SchemaInfo {
  return {
    dbName: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    rowRevision: ROW_REVISION,
    today: todayDate(),
  };
}

/** 依据周期类型推算某计划的下一期日期（供页面提示） */
export function nextPlanDateOf(planDate: string, cycle: Plan['cycleType']): string {
  return nextPlanDate(planDate, cycle);
}

/** 批量生成计划日期（对外暴露，避免页面直接依赖 utils/cycle） */
export function planDatesFrom(startDate: string, cycle: Plan['cycleType'], count: number): string[] {
  return generatePlanDates(startDate, cycle, count);
}

/** 困人时长（分钟）便捷函数，供 store 派生使用 */
export function rescueDurationMinutes(alarmAt: string, rescueAt: string): number {
  return rescueMinutes(alarmAt, rescueAt);
}
