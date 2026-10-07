import type { Revisioned } from './persistence';

/** 维保周期类型 */
export type MaintCycle = 'halfMonth' | 'quarter' | 'year';

export const MAINT_CYCLE_LABEL: Record<MaintCycle, string> = {
  halfMonth: '半月',
  quarter: '季度',
  year: '年度',
};

/** 电梯 */
export interface Elevator extends Revisioned {
  id: string;
  /** 注册代码（使用登记证编号） */
  regCode: string;
  /** 使用单位 */
  owner: string;
  /** 载重（kg） */
  loadKg: number;
  /** 层站数 */
  stops: number;
  /** 投用日期 yyyy-MM-dd */
  useDate: string;
  /** 维保周期 */
  maintCycle: MaintCycle;
  createdAt: string;
}

/** 新建/编辑电梯表单草稿 */
export interface ElevatorDraft {
  regCode: string;
  owner: string;
  loadKg: number;
  stops: number;
  useDate: string;
  maintCycle: MaintCycle;
}

/** 电梯卡片视图：回显超期项与待整改数 */
export interface ElevatorView extends Elevator {
  /** 该电梯的计划总数 */
  planCount: number;
  /** 逾期未签署计划数 */
  overduePlanCount: number;
  /** 待整改数量 */
  pendingRectifyCount: number;
  /** 最近一次困人救援时长（分钟），无记录为 null */
  lastRescueMinutes: number | null;
  /** 下次保养日期（按周期推算） */
  nextPlanDate: string;
}

/** 依据注册代码解析设备类别（用于列表内联标签） */
export function elevatorUsageLabel(useDate: string, now: Date = new Date()): '新梯' | '在用' | '老旧' {
  const start = new Date(`${useDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '在用';
  const years = (now.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 3) return '新梯';
  if (years <= 12) return '在用';
  return '老旧';
}

/** 载重档位标签 */
export function loadLabel(loadKg: number): string {
  if (loadKg <= 450) return '小载重';
  if (loadKg <= 1000) return '常规载重';
  return '大载重';
}
