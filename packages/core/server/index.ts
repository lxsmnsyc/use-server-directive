import type { SerovalJSON } from 'seroval';
import {
  crossSerializeStream,
  fromJSON,
  getCrossReferenceHeader,
} from 'seroval';
import {
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
      const args = fromJSON<unknown[]>((await request.json()) as SerovalJSON, {
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
      });
      const result = callback(...args);
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

export function $$server(
  id: string,
  callback: ServerHandler<unknown[], unknown>,
): ServerHandler<unknown[], unknown> {
  const reg: HandlerRegistration = [id, callback];
  REGISTRATIONS.set(id, reg);
  return callback;
}
