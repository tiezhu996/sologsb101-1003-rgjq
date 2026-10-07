/** 持久化行元信息：Vue 3 版（与 utils/db.ts 的 Dexie 行结构保持一致） */
export const ROW_REVISION = 2;

/** 行修订号，用于按行迁移与版本核对 */
export interface Revisioned {
  revision: number;
}
