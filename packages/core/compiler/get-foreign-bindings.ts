import type * as babel from '@babel/core';
import type { BindingKind } from '@babel/traverse';
import * as t from '@babel/types';

function isForeignBinding(
  source: babel.NodePath,
  current: babel.NodePath,
  name: string,
): boolean {
  if (current.scope.hasGlobal(name)) {
    return false;
  }
  if (source === current) {
    return true;
  }
  if (current.scope.hasOwnBinding(name)) {
    const binding = current.scope.getBinding(name);
    return !!binding && binding.kind === 'param';
  }
  if (current.parentPath) {
    return isForeignBinding(source, current.parentPath, name);
  }
  return true;
}

function isInTypescript(path: babel.NodePath): boolean {
  let parent = path.parentPath;
  while (parent) {
    if (t.isTypeScript(parent.node) && !t.isExpression(parent.node)) {
      return true;
    }
    parent = parent.parentPath;
  }
  return false;
}

interface ForeignBindings {
  referenced: t.Identifier[];
  mutations: t.Identifier[];
}

function isMutation(kind: BindingKind): boolean {
  switch (kind) {
    case 'let':
    case 'var':
    case 'param':
      return true;
    case 'const':
    case 'hoisted':
    case 'local':
    case 'module':
    case 'unknown':
      return false;
  }
}

function filterBindings(
  path: babel.NodePath,
  identifiers: Set<string>,
): ForeignBindings {
  const referenced: t.Identifier[] = [];
  const mutations: t.Identifier[] = [];
  for (const identifier of identifiers) {
    const binding = path.scope.getBinding(identifier);

    if (binding) {
      let blockParent = binding.path.scope.getBlockParent();
      const programParent = binding.path.scope.getProgramParent();

      if (blockParent.path === binding.path) {
        blockParent = blockParent.parent;
      }

      // We don't need top-level declarations
      if (blockParent !== programParent) {
        referenced.push(t.identifier(identifier));
        if (isMutation(binding.kind)) {
          mutations.push(t.identifier(identifier));
        }
      }
    }
  }
  return { referenced, mutations };
}

export default function getForeignBindings(
  path: babel.NodePath,
): ForeignBindings {
  const identifiers = new Set<string>();
  path.traverse({
    BindingIdentifier(p) {
      // Check identifiers that aren't in a TS expression
      if (!isInTypescript(p) && isForeignBinding(path, p, p.node.name)) {
        identifiers.add(p.node.name);
      }
    },
  });

  return filterBindings(path, identifiers);
}
