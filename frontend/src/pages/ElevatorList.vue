<script setup lang="ts">
/**
 * /elevators 电梯档案
 * 建立电梯与使用单位档案，按使用单位与周期类型筛选；
 * 卡片回显超期项与待整改数。消费 Elevator、Rectify 与 <StatBadge>、<EmptyPanel>、<FilterBar>。
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
  NSelect,
  NSpace,
  NTag,
  NText,
  NTimeline,
  NTimelineItem,
  useMessage,
  type DataTableColumns,
  type FormInst,
} from 'naive-ui';
import { ROUTES } from '../router';
import { useElevatorStore } from '../stores/elevatorStore';
import { usePlanStore } from '../stores/planStore';
import { useRectifyStore } from '../stores/rectifyStore';
import {
  MAINT_CYCLE_LABEL,
  elevatorUsageLabel,
  loadLabel,
  type ElevatorDraft,
  type MaintCycle,
} from '../types/elevator';
import type { RectifyView } from '../types/rectify';
import { remindState } from '../utils/cycle';
import { formatMinutes } from '../utils/duration';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import FilterBar from '../components/common/FilterBar.vue';
import StateTag from '../components/common/StateTag.vue';

const router = useRouter();
const message = useMessage();
const elevatorStore = useElevatorStore();
const planStore = usePlanStore();
const rectifyStore = useRectifyStore();

const keyword = ref(String(router.currentRoute.value.query.kw ?? ''));
const selectedOwners = ref<string[]>([]);
const selectedCycles = ref<MaintCycle[]>([]);

/** FilterBar 变更回调：条件值即 URL query 值，直接用于筛选 */
function onFilterChange(values: Record<string, string[]>): void {
  selectedOwners.value = values.owner ?? [];
  selectedCycles.value = (values.cycle ?? []) as MaintCycle[];
}

const formRef = ref<FormInst | null>(null);
const modalOpen = ref(false);
const editingId = ref<string>('');
const formModel = ref<{ draft: ElevatorDraft; useDateTs: number | null }>({
  draft: {
    regCode: '',
    owner: '',
    loadKg: 1000,
    stops: 18,
    useDate: '',
    maintCycle: 'halfMonth',
  },
  useDateTs: Date.now(),
});

/** 详情抽屉展示的整改单 */
const detailElevatorId = ref<string>('');

const cycleOptions = (Object.keys(MAINT_CYCLE_LABEL) as MaintCycle[]).map((key) => ({
  label: MAINT_CYCLE_LABEL[key],
  value: key,
}));

onMounted(async () => {
  await elevatorStore.bootstrap();
  await Promise.all([planStore.bootstrap(), rectifyStore.bootstrap()]);
});

const ownerOptions = computed(() =>
  elevatorStore.ownerGroups.map((group) => ({ label: `${group.owner}（${group.count}）`, value: group.owner })),
);

const filteredViews = computed(() => {
  const lower = keyword.value.trim().toLowerCase();
  return elevatorStore.elevatorViews.filter((item) => {
    if (selectedOwners.value.length > 0 && !selectedOwners.value.includes(item.owner)) return false;
    if (selectedCycles.value.length > 0 && !selectedCycles.value.includes(item.maintCycle)) return false;
    if (lower) {
      const haystack = `${item.regCode} ${item.owner}`.toLowerCase();
      if (!haystack.includes(lower)) return false;
    }
    return true;
  });
});

const overview = computed(() => {
  const views = elevatorStore.elevatorViews;
  const overduePlans = views.reduce((sum, item) => sum + item.overduePlanCount, 0);
  const pendingRectifies = rectifyStore.pendingViews.length;
  const withRescue = views.filter((item) => item.lastRescueMinutes !== null);
  const avgRescue =
    withRescue.length === 0
      ? 0
      : Math.round(withRescue.reduce((sum, item) => sum + (item.lastRescueMinutes ?? 0), 0) / withRescue.length);
  return { total: views.length, overduePlans, pendingRectifies, avgRescue };
});

const detailElevator = computed(
  () => elevatorStore.elevatorViews.find((item) => item.id === detailElevatorId.value) ?? null,
);

const detailPlans = computed(() =>
  planStore.planViews.filter((item) => item.elevatorId === detailElevatorId.value),
);

const detailRectifies = computed<RectifyView[]>(() =>
  rectifyStore.rectifyViews.filter((item) => item.elevatorId === detailElevatorId.value),
);

