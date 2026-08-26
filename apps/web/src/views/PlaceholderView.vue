<script setup lang="ts">
/**
 * [P10a] 通用占位页：菜单中尚未实现的页面统一指向本组件，
 * 标题取自路由 meta（P10b/c/d 逐阶段替换为真实页面）。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : '页面'));
</script>

<template>
  <el-card>
    <template #header>{{ title }}</template>
    <el-empty :description="`「${title}」页面建设中（后续阶段实现）`" />
  </el-card>
</template>
