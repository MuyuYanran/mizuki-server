<script setup lang="ts">
/**
 * [P10a] 主布局：顶栏（项目名 + 管理员 + 登出）+ 侧边栏菜单 + 内容区。
 * 菜单项按 §3.6 清单全量列出；未实现页面指向占位路由。
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '../api/auth';
import { authState, clearAuth } from '../stores/auth';

const route = useRoute();
const router = useRouter();

interface MenuItem {
  path: string;
  title: string;
}

/** 侧边栏菜单（§3.6 清单逐字） */
const MENU: MenuItem[] = [
  { path: '/', title: '仪表盘' },
  { path: '/articles', title: '文章' },
  { path: '/collections/diary', title: '日记' },
  { path: '/collections/friends', title: '友链' },
  { path: '/collections/projects', title: '项目' },
  { path: '/collections/timeline', title: '时间线' },
  { path: '/collections/skills', title: '技能' },
  { path: '/collections/devices', title: '设备' },
  { path: '/albums', title: '相册' },
  { path: '/media', title: '媒体库' },
  { path: '/backups', title: '备份' },
  { path: '/console', title: '构建预览' },
  { path: '/settings', title: '设置' },
];

const activeMenu = computed(() => route.path);
const username = computed(() => authState.user?.username ?? '管理员');

async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // 登出接口失败也继续清理本地态（无状态登出语义）
  }
  clearAuth();
  ElMessage.success('已登出');
  void router.push('/login');
}
</script>

<template>
  <el-container class="layout-root">
    <el-header class="layout-header">
      <span class="brand">Mizuki 管理面板</span>
      <span class="user-area">
        <span class="username">{{ username }}</span>
        <el-button size="small" @click="logout">登出</el-button>
      </span>
    </el-header>
    <el-container>
      <el-aside width="220px" class="layout-aside">
        <el-menu :default-active="activeMenu" router class="layout-menu">
          <el-menu-item v-for="item in MENU" :key="item.path" :index="item.path">
            {{ item.title }}
          </el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout-root {
  min-height: 100vh;
}
.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
}
.brand {
  font-size: 18px;
  font-weight: 700;
}
.user-area {
  display: flex;
  align-items: center;
  gap: 12px;
}
.username {
  color: #606266;
}
.layout-aside {
  border-right: 1px solid #e4e7ed;
}
.layout-menu {
  border-right: none;
}
.layout-main {
  background: #f5f7fa;
}
</style>
