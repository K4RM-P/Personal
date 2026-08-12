import { PrismaClient } from '@prisma/client'
import nodemailer from 'nodemailer'
import {
  getReportEmailSettingsInternal,
  recordReportEmailSent
} from '../db/queries/settingsQueries'
import { buildReportEmailDigest } from './reportEmailTemplate'

/** Sends the current report digest to the configured recipient using the manager's SMTP settings. */
export async function sendReportDigestNow(
  db: PrismaClient
): Promise<{ ok: boolean; message: string }> {
  const settings = await getReportEmailSettingsInternal(db)
  if (!settings.recipientEmail.trim()) {
    return { ok: false, message: 'No recipient email is configured.' }
  }
  if (!settings.smtpHost.trim()) {
    return { ok: false, message: 'No SMTP host is configured.' }
  }

  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUsername
      ? { user: settings.smtpUsername, pass: settings.smtpPassword }
      : undefined
  })

  const { subject, html } = await buildReportEmailDigest(db, settings.interval)

  try {
    await transport.sendMail({
      from: settings.smtpFromAddress || settings.smtpUsername,
      to: settings.recipientEmail,
      subject,
      html
    })
    await recordReportEmailSent(db, new Date())
    return { ok: true, message: `Sent to ${settings.recipientEmail}.` }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to send report email.'
    }
  }
}
