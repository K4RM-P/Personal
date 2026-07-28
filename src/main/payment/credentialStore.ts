import { safeStorage } from 'electron'

/**
 * Encrypts/decrypts payment API keys using Electron `safeStorage`, which is
 * backed by the OS keychain (macOS Keychain, Windows DPAPI, libsecret on Linux).
 * We NEVER write a key in plaintext — if the OS secure store is unavailable we
 * refuse to persist rather than silently downgrading.
 *
 * Encrypted values are stored base64-encoded so they fit the string-typed
 * `setting` table.
 */
export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage is unavailable — refusing to store the payment API key in plaintext'
    )
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(encBase64: string): string {
  if (!encBase64) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable — cannot decrypt the stored payment API key')
  }
  return safeStorage.decryptString(Buffer.from(encBase64, 'base64'))
}
