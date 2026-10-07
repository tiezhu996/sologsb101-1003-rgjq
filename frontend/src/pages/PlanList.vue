<script setup lang="ts">
/**
 * /plans 保养计划
 * 按周期批量生成计划、指派执行人、查看逾期；
 * 消费 Plan、Elevator 与 <StateTag>、<FilterBar>。
 */
import { computed, h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
  type DataTableColumns,
  type FormInst,
} from 'naive-ui';
import { ROUTES } from '../router';
import { usePlanStore } from '../stores/planStore';
import { useElevatorStore } from '../stores/elevatorStore';
import { useCheckStore } from '../stores/checkStore';
import { usePlanProgress } from '../hooks/usePlanProgress';
import { MAINT_CYCLE_LABEL, type MaintCycle } from '../types/elevator';
import { PLAN_STATE_LABEL, type PlanState, type PlanView } from '../types/plan';
import { formatMinutes } from '../utils/duration';
import StateTag from '../components/common/StateTag.vue';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import FilterBar from '../components/common/FilterBar.vue';

const router = useRouter();
const message = useMessage();
const planStore = usePlanStore();
const elevatorStore = useElevatorStore();
const checkStore = useCheckStore();
const {
  plans: progressPlans,
  cycleStats,
  overduePlans,
  overallCompletion,
  signCoverage,
  stateCounts,
  dueSoonPlans,
} = usePlanProgress();

const cycleOptions = (Object.keys(MAINT_CYCLE_LABEL) as MaintCycle[]).map((key) => ({
  label: MAINT_CYCLE_LABEL[key],
  value: key,
}));

const stateOptions = (Object.keys(PLAN_STATE_LABEL) as PlanState[]).map((key) => ({
  label: PLAN_STATE_LABEL[key],
  value: key,
}));

/** 筛选条件（由 FilterBar 与 URL query 同步） */
const keyword = ref('');
const cycleFilters = ref<MaintCycle[]>([]);
const stateFilters = ref<PlanState[]>([]);
const overdueOnly = ref(false);

function onFilterChange(values: Record<string, string[]>): void {
  cycleFilters.value = (values.cycle ?? []) as MaintCycle[];
  stateFilters.value = (values.state ?? []) as PlanState[];
}

onMounted(async () => {
  await planStore.bootstrap();
  await Promise.all([elevatorStore.bootstrap(), checkStore.bootstrap()]);
});

/* ------------------------------ 批量生成 ------------------------------ */
const generateOpen = ref(false);
const generateFormRef = ref<FormInst | null>(null);
const generateModel = ref<{ elevatorIds: string[]; cycleType: MaintCycle; startTs: number; periods: number; executor: string }>({
  elevatorIds: [],
  cycleType: 'halfMonth',
  startTs: Date.now(),
  periods: 2,
  executor: '刘建国',
});

function openGenerate(elevatorId?: string): void {
  generateModel.value = {
    elevatorIds: elevatorId ? [elevatorId] : elevatorStore.elevators.slice(0, 1).map((item) => item.id),
    cycleType: 'halfMonth',
    startTs: Date.now(),
    periods: 2,
    executor: planStore.executorOptions[0] ?? '刘建国',
  };
  generateOpen.value = true;
}

