/** Extracts request-layer configuration from business parameters. */

import type { CryptoMode } from './config';
import type { RequestOptions } from './request';

/** Caller-supplied optional parameters. */
export interface Query {
  /** Encryption mode; empty means "use the module's default". */
  crypto?: CryptoMode | '';
  /** Pre-injected cookie, string or object. */
  cookie?: string | Record<string, string>;
  /** Custom User-Agent. */
  ua?: string;
  /** Ask the server to encrypt the response body (weapi/eapi only). */
  e_r?: boolean;
  /** Referer / domain override. */
  domain?: string;
  /** Other optional parameters. */
  [key: string]: unknown;
}

/**
 * Builds request options from a query.
 * @param query - caller-supplied optional parameters
 * @param crypto - encryption mode
 * @returns request options
 */
export const createOption = (query: Query, crypto: CryptoMode | '' = ''): RequestOptions => ({
  crypto: (query.crypto as CryptoMode | undefined) || crypto,
  cookie: query.cookie,
  ua: query.ua || '',
  e_r: query.e_r,
  domain: query.domain || ''
});
