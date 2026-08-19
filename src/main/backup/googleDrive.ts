import { shell } from 'electron'
import { createServer } from 'http'
import { OAuth2Client } from 'googleapis-common'
import { drive, drive_v3 } from '@googleapis/drive'
import { PrismaClient } from '@prisma/client'
import { createReadStream, existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { encryptSecret, decryptSecret } from '../payment/credentialStore'
import type { BackupLogSummary, DriveBackupStatus } from '../../shared/types'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const DRIVE_ROOT_FOLDER_NAME = 'Pharmacy POS Backups'
const RETENTION_DAYS = 30

function oauthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID ?? ''
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Drive is not configured — GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET are missing.'
    )
  }
  return new OAuth2Client({ clientId, clientSecret })
}

async function getSetting(db: PrismaClient, key: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? ''
}
async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

async function getAuthorizedClient(db: PrismaClient): Promise<OAuth2Client> {
  const encToken = await getSetting(db, 'backup.driveRefreshTokenEnc')
  if (!encToken) throw new Error('Google Drive is not connected.')
  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptSecret(encToken) })
  return client
}

/**
 * Runs the loopback OAuth flow: opens the system browser, waits on a local HTTP
 * server for Google's redirect, exchanges the code for tokens, stores the refresh
 * token encrypted (via credentialStore's safeStorage-backed encryptSecret, same
 * pattern used for payment API keys), and caches the connected account's email.
 */
export async function connectGoogleDrive(db: PrismaClient): Promise<{ email: string }> {
  const client = oauthClient()

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '', 'http://127.0.0.1')
        const authCode = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        res.end(
          error
            ? 'Google Drive connection failed — you can close this tab.'
            : 'Google Drive connected — you can close this tab.'
        )
        server.close()
        if (error) reject(new Error(`Google denied access: ${error}`))
        else if (authCode) resolve({ code: authCode, redirectUri: currentRedirectUri })
        else reject(new Error('Google redirect had no authorization code.'))
      })
      let currentRedirectUri = ''
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        currentRedirectUri = `http://127.0.0.1:${port}/callback`
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
          redirect_uri: currentRedirectUri
        })
        shell.openExternal(authUrl)
      })
      server.on('error', reject)
    }
  )

  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri })
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Disconnect any prior grant for this app at myaccount.google.com/permissions and try again.'
    )
  }
  client.setCredentials(tokens)

  const driveClient = drive({ version: 'v3', auth: client })
  const about = await driveClient.about.get({ fields: 'user' })
  const email = about.data.user?.emailAddress ?? 'unknown'

  await setSetting(db, 'backup.driveRefreshTokenEnc', encryptSecret(tokens.refresh_token))
  await setSetting(db, 'backup.driveAccountEmail', email)
  await setSetting(db, 'backup.driveAutoBackupEnabled', 'true')

  return { email }
}

export async function disconnectGoogleDrive(db: PrismaClient): Promise<void> {
  await setSetting(db, 'backup.driveRefreshTokenEnc', '')
  await setSetting(db, 'backup.driveAccountEmail', '')
  await setSetting(db, 'backup.driveFolderId', '')
  await setSetting(db, 'backup.driveAutoBackupEnabled', 'false')
}

export async function saveDriveBackupSettings(
  db: PrismaClient,
  args: { autoBackupEnabled: boolean; intervalHours: number }
): Promise<void> {
  await setSetting(db, 'backup.driveAutoBackupEnabled', String(args.autoBackupEnabled))
  await setSetting(db, 'backup.driveIntervalHours', String(args.intervalHours))
}

export async function getDriveStatus(db: PrismaClient): Promise<DriveBackupStatus> {
  const [email, autoStr, intervalStr, lastLog] = await Promise.all([
    getSetting(db, 'backup.driveAccountEmail'),
    getSetting(db, 'backup.driveAutoBackupEnabled'),
    getSetting(db, 'backup.driveIntervalHours'),
    db.backupLog.findFirst({ where: { driveName: 'Google Drive' }, orderBy: { timestamp: 'desc' } })
  ])
  return {
    connected: email !== '',
    email: email || undefined,
    autoBackupEnabled: autoStr === 'true',
    intervalHours: parseInt(intervalStr, 10) || 24,
    lastBackup: lastLog
      ? ({
          id: lastLog.id,
          timestamp: lastLog.timestamp.toISOString(),
          backupPath: lastLog.backupPath,
          driveName: lastLog.driveName,
          drivePath: lastLog.drivePath,
          backupSizeBytes: lastLog.backupSizeBytes,
          status: lastLog.status as BackupLogSummary['status'],
          errorMessage: lastLog.errorMessage
        } as BackupLogSummary)
      : undefined
  }
}

