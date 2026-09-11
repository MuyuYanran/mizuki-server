/**
 * [阶段 P3] data-files/evaluator — AST → JS 值
 * [职责] 将 ts-morph SourceFile 中导出变量的初始化表达式递归求值为 JS 值，
 *   仅接受自包含字面量（MASTER-PLAN §6.2 节点分派表逐字实现）。
 *   注释天然被 AST 跳过；单引号、尾随逗号、as const、satisfies 天然兼容。
 * [状态] ACTIVE
 *
 * 说明：每次操作从磁盘重读文件、新建一次性 Project（彻底规避陈旧 AST）。
 */
import fs from 'node:fs';
import { NotFoundException } from '@nestjs/common';
import {
  ArrayLiteralExpression,
  AsExpression,
  Node,
  ObjectLiteralExpression,
  ParenthesizedExpression,
  PrefixUnaryExpression,
  Project,
  type SourceFile,
  StringLiteral,
  SatisfiesExpression,
  SyntaxKind,
  type VariableDeclaration,
} from 'ts-morph';

/** 不支持的字面量节点（含文件名 + 行号，供上层定位报错） */
export class UnsupportedLiteralError extends Error {
  readonly fileName: string;
  readonly line: number;

  constructor(fileName: string, line: number, kindName: string) {
    super(`不支持的字面量节点：${fileName} 第 ${line} 行（${kindName}）——数据文件必须自包含`);
    this.name = 'UnsupportedLiteralError';
    this.fileName = fileName;
    this.line = line;
  }
}

/**
 * 解包 `as const` / `satisfies Xxx` / `( … )` 包装，返回最内层表达式。
 * [Wave-2/C2] 单源：此前「解包语义」在 astToValue、astToValueWithConsts 与
 * theme-registry 各写一遍（第三处是局部私有函数），形态判定若加固（如新增
 * 新型断言包装）需三处同步。本函数为纯结构查询，不改变节点。
 */
export function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    current.getKind() === SyntaxKind.AsExpression ||
    current.getKind() === SyntaxKind.SatisfiesExpression ||
    current.getKind() === SyntaxKind.ParenthesizedExpression
  ) {
    current = (current as AsExpression | SatisfiesExpression | ParenthesizedExpression).getExpression();
  }
  return current;
}

/** 未找到目标导出变量 */
export class ExportNotFoundError extends NotFoundException {
  constructor(varName: string, filePath: string) {
    super(`未找到导出 ${varName}（${filePath}）`);
  }
}

/** 新建一次性 Project 并载入源文件（content 缺省时从磁盘重读） */
export function loadSourceFile(absPath: string, content?: string): SourceFile {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const text = content ?? fs.readFileSync(absPath, 'utf8');
  return project.createSourceFile(absPath, text, { overwrite: true });
}

/**
 * 按变量名取变量声明（缺失抛 ExportNotFoundError）。
 * @param displayPath 错误信息中的路径投影：默认取 ts-morph 的文件路径（**绝对路径**），
 *   经 HTTP 出口的调用方必须传相对路径（如 `src/data/diary.ts`）——API 响应
 *   不得泄露磁盘绝对路径（沙箱纪律；见 docs/audits/phase4-refactor-review.md E1）。
 */
export function getVariableDeclarationOrThrow(
  sf: SourceFile,
  varName: string,
  displayPath?: string,
): VariableDeclaration {
  const decl = sf.getVariableDeclaration(varName);
  if (!decl) {
    throw new ExportNotFoundError(varName, displayPath ?? sf.getFilePath());
  }
  return decl;
}

/**
 * AST → JS 值（节点分派表见 MASTER-PLAN §6.2）：
 * - Array/Object 字面量递归；
 * - 字符串/模板（无插值）取字面值（单引号、转义自动处理）；
 * - 数字/true/false/null 对应值；
 * - as const / satisfies / 括号解包后递归；
 * - 前缀一元负号取负；
 * - 模板插值、标识符引用、属性访问、Shorthand、Spread 等 → UnsupportedLiteralError。
 */
