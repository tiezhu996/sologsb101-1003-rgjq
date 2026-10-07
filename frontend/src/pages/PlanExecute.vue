<script setup lang="ts">
/**
 * /plans/:id/items 保养执行
 * 逐项填写实测值与结果并签署，异常项一键转整改；
 * 消费 CheckItem、Plan 与 <StateTag>。
 */
import { computed, h, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { ROUTES } from '../router';
import { useCheckStore } from '../stores/checkStore';
import { usePlanStore } from '../stores/planStore';
import { useRectifyStore } from '../stores/rectifyStore';
import { useElevatorStore } from '../stores/elevatorStore';
import { CHECK_RESULT_LABEL, valuePlaceholderOf, type CheckResult, type CheckItemView } from '../types/checkItem';
import { MAINT_CYCLE_LABEL } from '../types/elevator';
import { addDays, nextPlanDate } from '../utils/cycle';
import { nowDateTime, todayDate } from '../utils/duration';
import StateTag from '../components/common/StateTag.vue';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const checkStore = useCheckStore();
const planStore = usePlanStore();
const rectifyStore = useRectifyStore();
const elevatorStore = useElevatorStore();

const planId = computed(() => String(route.params.id ?? ''));

/** 表单编辑态：以 id 为键保存每项的草稿 */
interface DraftRow {
  itemName: string;
  result: CheckResult | null;
  value: string;
  remark: string;
}

const drafts = ref<Record<string, DraftRow>>({});
const rectifyDueTs = ref<number>(new Date(`${addDays(todayDate(), 7)}T00:00:00`).getTime());
const reviewer = ref('王敏');

/** 当前时间文案（用于未签署时的提示占位） */
const nowDateTimeText = nowDateTime();

const resultOptions = (Object.keys(CHECK_RESULT_LABEL) as CheckResult[]).map((key) => ({
  label: CHECK_RESULT_LABEL[key],
  value: key,
}));

const plan = computed(() => planStore.planViews.find((item) => item.id === planId.value) ?? null);

const items = computed<CheckItemView[]>(() => {
  checkStore.setActivePlan(planId.value);
  return checkStore.activeItemViews;
});

/** 把库中数据同步到草稿（仅补充缺失项，避免覆盖用户正在输入的内容） */
function syncDrafts(): void {
  const next: Record<string, DraftRow> = { ...drafts.value };
  for (const item of items.value) {
    if (!next[item.id]) {
      next[item.id] = {
        itemName: item.itemName,
        result: item.result,
        value: item.value,
        remark: item.remark,
      };
    }
  }
  drafts.value = next;
}

watch(items, () => syncDrafts(), { immediate: true });

onMounted(async () => {
  await checkStore.bootstrap();
  await Promise.all([planStore.bootstrap(), rectifyStore.bootstrap(), elevatorStore.bootstrap()]);
  checkStore.setActivePlan(planId.value);
  syncDrafts();
});

const filledCount = computed(
  () => items.value.filter((item) => drafts.value[item.id]?.result !== null && drafts.value[item.id]?.result !== undefined).length,
);

const abnormalDrafts = computed(() =>
  items.value.filter((item) => {
    const result = drafts.value[item.id]?.result;
    return result === 'abnormal' || result === 'advice';
  }),
);

const progressPercent = computed(() => {
  if (items.value.length === 0) return 0;
  return Number(((filledCount.value / items.value.length) * 100).toFixed(1));
});

/** 保存全部草稿 */
async function saveAll(): Promise<void> {
  const payload = items.value.map((item) => ({
    id: item.id,
    ...(drafts.value[item.id] ?? { itemName: item.itemName, result: item.result, value: item.value, remark: item.remark }),
  }));
  const saved = await checkStore.saveAll(planId.value, payload);
  message.success(`已保存 ${saved} 项保养结果`);
}

/** 快捷标记单项结果并立即落库 */
async function quickSet(item: CheckItemView, result: CheckResult): Promise<void> {
  await checkStore.setResult(item.id, result);
  drafts.value = {
    ...drafts.value,
    [item.id]: {
      ...(drafts.value[item.id] ?? { itemName: item.itemName, result, value: item.value, remark: item.remark }),
      result,
    },
  };
  message.success(`${item.itemName} 已标为${CHECK_RESULT_LABEL[result]}`);
}

async function fillRest(): Promise<void> {
  const rest = items.value.filter((item) => (drafts.value[item.id]?.result ?? null) === null);
  if (rest.length === 0) {
    message.info('没有未填写的项目');
    return;
  }
  for (const item of rest) {
    await checkStore.setResult(item.id, 'normal');
    drafts.value = {
      ...drafts.value,
      [item.id]: { ...(drafts.value[item.id] ?? { itemName: item.itemName, value: '', remark: '' }), result: 'normal', itemName: item.itemName },
    };
  }
  message.success(`已将其余 ${rest.length} 项标为正常`);
}

/** 签署：先保存再校验 */
async function signPlan(): Promise<void> {
  await saveAll();
  const result = await planStore.signPlan(planId.value);
  if (result.ok) message.success('保养计划已签署');
  else message.warning(result.message);
}

/** 异常项一键转整改 */
async function promote(): Promise<void> {
  if (!plan.value) return;
  if (abnormalDrafts.value.length === 0) {
    message.warning('当前没有异常项可转整改');
    return;
  }
  const date = new Date(rectifyDueTs.value);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const dueDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  await saveAll();
  const created = await rectifyStore.promoteAbnormalItems(plan.value.elevatorId, planId.value, dueDate, reviewer.value);
  if (created === 0) message.info('异常项均已有待整改单，未重复生成');
  else message.success(`已生成 ${created} 条年检整改单`);
}

const elevatorRemind = computed(() => {
  if (!plan.value) return '';
  const elevator = elevatorStore.elevators.find((item) => item.id === plan.value?.elevatorId);
  if (!elevator) return '';
  return `下次保养建议日期 ${nextPlanDate(plan.value.planDate, elevator.maintCycle)}（${MAINT_CYCLE_LABEL[elevator.maintCycle]}周期）`;
});

const columns = computed<DataTableColumns<CheckItemView>>(() => [
  { title: '序号', key: 'seq', width: 70 },
  { title: '保养项', key: 'itemName', minWidth: 170 },
  {
    title: '结果',
    key: 'result',
    width: 160,
    render: (row) =>
      h(
        NSelect,
        {
          value: drafts.value[row.id]?.result ?? null,
          options: resultOptions,
          size: 'small',
          placeholder: '选择结果',
          status:
            drafts.value[row.id]?.result === 'abnormal'
              ? 'error'
              : drafts.value[row.id]?.result === 'advice'
                ? 'warning'
                : undefined,
          'onUpdate:value': (value: CheckResult | null) => {
            drafts.value = {
              ...drafts.value,
              [row.id]: {
                ...(drafts.value[row.id] ?? { itemName: row.itemName, value: row.value, remark: row.remark }),
                itemName: row.itemName,
                result: value,
              },
            };
          },
        },
        {},
      ),
  },
  {
    title: '实测值',
    key: 'value',
    width: 180,
    render: (row) =>
      h(NInput, {
        value: drafts.value[row.id]?.value ?? '',
        size: 'small',
        placeholder: valuePlaceholderOf(row.itemName),
        'onUpdate:value': (value: string) => {
          drafts.value = {
            ...drafts.value,
            [row.id]: { ...(drafts.value[row.id] ?? { itemName: row.itemName, result: row.result, remark: row.remark }), itemName: row.itemName, value },
          };
        },
      }),
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 190,
    render: (row) =>
      h(NInput, {
        value: drafts.value[row.id]?.remark ?? '',
        size: 'small',
        placeholder: '异常描述 / 处置建议',
        'onUpdate:value': (value: string) => {
          drafts.value = {
            ...drafts.value,
            [row.id]: { ...(drafts.value[row.id] ?? { itemName: row.itemName, result: row.result, value: row.value }), itemName: row.itemName, remark: value },
          };
        },
      }),
  },
  {
    title: '快捷',
    key: 'quick',
    width: 190,
    render: (row) =>
      h(NSpace, { size: 2 }, {
        default: () => [
          h(NButton, { size: 'tiny', text: true, type: 'success', onClick: () => void quickSet(row, 'normal') }, { default: () => '正常' }),
          h(NButton, { size: 'tiny', text: true, type: 'error', onClick: () => void quickSet(row, 'abnormal') }, { default: () => '异常' }),
          h(NButton, { size: 'tiny', text: true, type: 'warning', onClick: () => void quickSet(row, 'advice') }, { default: () => '建议' }),
        ],
      }),
  },
]);

</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">保养执行</h2>
        <div class="page-sub">逐项填写实测值与结果并签署；出现异常项可一键转年检整改单。</div>
      </div>
      <n-space>
        <n-button @click="router.push(ROUTES.plans)">返回计划列表</n-button>
        <n-button @click="saveAll">保存全部</n-button>
        <n-button type="primary" :disabled="plan?.state === 'signed'" @click="signPlan">签署计划</n-button>
      </n-space>
    </div>

    <empty-panel
      v-if="!plan"
      title="未找到该保养计划"
      description="计划可能已被删除，请返回保养计划列表重新选择。"
      create-label="返回计划列表"
      @create="router.push(ROUTES.plans)"
    />

    <template v-else>
      <div class="stat-grid">
        <stat-badge title="保养项" :value="items.length" suffix="项" color="#18a058" />
        <stat-badge
          title="已填写"
          :value="filledCount"
          :suffix="`/ ${items.length}`"
          :percent="progressPercent"
          color="#2080f0"
        />
        <stat-badge
          title="异常 / 建议"
          :value="abnormalDrafts.length"
          suffix="项"
          :color="abnormalDrafts.length > 0 ? '#d03050' : '#18a058'"
          hint="异常项可一键转整改单"
        />
        <stat-badge
          title="计划状态"
          :value="plan.state === 'signed' ? '已签署' : plan.state === 'executing' ? '执行中' : '待执行'"
          :color="plan.state === 'signed' ? '#18a058' : '#f0a020'"
          :hint="plan.signedAt ? `签署时间 ${plan.signedAt}` : '尚未签署'"
        />
      </div>

      <n-card size="small" style="margin-bottom: 14px">
        <n-descriptions :column="3" size="small" label-placement="top" bordered>
          <n-descriptions-item label="电梯">{{ plan.elevatorName }}</n-descriptions-item>
          <n-descriptions-item label="周期">{{ MAINT_CYCLE_LABEL[plan.cycleType] }}</n-descriptions-item>
          <n-descriptions-item label="计划日期">{{ plan.planDate }}</n-descriptions-item>
          <n-descriptions-item label="执行人">{{ plan.executor }}</n-descriptions-item>
          <n-descriptions-item label="完成度">
            <n-space align="center" :size="6">
              <n-progress type="line" :percentage="plan.progress" :height="8" style="width: 120px" />
              <span>{{ plan.progress }}%</span>
            </n-space>
          </n-descriptions-item>
          <n-descriptions-item label="状态">
            <state-tag :value="plan.state" kind="plan" :overdue="plan.overdue" />
          </n-descriptions-item>
        </n-descriptions>
        <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
          {{ elevatorRemind }} · 签署时间参考 {{ plan.signedAt ?? nowDateTimeText }}
        </n-text>
      </n-card>

      <n-alert v-if="abnormalDrafts.length > 0" type="warning" style="margin-bottom: 12px">
        检测到 {{ abnormalDrafts.length }} 项异常 / 建议项：{{ abnormalDrafts.map((item) => item.itemName).join('、') }}。
        可设置限期后一键转整改单跟踪。
      </n-alert>

      <n-card size="small" title="保养项清单">
        <n-space style="margin-bottom: 10px" align="center">
          <n-button size="small" @click="fillRest">其余标记为正常</n-button>
          <n-button size="small" @click="checkStore.resetItemsToLibrary(planId)">重置为周期标准清单</n-button>
          <n-text depth="3" style="font-size: 12px">整改限期</n-text>
          <n-date-picker v-model:value="rectifyDueTs" type="date" size="small" style="width: 150px" />
          <n-input v-model:value="reviewer" size="small" placeholder="复核人" style="width: 120px" />
          <n-button size="small" type="primary" @click="promote">异常项转整改</n-button>
        </n-space>

        <n-data-table
          :columns="columns"
          :data="items"
          :bordered="false"
          size="small"
          :scroll-x="980"
          :pagination="false"
          :row-class-name="(row: CheckItemView) =>
            drafts[row.id]?.result === 'abnormal' ? 'row-marked' : ''"
        />
      </n-card>

      <n-card size="small" title="执行提示" class="section-gap">
        <n-space vertical :size="6">
          <n-text depth="3">1. 逐项填写实测值后「保存全部」，或使用「快捷」按钮快速标记结果。</n-text>
          <n-text depth="3">2. 全部保养项填写结果后点击「签署计划」，系统会校验未填项。</n-text>
          <n-text depth="3">3. 异常项建议在「年检整改与预警」页跟踪到复核关闭。</n-text>
          <n-space>
            <n-tag round type="info">保养项字典 {{ checkStore.items.length }} 条</n-tag>
            <n-tag round>异常 {{ checkStore.resultCounts.abnormal }} 项</n-tag>
            <n-tag round>建议 {{ checkStore.resultCounts.advice }} 项</n-tag>
            <n-tag round>待填 {{ checkStore.resultCounts.pending }} 项</n-tag>
          </n-space>
        </n-space>
      </n-card>
    </template>
  </div>
</template>
