<script setup lang="ts">
/**
 * <FilterBar> 关键字 + 多选条件筛选条
 * 条件与 URL query 同步（刷新后筛选状态不丢），被电梯档案页、困人救援页消费。
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NCard, NInput, NSelect, NSpace, NTag, NText, type SelectOption } from 'naive-ui';

/** 选项直接复用 naive-ui 的 SelectOption 结构，避免联合类型不兼容 */
export type FilterOption = SelectOption;

export interface FilterSelectSpec {
  /** query 参数名 */
  key: string;
  label: string;
  options: FilterOption[];
  multiple?: boolean;
  width?: number;
  placeholder?: string;
}

const props = withDefaults(
  defineProps<{
    keywordPlaceholder?: string;
    keywordKey?: string;
    selects?: FilterSelectSpec[];
    resultCount?: number;
    countUnit?: string;
  }>(),
  {
    keywordPlaceholder: '按名称 / 编号搜索',
    keywordKey: 'kw',
    selects: () => [],
    resultCount: undefined,
    countUnit: '条',
  },
);

const emit = defineEmits<{
  /** 关键字变化 */
  (event: 'update:keyword', value: string): void;
  /** 多选条件变化 */
  (event: 'change', value: Record<string, string[]>): void;
}>();

const route = useRoute();
const router = useRouter();

/** 从 route.query 读取多选值 */
function readValues(key: string): string[] {
  const raw = route.query[key];
  if (raw === undefined) return [];
  const text = Array.isArray(raw) ? raw.join(',') : String(raw);
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const keyword = ref(String(route.query[props.keywordKey] ?? ''));
const values = ref<Record<string, string[]>>({});
const syncing = ref(false);

/** 依据当前 query 重建本地状态 */
function syncFromRoute(): void {
  syncing.value = true;
  keyword.value = String(route.query[props.keywordKey] ?? '');
  const next: Record<string, string[]> = {};
  for (const select of props.selects) next[select.key] = readValues(select.key);
  values.value = next;
  syncing.value = false;
  emit('update:keyword', keyword.value);
  emit('change', next);
}

watch(
  () => JSON.stringify(route.query),
  () => {
    if (!syncing.value) syncFromRoute();
  },
  { immediate: true },
);

/** 把筛选条件写回 URL query（保留非本组件管理的 query 参数） */
function push(nextKeyword: string, nextValues: Record<string, string[]>): void {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (key === props.keywordKey) continue;
    if (props.selects.some((select) => select.key === key)) continue;
    if (typeof value === 'string') query[key] = value;
  }
  if (nextKeyword.trim()) query[props.keywordKey] = nextKeyword.trim();
  for (const select of props.selects) {
    const selected = nextValues[select.key] ?? [];
    if (selected.length > 0) query[select.key] = selected.join(',');
  }
  syncing.value = true;
  void router.replace({ query }).finally(() => {
    syncing.value = false;
  });
}

function onKeywordInput(value: string): void {
  keyword.value = value;
  emit('update:keyword', value);
  push(value, values.value);
}

function onSelect(key: string, value: string | string[] | null): void {
  const next = { ...values.value };
  next[key] = value === null ? [] : Array.isArray(value) ? value : [value];
  values.value = next;
  emit('change', next);
  push(keyword.value, next);
}

function reset(): void {
  keyword.value = '';
  const cleared: Record<string, string[]> = {};
  for (const select of props.selects) cleared[select.key] = [];
  values.value = cleared;
  emit('update:keyword', '');
  emit('change', cleared);
  push('', cleared);
}

const activeCount = computed(
  () => (keyword.value.trim() ? 1 : 0) + Object.values(values.value).filter((item) => item.length > 0).length,
);
</script>

<template>
  <n-card size="small" class="filter-bar">
    <n-space align="center" :wrap="true" :size="[10, 10]">
      <n-input
        :value="keyword"
        clearable
        :placeholder="keywordPlaceholder"
        style="width: 240px"
        @update:value="onKeywordInput"
      />
      <template v-for="select in selects" :key="select.key">
        <n-space align="center" :size="4">
          <n-text depth="3" style="font-size: 12px">{{ select.label }}</n-text>
          <n-select
            :value="select.multiple === false ? (values[select.key]?.[0] ?? null) : (values[select.key] ?? [])"
            :options="select.options"
            :multiple="select.multiple !== false"
            :placeholder="select.placeholder ?? `选择${select.label}`"
            clearable
            :max-tag-count="2"
            :style="{ minWidth: `${select.width ?? 170}px` }"
            @update:value="(value: string | string[] | null) => onSelect(select.key, value)"
          />
        </n-space>
      </template>
      <n-button :disabled="activeCount === 0" @click="reset">重置</n-button>
      <n-tag v-if="resultCount !== undefined" type="info" size="small">{{ resultCount }} {{ countUnit }}</n-tag>
      <slot />
    </n-space>
  </n-card>
</template>

<style scoped>
.filter-bar {
  border-radius: 10px;
}
</style>
