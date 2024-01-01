import * as babel from '@babel/core';
import * as t from '@babel/types';
import nodePath from 'path';
import { addNamed } from '@babel/helper-module-imports';
import assert from './assert';
import getForeignBindings from './get-foreign-bindings';
import xxHash32 from './xxhash32';
import { HIDDEN_SERVER_FUNCTION } from './constants';

export interface Options {
  directive: string;
  mode: 'server' | 'client';
  env?: 'development' | 'production';
  prefix?: string;
}

export type Output = babel.BabelFileResult;

interface StateContext {
  options: Options;
  imports: Map<string, t.Identifier>;
  prefix: string;
  count: number;
}

function getImportIdentifier(
  ctx: StateContext,
  path: babel.NodePath,
  source: string,
  name: string,
): t.Identifier {
  const target = `${source}[${name}]`;
  const current = ctx.imports.get(target);
  if (current) {
    return current;
  }
  const newID = addNamed(path, name, source);
  ctx.imports.set(target, newID);
  return newID;
}

function getDescriptiveName(path: babel.NodePath): string {
  let current: babel.NodePath | null = path;
  while (current) {
    switch (current.node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression': {
        if (current.node.id) {
          return current.node.id.name;
        }
        break;
      }
      case 'VariableDeclarator': {
        if (current.node.id.type === 'Identifier') {
          return current.node.id.name;
        }
        break;
      }
    }
    current = current.parentPath;
  }
  return 'anonymous';
}

const SKIP_MARKER = '@skip use-server-directive';

function shouldSkip(path: babel.NodePath<t.BlockStatement>): boolean {
  const comments = path.node.leadingComments;
  if (comments) {
    for (let i = 0, len = comments.length; i < len; i++) {
      if (comments[i].value === SKIP_MARKER) {
        return true;
      }
    }
  }
  return false;
}

function getServerBlockModeFromDirectives(
  ctx: StateContext,
  path: babel.NodePath<t.BlockStatement>,
): boolean {
  for (let i = 0, len = path.node.directives.length; i < len; i++) {
    const statement = path.node.directives[i];
    if (statement.value.value === ctx.options.directive) {
      return true;
    }
  }
  return false;
}

function getServerBlockModeFromFauxDirectives(
  ctx: StateContext,
  path: babel.NodePath<t.BlockStatement>,
): boolean {
  for (let i = 0, len = path.node.body.length; i < len; i++) {
    const statement = path.node.body[i];
    if (
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'StringLiteral'
    ) {
      if (statement.expression.value === ctx.options.directive) {
        return true;
      }
    } else {
      break;
    }
  }
  return false;
}

function isValidServerBlock(
  ctx: StateContext,
  path: babel.NodePath<t.BlockStatement>,
): boolean {
  if (shouldSkip(path)) {
    return false;
  }
  const parent = path.getFunctionParent();
  if (parent && !parent.node.async) {
    return false;
  }
  return (
    getServerBlockModeFromDirectives(ctx, path) ||
    getServerBlockModeFromFauxDirectives(ctx, path)
  );
}

function getRootStatementPath(path: babel.NodePath): babel.NodePath {
  let current = path.parentPath;
  while (current) {
    const next = current.parentPath;
    if (next && t.isProgram(next.node)) {
      return current;
    }
    current = next;
  }
  return path;
}

function convertServerBlock(node: t.BlockStatement): t.BlockStatement {
  return t.addComment(
    t.blockStatement(node.body, node.directives),
    'leading',
    SKIP_MARKER,
    false,
  );
}

// These are internal code for the control flow of the server block
// The goal is to transform these into return statements, and the
// the return value with the associated control flow code.
// This allows the replacement statement for the server block to
// know what to do if it encounters the said statement on the server.
const BREAK_KEY = t.numericLiteral(0);
const CONTINUE_KEY = t.numericLiteral(1);
const RETURN_KEY = t.numericLiteral(2);
// If the function has no explicit return
const NO_HALT_KEY = t.numericLiteral(3);