async function findOrCreateRootFolder(client: drive_v3.Drive, db: PrismaClient): Promise<string> {
  const cachedId = await getSetting(db, 'backup.driveFolderId')
  if (cachedId) {
    try {
      const check = await client.files.get({ fileId: cachedId, fields: 'id, trashed' })
      if (!check.data.trashed) return cachedId
    } catch {
      // cached id is stale/deleted — fall through and recreate
    }
  }
  const found = await client.files.list({
    q: `name = '${DRIVE_ROOT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)'
  })
  const existing = found.data.files?.[0]?.id
  const folderId =
    existing ??
    (
      await client.files.create({
        requestBody: {
          name: DRIVE_ROOT_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      })
    ).data.id
  if (!folderId) throw new Error('Could not create the Google Drive backup folder.')
  await setSetting(db, 'backup.driveFolderId', folderId)
  return folderId
}

/**
 * Pure retention logic, split out from the API-calling sweep below so it's unit-testable
 * without mocking the Drive client. Mirrors cleanupExpiredBackups' best-effort behavior in
 * backupService.ts: an unparseable timestamp is left alone, never deleted.
 */
export function pickBackupsToDelete(
  folders: Array<{ name: string; createdTime: string }>,
  now: Date
): string[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  return folders
    .filter((f) => {
      const parsed = Date.parse(f.createdTime)
      return !Number.isNaN(parsed) && parsed < cutoff
    })
    .map((f) => f.name)
}

async function cleanupExpiredDriveBackups(
  client: drive_v3.Drive,
  rootFolderId: string
): Promise<void> {
  const list = await client.files.list({
    q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, createdTime)'
  })
  const folders = (list.data.files ?? []).filter(
    (f): f is { id: string; name: string; createdTime: string } =>
      !!f.id && !!f.name && !!f.createdTime && f.name.startsWith('PHARMACY_POS_BACKUP_')
  )
  const toDeleteNames = new Set(pickBackupsToDelete(folders, new Date()))
  for (const folder of folders) {
    if (!toDeleteNames.has(folder.name)) continue
    try {
      await client.files.delete({ fileId: folder.id })
    } catch {
      // best-effort — leave it for the next sweep
    }
  }
}

/**
 * Uploads every file already written to `localBackupDir` (by performBackup) into a
 * timestamped Drive folder, logs a BackupLog row, then sweeps for expired Drive folders.
 */
export async function uploadBackupToDrive(
  db: PrismaClient,
  localBackupDir: string,
  args: { initiatedByUserId: number }
): Promise<void> {
  try {
    const authClient = await getAuthorizedClient(db)
    const client = drive({ version: 'v3', auth: authClient })
    const rootFolderId = await findOrCreateRootFolder(client, db)

    const folderName = basename(localBackupDir)
    const folder = await client.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      },
      fields: 'id, webViewLink'
    })
    const folderId = folder.data.id
    if (!folderId) throw new Error('Could not create the Drive backup folder for this run.')

    const metadataPath = join(localBackupDir, 'backup-metadata.json')
    const metadata = existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, 'utf-8')) as {
          filesIncluded?: string[]
          dataSnapshot?: Record<string, number>
        })
      : {}
    const files: string[] = metadata.filesIncluded ?? []
    let totalBytes = 0
    for (const fileName of files) {
      const filePath = join(localBackupDir, fileName)
      if (!existsSync(filePath)) continue
      const uploaded = await client.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { body: createReadStream(filePath) },
        fields: 'size'
      })
      totalBytes += Number(uploaded.data.size ?? 0)
    }

    await db.backupLog.create({
      data: {
        backupPath: folder.data.webViewLink ?? folderId,
        driveName: 'Google Drive',
        drivePath: folder.data.webViewLink ?? folderId,
        backupSizeBytes: totalBytes,
        dataSnapshot: JSON.stringify(metadata.dataSnapshot ?? {}),
        initiatedByUserId: args.initiatedByUserId,
        status: 'SUCCESS'
      }
    })

    await cleanupExpiredDriveBackups(client, rootFolderId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A revoked/expired grant surfaces as an auth error from Google — treat it as
    // disconnected so Settings prompts a manager to reconnect instead of retrying forever.
    if (message.includes('invalid_grant')) {
      await disconnectGoogleDrive(db)
    }
    await db.backupLog.create({
      data: {
        backupPath: localBackupDir,
        driveName: 'Google Drive',
        drivePath: '',
        backupSizeBytes: 0,
        dataSnapshot: '{}',
        initiatedByUserId: args.initiatedByUserId,
        status: 'FAILED',
        errorMessage: message
      }
    })
    throw new Error(message)
  }
}
