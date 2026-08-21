import { drive as driveApi, AuthPlus, type drive_v3 } from '@googleapis/drive'

// @googleapis/drive bundles its own private copy of googleapis-common/google-auth-library,
// structurally distinct from the top-level `googleapis-common` package (two separate
// OAuth2Client classes with a private `redirectUri` field TS won't unify). AuthPlus is
// @googleapis/drive's own auth namespace, so `new AuthPlus().OAuth2` is the exact class
// `drive({ auth })` expects.
const authPlus = new AuthPlus()
type OAuth2Client = InstanceType<typeof authPlus.OAuth2>
import http from 'http'
import { createReadStream, readdirSync } from 'fs'
import { join } from 'path'

// drive.file is the actual backup permission (least privilege); userinfo.email is only
// used to label the connection in Settings as "Connected as x@y.com" — without it the
// userinfo endpoint rejects the request entirely ("missing required authentication credential"),
// since an access token's scope set determines which APIs it's valid for at all.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email'
]
const REDIRECT_PORT_RANGE = { min: 42813, max: 42823 }
const DRIVE_BACKUP_FOLDER_NAME = 'PharmacyPOS Backups'
// Every individual Drive API call gets this as a per-request gaxios timeout — without it,
// a stalled connection (e.g. uploading backup.sqlite over a slow network) hangs the request
// forever with no error, leaving the renderer's "Back Up Now" button permanently disabled.
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000

export interface GoogleDriveCredentials {
  clientId: string
  clientSecret: string
}

function readOAuthCredentials(): GoogleDriveCredentials {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Drive is not configured — GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET are missing.'
    )
  }
  return { clientId, clientSecret }
}

function makeClient(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = readOAuthCredentials()
  return new authPlus.OAuth2({ clientId, clientSecret, redirectUri })
}

/**
 * Runs the full OAuth2 "Desktop app" loopback flow: opens a short-lived local HTTP
 * server on a free port in REDIRECT_PORT_RANGE, builds the consent URL pointed at it,
 * opens the URL in the user's default browser, and waits for Google to redirect back
 * with the authorization code. `access_type=offline` + `prompt=consent` are required
 * to get a refresh token back (Google only issues one on first consent, or when
 * prompt=consent forces re-consent).
 */
export async function runOAuthLoginFlow(
  openExternal: (url: string) => Promise<void> | void
): Promise<{ refreshToken: string; email: string }> {
  const port = await findFreePort()
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`
  const client = makeClient(redirectUri)

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    redirect_uri: redirectUri
  })

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', redirectUri)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      if (error) {
        res.end(
          '<body style="font-family:sans-serif;padding:2rem">Sign-in cancelled. You can close this tab.</body>'
        )
        server.close()
        reject(new Error(`Google sign-in was cancelled or denied (${error}).`))
        return
      }
      if (!code) {
        res.end(
          '<body style="font-family:sans-serif;padding:2rem">Missing authorization code. You can close this tab.</body>'
        )
        return
      }
      res.end(
        '<body style="font-family:sans-serif;padding:2rem">Google Drive connected. You can close this tab and return to the app.</body>'
      )
      server.close()
      resolve(code)
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      void openExternal(authUrl)
    })

    setTimeout(
      () => {
        server.close()
        reject(new Error('Timed out waiting for Google sign-in — please try again.'))
      },
      5 * 60 * 1000
    )
  })

  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri })
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke access for this app at myaccount.google.com/permissions and try connecting again.'
    )
  }

  client.setCredentials(tokens)
  const email = await fetchAccountEmail(client)

  return { refreshToken: tokens.refresh_token, email }
}

async function findFreePort(): Promise<number> {
  for (let port = REDIRECT_PORT_RANGE.min; port <= REDIRECT_PORT_RANGE.max; port++) {
    const isFree = await new Promise<boolean>((resolve) => {
      const server = http.createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true))
      })
    })
    if (isFree) return port
  }
  throw new Error('No free local port available to complete Google sign-in.')
}

async function fetchAccountEmail(client: OAuth2Client): Promise<string> {
  const res = await client.request<{ email?: string }>({
    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    timeout: REQUEST_TIMEOUT_MS
  })
  return res.data.email ?? 'Unknown Google account'
}

function driveClientFromRefreshToken(refreshToken: string): drive_v3.Drive {
  const client = makeClient()
  client.setCredentials({ refresh_token: refreshToken })
  return driveApi({ version: 'v3', auth: client })
}

async function findOrCreateBackupFolder(drive: drive_v3.Drive): Promise<string> {
  const existing = await drive.files.list(
    {
      q: `name='${DRIVE_BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )
  const found = existing.data.files?.[0]?.id
  if (found) return found

  const created = await drive.files.create(
    {
      requestBody: {
        name: DRIVE_BACKUP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )
  if (!created.data.id) throw new Error('Google Drive did not return a folder id after creation.')
  return created.data.id
}

/**
 * Uploads every file in `backupDir` into a dated subfolder under the app's Drive
 * backup folder, mirroring the local `PHARMACY_POS_BACKUP_<timestamp>` folder name so
 * Drive backups line up 1:1 with local ones.
 */
export async function uploadBackupFolderToDrive(
  refreshToken: string,
  backupDir: string
): Promise<{ folderId: string; fileCount: number }> {
  const drive = driveClientFromRefreshToken(refreshToken)
  const rootFolderId = await findOrCreateBackupFolder(drive)

  const folderName = backupDir.split(/[/\\]/).filter(Boolean).pop() ?? `backup-${Date.now()}`
  const dated = await drive.files.create(
    {
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      },
      fields: 'id'
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )
  const folderId = dated.data.id
  if (!folderId) throw new Error('Google Drive did not return a folder id for the backup upload.')

  const entries = readdirSync(backupDir, { withFileTypes: true }).filter((e) => e.isFile())
  for (const entry of entries) {
    const filePath = join(backupDir, entry.name)
    try {
      await drive.files.create(
        {
          requestBody: { name: entry.name, parents: [folderId] },
          media: { body: createReadStream(filePath) },
          fields: 'id'
        },
        { timeout: REQUEST_TIMEOUT_MS }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to upload "${entry.name}" to Google Drive: ${message}`)
    }
  }

  return { folderId, fileCount: entries.length }
}

/** Deletes dated backup subfolders older than RETENTION_DAYS, mirroring local retention. */
export async function cleanupExpiredDriveBackups(
  refreshToken: string,
  retentionDays: number
): Promise<void> {
  const drive = driveClientFromRefreshToken(refreshToken)
  const rootFolderId = await findOrCreateBackupFolder(drive)
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

  const list = await drive.files.list(
    {
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, createdTime)',
      spaces: 'drive',
      pageSize: 1000
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )

  for (const file of list.data.files ?? []) {
    if (!file.id || !file.createdTime) continue
    const created = Date.parse(file.createdTime)
    if (Number.isNaN(created) || created >= cutoff) continue
    await drive.files.delete({ fileId: file.id }, { timeout: REQUEST_TIMEOUT_MS })
  }
}