function transformHalting(path: babel.NodePath<t.BlockStatement>): {
  breaks: string[];
  breakCount: number;
  continues: string[];
  continueCount: number;
  hasReturn: boolean;
  hasYield: boolean;
} {
  const target =
    path.scope.getFunctionParent() || path.scope.getProgramParent();

  const breaks: string[] = [];
  let breakCount = 0;
  const continues: string[] = [];
  let continueCount = 0;
  let hasReturn = false;
  let hasYield = false;

  // Transform the control flow statements
  path.traverse({
    BreakStatement(child) {
      const parent =
        child.scope.getFunctionParent() || child.scope.getProgramParent();
      if (parent === target) {
        const replacement: t.Expression[] = [BREAK_KEY];
        breakCount++;
        if (child.node.label) {
          const targetName = child.node.label.name;
          breaks.push(targetName);
          replacement.push(t.stringLiteral(targetName));
        }
        child.replaceWith(t.returnStatement(t.arrayExpression(replacement)));
        child.skip();
      }
    },
    ContinueStatement(child) {
      const parent =
        child.scope.getFunctionParent() || child.scope.getProgramParent();
      if (parent === target) {
        const replacement: t.Expression[] = [CONTINUE_KEY];
        continueCount++;
        if (child.node.label) {
          const targetName = child.node.label.name;
          continues.push(targetName);
          replacement.push(t.stringLiteral(targetName));
        }
        child.replaceWith(t.returnStatement(t.arrayExpression(replacement)));
        child.skip();
      }
    },
    ReturnStatement(child) {
      const parent =
        child.scope.getFunctionParent() || child.scope.getProgramParent();
      if (parent === target) {
        hasReturn = true;
        const result: t.Expression[] = [RETURN_KEY];
        if (child.node.argument) {
          result.push(child.node.argument);
        }
        child.replaceWith(t.returnStatement(t.arrayExpression(result)));
        child.skip();
      }
    },
    YieldExpression(child) {
      const parent =
        child.scope.getFunctionParent() || child.scope.getProgramParent();
      if (parent === target) {
        hasYield = true;
      }
    },
  });

  path.node.body.push(t.returnStatement(t.arrayExpression([NO_HALT_KEY])));

  return { breaks, continues, hasReturn, hasYield, breakCount, continueCount };
}

// This generates a chain of if-statements that checks the
// received server return (which is transformed from the original block's
// server statement)
// Each if-statement matches an specific label, assuming that the original
// break statement is a labeled break statement.
// Otherwise, the output code is either a normal break statement or none.
function getBreakCheck(
  returnType: t.Identifier,
  returnResult: t.Identifier,
  breakCount: number,
  breaks: string[],
  check: t.Statement | undefined,
): t.Statement | undefined {
  let current: t.Statement | undefined;
  if (breakCount !== breaks.length) {
    current = t.blockStatement([t.breakStatement()]);
  }
  for (let i = 0, len = breaks.length; i < len; i++) {
    const target = breaks[i];
    current = t.blockStatement([
      t.ifStatement(
        t.binaryExpression('===', returnResult, t.stringLiteral(target)),
        t.blockStatement([t.breakStatement(t.identifier(target))]),
        current,
      ),
    ]);
  }
  if (current) {
    return t.ifStatement(
      t.binaryExpression('===', returnType, BREAK_KEY),
      current,
      check,
    );
  }
  return check;
}

// This generates a chain of if-statements that checks the
// received server return (which is transformed from the original block's
// server statement)
// Each if-statement matches an specific label, assuming that the original
// continue statement is a labeled continue statement.
// Otherwise, the output code is either a normal continue statement or none.
function getContinueCheck(
  returnType: t.Identifier,
  returnResult: t.Identifier,
  continueCount: number,
  continues: string[],
  check: t.Statement | undefined,
): t.Statement | undefined {
  let current: t.Statement | undefined;
  if (continueCount !== continues.length) {
    current = t.blockStatement([t.continueStatement()]);
  }
  for (let i = 0, len = continues.length; i < len; i++) {
    const target = continues[i];
    current = t.blockStatement([
      t.ifStatement(
        t.binaryExpression('===', returnResult, t.stringLiteral(target)),
        t.blockStatement([t.continueStatement(t.identifier(target))]),
        current,
      ),
    ]);
  }
  if (current) {
    return t.ifStatement(
      t.binaryExpression('===', returnType, CONTINUE_KEY),
      current,
      check,
    );
  }
  return check;
}

function getGeneratorReplacementForServerBlock(
  path: babel.NodePath<t.BlockStatement>,
  returnType: t.Identifier,
  returnResult: t.Identifier,
  registerID: t.Identifier,
  cloneArgs: t.Identifier[],
  check: t.Statement | undefined,
): t.BlockStatement {
  const iterator = path.scope.generateUidIdentifier('iterator');
  const step = path.scope.generateUidIdentifier('step');
  const replacement: t.Statement[] = [
    t.variableDeclaration('let', [
      // Generate variables
      t.variableDeclarator(returnType),
      t.variableDeclarator(returnResult),
      // First, get the iterator by calling the generator
      t.variableDeclarator(
        iterator,
        t.awaitExpression(t.callExpression(registerID, cloneArgs)),
      ),
    ]),
    // Create a while statement, the intent is to
    // repeatedly iterate the generator
    t.whileStatement(
      t.booleanLiteral(true),
      t.blockStatement([
        // Get the next value
        t.variableDeclaration('const', [
          t.variableDeclarator(
            step,
            t.callExpression(
              t.memberExpression(iterator, t.identifier('next')),
              [],
            ),
          ),
        ]),
        // Check if the step is done
        t.ifStatement(
          t.memberExpression(step, t.identifier('done')),
          t.blockStatement([
            t.expressionStatement(
              // Assign the value to the type and result
              t.assignmentExpression(
                '=',
                t.arrayPattern([returnType, returnResult]),
                t.memberExpression(step, t.identifier('value')),
              ),
            ),
            // exit the loop
            t.breakStatement(),
          ]),
          // Otherwise, yield the value
          t.blockStatement([
            t.expressionStatement(
              t.yieldExpression(
                t.memberExpression(step, t.identifier('value')),
              ),
            ),
          ]),
        ),
      ]),
    ),
  ];
  if (check) {
    replacement.push(check);
  }
  return t.blockStatement(replacement);
}

