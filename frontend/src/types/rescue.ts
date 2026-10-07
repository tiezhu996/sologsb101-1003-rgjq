import type { Revisioned } from './persistence';

/** 困人事件原因字典 */
export const RESCUE_CAUSES = [
  '门锁回路故障',
  '停电困人',
  '变频器故障',
  '平层感应器失效',
  '钢丝绳打滑',
  '超载保护动作',
] as const;

/** 困人事件 */
export interface Rescue extends Revisioned {
  id: string;
  /** 所属电梯 */
  elevatorId: string;
  /** 报警时间 yyyy-MM-dd HH:mm */
  alarmAt: string;
  /** 到场时间 */
  arriveAt: string;
  /** 救出时间 */
  rescueAt: string;
  /** 原因 */
  cause: string;
  /** 被困人数 */
  trappedCount: number;
  /** 救援人 */
  responder: string;
  createdAt: string;
}

/** 困人事件草稿 */
export interface RescueDraft {
  elevatorId: string;
  alarmAt: string;
  arriveAt: string;
  rescueAt: string;
  cause: string;
  trappedCount: number;
  responder: string;
}

/** 困人事件视图：自动算到场与救援时长 */
export interface RescueView extends Rescue {
  elevatorName: string;
  owner: string;
  /** 报警 → 到场（分钟） */
  arriveMinutes: number;
  /** 报警 → 救出（分钟） */
  rescueMinutes: number;
  /** 是否满足 30 分钟到场要求 */
  arriveInTime: boolean;
  /** 时间线节点（用于回放展示） */
  timeline: RescueTimelineNode[];
}

/** 时间线节点 */
export interface RescueTimelineNode {
  label: string;
  at: string;
  minutesFromAlarm: number;
  tone: 'alarm' | 'arrive' | 'rescue';
  detail: string;
}

/** 到场时限（分钟）：按特种设备应急要求 30 分钟内到场 */
export const ARRIVE_LIMIT_MINUTES = 30;