function tsToDate(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function submitGenerate(): Promise<void> {
  try {
    await generateFormRef.value?.validate();
  } catch {
    return;
  }
  const created = await planStore.batchGenerate({
    elevatorIds: generateModel.value.elevatorIds,
    cycleType: generateModel.value.cycleType,
    startDate: tsToDate(generateModel.value.startTs),
    periods: generateModel.value.periods,
    executor: generateModel.value.executor,
  });
  message.success(`已生成 ${created} 期保养计划，并同步生成保养项清单`);
  generateOpen.value = false;
}

/* ------------------------------ 单期编辑 ------------------------------ */
const editOpen = ref(false);
const editFormRef = ref<FormInst | null>(null);
const editingId = ref('');
const editModel = ref<{ elevatorId: string; cycleType: MaintCycle; planDateTs: number; executor: string }>({
  elevatorId: '',
  cycleType: 'halfMonth',
  planDateTs: Date.now(),
  executor: '',
});

function openEdit(row: PlanView): void {
  editingId.value = row.id;
  editModel.value = {
    elevatorId: row.elevatorId,
    cycleType: row.cycleType,
    planDateTs: new Date(`${row.planDate}T00:00:00`).getTime(),
    executor: row.executor,
  };
  editOpen.value = true;
}

async function submitEdit(): Promise<void> {
  try {
    await editFormRef.value?.validate();
  } catch {
    return;
  }
  await planStore.updatePlan(editingId.value, {
    elevatorId: editModel.value.elevatorId,
    cycleType: editModel.value.cycleType,
    planDate: tsToDate(editModel.value.planDateTs),
    executor: editModel.value.executor,
  });
  message.success('计划已更新');
  editOpen.value = false;
}

/* ------------------------------ 指派执行人 ------------------------------ */
const assignOpen = ref(false);
const assignTarget = ref<PlanView | null>(null);
const assignModel = ref<{ executor: string }>({ executor: '' });

function openAssign(row: PlanView): void {
  assignTarget.value = row;
  assignModel.value = { executor: row.executor };
  assignOpen.value = true;
}

async function submitAssign(): Promise<void> {
  if (!assignTarget.value) return;
  await planStore.assignExecutor(assignTarget.value.id, assignModel.value.executor);
  message.success('执行人已指派');
  assignOpen.value = false;
}

async function sign(row: PlanView): Promise<void> {
  const result = await planStore.signPlan(row.id);
  if (result.ok) message.success(`${row.elevatorName} 计划已签署`);
  else message.warning(result.message);
}

/* ------------------------------ 过滤与列 ------------------------------ */
const filtered = computed(() => {
  const lower = keyword.value.trim().toLowerCase();
  return progressPlans.value.filter((row) => {
    if (cycleFilters.value.length > 0 && !cycleFilters.value.includes(row.cycleType)) return false;
    if (stateFilters.value.length > 0 && !stateFilters.value.includes(row.state)) return false;
    if (overdueOnly.value && !row.overdue) return false;
    if (lower && !`${row.elevatorName} ${row.executor}`.toLowerCase().includes(lower)) return false;
    return true;
  });
});

const columns = computed<DataTableColumns<PlanView>>(() => [
  { title: '电梯', key: 'elevatorName', minWidth: 210, ellipsis: { tooltip: true } },
  {
    title: '周期',
    key: 'cycleType',
    width: 100,
    render: (row) => h(NTag, { size: 'small', round: true }, { default: () => MAINT_CYCLE_LABEL[row.cycleType] }),
  },
  { title: '计划日期', key: 'planDate', width: 120 },
  { title: '执行人', key: 'executor', width: 100 },
  {
    title: '完成度',
    key: 'progress',
    width: 170,
    render: (row) =>
      h(NProgress, {
        type: 'line',
        percentage: row.progress,
        height: 8,
        color: row.progress >= 100 ? '#18a058' : '#2080f0',
        railColor: '#eef2f0',
      }),
  },
  {
    title: '异常项',
    key: 'abnormalCount',
    width: 90,
    render: (row) => (row.abnormalCount > 0 ? `${row.abnormalCount} 项` : '—'),
  },
  {
    title: '状态',
    key: 'state',
    width: 150,
    render: (row) => h(StateTag, { value: row.state, kind: 'plan', overdue: row.overdue }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 2 }, {
        default: () => [
          h(
            NButton,
            { size: 'tiny', text: true, type: 'primary', onClick: () => router.push(ROUTES.planItems(row.id)) },
            { default: () => '执行' },
          ),
          h(NButton, { size: 'tiny', text: true, onClick: () => openAssign(row) }, { default: () => '指派' }),
          h(NButton, { size: 'tiny', text: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(
            NButton,
            {
              size: 'tiny',
              text: true,
              type: row.state === 'signed' ? 'default' : 'success',
              disabled: row.state === 'signed',
              onClick: () => void sign(row),
            },
            { default: () => '签署' },
          ),
          h(
            NButton,
            {
              size: 'tiny',
              text: true,
              type: 'error',
              onClick: async () => {
                await planStore.deletePlan(row.id);
                message.success('计划及其保养项已删除');
              },
            },
            { default: () => '删除' },
          ),
        ],
      }),
  },
]);

const avgRescueHint = computed(() => {
  const views = elevatorStore.elevatorViews.filter((item) => item.lastRescueMinutes !== null);
  if (views.length === 0) return '暂无救援记录';
  return views
    .slice(0, 3)
    .map((item) => `${item.regCode.slice(-4)} ${formatMinutes(item.lastRescueMinutes ?? 0)}`)
    .join(' · ');
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">保养计划</h2>
        <div class="page-sub">
          按半月 / 季度 / 年度批量生成计划并指派执行人；逾期未签署自动标红，签署需全部保养项已填写结果。
        </div>
      </div>
      <n-space>
        <n-button @click="router.push(ROUTES.rectifies)">整改与预警</n-button>
        <n-button type="primary" @click="openGenerate()">批量生成计划</n-button>
      </n-space>
    </div>

    <div class="stat-grid">
      <stat-badge
        title="计划完成率"
        :value="overallCompletion"
        suffix="%"
        :percent="overallCompletion"
        color="#18a058"
        :hint="`已签署 ${stateCounts.signed} 期 / 共 ${progressPlans.length} 期`"
      />
      <stat-badge
        title="逾期未签署"
        :value="overduePlans.length"
        suffix="期"
        color="#d03050"
        :hint="`待执行 ${stateCounts.pending} 期 · 执行中 ${stateCounts.executing} 期`"
      />
      <stat-badge
        title="签署覆盖率"
        :value="signCoverage"
        suffix="%"
        :percent="signCoverage"
        color="#2080f0"
        hint="已填写保养项 / 全部保养项"
      />
      <stat-badge
        title="7 天内到期"
        :value="dueSoonPlans.length"
        suffix="期"
        color="#f0a020"
        :hint="avgRescueHint"
      />
    </div>

    <n-grid :cols="2" :x-gap="12" style="margin-bottom: 14px">
      <n-gi v-for="stat in cycleStats" :key="stat.cycleType">
        <n-card size="small" :title="`${stat.label}周期`">
          <n-space justify="space-between" align="center">
            <n-text depth="3">计划 {{ stat.total }} 期 · 已签署 {{ stat.signed }} 期 · 逾期 {{ stat.overdue }} 期</n-text>
            <n-tag :type="stat.completion >= 80 ? 'success' : stat.completion >= 50 ? 'warning' : 'error'" round>
              完成率 {{ stat.completion }}%
            </n-tag>
          </n-space>
          <n-progress
            type="line"
            :percentage="stat.completion"
            :height="8"
            style="margin-top: 8px"
            :color="stat.completion >= 80 ? '#18a058' : '#f0a020'"
          />
          <n-text depth="3" style="font-size: 12px">平均完成度 {{ stat.averageProgress }}%</n-text>
        </n-card>
      </n-gi>
    </n-grid>

    <filter-bar
      keyword-placeholder="按电梯 / 执行人搜索"
      :selects="[
        { key: 'cycle', label: '周期', options: cycleOptions, width: 190 },
        { key: 'state', label: '状态', options: stateOptions, width: 190 },
      ]"
      :result-count="filtered.length"
      count-unit="期计划"
      @update:keyword="(value: string) => (keyword = value)"
      @change="onFilterChange"
    >
      <n-button size="small" :type="overdueOnly ? 'error' : 'default'" @click="overdueOnly = !overdueOnly">
        仅看逾期（{{ overduePlans.length }}）
      </n-button>
    </filter-bar>

    <n-card size="small" class="section-gap">
      <empty-panel
        v-if="filtered.length === 0"
        title="没有匹配的保养计划"
        description="可批量生成计划，或调整筛选条件。"
        create-label="批量生成计划"
        @create="openGenerate()"
      />
      <n-data-table
        v-else
        :columns="columns"
        :data="filtered"
        :bordered="false"
        size="small"
        :scroll-x="1380"
        :pagination="{ pageSize: 10 }"
        :row-class-name="(row: PlanView) => (row.overdue ? 'row-marked' : '')"
      />
    </n-card>

    <!-- 批量生成 -->
    <n-modal v-model:show="generateOpen" preset="card" title="批量生成保养计划" style="max-width: 560px">
      <n-form ref="generateFormRef" :model="generateModel" label-placement="top">
        <n-form-item
          label="电梯（可多选）"
          path="elevatorIds"
          :rule="{ required: true, type: 'array', message: '请至少选择一台电梯', trigger: ['change', 'blur'] }"
        >
          <n-select
            v-model:value="generateModel.elevatorIds"
            multiple
            filterable
            :options="
              elevatorStore.elevators.map((item) => ({
                label: `${item.regCode}（${item.owner}）`,
                value: item.id,
              }))
            "
          />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="周期类型" path="cycleType">
              <n-select v-model:value="generateModel.cycleType" :options="cycleOptions" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="起始日期" path="startTs">
              <n-date-picker v-model:value="generateModel.startTs" type="date" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="连续期数" path="periods">
              <n-input-number v-model:value="generateModel.periods" :min="1" :max="12" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="执行人" path="executor">
              <n-select
                v-model:value="generateModel.executor"
                filterable
                tag
                :options="planStore.executorOptions.map((name) => ({ label: name, value: name }))"
              />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-text depth="3" style="font-size: 12px">
          将按周期口径（半月 15 天 / 季度 90 天 / 年度 365 天）依次生成计划，并同步生成对应保养项清单。
        </n-text>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="generateOpen = false">取消</n-button>
          <n-button type="primary" @click="submitGenerate">生成</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 编辑计划 -->
    <n-modal v-model:show="editOpen" preset="card" title="编辑保养计划" style="max-width: 520px">
      <n-form ref="editFormRef" :model="editModel" label-placement="top">
        <n-form-item label="电梯" path="elevatorId" :rule="{ required: true, message: '请选择电梯', trigger: 'change' }">
          <n-select
            v-model:value="editModel.elevatorId"
            filterable
            :options="
              elevatorStore.elevators.map((item) => ({
                label: `${item.regCode}（${item.owner}）`,
                value: item.id,
              }))
            "
          />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="周期类型" path="cycleType">
              <n-select v-model:value="editModel.cycleType" :options="cycleOptions" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="计划日期" path="planDateTs">
              <n-date-picker v-model:value="editModel.planDateTs" type="date" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-form-item label="执行人" path="executor" :rule="{ required: true, message: '请输入执行人', trigger: 'blur' }">
          <n-input v-model:value="editModel.executor" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editOpen = false">取消</n-button>
          <n-button type="primary" @click="submitEdit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 指派执行人 -->
    <n-modal v-model:show="assignOpen" preset="card" title="指派执行人" style="max-width: 440px">
      <n-form label-placement="top">
        <n-form-item label="计划">
          <n-text>{{ assignTarget?.elevatorName }} · {{ assignTarget?.planDate }}</n-text>
        </n-form-item>
        <n-form-item label="执行人">
          <n-select
            v-model:value="assignModel.executor"
            filterable
            tag
            :options="planStore.executorOptions.map((name) => ({ label: name, value: name }))"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="assignOpen = false">取消</n-button>
          <n-button type="primary" @click="submitAssign">确认指派</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>
