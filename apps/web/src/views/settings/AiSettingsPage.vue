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
 *
 * [U4-UI1] 版式重做：
 *  - 与其它页面统一（`panel-card` 外壳 + 统一 page-header/page-title 口径）；
 *  - 宽度铺满内容区并随视口伸缩（不再固定 880px 挤在左边）：宽屏代理 / 生成参数两列并排，
 *    1280 以下单列、900 以下字段栅格再降一列；
 *  - 生成参数改滑条（step 取「非个位」档，滑条 + 窄数字框双通道，既好调又精确）；
 *  - 控件从 `size="small"` 提升到默认尺寸，字号 13→13/14 并补齐行高，去掉拥挤感。
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  AI_LIMITS,
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

const PROXY_HINTS: Record<AiProxyMode, string> = {
  none: '完全不经过代理，直接与上游服务建立连接。',
  system: '读取 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量；不读取 Windows「设置 → 网络 → 代理」里的系统代理。',
  custom: '所有请求固定走下方填写的代理地址，适合本地 Clash / v2rayN 等固定端口场景。',
};

/** 生成参数的档位（[U4-UI1] 非个位精度：滑条拖起来才对得齐） */
const TOKEN_STEP = 128;
const TIMEOUT_STEP = 1000;
const TEMP_STEP = 0.1;

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

/** 温度档位标记（给滑条一个语义锚点，不是精确刻度） */
const TEMP_MARKS = { 0: '0', 0.7: '0.7', 1.3: '1.3', 2: '2' } as const;

/** 滑条会回写浮点噪声（0.699999988079071），写回配置前统一收敛到 1 位小数 */
const temperatureModel = computed<number>({
  get: () => temperature.value,
  set: (value: number) => {
    temperature.value = Math.round(value * 10) / 10;
  },
});