function transformServerBlock(
  ctx: StateContext,
  path: babel.NodePath<t.BlockStatement>,
): void {
  // Get all bindings needed by the function
  const cloneArgs: t.Identifier[] = getForeignBindings(path);
  // Transform all control statements
  const halting = transformHalting(path);
  // Create an ID
  let id = `${ctx.prefix}${ctx.count}`;
  if (ctx.options.env !== 'production') {
    id += `-${getDescriptiveName(path)}`;
  }
  ctx.count += 1;
  // Generate arguments for the server function instanciation
  const args: t.Expression[] = [t.stringLiteral(id)];
  // If the compilation mode is in server mode
  if (ctx.options.mode === 'server') {
    // Create a new function whose body is the transformed
    // server block
    args.push(
      t.functionExpression(
        undefined,
        cloneArgs,
        convertServerBlock(path.node),
        halting.hasYield,
        true,
      ),
    );
  }
  // Create the registration call
  const register = t.callExpression(
    getImportIdentifier(
      ctx,
      path,
      `use-server-directive/${ctx.options.mode}`,
      HIDDEN_SERVER_FUNCTION,
    ),
    args,
  );
  // Locate root statement (the top-level statement)
  const rootStatement = getRootStatementPath(path);
  // Push the declaration
  const registerID = path.scope.generateUidIdentifier('server');
  rootStatement.insertBefore(
    t.variableDeclaration('const', [
      t.variableDeclarator(registerID, register),
    ]),
  );
  // Move to the replacement for the server block,
  // declare the type and result based from transformHalting
  const returnType = path.scope.generateUidIdentifier('type');
  const returnResult = path.scope.generateUidIdentifier('result');
  let check: t.Statement | undefined;
  // If the block has a return, we need to make sure that the
  // replacement does too.
  if (halting.hasReturn) {
    check = t.ifStatement(
      t.binaryExpression('===', returnType, RETURN_KEY),
      t.blockStatement([t.returnStatement(returnResult)]),
    );
  }
  // If the block has a break, we also do it.
  if (halting.breakCount > 0) {
    check = getBreakCheck(
      returnType,
      returnResult,
      halting.breakCount,
      halting.breaks,
      check,
    );
  }
  // If the block has a continue, we also do it.
  if (halting.continueCount > 0) {
    check = getContinueCheck(
      returnType,
      returnResult,
      halting.continueCount,
      halting.continues,
      check,
    );
  }
  // If the server block happens to be declared in a generator
  if (halting.hasYield) {
    path.replaceWith(
      getGeneratorReplacementForServerBlock(
        path,
        returnType,
        returnResult,
        registerID,
        cloneArgs,
        check,
      ),
    );
  } else {
    const replacement: t.Statement[] = [
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.arrayPattern([returnType, returnResult]),
          t.awaitExpression(t.callExpression(registerID, cloneArgs)),
        ),
      ]),
    ];
    if (check) {
      replacement.push(check);
    }
    path.replaceWith(t.blockStatement(replacement));
  }
}

function transformBlock(
  ctx: StateContext,
  path: babel.NodePath<t.BlockStatement>,
): void {
  if (isValidServerBlock(ctx, path)) {
    transformServerBlock(ctx, path);
  }
}

interface State extends babel.PluginPass {
  opts: StateContext;
}

function plugin(): babel.PluginObj<State> {
  return {
    name: 'use-server-directive',
    visitor: {
      BlockStatement(path, ctx) {
        transformBlock(ctx.opts, path);
      },
    },
  };
}

const DEFAULT_PREFIX = '__server';

function getPrefix(id: string, options: Options): string {
  const prefix = options.prefix == null ? DEFAULT_PREFIX : options.prefix;
  const base = `/${prefix}/${xxHash32(id).toString(16)}-`;
  if (options.env === 'production') {
    return base;
  }
  const parsed = nodePath.parse(id);
  return `${base}${parsed.name}-`;
}

export async function compile(
  id: string,
  code: string,
  options: Options,
): Promise<Output> {
  const parsedPath = nodePath.parse(id);
  const ctx: StateContext = {
    options,
    imports: new Map(),
    prefix: getPrefix(id, options),
    count: 0,
  };

  const plugins: babel.ParserOptions['plugins'] = ['jsx'];

  if (/\.[mc]?tsx?$/i.test(id)) {
    plugins.push('typescript');
  }

  const result = await babel.transformAsync(code, {
    plugins: [[plugin, ctx]],
    parserOpts: {
      plugins,
    },
    filename: parsedPath.base,
    ast: false,
    sourceFileName: id,
    sourceMaps: true,
    configFile: false,
    babelrc: false,
  });

  assert(result, 'invariant');

  return result;
}
