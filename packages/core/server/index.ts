import type { SerovalJSON } from 'seroval';
import {
  crossSerializeStream,
  fromJSON,
} from 'seroval';
import type { FunctionBody, ServerHandler } from '../shared/utils';

type HandlerRegistration = [id: string, callback: ServerHandler<unknown[], unknown>];

const REGISTRATIONS = new Map<string, HandlerRegistration>();

export function $$server(
  id: string,
  callback: ServerHandler<unknown[], unknown>,
): HandlerRegistration {
  const reg: HandlerRegistration = [id, callback];
  REGISTRATIONS.set(id, reg);
  return reg;
}

function serializeToStream<T>(instance: string, value: T): ReadableStream {
  return new ReadableStream({
    start(controller): void {
      crossSerializeStream(value, {
        scopeId: instance,
        onSerialize(data, initial) {
          const result = initial
            ? `((self.$R=self.$R||{})["${instance}"]=[],${data})`
            : data;
          controller.enqueue(
            new TextEncoder().encode(`${result};\n`),
          );
        },
        onDone() {
          controller.close();
        },
        onError(error) {
          controller.error(error);
        },
      });
    },
  });
}

let SCOPE: unknown[] | undefined;

function runWithScope<T>(scope: unknown[], callback: () => T): T {
  const parent = SCOPE;
  SCOPE = scope;
  try {
    return callback();
  } finally {
    SCOPE = parent;
  }
}

async function handler<T extends unknown[], R>(
  id: string,
  callback: ServerHandler<T, R>,
  scope: () => unknown[],
  ...args: T
): Promise<R> {
  const currentScope = scope();
  return runWithScope(currentScope, async () => callback(...args));
}

export function $$scope(): unknown[] {
  return SCOPE!;
}

export function $$clone(
  [id, callback]: HandlerRegistration,
  scope: () => unknown[],
): unknown {
  return Object.assign(handler.bind(null, id, callback, scope), {
    id,
  });
}

export async function handleRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const registration = REGISTRATIONS.get(url.pathname);
  const instance = request.headers.get('X-Use-Server-Directive');
  if (registration && instance) {
    const [id, callback] = registration;
    try {
      const { scope, args } = fromJSON<FunctionBody>(
        await request.json() as SerovalJSON,
      );
      const result = await runWithScope(
        scope,
        async () => callback(...args),
      );
      return new Response(serializeToStream(instance, result), {
        headers: {
          'Content-Type': 'text/javascript',
        },
        status: 200,
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(error);
        return new Response(serializeToStream(instance, error), {
          headers: {
            'Content-Type': 'text/javascript',
          },
          status: 500,
        });
      }
      return new Response(`function "${id}" threw an unhandled server-side error.`, {
        status: 500,
      });
    }
  }
  return undefined;
}
