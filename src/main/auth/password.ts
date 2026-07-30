import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

/** Hash a plaintext password with bcrypt. Never store or log the plaintext. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

/** Verify a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}
