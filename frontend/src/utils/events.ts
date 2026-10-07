/**
 * 轻量变更广播：Dexie 写入后通知各 Pinia store 重新拉取，实现跨页响应式刷新。
 * 纯前端单页应用内部的同步机制，不涉及网络。
 */
type ChangeListener = () => void;

const listeners = new Set<ChangeListener>();

/** 订阅数据变更，返回取消订阅函数 */
export function onChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 广播一次数据变更 */
export function emitChange(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
