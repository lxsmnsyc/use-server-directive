import { deserialize, toJSONAsync } from 'seroval';
import {
  BlobPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FilePlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin,
} from 'seroval-plugins/web';
import {
  USE_SERVER_DIRECTIVE_INDEX_HEADER,
  type FunctionBody,
  USE_SERVER_DIRECTIVE_ID_HEADER,
} from '../shared/utils';

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

async function serverHandler(id: string, init: RequestInit): Promise<Response> {
  let root = new Request(id, init);
  for (const intercept of INTERCEPTORS) {
    // eslint-disable-next-line no-await-in-loop
    root = await intercept(root);
  }
  const result = await fetch(root);
  return result;
}

declare const $R: Record<string, unknown>;

async function deserializeResponse<T>(
  id: string,
  response: Response,
): Promise<T> {
  const instance = response.headers.get(USE_SERVER_DIRECTIVE_INDEX_HEADER);
  const target = response.headers.get(USE_SERVER_DIRECTIVE_ID_HEADER);
  if (!instance || target !== id) {
    throw new Error(`Invalid response for ${id}.`);
  }
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
  let pending = true;
  let revived: unknown;
  const splits = serialized.split('\n');
  for (const split of splits) {
    if (split !== '') {
      const current = deserialize(split);
      if (pending) {
        revived = current;
        pending = false;
      }
    }
  }

  pop().then(
    () => {
      delete $R[instance];
    },
    () => {
      // no-op
    },
  );

  if (response.ok) {
    return revived as T;
  }
  if (import.meta.env.DEV) {
    throw revived;
  }
  throw new Error(`function "${id}" threw an unhandled server-side error.`);
}

async function serializeFunctionBody(body: FunctionBody): Promise<string> {
  return JSON.stringify(
    await toJSONAsync(body, {
      plugins: [
        BlobPlugin,
        CustomEventPlugin,
        DOMExceptionPlugin,
        EventPlugin,
        FilePlugin,
        FormDataPlugin,
        HeadersPlugin,
        ReadableStreamPlugin,
        RequestPlugin,
        ResponsePlugin,
        URLSearchParamsPlugin,
        URLPlugin,
      ],
    }),
  );
}

let INSTANCE = 0;

async function handler<T extends unknown[], R>(
  id: string,
  scope: () => unknown[],
  ...args: T
): Promise<R> {
  return deserializeResponse(
    id,
    await serverHandler(id, {
      headers: {
        [USE_SERVER_DIRECTIVE_INDEX_HEADER]: `use-server-directive:${INSTANCE++}`,
        [USE_SERVER_DIRECTIVE_ID_HEADER]: id,
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
