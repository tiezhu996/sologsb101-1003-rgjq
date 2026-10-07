/** 按半月 / 季度 / 年度推算下次保养日期与提醒窗口 */
import type { MaintCycle } from '../types/elevator';
import { MAINT_CYCLE_LABEL } from '../types/elevator';
import { daysFromToday, todayDate } from './duration';

/** 各周期天数口径 */
export const CYCLE_DAYS: Record<MaintCycle, number> = {
  halfMonth: 15,
  quarter: 90,
  year: 365,
};

/** 提醒窗口（天）：到期前多少天开始提示 */
export const CYCLE_REMIND_DAYS: Record<MaintCycle, number> = {
  halfMonth: 3,
  quarter: 10,
  year: 30,
};

/** 日期加天数，返回 yyyy-MM-dd */
export function addDays(date: string, days: number): string {
  const base = new Date(`${date.length <= 10 ? date : date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return date;
  base.setDate(base.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

/** 依据上次保养日期与周期推算下次计划日期 */
export function nextPlanDate(lastDate: string, cycle: MaintCycle): string {
  return addDays(lastDate, CYCLE_DAYS[cycle]);
}

/** 批量生成计划日期：从起始日期起连续生成 count 期 */
export function generatePlanDates(startDate: string, cycle: MaintCycle, count: number): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  for (let index = 0; index < Math.max(0, count); index += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, CYCLE_DAYS[cycle]);
  }
  return dates;
}

/** 距下次保养剩余天数（正数为剩余，负数为已过期） */
export function daysUntilNextPlan(lastDate: string, cycle: MaintCycle, now: Date = new Date()): number {
  const next = nextPlanDate(lastDate, cycle);
  return -daysFromToday(next, now);
}

/** 提醒窗口状态 */
export function remindState(
  lastDate: string,
  cycle: MaintCycle,
  now: Date = new Date(),
): { level: 'ok' | 'soon' | 'overdue'; text: string; nextDate: string } {
  const next = nextPlanDate(lastDate, cycle);
  const remaining = daysUntilNextPlan(lastDate, cycle, now);
  if (remaining < 0) {
    return { level: 'overdue', text: `已过期 ${Math.abs(remaining)} 天`, nextDate: next };
  }
  if (remaining <= CYCLE_REMIND_DAYS[cycle]) {
    return { level: 'soon', text: `还剩 ${remaining} 天进入提醒窗口`, nextDate: next };
  }
  return { level: 'ok', text: `距下次保养 ${remaining} 天`, nextDate: next };
}

/** 周期摘要文案 */
export function cycleSummary(cycle: MaintCycle): string {
  return `${MAINT_CYCLE_LABEL[cycle]}（每 ${CYCLE_DAYS[cycle]} 天）`;
}

/** 计划日期是否落在提醒窗口内 */
export function inRemindWindow(planDate: string, cycle: MaintCycle, now: Date = new Date()): boolean {
  const remaining = -daysFromToday(planDate, now);
  return remaining >= 0 && remaining <= CYCLE_REMIND_DAYS[cycle];
}

/** 今天字符串（周期模块内复用，避免页面重复 import） */
export function cycleToday(): string {
  return todayDate();
}
