/**
 * NetEase API module signature: every module is `(query, request) => Promise<RequestResponse>`.
 */

import type { createRequest, RequestResponse } from './request';
import type { Query } from './option';

export type RequestFn = typeof createRequest;

export type NeteaseModule = (query: Query, request: RequestFn) => Promise<RequestResponse>;

export type { Query, RequestResponse };
