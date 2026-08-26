/// <reference types="vite/client" />

/** .vue 单文件组件模块声明（供纯 TS 工具链识别；vue-tsc 原生理解 SFC） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
