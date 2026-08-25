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

/** 按变量名取变量声明（缺失抛 ExportNotFoundError） */
export function getVariableDeclarationOrThrow(sf: SourceFile, varName: string): VariableDeclaration {
  const decl = sf.getVariableDeclaration(varName);
  if (!decl) {
    throw new ExportNotFoundError(varName, sf.getFilePath());
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
      // 兼容 `as const`、`satisfies Xxx`、( … )：解包后递归
      return astToValue(
        (node as AsExpression | SatisfiesExpression | ParenthesizedExpression).getExpression(),
        fileName,
      );
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
