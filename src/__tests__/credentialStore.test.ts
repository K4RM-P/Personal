import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake OS keychain. `available` is toggled per test to prove we never fall back
// to plaintext when secure storage is unavailable.
const h = vi.hoisted(() => ({ available: true }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    encryptString: (plain: string) => Buffer.from(`ENC(${plain})`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^ENC\((.*)\)$/, '$1')
  }
}))

import { encryptSecret, decryptSecret, isSecureStorageAvailable } from '../main/payment/credentialStore'

describe('credentialStore (safeStorage-backed)', () => {
  beforeEach(() => {
    h.available = true
  })

  it('round-trips a secret through encrypt/decrypt', () => {
    const enc = encryptSecret('sk_test_secret')
    expect(enc).not.toContain('sk_test_secret') // stored value is not plaintext
    expect(decryptSecret(enc)).toBe('sk_test_secret')
  })

  it('stores as base64 (fits the string setting table)', () => {
    const enc = encryptSecret('abc')
    expect(enc).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it('refuses to encrypt when the OS keychain is unavailable (never plaintext)', () => {
    h.available = false
    expect(() => encryptSecret('abc')).toThrow(/plaintext/)
  })

  it('reports secure-storage availability', () => {
    expect(isSecureStorageAvailable()).toBe(true)
    h.available = false
    expect(isSecureStorageAvailable()).toBe(false)
  })

  it('decrypts an empty value to empty string without touching the keychain', () => {
    h.available = false
    expect(decryptSecret('')).toBe('')
  })
})
