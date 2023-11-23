import * as babel from '@babel/core';
import * as t from '@babel/types';
import nodePath from 'path';
import { addNamed } from '@babel/helper-module-imports';
import assert from './assert';
import getForeignBindings from './get-foreign-bindings';
import xxHash32 from './xxhash32';
import { HIDDEN_CLONE, HIDDEN_SERVER_FUNCTION, HIDDEN_USE_SCOPE } from './constants';

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
      case 'FunctionExpression':
        if (current.node.id) {
          return current.node.id.name;
        }
        break;
      case 'VariableDeclarator':
        if (current.node.id.type === 'Identifier') {
          return current.node.id.name;
        }
        break;
      default:
        break;
    }
    current = current.parentPath;
  }
  return 'anonymous';
}

const SKIP_MARKER = '@skip use-server-directive';

function shouldSkip(path: babel.NodePath<ServerFunctionExpression>): boolean {
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

type ServerFunctionExpression =
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | t.FunctionDeclaration;

function isServerFunction(
  ctx: StateContext,
  path: babel.NodePath<ServerFunctionExpression>,
): boolean {
  if (shouldSkip(path)) {
    return false;
  }
  if (path.node.async && path.node.body.type === 'BlockStatement') {
    const dirs = path.node.body.directives;
    for (let i = 0, len = dirs.length; i < len; i++) {
      const literal = dirs[i].value.value;
      if (literal === ctx.options.directive) {
        return true;
      }
    }
  }
  return false;
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

function convertServerFunction(
  node: ServerFunctionExpression,
): t.Expression {
  return t.addComment(
    node.type === 'ArrowFunctionExpression'
      ? t.arrowFunctionExpression(
        node.params,
        node.body,
        node.async,
      )
      : t.functionExpression(
        node.id,
        node.params,
        node.body,
        node.generator,
        node.async,
      ),
    'leading',
    SKIP_MARKER,
    false,
  );
}

function transformFunction(
  ctx: StateContext,
  path: babel.NodePath<ServerFunctionExpression>,
): void {
  if (isServerFunction(ctx, path)) {
    // Create registration call
    const registerID = path.scope.generateUidIdentifier('server');
    // Setup for clone call
    const cloneArgs: t.Expression[] = [registerID];
    const scope = getForeignBindings(path);
    cloneArgs.push(t.arrowFunctionExpression([], t.arrayExpression(scope)));
    if (scope.length) {
      // Add scoping to the arrow function
      if (ctx.options.mode === 'server') {
        const statement = t.isStatement(path.node.body)
          ? path.node.body
          : t.blockStatement([
            t.returnStatement(path.node.body),
          ]);
        statement.body = [
          t.variableDeclaration(
            'const',
            [
              t.variableDeclarator(
                t.arrayPattern(scope),
                t.callExpression(getImportIdentifier(
                  ctx,
                  path,
                  `use-server-directive/${ctx.options.mode}`,
                  HIDDEN_USE_SCOPE,
                ), []),
              ),
            ],
          ),
          ...statement.body,
        ];

        path.node.body = statement;
      }
    }
    // Create an ID
    let id = `${ctx.prefix}${ctx.count}`;
    if (ctx.options.env !== 'production') {
      id += `-${getDescriptiveName(path)}`;
    }
    ctx.count += 1;
    const args: t.Expression[] = [t.stringLiteral(id)];
    if (ctx.options.mode === 'server') {
      // Hoist the argument
      args.push(convertServerFunction(path.node));
    }
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
    rootStatement.insertBefore(
      t.variableDeclaration(
        'const',
        [t.variableDeclarator(registerID, register)],
      ),
    );
    // Replace with clone
    const replacement = t.callExpression(
      getImportIdentifier(
        ctx,
        path,
        `use-server-directive/${ctx.options.mode}`,
        HIDDEN_CLONE,
      ),
      cloneArgs,
    );
    if (path.node.type === 'FunctionDeclaration') {
      const declarationID = path.node.id || path.scope.generateUidIdentifier('fn');
      const declaration = t.variableDeclaration(
        'var',
        [
          t.variableDeclarator(declarationID, replacement),
        ],
      );
      if (path.parentPath.isExportDefaultDeclaration()) {
        path.parentPath.insertBefore(declaration);
        path.replaceWith(declarationID);
      } else {
        path.replaceWith(declaration);
      }
    } else {
      path.replaceWith(
        replacement,
      );
    }
  }
}

interface State extends babel.PluginPass {
  opts: StateContext;
}

function plugin(): babel.PluginObj<State> {
  return {
    name: 'use-server-directive',
    visitor: {
      ArrowFunctionExpression(path, ctx): void {
        transformFunction(ctx.opts, path);
      },
      FunctionDeclaration(path, ctx): void {
        transformFunction(ctx.opts, path);
      },
      FunctionExpression(path, ctx): void {
        transformFunction(ctx.opts, path);
      },
    },
  };
}

const DEFAULT_PREFIX = '__server';

function getPrefix(
  id: string,
  options: Options,
): string {
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
    plugins: [
      [plugin, ctx],
    ],
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
