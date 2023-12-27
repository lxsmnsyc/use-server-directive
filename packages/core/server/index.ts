import type { SerovalJSON } from 'seroval';
import {
  crossSerializeStream,
  fromJSON,
  getCrossReferenceHeader,
} from 'seroval';
import {
  type FunctionBody,
  type ServerHandler,
  USE_SERVER_DIRECTIVE_INDEX_HEADER,
  USE_SERVER_DIRECTIVE_ID_HEADER,
} from '../shared/utils';
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
  URLSearchParamsPlugin,
  URLPlugin,
} from 'seroval-plugins/web';

type HandlerRegistration = [
  id: string,
  callback: ServerHandler<unknown[], unknown>,
];

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
        plugins: [
          CustomEventPlugin,
          DOMExceptionPlugin,
          EventPlugin,
          FormDataPlugin,
          HeadersPlugin,
          ReadableStreamPlugin,
          RequestPlugin,
          ResponsePlugin,
          URLSearchParamsPlugin,
          URLPlugin,
        ],
        onSerialize(data, initial) {
          const result = initial
            ? `(${getCrossReferenceHeader(instance)},${data})`
            : data;
          controller.enqueue(new TextEncoder().encode(`${result};\n`));
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
  callback: ServerHandler<T, R>,
  scope: () => unknown[],
  ...args: T
): Promise<R> {
  const currentScope = scope();
  return await runWithScope(currentScope, async () => callback(...args));
}

export function $$scope(): unknown[] {
  return SCOPE!;
}

export function $$clone(
  [id, callback]: HandlerRegistration,
  scope: () => unknown[],
): unknown {
  return Object.assign(handler.bind(null, callback, scope), {
    id,
  });
}

export async function handleRequest(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const registration = REGISTRATIONS.get(url.pathname);
  const instance = request.headers.get(USE_SERVER_DIRECTIVE_INDEX_HEADER);
  const target = request.headers.get(USE_SERVER_DIRECTIVE_ID_HEADER);
  if (registration && instance) {
    const [id, callback] = registration;
    if (id !== target) {
      return new Response(
        serializeToStream(
          instance,
          new Error(`Invalid request for ${instance}`),
        ),
        {
          headers: {
            'Content-Type': 'text/javascript',
            [USE_SERVER_DIRECTIVE_INDEX_HEADER]: instance,
            [USE_SERVER_DIRECTIVE_ID_HEADER]: target || '',
          },
          status: 500,
        },
      );
    }
    try {
      const { scope, args } = fromJSON<FunctionBody>(
        (await request.json()) as SerovalJSON,
        {
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
        },
      );
      const result = await runWithScope(scope, async () => callback(...args));
      return new Response(serializeToStream(instance, result), {
        headers: {
          'Content-Type': 'text/javascript',
          [USE_SERVER_DIRECTIVE_INDEX_HEADER]: instance,
          [USE_SERVER_DIRECTIVE_ID_HEADER]: id,
        },
        status: 200,
      });
    } catch (error) {
      return new Response(serializeToStream(instance, error), {
        headers: {
          'Content-Type': 'text/javascript',
          [USE_SERVER_DIRECTIVE_INDEX_HEADER]: instance,
          [USE_SERVER_DIRECTIVE_ID_HEADER]: id,
        },
        status: 500,
      });
    }
  }
  return undefined;
}