const tokenLabel = computed(() => maxOutputTokens.value.toLocaleString('zh-CN'));
const timeoutLabel = computed(() => `${(timeoutMs.value / 1000).toFixed(timeoutMs.value % 1000 === 0 ? 0 : 1)} 秒`);
const tempLabel = computed(() => temperature.value.toFixed(1));

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
  <div v-loading="loading" class="ai-page panel-card">
    <div class="page-header">
      <div class="header-left">
        <span class="page-subtitle">
          {{ actionCount }} 个写作动作与右侧助手共用此处配置 · 密钥只存服务端（<code>config.json</code>），浏览器不回显
        </span>
      </div>
      <div class="header-actions">
        <el-button :loading="pingLoading" @click="runPing">测试连接</el-button>
        <el-button type="primary" class="btn-gradient-primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </div>

    <!-- ① 总开关 + ⑤ 允许私有网络：两个开关收进同一条状态带，避免各占一段空白 -->
    <div class="switch-strip">
      <div class="switch-item">
        <div class="switch-text">
          <span class="switch-label">启用 AI 助手</span>
          <span class="switch-desc">关闭后聊天栏仍可打开，但不能发送请求。</span>
        </div>
        <el-switch v-model="enabled" />
      </div>
      <div class="switch-divider" />
      <div class="switch-item">
        <div class="switch-text">
          <span class="switch-label">
            允许私有网络
            <el-tag size="small" type="warning" effect="plain" round>高级</el-tag>
          </span>
          <span class="switch-desc">默认拒绝内网 / 回环 baseUrl，连本地 Ollama 时才需要开启。</span>
        </div>
        <el-switch
          :model-value="allowPrivateNetwork"
          @update:model-value="toggleAllowPrivateNetwork($event === true)"
        />
      </div>
    </div>

    <!-- ② provider 档案 -->
    <section class="block">
      <div class="block-head">
        <div>
          <h3 class="block-title">服务档案</h3>
          <p class="block-desc">
            任意 OpenAI 兼容服务均可（DeepSeek / 智谱 / Ollama / OneAPI / OpenRouter）。
            出站地址会经过安全闸，默认禁止内网与回环地址。
          </p>
        </div>
        <el-button plain @click="addProfile">新增档案</el-button>
      </div>

      <div v-if="profiles.length === 0" class="empty-hint">还没有服务档案，先点右上「新增档案」。</div>

      <div
        v-for="(profile, index) in profiles"
        :key="profile.id"
        :class="['profile', { 'is-active': profile.id === activeProfileId }]"
      >
        <div class="profile-head">
          <label class="profile-pick">
            <input
              type="radio"
              name="ai-active-profile"
              :checked="profile.id === activeProfileId"
              @change="activeProfileId = profile.id"
            />
            <span class="profile-name">{{ profile.name || '未命名档案' }}</span>
            <el-tag v-if="profile.id === activeProfileId" size="small" type="success" effect="light" round>
              当前使用
            </el-tag>
          </label>
          <el-button text type="danger" :disabled="profiles.length <= 1" @click="removeProfile(index)">
            删除
          </el-button>
        </div>

        <div class="field-grid">
          <label class="field">
            <span class="field-label">名称</span>
            <el-input v-model="profile.name" maxlength="40" placeholder="DeepSeek" />
          </label>
          <label class="field">
            <span class="field-label">模型</span>
            <el-input v-model="profile.model" maxlength="80" placeholder="deepseek-flash" />
          </label>
          <label class="field field-span-2">
            <span class="field-label">Base URL</span>
            <el-input v-model="profile.baseUrl" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label class="field field-span-2">
            <span class="field-label">
              API Key
              <em v-if="keyFromEnv" class="field-note is-env">来自环境变量 MIZUKI_AI_API_KEY，面板改动不生效</em>
              <em v-else-if="profile.maskedKey !== ''" class="field-note">已保存：{{ profile.maskedKey }}</em>
            </span>
            <el-input
              v-model="profile.apiKey"
              type="password"
              show-password
              :disabled="keyFromEnv"
              :placeholder="profile.maskedKey !== '' ? '留空 = 保留已保存的 Key' : '填入 API Key'"
            />
          </label>
        </div>
      </div>
    </section>

    <!-- ③ + ④：宽屏并排，窄屏堆叠 -->
    <div class="split">
      <!-- ③ 代理三态 -->
      <section class="block">
        <div class="block-head">
          <div>
            <h3 class="block-title">网络代理</h3>
            <p class="block-desc">{{ PROXY_HINTS[proxyMode] }}</p>
          </div>
        </div>
        <el-radio-group v-model="proxyMode" class="proxy-group">
          <el-radio v-for="mode in AI_PROXY_MODES" :key="mode" :value="mode" class="proxy-radio">
            {{ PROXY_LABELS[mode] }}
          </el-radio>
        </el-radio-group>
        <el-input
          v-if="proxyMode === 'custom'"
          v-model="proxyUrl"
          class="proxy-url"
          placeholder="http://127.0.0.1:7897"
        />
      </section>

      <!-- ④ 生成参数（滑条） -->
      <section class="block">
        <div class="block-head">
          <div>
            <h3 class="block-title">生成参数</h3>
            <p class="block-desc">滑条按档位吸附，右侧数字框保留精确微调。</p>
          </div>
        </div>

        <div class="slider-row">
          <div class="slider-head">
            <span class="slider-label">最大输出 token</span>
            <span class="slider-value">{{ tokenLabel }}</span>
          </div>
          <div class="slider-body">
            <el-slider
              v-model="maxOutputTokens"
              :min="128"
              :max="AI_LIMITS.maxOutputTokensCap"
              :step="TOKEN_STEP"
              :show-tooltip="false"
              class="slider"
            />
            <el-input-number
              v-model="maxOutputTokens"
              :min="1"
              :max="AI_LIMITS.maxOutputTokensCap"
              :step="TOKEN_STEP"
              size="small"
              controls-position="right"
              class="slider-num"
            />
          </div>
        </div>

        <div class="slider-row">
          <div class="slider-head">
            <span class="slider-label">温度</span>
            <span class="slider-value">{{ tempLabel }}</span>
          </div>
          <div class="slider-body">
            <el-slider
              v-model="temperatureModel"
              :min="0"
              :max="2"
              :step="TEMP_STEP"
              :marks="TEMP_MARKS"
              :show-tooltip="false"
              class="slider is-marked"
            />
            <el-input-number
              v-model="temperatureModel"
              :min="0"
              :max="2"
              :step="TEMP_STEP"
              :precision="1"
              size="small"
              controls-position="right"
              class="slider-num"
            />
          </div>
        </div>

        <div class="slider-row">
          <div class="slider-head">
            <span class="slider-label">请求超时</span>
            <span class="slider-value">{{ timeoutLabel }}</span>
          </div>
          <div class="slider-body">
            <el-slider
              v-model="timeoutMs"
              :min="1000"
              :max="120000"
              :step="TIMEOUT_STEP"
              :show-tooltip="false"
              class="slider"
            />
            <el-input-number
              v-model="timeoutMs"
              :min="1000"
              :max="120000"
              :step="TIMEOUT_STEP"
              size="small"
              controls-position="right"
              class="slider-num"
            />
          </div>
        </div>
      </section>
    </div>

    <!-- ⑥ 连通性测试 -->
    <section class="block block-last">
      <div class="block-head">
        <div>
          <h3 class="block-title">连通性</h3>
          <p class="block-desc">
            发一条最小请求验证 Key 与地址。失败只回分类码，不会显示上游报错原文。
          </p>
        </div>
        <el-button :loading="pingLoading" @click="runPing">测试连接</el-button>
      </div>
      <p v-if="pingText !== ''" :class="['ping', pingOk ? 'is-ok' : 'is-bad']">{{ pingText }}</p>
      <p v-else class="ping is-idle">尚未测试。</p>
    </section>
  </div>