const detailRescues = computed(() =>
  elevatorStore.rescues
    .filter((item) => item.elevatorId === detailElevatorId.value)
    .sort((a, b) => b.alarmAt.localeCompare(a.alarmAt)),
);

const rectifyColumns: DataTableColumns<RectifyView> = [
  { title: '不合格项', key: 'item', minWidth: 180 },
  { title: '限期', key: 'dueDate', width: 120 },
  {
    title: '状态',
    key: 'state',
    width: 160,
    render: (row) => h(StateTag, { value: row.state, kind: 'rectify', overdue: row.overdue, overdueDays: row.overdueDays }),
  },
  { title: '复核人', key: 'reviewer', width: 100 },
];

function openCreate(): void {
  editingId.value = '';
  formModel.value = {
    draft: {
      regCode: `DT-${Math.floor(3100 + Math.random() * 800)}-${new Date().getFullYear()}-${String(
        Math.floor(Math.random() * 9000) + 1000,
      )}`,
      owner: ownerOptions.value[0]?.value ?? '',
      loadKg: 1000,
      stops: 18,
      useDate: '',
      maintCycle: 'halfMonth',
    },
    useDateTs: Date.now(),
  };
  modalOpen.value = true;
}

function openEdit(id: string): void {
  const target = elevatorStore.elevators.find((item) => item.id === id);
  if (!target) return;
  editingId.value = id;
  formModel.value = {
    draft: {
      regCode: target.regCode,
      owner: target.owner,
      loadKg: target.loadKg,
      stops: target.stops,
      useDate: target.useDate,
      maintCycle: target.maintCycle,
    },
    useDateTs: new Date(`${target.useDate}T00:00:00`).getTime(),
  };
  modalOpen.value = true;
}

function tsToDate(ts: number | null): string {
  if (!ts) return new Date().toISOString().slice(0, 10);
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  const draft: ElevatorDraft = { ...formModel.value.draft, useDate: tsToDate(formModel.value.useDateTs) };
  if (editingId.value) {
    await elevatorStore.updateElevator(editingId.value, draft);
    message.success('电梯档案已更新');
  } else {
    const created = await elevatorStore.createElevator(draft);
    message.success('电梯已建档，可继续生成保养计划');
    modalOpen.value = false;
    await router.push(ROUTES.plans);
    void created;
    return;
  }
  modalOpen.value = false;
}

async function removeElevator(id: string): Promise<void> {
  await elevatorStore.deleteElevator(id);
  message.success('电梯及其计划、保养项、救援与整改记录已删除');
}

