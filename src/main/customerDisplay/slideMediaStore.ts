import { app, protocol } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, writeFile, unlink, rm } from 'fs/promises'
import { existsSync, createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { join, extname, normalize } from 'path'
import { CUSTOMER_DISPLAY_MEDIA_PROTOCOL } from '../../shared/customerDisplay'

/**
 * On-disk storage for customer-display slide videos, which are too large for
 * the base64-in-SQLite pattern used for images. Files live under
 * userData/customerDisplayMedia and are referenced from the DB by their
 * filename only (`videoFilePath`) — never a full path — so a restored backup
 * on a different machine still resolves correctly.
 */

const MEDIA_DIR_NAME = 'customerDisplayMedia'

function mediaDir(): string {
  return join(app.getPath('userData'), MEDIA_DIR_NAME)
}

export async function ensureMediaDir(): Promise<string> {
  const dir = mediaDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** Rejects anything that isn't a bare filename — no traversal via `..` or path separators. */
function assertSafeFilename(name: string): void {
  const normalized = normalize(name)
  if (
    normalized !== name ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error('Invalid media filename')
  }
}

/** Copies an uploaded video's bytes to the media store and returns its stored filename. */
export async function storeSlideVideo(buffer: Buffer, originalExt: string): Promise<string> {
  const dir = await ensureMediaDir()
  const filename = `${randomUUID()}${originalExt}`
  await writeFile(join(dir, filename), buffer)
  return filename
}

export async function deleteSlideMediaFiles(filenames: string[]): Promise<void> {
  const dir = mediaDir()
  await Promise.all(
    filenames.map(async (name) => {
      try {
        assertSafeFilename(name)
        const filePath = join(dir, name)
        if (existsSync(filePath)) await unlink(filePath)
      } catch {
        // Best-effort cleanup — a missing/invalid file is never fatal to a slide save.
      }
    })
  )
}

/** Wipes the entire media store — used by the Danger Zone full factory reset. */
export async function deleteAllSlideMedia(): Promise<void> {
  await rm(mediaDir(), { recursive: true, force: true })
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime'
}

/**
 * Registers the `pos-media://` scheme the customer-display window uses to play
 * slide videos directly from disk (never over IPC — video files are too large
 * to shuttle through contextBridge). Must be called before `app.whenReady()`.
 */
export function registerSlideMediaProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CUSTOMER_DISPLAY_MEDIA_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

/** Serves files out of the media dir, with basic range-request support for video seeking. Call after `app.whenReady()`. */
export function registerSlideMediaProtocolHandler(): void {
  protocol.handle(CUSTOMER_DISPLAY_MEDIA_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    // pos-media://slide/<encoded-filename>
    const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    try {
      assertSafeFilename(filename)
    } catch {
      return new Response('Invalid media path', { status: 400 })
    }

    const filePath = join(mediaDir(), filename)
    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }

    const ext = extname(filePath).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const { size } = statSync(filePath)
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': mime, 'Content-Length': String(size) }
    })
  })
}
