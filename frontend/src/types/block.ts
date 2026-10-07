/**
 * 封存与归档参数：集中登记周期封存、资料归档所需的运行期常量与校验口径，
 * 供保养计划页与整改页共用，避免常量散落在页面中。
 */
import type { MaintCycle } from './elevator';
import { CYCLE_DAYS } from '../utils/cycle';

/** 单台电梯的年度最低保养次数（按周期折算） */
export const ANNUAL_MIN_VISITS: Record<MaintCycle, number> = {
  halfMonth: 24,
  quarter: 4,
  year: 1,
};

/** 资料归档保留年限（年） */
export const ARCHIVE_KEEP_YEARS = 4;

/** 计算某周期在给定月份数内的应保养次数 */
export function expectedVisits(cycle: MaintCycle, months: number): number {
  const days = months * 30;
  return Math.max(1, Math.round(days / CYCLE_DAYS[cycle]));
}

/** 封存判定：实际签署次数是否满足最低要求 */
export function blockCheck(input: {
  cycle: MaintCycle;
  months: number;
  signedCount: number;
}): { ok: boolean; expected: number; message: string } {
  const expected = expectedVisits(input.cycle, input.months);
  if (input.signedCount >= expected) {
    return { ok: true, expected, message: `已签署 ${input.signedCount} 期，满足 ${expected} 期要求` };
  }
  return {
    ok: false,
    expected,
    message: `已签署 ${input.signedCount} 期，低于应保养 ${expected} 期，暂不建议封存归档`,
  };
}

/** 封存摘要文案 */
export function blockSummary(input: {
  elevatorCode: string;
  cycle: MaintCycle;
  signedCount: number;
  rectifyClosedCount: number;
}): string {
  return `${input.elevatorCode}：周期 ${input.cycle} · 已签署 ${input.signedCount} 期 · 整改闭环 ${input.rectifyClosedCount} 项 · 资料保留 ${ARCHIVE_KEEP_YEARS} 年`;
}
