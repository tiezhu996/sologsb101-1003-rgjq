<script setup lang="ts">
/**
 * /rectifies 年检整改与预警
 * 整改单跟踪与超期预警，查看结构版本并导出 / 导入 JSON；
 * 消费 Rectify、Elevator 与 <StateTag>、<EmptyPanel>。
 */
import { computed, h, onMounted, ref } from 'vue';
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInput,
  NModal,
  NProgress,
  NSelect,
  NSpace,
  NStatistic,
  NTag,
  NText,
  NUpload,
  useMessage,
  type DataTableColumns,
  type FormInst,
} from 'naive-ui';
import { useRectifyStore } from '../stores/rectifyStore';
import { useElevatorStore } from '../stores/elevatorStore';
import {
  RECTIFY_ITEM_LIBRARY,
  RECTIFY_STATE_LABEL,
  type RectifyDraft,
  type RectifyState,
  type RectifyView,
} from '../types/rectify';
import {
  DB_NAME,
  DB_SCHEMA_VERSION,
  ROW_REVISION,
  countAll,
  exportSnapshot,
  importSnapshot,
  resetDatabase,
  schemaInfo,
  type DatabaseSnapshot,
} from '../utils/db';
import { backupFilename, downloadCsv, downloadJson, readJsonFile } from '../utils/export';
import { todayDate } from '../utils/duration';
import { useIdbTable } from '../hooks/useIdbTable';
import StateTag from '../components/common/StateTag.vue';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import FilterBar from '../components/common/FilterBar.vue';

const message = useMessage();
const rectifyStore = useRectifyStore();
const elevatorStore = useElevatorStore();

const keyword = ref('');
const stateFilters = ref<RectifyState[]>([]);
const ownerFilters = ref<string[]>([]);
const overdueOnly = ref(false);

const { data: counts, reload: reloadCounts } = useIdbTable(countAll, []);
const schema = schemaInfo();

onMounted(async () => {
  await rectifyStore.bootstrap();
  await elevatorStore.bootstrap();
  await reloadCounts();
});

function onFilterChange(values: Record<string, string[]>): void {
  stateFilters.value = (values.state ?? []) as RectifyState[];
  ownerFilters.value = values.owner ?? [];
}

const filtered = computed(() => {
  const lower = keyword.value.trim().toLowerCase();
  return rectifyStore.rectifyViews.filter((row) => {
    if (stateFilters.value.length > 0 && !stateFilters.value.includes(row.state)) return false;
    if (ownerFilters.value.length > 0 && !ownerFilters.value.includes(row.owner)) return false;
    if (overdueOnly.value && !row.overdue) return false;
    if (lower && !`${row.elevatorName} ${row.item} ${row.reviewer}`.toLowerCase().includes(lower)) return false;
    return true;
  });
});

/* ------------------------------ 表单 ------------------------------ */
const formRef = ref<FormInst | null>(null);
const modalOpen = ref(false);
const editingId = ref('');
const formModel = ref<{ elevatorId: string; item: string; dueTs: number; reviewer: string }>({
  elevatorId: '',
  item: RECTIFY_ITEM_LIBRARY[0],
  dueTs: Date.now() + 7 * 24 * 3600 * 1000,
  reviewer: '王敏',
});

function toDate(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function openCreate(): void {
  editingId.value = '';
  formModel.value = {
    elevatorId: elevatorStore.activeElevatorId || elevatorStore.elevators[0]?.id || '',
    item: RECTIFY_ITEM_LIBRARY[0],
    dueTs: Date.now() + 7 * 24 * 3600 * 1000,
    reviewer: '王敏',
  };
  modalOpen.value = true;
}

function openEdit(row: RectifyView): void {
  editingId.value = row.id;
  formModel.value = {
    elevatorId: row.elevatorId,
    item: row.item,
    dueTs: new Date(`${row.dueDate}T00:00:00`).getTime(),
    reviewer: row.reviewer,
  };
  modalOpen.value = true;
}

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  const draft: RectifyDraft = {
    elevatorId: formModel.value.elevatorId,
    item: formModel.value.item,
    dueDate: toDate(formModel.value.dueTs),
    reviewer: formModel.value.reviewer,
  };
  if (editingId.value) {
    await rectifyStore.updateRectify(editingId.value, draft);
    message.success('整改单已更新');
  } else {
    await rectifyStore.createRectify(draft);
    message.success('整改单已登记');
  }
  modalOpen.value = false;
}