export function astToValue(node: Node, fileName: string): unknown {
  switch (node.getKind()) {
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ArrayLiteralExpression;
      return arr.getElements().map((element) => astToValue(element, fileName));
    }
    case SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ObjectLiteralExpression;
      const result: Record<string, unknown> = {};
      for (const property of obj.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          // Shorthand / Spread / Getter / Method → 抛错
          throw new UnsupportedLiteralError(
            fileName,
            property.getStartLineNumber(),
            property.getKindName(),
          );
        }
        const key = property.getNameNode();
        let name: string;
        if (Node.isIdentifier(key) || Node.isNumericLiteral(key)) {
          name = key.getText();
        } else if (Node.isStringLiteral(key)) {
          name = key.getLiteralText();
        } else {
          throw new UnsupportedLiteralError(fileName, key.getStartLineNumber(), key.getKindName());
        }
        result[name] = astToValue(property.getInitializerOrThrow(), fileName);
      }
      return result;
    }
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral: {
      // getLiteralText() 自动处理单引号与转义（含换行、内嵌引号）
      return (node as StringLiteral).getLiteralText();
    }
    case SyntaxKind.NumericLiteral: {
      const num = Number(node.getText());
      if (!Number.isFinite(num)) {
        throw new UnsupportedLiteralError(fileName, node.getStartLineNumber(), node.getKindName());
      }
      return num;
    }
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    case SyntaxKind.AsExpression:
    case SyntaxKind.SatisfiesExpression:
    case SyntaxKind.ParenthesizedExpression:
      // 兼容 `as const`、`satisfies Xxx`、( … )：解包后递归（解包语义单源）
      return astToValue(unwrapExpression(node), fileName);
    case SyntaxKind.PrefixUnaryExpression: {
      const expr = node as PrefixUnaryExpression;
      if (expr.getOperatorToken() === SyntaxKind.MinusToken) {
        const operand = astToValue(expr.getOperand(), fileName);
        if (typeof operand === 'number') {
          return -operand;
        }
      }
      throw new UnsupportedLiteralError(fileName, node.getStartLineNumber(), node.getKindName());
    }
    case SyntaxKind.TemplateExpression:
    case SyntaxKind.Identifier:
    case SyntaxKind.PropertyAccessExpression:
      // 数据文件必须自包含
      throw new UnsupportedLiteralError(fileName, node.getStartLineNumber(), node.getKindName());
    default:
      throw new UnsupportedLiteralError(fileName, node.getStartLineNumber(), node.getKindName());
  }
}

/** 便捷入口：读取文件并对指定导出变量求值 */
export function evaluateExport(absPath: string, varName: string): unknown {
  const sf = loadSourceFile(absPath);
  const decl = getVariableDeclarationOrThrow(sf, varName);
  const initializer = decl.getInitializer();
  if (!initializer) {
    throw new ExportNotFoundError(varName, absPath);
  }
  return astToValue(initializer, absPath);
}

// ── [Phase4-E3a] 常量代入求值（自 site-config.service 迁入，单一来源）──
// 主题 config.ts 允许 `lang: SITE_LANG` 式标识符引用：顶层非导出简单常量表代入后
// 求值（site-config 基线读取与 theme 声明探针共用）。

/** 简单常量值判定：字符串字面量 / 无插值模板 / 数字字面量 → 值；其余 → undefined */
export function constValueOf(init: Node): string | number | undefined {
  switch (init.getKind()) {
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (init as StringLiteral).getLiteralText();
    case SyntaxKind.NumericLiteral: {
      const num = Number(init.getText());
      return Number.isFinite(num) ? num : undefined;
    }
    default:
      return undefined;
  }
}

/** 顶层非导出简单常量表（config.ts 的 SITE_LANG / SITE_TIMEZONE 类，代入标识符引用） */
export function extractSimpleConsts(sf: SourceFile): Map<string, string | number> {
  const map = new Map<string, string | number>();
  for (const stmt of sf.getVariableStatements()) {
    if (stmt.hasExportKeyword()) {
      continue; // 导出的业务对象不走常量表（siteConfig/commentConfig 本体）
    }
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init === undefined) {
        continue;
      }
      const value = constValueOf(init);
      if (value !== undefined) {
        map.set(decl.getName(), value);
      }
    }
  }
  return map;
}

/**
 * AST → JS 值（astToValue 的常量代入变体）：分派表同型（自包含字面量），
 * 唯一差异——Identifier 节点查常量表代入（config.ts 允许 `lang: SITE_LANG` 式
 * 引用）；常量表未命中的标识符与其他未支持节点 → UnsupportedLiteralError
 * （调用方按「基线不可得」处置）。注意：无数组字面量分支（navBarConfig.links
 * 原始态含 LinkPreset 标识符 → 恒抛 → 降级分支，D3 实测）。
 */
export function astToValueWithConsts(
  node: Node,
  filePath: string,
  consts: Map<string, string | number>,
): unknown {
  switch (node.getKind()) {
    case SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ObjectLiteralExpression;
      const result: Record<string, unknown> = {};
      for (const property of obj.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          throw new UnsupportedLiteralError(filePath, property.getStartLineNumber(), property.getKindName());
        }
        const key = property.getNameNode();
        const name = Node.isStringLiteral(key) ? key.getLiteralText() : key.getText();
        result[name] = astToValueWithConsts(property.getInitializerOrThrow(), filePath, consts);
      }
      return result;
    }
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (node as StringLiteral).getLiteralText();
    case SyntaxKind.NumericLiteral:
      return Number(node.getText());
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    case SyntaxKind.AsExpression:
    case SyntaxKind.SatisfiesExpression:
    case SyntaxKind.ParenthesizedExpression:
      return astToValueWithConsts(unwrapExpression(node), filePath, consts);
    case SyntaxKind.PrefixUnaryExpression: {
      const expr = node as PrefixUnaryExpression;
      if (expr.getOperatorToken() === SyntaxKind.MinusToken) {
        const operand = astToValueWithConsts(expr.getOperand(), filePath, consts);
        if (typeof operand === 'number') {
          return -operand;
        }
      }
      throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
    }
    case SyntaxKind.Identifier: {
      const value = consts.get(node.getText());
      if (value === undefined) {
        throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
      }
      return value;
    }
    default:
      throw new UnsupportedLiteralError(filePath, node.getStartLineNumber(), node.getKindName());
  }
}
