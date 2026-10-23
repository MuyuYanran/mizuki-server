<script setup lang="ts">
/**
 * [U4-AI2] AI 服务设置页（路由 `/settings/ai`，入口在菜单「配置」组）
 *
 * 六个区块：总开关 / provider 档案 / 代理三态 / 生成参数 / 高级（允许私有网络）/ 连通性测试。
 *
 * 三条与 AI1 实现对齐的要点（指令包开头那三处"落地事实"）：
 * ① `ping` 回的 `viaProxy` 是**布尔**（配置意图），不是枚举 ⇒ 本页**同时**展示
 *    配置里的 `proxy.mode` 与 ping 的布尔意图，且文案不宣称"已走代理"
 *    （`system` 模式下 `NO_PROXY` 命中会直连，服务端无从感知）；
 * ② 失败分类含 `upstream_4xx`（不止指令包原先列举的那几个）；
 * ③ 保存走「整页一个保存按钮」+ `keepApiKey` 语义：key 输入留空 = 保留既有 key。
 *
 * 安全：本页**永不回显** key 明文（只显示服务端给的 `maskedKey`）；
 * `keySource='env'` 时 key 输入框禁用并说明"环境变量优先，面板改动不生效"。
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  AI_PROXY_MODES,
  type AiAction,
  type AiConfigView,
  type AiProfile,
  type AiProxyMode,
  type AiPutConfigBody,
} from '@mizuki/shared';
import { aiApi, aiFailureText, type AiPingResult } from '../../api/ai';
import { ensureAiConfig } from '../../stores/ai';

/** 编辑态的一条档案（`apiKey` 是本页内的临时明文，提交后立即清空） */
interface ProfileDraft {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** 用户本次新填的 key（留空 = 保留；提交成功后清空，绝不留存） */
  apiKey: string;
  maskedKey: string;
}

const PROXY_LABELS: Record<AiProxyMode, string> = {
  none: '直连（不走代理）',
  system: '系统环境变量代理',
  custom: '指定代理地址',
};

const loading = ref(false);
const saving = ref(false);
const pingLoading = ref(false);
const pingResult = ref<AiPingResult | null>(null);

const enabled = ref(false);
const activeProfileId = ref<string>('');
const profiles = ref<ProfileDraft[]>([]);
const proxyMode = ref<AiProxyMode>('system');
const proxyUrl = ref('');
const allowPrivateNetwork = ref(false);
const maxOutputTokens = ref(1024);
const temperature = ref(0.7);
const timeoutMs = ref(30000);
const keySource = ref<AiConfigView['keySource']>('none');

const keyFromEnv = computed(() => keySource.value === 'env');

const pingText = computed<string>(() => {
  const result = pingResult.value;
  if (result === null) return '';
  if (result.ok) {
    const via =
      result.viaProxy === true
        ? `配置意图：走代理（${PROXY_LABELS[proxyMode.value]}）`
        : '配置意图：直连';
    return `✓ 连接成功 · 模型 ${result.model} · 延迟 ${result.latencyMs}ms · ${via}`;
  }
  return `✗ ${aiFailureText(result.code)}（${result.latencyMs}ms）`;
});

const pingOk = computed(() => pingResult.value?.ok === true);

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    await ensureAiConfig(true);
    const config = await aiApi.getConfig();
    applyConfig(config);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function applyConfig(config: AiConfigView): void {
  enabled.value = config.enabled;
  activeProfileId.value = config.activeProfileId ?? config.profiles[0]?.id ?? '';
  profiles.value = config.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: '',
    maskedKey: profile.maskedKey,
  }));
  proxyMode.value = config.proxy.mode;
  proxyUrl.value = config.proxy.url ?? '';
  allowPrivateNetwork.value = config.allowPrivateNetwork;
  maxOutputTokens.value = config.maxOutputTokens;
  temperature.value = config.temperature;
  timeoutMs.value = config.timeoutMs;
  keySource.value = config.keySource;
}

