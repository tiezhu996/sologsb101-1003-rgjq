import type { Revisioned } from './persistence';

/** 保养项结果：正常 / 异常 / 建议 */
export type CheckResult = 'normal' | 'abnormal' | 'advice';

export const CHECK_RESULT_LABEL: Record<CheckResult, string> = {
  normal: '正常',
  abnormal: '异常',
  advice: '建议',
};

/** 保养项名称字典（半月 / 季度 / 年度周期各自的必检项） */
export const CHECK_ITEM_LIBRARY: string[] = [
  '制动器动作试验',
  '层门锁紧装置',
  '限速器动作',
  '缓冲器检查',
  '钢丝绳磨损',
  '导靴与导轨间隙',
  '平层准确度',
  '超载保护装置',
  '应急照明与警铃',
  '机房温度与通风',
];

/** 保养项 */
export interface CheckItem extends Revisioned {
  id: string;
  /** 所属计划 */
  planId: string;
  /** 序号 */
  seq: number;
  /** 项目名 */
  itemName: string;
  /** 结果，未填写为 null */
  result: CheckResult | null;
  /** 实测值描述 */
  value: string;
  /** 备注 */
  remark: string;
  createdAt: string;
}

/** 保养项编辑草稿 */
export interface CheckItemDraft {
  itemName: string;
  result: CheckResult | null;
  value: string;
  remark: string;
}

/** 保养项视图：补充计划与电梯上下文 */
export interface CheckItemView extends CheckItem {
  elevatorId: string;
  elevatorName: string;
  cycleType: string;
  planDate: string;
}

/** 依据周期类型给出必检项清单 */
export function itemsForCycle(cycle: 'halfMonth' | 'quarter' | 'year'): string[] {
  if (cycle === 'halfMonth') return CHECK_ITEM_LIBRARY.slice(0, 5);
  if (cycle === 'quarter') return CHECK_ITEM_LIBRARY.slice(0, 8);
  return CHECK_ITEM_LIBRARY;
}

/** 计算某周期必检项中、既有清单缺失的项目名（按项目名比对，既有项的结果与备注不动） */
export function missingItemsForCycle(
  cycle: 'halfMonth' | 'quarter' | 'year',
  existingNames: string[],
): string[] {
  const names = new Set(existingNames);
  return itemsForCycle(cycle).filter((itemName) => !names.has(itemName));
}

/** 异常项判定 */
export function isAbnormal(result: CheckResult | null): boolean {
  return result === 'abnormal' || result === 'advice';
}

/** 实测值缺省值建议（按项目名给出参考格式） */
export function valuePlaceholderOf(itemName: string): string {
  if (itemName.includes('间隙')) return '如：2.5mm';
  if (itemName.includes('平层')) return '如：±3mm';
  if (itemName.includes('温度')) return '如：32℃';
  if (itemName.includes('动作')) return '如：动作正常 / 动作迟缓';
  return '如：合格 / 实测值';
}
