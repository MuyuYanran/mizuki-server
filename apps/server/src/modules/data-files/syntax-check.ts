/**
 * [阶段 P3] data-files/syntax-check — 写前语法校验
 * [职责] 对序列化后的整文件文本做语法校验（typescript transpileModule
 *   reportDiagnostics），语法错误数必须为 0，否则抛错（MASTER-PLAN §6.4 第 4 步）。
 * [状态] ACTIVE
 *
 * 说明：transpileModule 只做语法层诊断（无类型检查），恰好契合
 * 「syntax error 必须为 0」的要求；类型正确性由 Mizuki 项目自身的
 * tsc 构建（P9 构建任务）兜底。
 *
 * [Wave-2/E2] 异常类型由普通 Error 改为 BadRequestException：语法校验失败是
 *   **用户提交内容**引发的可自助修正问题，此前经 AllExceptionsFilter 落为
 *   500「内部服务器错误」（语义错位、且用户无法据此定位）。改判 400 后
 *   对外错误码为 BadRequestException（原有 500 路径无成功语义，属缺陷修复）。
 */
import { BadRequestException } from '@nestjs/common';
import ts from 'typescript';

/** 格式化单条诊断信息（含行号） */
function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `第 ${line + 1} 行：${message}`;
  }
  return message;
}

/**
 * 语法校验：文本存在任何语法错误诊断时抛错。
 * @param text 数据文件全文
 * @param fileName 文件名（错误信息定位用；调用方应传相对路径，勿传磁盘绝对路径）
 */
export function assertSyntaxValid(text: string, fileName = '<data-file>'): void {
  const result = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
    },
    reportDiagnostics: true,
    fileName,
  });
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new BadRequestException(
      `语法校验失败（${fileName}）：${diagnostics.map(formatDiagnostic).join('；')}`,
    );
  }
}
