import { existsSync, readdirSync, statfsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import type { ExternalDrive } from '../../shared/types'

function safeReadDir(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : []
  } catch {
    return []
  }
}

function driveSpace(drivePath: string): { totalBytes: number; freeBytes: number } | null {
  try {
    const stats = statfsSync(drivePath)
    return {
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize
    }
  } catch {
    return null
  }
}

function toDrive(name: string, path: string): ExternalDrive | null {
  const space = driveSpace(path)
  if (!space) return null
  return { name, path, totalBytes: space.totalBytes, freeBytes: space.freeBytes }
}

/** Detect connected external/removable drives. Platform-specific — see spec §1.5. */
export function getExternalDrives(): ExternalDrive[] {
  const platform = os.platform()

  if (platform === 'darwin') {
    return safeReadDir('/Volumes')
      .filter((name) => name !== 'Macintosh HD' && !name.startsWith('.'))
      .map((name) => toDrive(name, join('/Volumes', name)))
      .filter((d): d is ExternalDrive => d !== null)
  }

  if (platform === 'win32') {
    const drives: ExternalDrive[] = []
    for (let code = 68; code <= 90; code++) {
      // D: through Z: — skip A/B/C, which are floppy/system on Windows
      const letter = `${String.fromCharCode(code)}:\\`
      if (existsSync(letter)) {
        const drive = toDrive(letter, letter)
        if (drive) drives.push(drive)
      }
    }
    return drives
  }

  // Linux and other platforms: removable media typically mounted under /media or /mnt
  const drives: ExternalDrive[] = []
  for (const root of ['/media', '/mnt']) {
    for (const name of safeReadDir(root).filter((n) => !n.startsWith('.'))) {
      const path = join(root, name)
      const drive = toDrive(name, path)
      if (drive) drives.push(drive)
    }
  }
  return drives
}
