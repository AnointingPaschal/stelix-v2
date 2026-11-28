// Stelix Admin — admin-managed API keys (migration 0021). Shared by
// the Worker (server-side encryption + validation) and the API Keys
// page, so the rules cannot drift between the form and the API.
//
// SECURITY: a key VALUE is used only server-side by the Worker and is
// NEVER included in /api/sync or any app-facing response. The admin UI
// shows only the name + a masked hint. Values are encrypted at rest
// with AES-GCM, keyed by a key derived (HKDF-SHA256) from the
// CONFIG_SIGNING_SECRET Pages secret — the same secret that signs the
// app config, so no new secret has to be provisioned. Rotating that
// secret makes stored keys undecryptable: decryptApiKeyValue then
// returns null and the caller treats the key as missing (Circle falls
// back to the CIRCLE_API_KEY Pages secret) until the key is re-saved.
// If CONFIG_SIGNING_SECRET is not set, the Worker refuses to save a
// key at all (503) rather than storing it unencrypted.
export const API_KEY_CIRCLE_NAME = 'circle'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/

/** Name rules: 1–64 chars, starts with a letter or digit, then
 *  letters, digits, spaces, hyphens or underscores. Returns an error
 *  message, or null when the name is valid. */
export function validateApiKeyName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'name is required'
  if (!NAME_RE.test(name.trim())) {
    return 'name must be 1–64 characters, starting with a letter or digit, using only letters, digits, spaces, hyphens and underscores'
  }
  return null
}

/** Masked hint for display: first 4 + ellipsis + last 4 characters.
 *  Short values show only bullets — never the value itself. */
export function maskApiKeyHint(value: string): string {
  if (value.length < 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

const b64urlEncode = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlDecode = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  // A fresh fixed-length array is ArrayBuffer-backed, which is what
  // crypto.subtle.decrypt requires (Uint8Array.from would type as
  // Uint8Array<ArrayBufferLike> and fail tsc).
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Derive the AES-GCM key for API-key values from the server secret.
 *  HKDF keeps the encryption key distinct from the HMAC key the same
 *  secret is used for (config signing). */
export async function deriveApiKeyEncryptionKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('stelix-api-keys-v1'),
      info: new TextEncoder().encode('api-key-value'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt one key value. Stored form: `v1.<b64url iv>.<b64url ciphertext>`. */
export async function encryptApiKeyValue(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`
}

/** Decrypt a stored value. Returns null for anything undecryptable —
 *  wrong format, tampered ciphertext, or a key derived from a rotated
 *  secret — so the caller treats it as missing, never as plaintext. */
export async function decryptApiKeyValue(key: CryptoKey, stored: string): Promise<string | null> {
  try {
    const parts = stored.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1') return null
    const iv = b64urlDecode(parts[1])
    const ct = b64urlDecode(parts[2])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