/* ------------------------------ 备份 ------------------------------ */
async function handleExport(): Promise<void> {
  const snapshot = await exportSnapshot();
  downloadJson(backupFilename(`gbelevsvc-backup-v${DB_SCHEMA_VERSION}`), snapshot);
  message.success(`已导出 ${snapshot.elevators.length} 台电梯、${snapshot.rectifies.length} 条整改单的 JSON 备份`);
}

async function handleImport(file: File): Promise<void> {
  try {
    const snapshot = await readJsonFile<DatabaseSnapshot>(file);
    if (!snapshot || !Array.isArray(snapshot.elevators)) {
      message.error('文件格式不正确：缺少 elevators 数组');
      return;
    }
    await importSnapshot(snapshot);
    await Promise.all([rectifyStore.load(), elevatorStore.load()]);
    await reloadCounts();
    message.success(`导入完成：${snapshot.elevators.length} 台电梯、${snapshot.plans?.length ?? 0} 期计划`);
  } catch (error) {
    message.error(`导入失败：${error instanceof Error ? error.message : '文件解析异常'}`);
  }
}

async function handleReset(): Promise<void> {
  await resetDatabase();
  await Promise.all([rectifyStore.load(), elevatorStore.load()]);
  await reloadCounts();
  message.success('已清空并重新播种演示数据');
}

function exportOverdueCsv(): void {
  const rows: Array<Array<string | number>> = [['电梯', '不合格项', '限期', '状态', '超期天数', '复核人']];
  for (const row of rectifyStore.rectifyViews) {
    rows.push([row.elevatorName, row.item, row.dueDate, RECTIFY_STATE_LABEL[row.state], row.overdueDays, row.reviewer]);
  }
  downloadCsv(`gbelevsvc-rectify-${todayDate()}.csv`, rows);
  message.success('整改清单已导出 CSV');
}

