import { createHash } from 'crypto'
import { createReadStream } from 'fs'

/** SHA-256 of a file's contents, streamed so large files (backup.sqlite) don't load fully into memory. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
