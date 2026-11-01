/** Unified response structure. */
export interface RequestResponse {
  status: number;
  body: Record<string, unknown>;
  cookie: string[];
}

/** Error thrown for any non-200 outcome, keeping the server's business result attached. */
export class NeteaseRequestError extends Error {
  readonly response: RequestResponse;

  constructor(response: RequestResponse) {
    const body = response.body as { code?: number | string; msg?: string; message?: string };
    const code = body?.code ?? response.status;
    const msg = body?.msg ?? body?.message ?? '';
    super(msg ? `netease ${code}: ${msg}` : `netease ${code}`);
    this.name = 'NeteaseRequestError';
    this.response = response;
  }
}