const columns = computed<DataTableColumns<RectifyView>>(() => [
  { title: '电梯', key: 'elevatorName', minWidth: 210, ellipsis: { tooltip: true } },
  { title: '不合格项', key: 'item', minWidth: 180 },
  { title: '限期', key: 'dueDate', width: 120 },
  {
    title: '状态',
    key: 'state',
    width: 190,
    render: (row) => h(StateTag, { value: row.state, kind: 'rectify', overdue: row.overdue, overdueDays: row.overdueDays }),
  },
  { title: '复核人', key: 'reviewer', width: 100 },
  {
    title: '复核时间',
    key: 'reviewedAt',
    width: 150,
    render: (row) => row.reviewedAt ?? '—',
  },
  {
    title: '操作',
    key: 'actions',
    width: 210,
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 2 }, {
        default: () => [
          row.state === 'pending'
            ? h(
                NButton,
                {
                  size: 'tiny',
                  text: true,
                  type: 'success',
                  onClick: async () => {
                    await rectifyStore.review(row.id, row.reviewer);
                    message.success('复核通过，整改单已关闭');
                  },
                },
                { default: () => '复核通过' },
              )
            : h(
                NButton,
                {
                  size: 'tiny',
                  text: true,
                  type: 'warning',
                  onClick: async () => {
                    await rectifyStore.revokeReview(row.id);
                    message.info('已退回待整改');
                  },
                },
                { default: () => '撤销复核' },
              ),
          h(NButton, { size: 'tiny', text: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(
            NButton,
            {
              size: 'tiny',
              text: true,
              type: 'error',
              onClick: async () => {
                await rectifyStore.deleteRectify(row.id);
                message.success('整改单已删除');
              },
            },
            { default: () => '删除' },
          ),
        ],
      }),
  },
]);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">年检整改与预警</h2>
        <div class="page-sub">
          跟踪年检不合格项整改到复核关闭，超期自动预警；可导出 / 导入整库 JSON 并查看 IndexedDB 结构版本。
        </div>
      </div>
      <n-space>
        <n-button @click="exportOverdueCsv">导出整改 CSV</n-button>
        <n-button @click="handleExport">导出 JSON</n-button>
        <n-upload
          :show-file-list="false"
          accept="application/json"
          :default-upload="false"
          @before-upload="
            ({ file }) => {
              if (file.file) void handleImport(file.file);
              return false;
            }
          "
        >
          <n-button>导入 JSON</n-button>
        </n-upload>
        <n-button type="primary" @click="openCreate">登记整改单</n-button>
      </n-space>
    </div>

    <div class="stat-grid">
      <stat-badge title="整改单总数" :value="rectifyStore.rectifyViews.length" suffix="条" color="#18a058" />
      <stat-badge
        title="待整改"
        :value="rectifyStore.pendingViews.length"
        suffix="条"
        color="#f0a020"
        hint="未复核关闭的整改项"
      />
      <stat-badge
        title="超期预警"
        :value="rectifyStore.overdueViews.length"
        suffix="条"
        color="#d03050"
        :hint="
          rectifyStore.overdueViews.length > 0
            ? `最长超期 ${rectifyStore.overdueViews[0]?.overdueDays ?? 0} 天`
            : '暂无超期整改'
        "
      />
      <stat-badge
        title="整改复核率"
        :value="rectifyStore.reviewRate"
        suffix="%"
        :percent="rectifyStore.reviewRate"
        color="#2080f0"
      />
    </div>

    <filter-bar
      keyword-placeholder="按电梯 / 不合格项 / 复核人搜索"
      :selects="[
        {
          key: 'state',
          label: '状态',
          options: [
            { label: '待整改', value: 'pending' },
            { label: '已复核', value: 'reviewed' },
          ],
          width: 180,
        },
        {
          key: 'owner',
          label: '使用单位',
          options: elevatorStore.ownerGroups.map((item) => ({ label: item.owner, value: item.owner })),
          width: 220,
        },
      ]"
      :result-count="filtered.length"
      count-unit="条整改"
      @update:keyword="(value: string) => (keyword = value)"
      @change="onFilterChange"
    >
      <n-button size="small" :type="overdueOnly ? 'error' : 'default'" @click="overdueOnly = !overdueOnly">
        仅看超期（{{ rectifyStore.overdueViews.length }}）
      </n-button>
    </filter-bar>

    <n-grid :cols="3" :x-gap="14" class="section-gap">
      <n-gi :span="2">
        <n-card size="small" title="整改单跟踪">
          <empty-panel
            v-if="filtered.length === 0"
            title="没有匹配的整改单"
            description="可登记整改单，或在保养执行页将异常项一键转整改。"
            create-label="登记整改单"
            @create="openCreate"
          />
          <n-data-table
            v-else
            :columns="columns"
            :data="filtered"
            :bordered="false"
            size="small"
            :scroll-x="1160"
            :pagination="{ pageSize: 9 }"
            :row-class-name="(row: RectifyView) => (row.overdue ? 'row-marked' : '')"
          />
        </n-card>
      </n-gi>

      <n-gi>
        <n-card size="small" title="超期预警清单" style="margin-bottom: 14px">
          <n-space v-if="rectifyStore.overdueViews.length === 0" vertical>
            <n-text depth="3">暂无超期整改，全部在限期内。</n-text>
          </n-space>
          <n-space v-else vertical :size="10">
            <div v-for="row in rectifyStore.overdueViews" :key="row.id">
              <n-space justify="space-between" align="center">
                <n-text strong style="font-size: 13px">{{ row.item }}</n-text>
                <n-tag size="small" type="error" round>超期 {{ row.overdueDays }} 天</n-tag>
              </n-space>
              <n-text depth="3" style="font-size: 12px">{{ row.elevatorName }} · 限期 {{ row.dueDate }}</n-text>
            </div>
          </n-space>
        </n-card>

        <n-card size="small" title="按使用单位统计" style="margin-bottom: 14px">
          <n-space vertical :size="10">
            <div v-for="group in rectifyStore.byOwner" :key="group.owner">
              <n-space justify="space-between" align="center">
                <n-text style="font-size: 13px">{{ group.owner }}</n-text>
                <n-text depth="3" style="font-size: 12px">
                  待整改 {{ group.pending }} / 共 {{ group.total }}
                </n-text>
              </n-space>
              <n-progress
                type="line"
                :percentage="group.total === 0 ? 0 : Number((((group.total - group.pending) / group.total) * 100).toFixed(1))"
                :height="6"
                :show-indicator="false"
                color="#18a058"
              />
            </div>
            <n-text v-if="rectifyStore.byOwner.length === 0" depth="3">暂无整改数据</n-text>
          </n-space>
        </n-card>

        <n-card size="small" title="结构版本与存储">
          <n-descriptions :column="1" size="small" label-placement="left" bordered>
            <n-descriptions-item label="IndexedDB 库名">
              <n-tag size="small" type="info">{{ DB_NAME }}</n-tag>
            </n-descriptions-item>
            <n-descriptions-item label="结构版本">v{{ DB_SCHEMA_VERSION }}</n-descriptions-item>
            <n-descriptions-item label="行修订号">{{ ROW_REVISION }}</n-descriptions-item>
            <n-descriptions-item label="基准日期">{{ schema.today }}</n-descriptions-item>
          </n-descriptions>
          <n-space :size="8" :wrap="true" style="margin-top: 10px">
            <n-tag v-for="(count, table) in counts ?? {}" :key="table" size="small" round>
              {{ table }} {{ count }}
            </n-tag>
          </n-space>
          <n-statistic label="整改单存储条数" :value="counts?.rectifies ?? 0" style="margin-top: 10px" />
          <n-button size="small" type="error" quaternary style="margin-top: 8px" @click="handleReset">
            重置演示数据（清空并重新播种）
          </n-button>
        </n-card>
      </n-gi>
    </n-grid>

    <!-- 登记 / 编辑 -->
    <n-modal
      v-model:show="modalOpen"
      preset="card"
      :title="editingId ? '编辑整改单' : '登记整改单'"
      style="max-width: 520px"
    >
      <n-form ref="formRef" :model="formModel" label-placement="top">
        <n-form-item
          label="电梯"
          path="elevatorId"
          :rule="{ required: true, message: '请选择电梯', trigger: 'change' }"
        >
          <n-select
            v-model:value="formModel.elevatorId"
            filterable
            :options="elevatorStore.elevators.map((item) => ({ label: `${item.regCode}（${item.owner}）`, value: item.id }))"
          />
        </n-form-item>
        <n-form-item
          label="不合格项"
          path="item"
          :rule="{ required: true, message: '请输入或选择不合格项', trigger: ['blur', 'change'] }"
        >
          <n-select
            v-model:value="formModel.item"
            filterable
            tag
            :options="RECTIFY_ITEM_LIBRARY.map((item) => ({ label: item, value: item }))"
          />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="整改限期" path="dueTs">
              <n-date-picker v-model:value="formModel.dueTs" type="date" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="复核人" path="reviewer">
              <n-input v-model:value="formModel.reviewer" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="modalOpen = false">取消</n-button>
          <n-button type="primary" @click="submit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>
