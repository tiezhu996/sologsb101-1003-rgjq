/** 时长与超期计算：报警—到场—救出，超期天数与分钟/小时格式化 */

/** "yyyy-MM-dd HH:mm" 解析为时间戳，非法输入返回 NaN */
export function parseDateTime(value: string): number {
  if (!value) return Number.NaN;
  const normalized = value.length <= 10 ? `${value}T00:00:00` : value.replace(' ', 'T');
  return new Date(normalized).getTime();
}

/** 两时间点间隔分钟数，非法输入或负值返回 0 */
export function minutesBetween(from: string, to: string): number {
  const start = parseDateTime(from);
  const end = parseDateTime(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const diff = Math.round((end - start) / 60000);
  return diff > 0 ? diff : 0;
}

/** 报警 → 到场分钟数 */
export function arriveMinutes(alarmAt: string, arriveAt: string): number {
  return minutesBetween(alarmAt, arriveAt);
}

/** 报警 → 救出分钟数 */
export function rescueMinutes(alarmAt: string, rescueAt: string): number {
  return minutesBetween(alarmAt, rescueAt);
}

/** 分钟格式化：不足 60 分钟显示分钟，否则显示小时+分钟 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

/** 分钟格式化为工时口径（用于统计均值） */
export function formatAverageMinutes(totalMinutes: number, count: number): string {
  if (count <= 0) return '—';
  return formatMinutes(Math.round(totalMinutes / count));
}

/** 相对今天的天数差（正数为已过去天数） */
export function daysFromToday(date: string, now: Date = new Date()): number {
  const at = parseDateTime(date.length <= 10 ? `${date} 23:59` : date);
  if (Number.isNaN(at)) return 0;
  return Math.floor((now.getTime() - at) / (24 * 3600 * 1000));
}

/** 是否超期 */
export function isOverdueDate(date: string, now: Date = new Date()): boolean {
  return daysFromToday(date, now) > 0;
}

/** 超期描述文案 */
export function overdueText(days: number): string {
  if (days <= 0) return '未超期';
  return `超期 ${days} 天`;
}

/** 今天日期 yyyy-MM-dd */
export function todayDate(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 当前时间 yyyy-MM-dd HH:mm */
export function nowDateTime(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${todayDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
