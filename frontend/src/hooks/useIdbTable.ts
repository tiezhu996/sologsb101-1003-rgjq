/**
 * Dexie 表响应式订阅封装（Vue composable）
 * 订阅全局变更广播并在 onScopeDispose / onUnmounted 时自动取消，被全部页面消费。
 */
import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { onChange } from '../utils/events';

export interface UseIdbTableResult<T> {
  /** 当前数据（浅层响应，避免大数组深度代理开销） */
  data: ShallowRef<T>;
  /** 是否正在加载 */
  loading: Ref<boolean>;
  /** 错误信息（空串表示无错误） */
  error: Ref<string>;
  /** 手动重新拉取 */
  reload: () => Promise<void>;
}

/**
 * 订阅 Dexie 表数据。
 * @param loader 读取函数，可返回多表组合结果
 * @param deps 依赖数组，变化时重新拉取
 */
export function useIdbTable<T>(loader: () => Promise<T>, deps: unknown[] = []): UseIdbTableResult<T> {
  const data = shallowRef<T>(undefined as unknown as T);
  const loading = ref(true);
  const error = ref('');

  const reload = async (): Promise<void> => {
    try {
      const result = await loader();
      data.value = result;
      error.value = '';
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '本地数据读取失败';
    } finally {
      loading.value = false;
    }
  };

  void reload();
  const unsubscribe = onChange(() => {
    void reload();
  });

  if (deps.length > 0) {
    watch(
      () => deps,
      () => {
        loading.value = true;
        void reload();
      },
      { deep: true },
    );
  }

  onScopeDispose(() => {
    unsubscribe();
  });

  return { data, loading, error, reload };
}

/** 简化的列表订阅：保证返回数组，避免页面到处判空 */
export function useIdbList<T>(loader: () => Promise<T[]>, deps: unknown[] = []): ShallowRef<T[]> {
  const { data } = useIdbTable<T[]>(loader, deps);
  const list = shallowRef<T[]>([]);
  watch(
    data,
    (value) => {
      list.value = value ?? [];
    },
    { immediate: true },
  );
  return list;
}
