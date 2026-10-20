import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// `test/setup.ts` is not applied to this file, so the temp dir is the only shared state. Unique per
// module instance keeps it isolated from the other test files that exercise the same repository.
const userDataDir = path.join(
  os.tmpdir(),
  `nora-provider-profiles-${process.pid}-${Math.random().toString(36).slice(2)}`
);

// `test/setup.ts` already mocks `electron` globally, so override the pieces this module needs
// instead of replacing the whole module (a second `vi.mock` for the same id is ignored).
vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => userDataDir) },
    safeStorage: {
      // Round-trip through base64 so tests never need a real OS keychain.
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf-8'),
      decryptString: (value: Buffer) => value.toString('utf-8').replace(/^enc:/, '')
    }
  };
});

const repository = await import('../../../../src/main/lyricsAnalysis/providerConfigRepository');

const profilesFile = () => path.join(userDataDir, 'lyrics-analysis-providers.json');
const legacyFile = () => path.join(userDataDir, 'lyrics-analysis-provider.json');

describe('providerConfigRepository', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('saves profiles, marks new ones active, and never exposes the key in the list', async () => {
    await repository.saveStoredProviderProfile({
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-first-key-1234'
    });
    const state = await repository.saveStoredProviderProfile({
      name: 'Gateway',
      baseURL: 'https://gateway.example/v1',
      modelId: 'deepseek-chat',
      apiKey: 'sk-second-key-5678'
    });

    expect(state.profiles).toHaveLength(2);
    expect(state.activeProfileId).toBe(state.profiles[1].id);
    expect(state.profiles.map((profile) => profile.name)).toEqual(['OpenAI', 'Gateway']);
    expect(JSON.stringify(state)).not.toContain('sk-first-key-1234');
    expect(state.profiles[0].apiKeyHint).toBe('••••1234');

    const stored = await repository.getStoredProviderConfig();
    expect(stored.apiKey).toBe('sk-second-key-5678');
  });

  test('editing a profile keeps the stored key unless a new one is supplied', async () => {
    const state = await repository.saveStoredProviderProfile({
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-keep-me-9999'
    });
    const id = state.profiles[0].id;
    await repository.saveStoredProviderProfile({
      id,
      name: 'OpenAI renamed',
      baseURL: 'https://api.openai.com/v1',
      modelId: 'gpt-4o'
    });
    expect((await repository.getStoredProviderProfile(id))?.apiKey).toBe('sk-keep-me-9999');

    await repository.saveStoredProviderProfile({
      id,
      name: 'OpenAI renamed',
      baseURL: 'https://api.openai.com/v1',
      modelId: 'gpt-4o',
      apiKey: 'sk-brand-new-0000'
    });
    expect((await repository.getStoredProviderProfile(id))?.apiKey).toBe('sk-brand-new-0000');
  });

  test('switching the active profile changes what the worker receives', async () => {
    await repository.saveStoredProviderProfile({
      name: 'A',
      baseURL: 'https://a.example/v1',
      modelId: 'model-a',
      apiKey: 'key-a'
    });
    const state = await repository.saveStoredProviderProfile({
      name: 'B',
      baseURL: 'https://b.example/v1',
      modelId: 'model-b',
      apiKey: 'key-b'
    });
    const firstId = state.profiles[0].id;

    await repository.setActiveProviderProfile(firstId);

    const stored = await repository.getStoredProviderConfig();
    expect(stored).toMatchObject({ baseURL: 'https://a.example/v1', modelId: 'model-a', apiKey: 'key-a' });
  });

  test('deleting the active profile falls back to the first remaining one', async () => {
    await repository.saveStoredProviderProfile({
      name: 'A',
      baseURL: 'https://a.example/v1',
      modelId: 'model-a',
      apiKey: 'key-a'
    });
    const state = await repository.saveStoredProviderProfile({
      name: 'B',
      baseURL: 'https://b.example/v1',
      modelId: 'model-b',
      apiKey: 'key-b'
    });
    const activeId = state.activeProfileId!;

    const afterDelete = await repository.deleteProviderProfile(activeId);

    expect(afterDelete.profiles).toHaveLength(1);
    expect(afterDelete.activeProfileId).toBe(afterDelete.profiles[0].id);
    expect((await repository.getStoredProviderConfig()).baseURL).toBe('https://a.example/v1');
  });

  test('migrates the legacy single-provider file on first read', async () => {
    await fs.writeFile(
      legacyFile(),
      JSON.stringify({
        baseURL: 'https://legacy.example/v1',
        modelId: 'legacy-model',
        apiKeyEncrypted: Buffer.from('enc:legacy-key', 'utf-8').toString('base64')
      })
    );

    const state = await repository.getStoredProviderProfiles();

    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      name: 'legacy.example',
      baseURL: 'https://legacy.example/v1',
      modelId: 'legacy-model',
      hasApiKey: true,
      apiKeyHint: '••••-key'
    });
    expect((await repository.getStoredProviderConfig()).apiKey).toBe('legacy-key');
    // The migrated state is written, so the next read no longer needs the legacy file.
    await expect(fs.access(profilesFile())).resolves.toBeUndefined();
  });

  test('uses the host name as the profile name when none is supplied', async () => {
    const state = await repository.saveStoredProviderProfile({
      baseURL: 'https://token.ctflow.cn/v1',
      modelId: 'deepseek-v4.1-flash',
      apiKey: 'key'
    });

    expect(state.profiles[0].name).toBe('token.ctflow.cn');
  });

  test('persists maxConcurrency, clamps it, and keeps the stored value when the input omits it', async () => {
    const state = await repository.saveStoredProviderProfile({
      name: 'C',
      baseURL: 'https://c.example/v1',
      modelId: 'model-c',
      apiKey: 'key',
      maxConcurrency: 12
    });
    const id = state.profiles[0].id;
    expect(state.profiles[0].maxConcurrency).toBe(12);

    // Editing without the field keeps the stored ceiling.
    const edited = await repository.saveStoredProviderProfile({
      id,
      name: 'C',
      baseURL: 'https://c.example/v1',
      modelId: 'model-c2'
    });
    expect(edited.profiles[0].maxConcurrency).toBe(12);

    // Re-saving with a number overwrites; out-of-range values clamp.
    const overwritten = await repository.saveStoredProviderProfile({
      id,
      name: 'C',
      baseURL: 'https://c.example/v1',
      modelId: 'model-c2',
      maxConcurrency: 999
    });
    expect(overwritten.profiles[0].maxConcurrency).toBe(64);
  });

  test('reads profiles written before maxConcurrency existed as undefined', async () => {
    // Simulate a pre-field profile on disk: write via the repository, then strip the field.
    const state = await repository.saveStoredProviderProfile({
      name: 'Old',
      baseURL: 'https://old.example/v1',
      modelId: 'model-old',
      apiKey: 'key',
      maxConcurrency: 8
    });
    const rawPath = path.join(userDataDir, 'lyrics-analysis-providers.json');
    const raw = JSON.parse(await fs.readFile(rawPath, 'utf-8'));
    delete raw.profiles[0].maxConcurrency;
    await fs.writeFile(rawPath, JSON.stringify(raw));

    const reread = await repository.getStoredProviderProfiles();
    expect(reread.profiles[0].maxConcurrency).toBeUndefined();

    // The worker-facing config also defaults: no field, consumer applies 4.
    const config = await repository.getStoredProviderConfig();
    expect(config.maxConcurrency).toBeUndefined();
    void state;
  });
});