/** 新增档案（本地草稿；保存时才提交） */
function addProfile(): void {
  const seq = profiles.value.length + 1;
  profiles.value.push({
    id: `profile-${Date.now().toString(36)}`,
    name: `服务 ${seq}`,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    apiKey: '',
    maskedKey: '',
  });
}

/** 删除档案（本地草稿） */
function removeProfile(index: number): void {
  const target = profiles.value[index];
  if (target === undefined) return;
  profiles.value.splice(index, 1);
  if (activeProfileId.value === target.id) {
    activeProfileId.value = profiles.value[0]?.id ?? '';
  }
}

async function toggleAllowPrivateNetwork(next: boolean): Promise<void> {
  if (!next) {
    allowPrivateNetwork.value = false;
    return;
  }
  try {
    await ElMessageBox.confirm(
      '允许服务端访问内网 / 回环地址。仅在你确知风险时开启（例如连接本地 Ollama）。' +
        '开启后，配置的 baseUrl 将不再被"禁止私有网络"的安全闸拦截。',
      '允许私有网络？',
      { type: 'warning', confirmButtonText: '我确认要开启', cancelButtonText: '取消' },
    );
    allowPrivateNetwork.value = true;
  } catch {
    allowPrivateNetwork.value = false;
  }
}

/** 保存前的前端校验（与服务端 schema 同口径，早失败早提示） */
function validate(): string | null {
  if (profiles.value.length === 0) return '至少需要一条服务档案。';
  for (const [index, profile] of profiles.value.entries()) {
    if (profile.id.trim() === '') return `第 ${index + 1} 条档案缺少 id。`;
    if (profile.name.trim() === '') return `第 ${index + 1} 条档案缺少名称。`;
    if (profile.baseUrl.trim() === '') return `第 ${index + 1} 条档案缺少 baseUrl。`;
    if (!/^https?:\/\//i.test(profile.baseUrl.trim())) return `第 ${index + 1} 条档案的 baseUrl 必须以 http:// 或 https:// 开头。`;
    if (profile.model.trim() === '') return `第 ${index + 1} 条档案缺少模型名。`;
  }
  if (proxyMode.value === 'custom' && proxyUrl.value.trim() === '') {
    return '选择了「指定代理地址」时必须填写代理 URL。';
  }
  if (!profiles.value.some((profile) => profile.id === activeProfileId.value)) {
    return '请选择一条「当前使用」的档案。';
  }
  return null;
}

/** 有新填 key 的档案需要二次确认（覆盖不可逆） */
async function confirmKeyOverwrite(): Promise<boolean> {
  const withNewKey = profiles.value.filter((profile) => profile.apiKey.trim() !== '');
  if (withNewKey.length === 0) return true;
  const names = withNewKey.map((profile) => profile.name).join('、');
  try {
    await ElMessageBox.confirm(
      `将覆盖以下档案已保存的 API Key：${names}。覆盖后旧 Key 无法找回。`,
      '覆盖 API Key？',
      { type: 'warning', confirmButtonText: '覆盖', cancelButtonText: '取消' },
    );
    return true;
  } catch {
    return false;
  }
}

async function save(): Promise<void> {
  const problem = validate();
  if (problem !== null) {
    ElMessage.warning(problem);
    return;
  }
  if (!(await confirmKeyOverwrite())) return;

  const body: AiPutConfigBody = {
    enabled: enabled.value,
    activeProfileId: activeProfileId.value,
    profiles: profiles.value.map<AiProfile & { apiKey?: string }>((profile) => ({
      id: profile.id.trim(),
      name: profile.name.trim(),
      baseUrl: profile.baseUrl.trim(),
      model: profile.model.trim(),
      // 关键：空串 = 不提供 ⇒ 服务端按 keepApiKey 语义保留既有 key
      ...(profile.apiKey.trim() !== '' ? { apiKey: profile.apiKey.trim() } : {}),
    })),
    proxy:
      proxyMode.value === 'custom'
        ? { mode: 'custom', url: proxyUrl.value.trim() }
        : { mode: proxyMode.value },
    allowPrivateNetwork: allowPrivateNetwork.value,
    maxOutputTokens: maxOutputTokens.value,
    temperature: temperature.value,
    timeoutMs: timeoutMs.value,
    // 省略 = 保留既有 key（与 taskEnv.keep 同语义）
  };

  saving.value = true;
  try {
    const config = await aiApi.putConfig(body);
    applyConfig(config);
    await ensureAiConfig(true);
    ElMessage.success('已保存，立即生效');
    // 保存后自动重测一次：验证"活取"真的生效（K7）
    if (pingResult.value !== null) {
      await runPing();
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function runPing(): Promise<void> {
  pingLoading.value = true;
  try {
    pingResult.value = await aiApi.ping();
  } catch (error) {
    pingResult.value = null;
    ElMessage.error(error instanceof Error ? error.message : '测试失败');
  } finally {
    pingLoading.value = false;
  }
}

/** 动作枚举仅用于此页的提示文案（避免"未使用导入"） */
const ACTION_HINT: Record<AiAction, string> = {
  polish: '润色',
  continue: '续写',
  summarize: '摘要',
  meta: '标题·描述·标签',
  translate: '翻译',
};
const actionCount = Object.keys(ACTION_HINT).length;
</script>

<template>
  <div class="ai-settings">
    <h2 class="page-title">AI 服务</h2>
    <p class="page-hint">
      面板右侧的 AI 助手使用这里配置的服务档案。密钥只保存在服务端（<code>config.json</code>），
      浏览器不存储、也不会回显明文。
    </p>

    <el-card v-loading="loading" shadow="never" class="ai-card">
      <!-- ① 总开关 -->
      <section class="ai-section">
        <div class="ai-row">
          <div>
            <div class="ai-label">启用 AI 助手</div>
            <div class="ai-desc">关闭后聊天栏仍可打开，但不能发送请求。</div>
          </div>
          <el-switch v-model="enabled" />
        </div>
      </section>

      <!-- ② provider 档案 -->
      <section class="ai-section">
        <div class="ai-section-head">
          <span class="ai-label">服务档案</span>
          <el-button size="small" @click="addProfile">新增档案</el-button>
        </div>
        <p class="ai-desc">
          可填任意 OpenAI 兼容服务（DeepSeek / 智谱 / Ollama / OneAPI / OpenRouter 等）。
          出站地址会经过安全闸：默认禁止内网与回环地址。
        </p>

        <div v-for="(profile, index) in profiles" :key="profile.id" class="ai-profile">
          <div class="ai-profile-head">
            <el-radio
              :model-value="activeProfileId"
              :value="profile.id"
              @change="activeProfileId = profile.id"
            >
              当前使用
            </el-radio>
            <el-button text size="small" type="danger" @click="removeProfile(index)">删除</el-button>
          </div>
          <div class="ai-profile-grid">
            <label class="ai-field">
              <span>名称</span>
              <el-input v-model="profile.name" size="small" maxlength="40" />
            </label>
            <label class="ai-field">
              <span>模型</span>
              <el-input v-model="profile.model" size="small" maxlength="80" placeholder="deepseek-flash" />
            </label>
            <label class="ai-field ai-field-wide">
              <span>Base URL</span>
              <el-input v-model="profile.baseUrl" size="small" placeholder="https://api.deepseek.com/v1" />
            </label>
            <label class="ai-field ai-field-wide">
              <span>
                API Key
                <template v-if="keyFromEnv">
                  <em class="ai-env">（来自环境变量 MIZUKI_AI_API_KEY，面板改动不生效）</em>
                </template>
                <template v-else-if="profile.maskedKey !== ''">
                  <em class="ai-masked">已保存：{{ profile.maskedKey }}</em>
                </template>
              </span>
              <el-input
                v-model="profile.apiKey"
                size="small"
                type="password"
                show-password
                :disabled="keyFromEnv"
                :placeholder="profile.maskedKey !== '' ? '留空 = 保留已保存的 Key' : '填入 API Key'"
              />
            </label>
          </div>
        </div>
      </section>

      <!-- ③ 代理三态 -->
      <section class="ai-section">
        <div class="ai-label">网络代理</div>
        <el-radio-group v-model="proxyMode" class="ai-proxy-group">
          <el-radio v-for="mode in AI_PROXY_MODES" :key="mode" :value="mode">
            {{ PROXY_LABELS[mode] }}
          </el-radio>
        </el-radio-group>
        <p v-if="proxyMode === 'system'" class="ai-desc ai-desc-warn">
          「系统环境变量代理」读取 <code>HTTP_PROXY</code> / <code>HTTPS_PROXY</code> /
          <code>NO_PROXY</code>；<strong>不读取 Windows「设置 → 网络 → 代理」里的系统代理</strong>。
        </p>
        <el-input
          v-if="proxyMode === 'custom'"
          v-model="proxyUrl"
          size="small"
          class="ai-proxy-url"
          placeholder="http://127.0.0.1:7897"
        />
      </section>

      <!-- ④ 生成参数 -->
      <section class="ai-section">
        <div class="ai-label">生成参数</div>
        <div class="ai-profile-grid">
          <label class="ai-field">
            <span>最大输出 token</span>
            <el-input-number v-model="maxOutputTokens" :min="1" :max="8192" :step="128" size="small" />
          </label>
          <label class="ai-field">
            <span>温度（0–2）</span>
            <el-input-number v-model="temperature" :min="0" :max="2" :step="0.1" size="small" />
          </label>
          <label class="ai-field">
            <span>超时（毫秒）</span>
            <el-input-number v-model="timeoutMs" :min="1000" :max="120000" :step="1000" size="small" />
          </label>
        </div>
      </section>

      <!-- ⑤ 高级 -->
      <section class="ai-section">
        <div class="ai-row">
          <div>
            <div class="ai-label">允许私有网络（高级）</div>
            <div class="ai-desc ai-desc-warn">
              默认拒绝指向内网 / 回环的 baseUrl。连接本地 Ollama 等场景才需要开启。
            </div>
          </div>
          <el-switch
            :model-value="allowPrivateNetwork"
            @update:model-value="toggleAllowPrivateNetwork($event === true)"
          />
        </div>
      </section>

      <!-- ⑥ 连通性测试 -->
      <section class="ai-section">
        <div class="ai-section-head">
          <span class="ai-label">连通性测试</span>
          <el-button size="small" :loading="pingLoading" @click="runPing">测试连接</el-button>
        </div>
        <p v-if="pingText !== ''" :class="['ai-ping', pingOk ? 'is-ok' : 'is-bad']">{{ pingText }}</p>
        <p v-else class="ai-desc">
          发一条最小请求验证 Key 与地址。失败只回分类码，不会显示上游报错原文。
        </p>
      </section>

      <div class="ai-footer">
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        <span class="ai-desc">共 {{ actionCount }} 个写作动作会用到该服务。</span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.ai-settings {
  max-width: 880px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.page-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-card {
  background: var(--el-bg-color);
}

.ai-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.ai-section:last-of-type {
  border-bottom: none;
}

.ai-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.ai-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.ai-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ai-desc-warn {
  color: var(--el-color-warning-dark-2);
}

.ai-profile {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}

.ai-profile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.ai-profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.ai-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ai-field-wide {
  grid-column: 1 / -1;
}

.ai-env {
  color: var(--el-color-primary);
  font-style: normal;
}

.ai-masked {
  color: var(--el-text-color-placeholder);
  font-style: normal;
}

.ai-proxy-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.ai-proxy-url {
  margin-top: 8px;
  max-width: 420px;
}

.ai-ping {
  margin: 6px 0 0;
  font-size: 13px;
}

.ai-ping.is-ok {
  color: var(--el-color-success);
}

.ai-ping.is-bad {
  color: var(--el-color-danger);
}

.ai-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 14px;
}
</style>
