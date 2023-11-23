export interface FunctionBody {
  scope: unknown[];
  args: unknown[];
}

export type ServerHandler<Args extends unknown[], Return> = (
  ...args: Args
) => Promise<Return>;
