/**
 * [阶段 P8] common/render/sanitize-html.d — sanitize-html 最小环境类型声明
 * [职责] @types/sanitize-html 不在 P0a 依赖清单（禁新增依赖），此处声明
 *   本项目实际用到的最小类型面（库本体为 CJS，运行期直接可用）。
 * [状态] ACTIVE
 */
declare module 'sanitize-html' {
  export interface SanitizeOptions {
    allowedTags?: string[];
    allowedAttributes?: Record<string, string[]>;
    allowedSchemes?: string[];
    disallowedTagsMode?: 'discard' | 'escape' | 'recursiveEscape';
  }

  interface SanitizeHtmlFunction {
    (dirty: string, options?: SanitizeOptions): string;
    defaults: {
      allowedTags: string[];
      allowedAttributes: Record<string, string[]>;
      allowedSchemes: string[];
    };
  }

  const sanitizeHtml: SanitizeHtmlFunction;
  export default sanitizeHtml;
}
