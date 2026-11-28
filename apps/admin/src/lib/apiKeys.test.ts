/**
 * Admin-managed API keys (admin/src/lib/apiKeys.ts): name rules, masked
 * hints, and AES-GCM encryption at rest keyed off CONFIG_SIGNING_SECRET.
 * Values must never be returned to any client — only names + hints.
 */
import { describe, expect, it } from 'vitest';
import {
  API_KEY_CIRCLE_NAME,
  decryptApiKeyValue,
  deriveApiKeyEncryptionKey,
  encryptApiKeyValue,
  maskApiKeyHint,
  validateApiKeyName,
} from './apiKeys';

describe('validateApiKeyName', () => {
  it('accepts the reserved Circle name and ordinary names', () => {
    expect(validateApiKeyName(API_KEY_CIRCLE_NAME)).toBeNull();
    expect(validateApiKeyName('Explorer Key')).toBeNull();
    expect(validateApiKeyName('circle-testnet')).toBeNull();
    expect(validateApiKeyName('x'.repeat(64))).toBeNull();
  });

  it('rejects empty, over-long and malformed names', () => {
    expect(validateApiKeyName('')).not.toBeNull();
    expect(validateApiKeyName('   ')).not.toBeNull();
    expect(validateApiKeyName('x'.repeat(65))).not.toBeNull();
    expect(validateApiKeyName('bad/name')).not.toBeNull();
    expect(validateApiKeyName('bad!')).not.toBeNull();
    expect(validateApiKeyName(42)).not.toBeNull();
  });

  it('trims surrounding whitespace before validating', () => {
    expect(validateApiKeyName(' circle ')).toBeNull();
  });
});

describe('maskApiKeyHint', () => {
  it('shows first 4 + last 4 only', () => {
    expect(maskApiKeyHint('sk_live_abc123def456')).toBe('sk_l…f456');
  });

  it('never leaks a short value', () => {
    expect(maskApiKeyHint('abc')).toBe('••••');
    expect(maskApiKeyHint('1234567')).toBe('••••');
  });
});

describe('encryptApiKeyValue / decryptApiKeyValue', () => {
  it('round-trips a value with the derived key', async () => {
    const key = await deriveApiKeyEncryptionKey('test-signing-secret');
    const stored = await encryptApiKeyValue(key, 'CIRCLE_API_KEY_VALUE');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('CIRCLE_API_KEY_VALUE');
    expect(await decryptApiKeyValue(key, stored)).toBe('CIRCLE_API_KEY_VALUE');
  });

  it('encrypting twice gives different ciphertext (random IV)', async () => {
    const key = await deriveApiKeyEncryptionKey('test-signing-secret');
    const a = await encryptApiKeyValue(key, 'same-value');
    const b = await encryptApiKeyValue(key, 'same-value');
    expect(a).not.toBe(b);
    expect(await decryptApiKeyValue(key, a)).toBe('same-value');
    expect(await decryptApiKeyValue(key, b)).toBe('same-value');
  });

  it('returns null for a tampered value, a wrong key, or a bad format', async () => {
    const key = await deriveApiKeyEncryptionKey('test-signing-secret');
    const otherKey = await deriveApiKeyEncryptionKey('a-different-secret');
    const stored = await encryptApiKeyValue(key, 'some-secret');
    const tampered = stored.slice(0, -2) + 'aa';
    expect(await decryptApiKeyValue(key, tampered)).toBeNull();
    expect(await decryptApiKeyValue(otherKey, stored)).toBeNull();
    expect(await decryptApiKeyValue(key, 'not-encrypted')).toBeNull();
    expect(await decryptApiKeyValue(key, '')).toBeNull();
  });
});