</template>

<style scoped>
/* ── 页面外壳：与仪表盘 / 站点配置同一口径（panel-card + page-header） ── */
.ai-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  /* 铺满内容区（不再固定 max-width 挤在左侧造成"右半边全空"的失衡感） */
  width: 100%;
  min-height: calc(100vh - 100px);
  box-sizing: border-box;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: var(--el-text-color-primary);
}

.page-subtitle {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.page-subtitle code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--el-fill-color);
  font-size: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* ── 状态带（两个开关并排，窄屏堆叠） ── */
.switch-strip {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  border: 1px solid var(--mizuki-soft-card-border);
  border-radius: var(--mizuki-radius-control);
  background: var(--el-fill-color-blank);
}

.switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
}

.switch-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.switch-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.switch-desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--el-text-color-secondary);
}

.switch-divider {
  width: 1px;
  height: 34px;
  /* [UI-U3] 竖分隔改两端淡出的发丝线 */
  background: none;
  background-image: var(--mizuki-fade-hairline-v);
  background-repeat: no-repeat;
  background-size: 100% 100%;
}

/* ── 区块：外层 panel-card 已是唯一「面」，区块之间用极淡分隔线，
   不再套第二层卡片（避免卡片套卡片的双层边框噪点）。 ── */
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 0 20px;
  /* [UI-U3] 区块分隔改两端淡出的发丝线 */
  border-top: none;
  background-image: var(--mizuki-fade-hairline);
  background-repeat: no-repeat;
  background-position: left top;
  background-size: 100% 1px;
}

.block:first-of-type {
  border-top: none;
  padding-top: 0;
}

.block-last {
  padding-bottom: 0;
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.block-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--el-text-color-primary);
}

.block-desc {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  max-width: 68ch;
}

/* ── 档案卡 ── */
.profile {
  padding: 14px 16px;
  border: 1px solid var(--mizuki-soft-card-border);
  border-radius: var(--mizuki-radius-control);
  background: var(--el-fill-color-blank);
  transition: border-color var(--mizuki-motion-fast), background var(--mizuki-motion-fast);
}

.profile.is-active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.profile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.profile-pick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
}

.profile-pick input[type='radio'] {
  accent-color: var(--el-color-primary);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

.profile-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 字段栅格：宽屏两列，窄屏一列 ── */
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-span-2 {
  grid-column: 1 / -1;
}

.field-label {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.field-note {
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  color: var(--el-text-color-placeholder);
}

.field-note.is-env {
  color: var(--el-color-primary);
}

/* ── 宽屏并排（代理 / 生成参数） ── */
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.proxy-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.proxy-radio {
  height: 24px;
  margin-right: 0 !important;
}

.proxy-radio :deep(.el-radio__label) {
  font-size: 13px;
}

.proxy-url {
  margin-top: 4px;
  max-width: 420px;
}

/* ── 滑条行 ── */
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0 6px;
}

.slider-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.slider-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.slider-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--el-color-primary);
}

.slider-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 108px;
  align-items: center;
  gap: 16px;
}

.slider {
  padding: 0 6px 0 0;
  --el-slider-height: 4px;
  --el-slider-button-size: 14px;
}

.slider.is-marked {
  padding-bottom: 20px;
}

.slider :deep(.el-slider__marks-text) {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 10px;
}

.slider-num {
  width: 108px;
}

/* ── 连通性 ── */
.ping {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.ping.is-ok {
  color: var(--el-color-success);
}

.ping.is-bad {
  color: var(--el-color-danger);
}

.ping.is-idle {
  color: var(--el-text-color-placeholder);
}

.empty-hint {
  padding: 18px;
  border: 1px dashed var(--mizuki-soft-card-border);
  border-radius: var(--mizuki-radius-control);
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

/* ── 响应式：<1280 走单列，<900 进一步压字段栅格 ── */
@media (max-width: 1279px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
  .switch-strip {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .switch-divider {
    width: 100%;
    height: 1px;
  }
}

@media (max-width: 900px) {
  .field-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .slider-body {
    grid-template-columns: minmax(0, 1fr) 96px;
    gap: 10px;
  }
  .slider-num {
    width: 96px;
  }
  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