const rescueColumns: DataTableColumns<(typeof elevatorStore.rescues)[number]> = [
  { title: '报警时间', key: 'alarmAt', width: 150 },
  { title: '原因', key: 'cause', minWidth: 140 },
  { title: '被困人数', key: 'trappedCount', width: 100 },
  { title: '救援人', key: 'responder', width: 100 },
];
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">电梯档案</h2>
        <div class="page-sub">
          建立电梯与使用单位档案，按周期类型自动推算下次保养；卡片回显超期计划与待整改数量。
        </div>
      </div>
      <n-space>
        <n-button @click="router.push(ROUTES.rectifies)">整改与预警</n-button>
        <n-button type="primary" @click="openCreate">新建电梯</n-button>
      </n-space>
    </div>

    <div class="stat-grid">
      <stat-badge title="在册电梯" :value="overview.total" suffix="台" color="#18a058" />
      <stat-badge
        title="逾期未签署计划"
        :value="overview.overduePlans"
        suffix="期"
        color="#d03050"
        hint="计划日期已过且状态不是已签署"
      />
      <stat-badge
        title="待整改项"
        :value="overview.pendingRectifies"
        suffix="项"
        color="#f0a020"
        :percent="rectifyStore.reviewRate"
        hint="进度条为整改复核率"
      />
      <stat-badge
        title="最近救援均值"
        :value="overview.avgRescue"
        suffix="分钟"
        color="#2080f0"
        hint="各电梯最近一次困人救援时长的平均"
      />
    </div>

    <filter-bar
      keyword-placeholder="按注册代码 / 使用单位搜索"
      :selects="[
        { key: 'owner', label: '使用单位', options: ownerOptions, width: 220 },
        { key: 'cycle', label: '周期类型', options: cycleOptions, width: 170 },
      ]"
      :result-count="filteredViews.length"
      count-unit="台电梯"
      @update:keyword="(value: string) => (keyword = value)"
      @change="onFilterChange"
    />

    <n-space class="section-gap" :wrap="true" :size="10">
      <n-tag
        v-for="group in elevatorStore.ownerGroups"
        :key="group.owner"
        round
        :type="selectedOwners.includes(group.owner) ? 'success' : 'default'"
        style="cursor: pointer"
        @click="
          selectedOwners.includes(group.owner)
            ? (selectedOwners = selectedOwners.filter((item) => item !== group.owner))
            : selectedOwners.push(group.owner)
        "
      >
        {{ group.owner }} · {{ group.count }}
      </n-tag>
      <n-button v-if="selectedOwners.length > 0" size="tiny" quaternary @click="selectedOwners = []">
        清空单位筛选
      </n-button>
    </n-space>

    <div class="section-gap">
      <empty-panel
        v-if="filteredViews.length === 0"
        title="没有匹配的电梯"
        description="可新建电梯档案，或清空筛选条件后重试。"
        create-label="新建电梯"
        @create="openCreate"
      />
      <div v-else class="card-grid">
        <div
          v-for="item in filteredViews"
          :key="item.id"
          class="elevator-card"
          :class="{ 'is-active': elevatorStore.activeElevatorId === item.id }"
          @click="elevatorStore.setActive(item.id)"
        >
          <n-space align="start" justify="space-between" style="width: 100%">
            <div>
              <n-text strong style="font-size: 15px">{{ item.regCode }}</n-text>
              <div class="hint">{{ item.owner }}</div>
            </div>
            <n-space :size="4">
              <n-button size="tiny" quaternary @click.stop="openEdit(item.id)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click.stop="removeElevator(item.id)">删除</n-button>
            </n-space>
          </n-space>

          <n-grid :cols="3" :x-gap="8" style="margin-top: 10px">
            <n-gi>
              <stat-badge title="载重" :value="item.loadKg" suffix="kg" inline color="#18a058" />
            </n-gi>
            <n-gi>
              <stat-badge title="层站" :value="item.stops" suffix="层" inline color="#2080f0" />
            </n-gi>
            <n-gi>
              <stat-badge
                title="逾期计划"
                :value="item.overduePlanCount"
                suffix="期"
                inline
                :color="item.overduePlanCount > 0 ? '#d03050' : '#18a058'"
              />
            </n-gi>
          </n-grid>

          <div class="inline-tags" style="margin-top: 10px">
            <n-tag size="small" round>{{ MAINT_CYCLE_LABEL[item.maintCycle] }}</n-tag>
            <n-tag size="small" round>{{ loadLabel(item.loadKg) }}</n-tag>
            <n-tag size="small" round>{{ elevatorUsageLabel(item.useDate) }}</n-tag>
            <n-tag size="small" round type="info">投用 {{ item.useDate }}</n-tag>
          </div>

          <div class="hint" style="margin-top: 8px">
            下次保养 {{ item.nextPlanDate }} ·
            {{ remindState(item.useDate, item.maintCycle).text }} · 待整改 {{ item.pendingRectifyCount }} 项
          </div>
          <div class="hint">
            最近救援：
            {{ item.lastRescueMinutes === null ? '无记录' : formatMinutes(item.lastRescueMinutes) }} · 计划
            {{ item.planCount }} 期
          </div>

          <n-space justify="space-between" align="center" style="margin-top: 8px">
            <n-button size="tiny" text type="primary" @click.stop="detailElevatorId = item.id">
              查看档案详情
            </n-button>
            <n-button
              size="tiny"
              text
              type="primary"
              @click.stop="
                () => {
                  elevatorStore.setActive(item.id);
                  router.push(ROUTES.plans);
                }
              "
            >
              去生成计划
            </n-button>
          </n-space>
        </div>
      </div>
    </div>

    <!-- 电梯表单 -->
    <n-modal
      v-model:show="modalOpen"
      preset="card"
      :title="editingId ? '编辑电梯档案' : '新建电梯档案'"
      style="max-width: 520px"
    >
      <n-form ref="formRef" :model="formModel.draft" label-placement="top">
        <n-form-item
          label="注册代码"
          path="regCode"
          :rule="{ required: true, message: '请输入注册代码', trigger: ['input', 'blur'] }"
        >
          <n-input v-model:value="formModel.draft.regCode" placeholder="如 DT-3101-2021-0087" />
        </n-form-item>
        <n-form-item
          label="使用单位"
          path="owner"
          :rule="{ required: true, message: '请选择或输入使用单位', trigger: ['input', 'blur'] }"
        >
          <n-select
            v-model:value="formModel.draft.owner"
            filterable
            tag
            placeholder="选择或输入使用单位"
            :options="ownerOptions"
          />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="载重（kg）" path="loadKg">
              <n-input-number v-model:value="formModel.draft.loadKg" :min="100" :max="6000" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="层站数" path="stops">
              <n-input-number v-model:value="formModel.draft.stops" :min="2" :max="80" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="投用日期" path="useDate">
              <n-date-picker v-model:value="formModel.useDateTs" type="date" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="维保周期" path="maintCycle">
              <n-select v-model:value="formModel.draft.maintCycle" :options="cycleOptions" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-text depth="3" style="font-size: 12px">
          周期口径：半月 15 天、季度 90 天、年度 365 天，建档后可据此自动推算下次保养日期。
        </n-text>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="modalOpen = false">取消</n-button>
          <n-button type="primary" @click="submit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 档案详情 -->
    <n-modal
      :show="Boolean(detailElevatorId)"
      preset="card"
      :title="detailElevator ? `档案详情 · ${detailElevator.regCode}` : '档案详情'"
      style="max-width: 900px"
      @update:show="(value: boolean) => (!value ? (detailElevatorId = '') : undefined)"
    >
      <template v-if="detailElevator">
        <n-space :size="8" :wrap="true" style="margin-bottom: 12px">
          <n-tag round type="success">{{ detailElevator.owner }}</n-tag>
          <n-tag round>载重 {{ detailElevator.loadKg }}kg</n-tag>
          <n-tag round>{{ detailElevator.stops }} 层站</n-tag>
          <n-tag round>投用 {{ detailElevator.useDate }}</n-tag>
          <n-tag round>{{ MAINT_CYCLE_LABEL[detailElevator.maintCycle] }}</n-tag>
        </n-space>

        <n-grid :cols="3" :x-gap="10" style="margin-bottom: 12px">
          <n-gi>
            <stat-badge title="计划期数" :value="detailElevator.planCount" suffix="期" inline color="#18a058" />
          </n-gi>
          <n-gi>
            <stat-badge
              title="逾期计划"
              :value="detailElevator.overduePlanCount"
              suffix="期"
              inline
              color="#d03050"
            />
          </n-gi>
          <n-gi>
            <stat-badge
              title="待整改"
              :value="detailElevator.pendingRectifyCount"
              suffix="项"
              inline
              color="#f0a020"
            />
          </n-gi>
        </n-grid>

        <n-card size="small" title="保养计划" style="margin-bottom: 12px">
          <n-data-table
            :columns="[
              { title: '计划日期', key: 'planDate', width: 120 },
              { title: '周期', key: 'cycleType', width: 90 },
              { title: '执行人', key: 'executor', width: 100 },
              { title: '进度', key: 'progress', width: 90, render: (row: any) => `${row.progress}%` },
              {
                title: '状态',
                key: 'state',
                width: 150,
                render: (row: any) =>
                  h(StateTag, { value: row.state, kind: 'plan', overdue: row.overdue }),
              },
              {
                title: '操作',
                key: 'actions',
                width: 100,
                render: (row: any) =>
                  h(
                    NButton,
                    { size: 'tiny', text: true, type: 'primary', onClick: () => router.push(ROUTES.planItems(row.id)) },
                    { default: () => '执行' },
                  ),
              },
            ]"
            :data="detailPlans"
            :bordered="false"
            size="small"
            :pagination="false"
          />
        </n-card>

        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-card size="small" title="整改单">
              <n-data-table
                :columns="rectifyColumns"
                :data="detailRectifies"
                :bordered="false"
                size="small"
                :pagination="false"
              />
            </n-card>
          </n-gi>
          <n-gi>
            <n-card size="small" title="困人事件">
              <n-timeline v-if="detailRescues.length > 0">
                <n-timeline-item
                  v-for="rescue in detailRescues"
                  :key="rescue.id"
                  type="error"
                  :title="rescue.alarmAt"
                  :content="`${rescue.cause} · 被困 ${rescue.trappedCount} 人 · ${rescue.responder}`"
                />
              </n-timeline>
              <n-data-table
                v-else
                :columns="rescueColumns"
                :data="[]"
                :bordered="false"
                size="small"
                :pagination="false"
              />
            </n-card>
          </n-gi>
        </n-grid>
      </template>
    </n-modal>
  </div>
</template>
