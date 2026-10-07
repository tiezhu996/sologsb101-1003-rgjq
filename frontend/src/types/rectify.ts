import type { Revisioned } from './persistence';

/** 整改状态：待整改 / 已复核 */
export type RectifyState = 'pending' | 'reviewed';

export const RECTIFY_STATE_LABEL: Record<RectifyState, string> = {
  pending: '待整改',
  reviewed: '已复核',
};

/** 年检整改单 */
export interface Rectify extends Revisioned {
  id: string;
  /** 所属电梯 */
  elevatorId: string;
  /** 不合格项 */
  item: string;
  /** 限期 yyyy-MM-dd */
  dueDate: string;
  /** 状态 */
  state: RectifyState;
  /** 复核人 */
  reviewer: string;
  /** 复核时间 */
  reviewedAt: string | null;
  createdAt: string;
}

/** 整改单草稿 */
export interface RectifyDraft {
  elevatorId: string;
  item: string;
  dueDate: string;
  reviewer: string;
}

/** 整改单视图：带电梯上下文与超期天数 */
export interface RectifyView extends Rectify {
  elevatorName: string;
  owner: string;
  /** 是否超期（未复核且限期早于今天） */
  overdue: boolean;
  /** 超期天数（未超期为 0） */
  overdueDays: number;
}

/** 年检不合格项字典 */
export const RECTIFY_ITEM_LIBRARY: string[] = [
  '限速器动作速度超差',
  '层门门锁啮合深度不足',
  '制动器制动力矩不足',
  '缓冲器复位异常',
  '钢丝绳断丝超标',
  '轿厢应急照明失效',
  '超载保护装置失灵',
  '机房通风不符合要求',
];

/** 超期天数计算 */
export function overdueDaysOf(dueDate: string, state: RectifyState, now: Date = new Date()): number {
  if (state === 'reviewed') return 0;
  const due = new Date(`${dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 0;
  const diff = now.getTime() - due.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 3600 * 1000));
}
