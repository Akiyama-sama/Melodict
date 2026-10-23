/**
 * Per-endpoint memory of structured-output support, adapted from magpie's gateway
 * (internal/gateway/format.go): an endpoint that rejects `response_format` outright must not be
 * asked again — the format is dropped and the JSON instruction rides the system prompt alone
 * (which for this feature it always effectively did; the schema never constrained the wire
 * request). One fact per `baseURL|modelId`, persisted in userData like the concurrency seed.
 *
 * Shape of the ladder, from richest to plainest:
 *   1. `json_object` — the OpenAI/DeepSeek/GLM common denominator. The default wire form.
 *   2. no `response_format` at all — for relays and self-hosted servers that turn the field away
 *      (magpie's `formatRefused`).
 *
 * The old ladder had `json_schema` at the top, but it bought nothing: the transport schema was
 * deliberately lenient (app-side validation owns correctness), and `json_schema` is exactly what
 * DeepSeek's API answers 400 `invalid_request_error` to. Rather than remember a "supports
 * schema" tier no endpoint needs, the wire always speaks `json_object` — or nothing.
 *
 * Lives in the main process: the worker cannot touch Electron storage. The worker learns the
 * refusal from a failed request and reports it up (worker protocol `provider-capability`); the
 * main process persists it, and `sessionManager` passes the fact down with the next config so the
 * worker skips the rejected field from the start.
 */
import path from 'node:path';

import { concurrencyMemoryKey } from './concurrencyMemory';
import { readJsonFileOrNull, writeJsonFileAtomic } from './fsJson';

/** The single capability fact stored today; versioned so future facts migrate cleanly. */
export type ProviderCapability = 'responseFormatRefused';

interface ProviderCapabilitiesFileV1 {
  version: 1;
  /** Keys from `concurrencyMemoryKey` (normalized `baseURL|modelId`), values are refused features. */
  capabilities: Record<string, ProviderCapability[]>;
}

const FILE_NAME = 'lyrics-analysis-provider-capabilities.json';
const FORMAT_VERSION = 1;

const emptyFile = (): ProviderCapabilitiesFileV1 => ({ version: FORMAT_VERSION, capabilities: {} });

const readCapabilitiesFile = async (
  userDataDir: string
): Promise<ProviderCapabilitiesFileV1> => {
  const stored = await readJsonFileOrNull<Partial<ProviderCapabilitiesFileV1>>(
    path.join(userDataDir, FILE_NAME),
    (error) => console.warn('[lyrics-analysis] Failed to read provider capabilities.', { error })
  );
  if (
    !stored ||
    stored.version !== FORMAT_VERSION ||
    typeof stored.capabilities !== 'object' ||
    stored.capabilities === null
  ) {
    return emptyFile();
  }

  const capabilities: Record<string, ProviderCapability[]> = {};
  for (const [key, value] of Object.entries(stored.capabilities)) {
    if (Array.isArray(value)) {
      capabilities[key] = value.filter((entry): entry is ProviderCapability => entry === 'responseFormatRefused');
    }
  }
  return { version: FORMAT_VERSION, capabilities };
};

/** Whether the endpoint has been seen refusing the feature. Absent file / unreadable = no. */
export const hasProviderCapability = async (
  userDataDir: string,
  baseURL: string,
  modelId: string,
  capability: ProviderCapability
): Promise<boolean> => {
  const file = await readCapabilitiesFile(userDataDir);
  return file.capabilities[concurrencyMemoryKey(baseURL, modelId)]?.includes(capability) ?? false;
};

/** Records the feature refusal for the endpoint and persists it immediately. */
export const addProviderCapability = async (
  userDataDir: string,
  baseURL: string,
  modelId: string,
  capability: ProviderCapability
): Promise<void> => {
  const file = await readCapabilitiesFile(userDataDir);
  const key = concurrencyMemoryKey(baseURL, modelId);
  const existing = file.capabilities[key] ?? [];
  if (!existing.includes(capability)) existing.push(capability);
  file.capabilities[key] = existing;

  try {
    await writeJsonFileAtomic(path.join(userDataDir, FILE_NAME), file, { spacing: 2 });
  } catch (error) {
    // Persistence is best-effort: a read-only userData dir costs one re-detected 400 per
    // session, never a failed analysis.
    console.warn('[lyrics-analysis] Failed to persist provider capabilities.', { error });
  }
};
