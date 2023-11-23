import {
  deserialize,
  toJSONAsync,
} from 'seroval';
import type { FunctionBody } from '../shared/utils';

interface HandlerRegistrationResult {
  id: string;
}

export function $$server(id: string): HandlerRegistrationResult {
  return { id };
}

export type MaybePromise<T> = T | Promise<T>;

export type Interceptor = (request: Request) => MaybePromise<Request>;

const INTERCEPTORS: Interceptor[] = [];

export function interceptRequest(callback: Interceptor): void {
  INTERCEPTORS.push(callback);
}

async function serverHandler(
  id: string,
  init: RequestInit,
): Promise<Response> {
  let root = new Request(id, init);
  for (const intercept of INTERCEPTORS) {
    // eslint-disable-next-line no-await-in-loop
    root = await intercept(root);
  }
  const result = await fetch(root);
  return result;
}

declare const $R: Record<string, unknown>;

async function deserializeStream<T>(instance: string, response: Response): Promise<T> {
  if (!response.body) {
    throw new Error('missing body');
  }
  const reader = response.body.getReader();

  async function pop(): Promise<void> {
    const result = await reader.read();
    if (!result.done) {
      const serialized = new TextDecoder().decode(result.value);
      const splits = serialized.split('\n');
      for (const split of splits) {
        if (split !== '') {
          deserialize(split);
        }
      }
      await pop();
    }
  }

  const result = await reader.read();
  if (result.done) {
    throw new Error('Unexpected end of body');
  }
  const serialized = new TextDecoder().decode(result.value);
  const revived = deserialize(serialized);

  pop().then(() => {
    delete $R[instance];
  }, () => {
    // no-op
  });

  return revived as T;
}

async function deserializeResponse<R>(
  id: string,
  instance: string,
  response: Response,
): Promise<R> {
  if (response.ok) {
    return deserializeStream(instance, response);
  }
  if (import.meta.env.DEV) {
    throw deserializeStream(instance, response);
  }
  throw new Error(`function "${id}" threw an unhandled server-side error.`);
}

async function serializeFunctionBody(body: FunctionBody): Promise<string> {
  return JSON.stringify(await toJSONAsync(body));
}

let INSTANCE = 0;

async function handler<T extends unknown[], R>(
  id: string,
  scope: () => unknown[],
  ...args: T
): Promise<R> {
  const instance = `use-server-directive:${INSTANCE++}`;
  return deserializeResponse(
    id,
    instance,
    await serverHandler(id, {
      headers: {
        'X-Use-Server-Directive': instance,
      },
      method: 'POST',
      body: await serializeFunctionBody({
        scope: scope(),
        args,
      }),
    }),
  );
}

export function $$clone(
  { id }: HandlerRegistrationResult,
  scope: () => unknown[],
): unknown {
  return Object.assign(handler.bind(null, id, scope), {
    toString() {
      return id;
    },
  });
}
