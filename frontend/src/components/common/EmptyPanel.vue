<script setup lang="ts">
/**
 * <EmptyPanel> 空数据引导与新建入口
 * 被全部列表页消费，保证任何列表为空时都有明确的下一步动作。
 */
import { NButton, NEmpty, NSpace, NText } from 'naive-ui';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    createLabel?: string;
    resetLabel?: string;
    /** 自定义重置按钮文案 */
    secondaryLabel?: string;
  }>(),
  {
    title: '暂无数据',
    description: '当前筛选条件下没有记录，可新建一条或调整筛选条件。',
    createLabel: '',
    resetLabel: '',
    secondaryLabel: '',
  },
);

const emit = defineEmits<{
  (event: 'create'): void;
  (event: 'reset'): void;
  (event: 'secondary'): void;
}>();
</script>

<template>
  <div class="empty-panel">
    <n-empty :description="title" size="large">
      <template #extra>
        <div class="empty-panel-body">
          <n-text depth="3" style="display: block; margin-bottom: 12px">{{ description }}</n-text>
          <n-space justify="center">
            <n-button v-if="createLabel" type="primary" @click="emit('create')">{{ createLabel }}</n-button>
            <n-button v-if="resetLabel" @click="emit('reset')">{{ resetLabel }}</n-button>
            <n-button v-if="secondaryLabel" quaternary @click="emit('secondary')">
              {{ secondaryLabel }}
            </n-button>
          </n-space>
        </div>
      </template>
    </n-empty>
  </div>
</template>

<style scoped>
.empty-panel {
  padding: 32px 16px;
  background: #ffffff;
  border: 1px dashed rgba(24, 160, 88, 0.35);
  border-radius: 10px;
}
.empty-panel-body {
  max-width: 520px;
  margin: 0 auto;
  text-align: center;
}
</style>
