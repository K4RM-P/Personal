import { PrismaClient } from '@prisma/client'
import {
  CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH,
  type CustomerDisplaySettingsDTO,
  type CustomerDisplaySlideDTO
} from '../../../shared/customerDisplay'
import { getStoreInfo } from './settingsQueries'
import { deleteSlideMediaFiles } from '../../customerDisplay/slideMediaStore'

async function getSetting(db: PrismaClient, key: string, fallback: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? fallback
}

async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

function toSlideType(type: string | undefined): 'TEXT' | 'IMAGE' | 'VIDEO' {
  return type === 'IMAGE' ? 'IMAGE' : type === 'VIDEO' ? 'VIDEO' : 'TEXT'
}

function toDTO(row: {
  id: number
  type: string
  text: string
  imageDataUrl: string | null
  videoFilePath: string | null
  durationSeconds: number | null
  sortOrder: number
}): CustomerDisplaySlideDTO {
  return {
    id: row.id,
    type: toSlideType(row.type),
    text: row.text,
    imageDataUrl: row.imageDataUrl,
    videoFilePath: row.videoFilePath,
    durationSeconds: row.durationSeconds,
    sortOrder: row.sortOrder
  }
}

export async function getCustomerDisplaySlides(
  db: PrismaClient
): Promise<CustomerDisplaySlideDTO[]> {
  const rows = await db.customerDisplaySlide.findMany({ orderBy: { sortOrder: 'asc' } })
  return rows.map(toDTO)
}

/**
 * Replaces the full ordered slide list. `sortOrder` is assigned by array position,
 * so reordering in the UI is just a re-save of the array in the new order. Any
 * video file on disk no longer referenced by the new list (slide deleted, or its
 * video replaced) is cleaned up after the transaction commits.
 */
export async function saveCustomerDisplaySlides(
  db: PrismaClient,
  slides: Array<{
    id?: number
    type?: 'TEXT' | 'IMAGE' | 'VIDEO'
    text: string
    imageDataUrl?: string | null
    videoFilePath?: string | null
    durationSeconds?: number | null
  }>
): Promise<CustomerDisplaySlideDTO[]> {
  for (const s of slides) {
    const type = toSlideType(s.type)
    if (type === 'IMAGE') {
      if (!s.imageDataUrl) throw new Error('Image slide is missing an uploaded image')
    } else if (type === 'VIDEO') {
      if (!s.videoFilePath) throw new Error('Video slide is missing an uploaded video')
    } else {
      const text = s.text?.trim() ?? ''
      if (text.length === 0 || text.length > CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH) {
        throw new Error(`Slide text must be 1-${CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH} characters`)
      }
    }
    if (s.durationSeconds != null && (s.durationSeconds < 1 || s.durationSeconds > 300)) {
      throw new Error('Slide duration must be between 1 and 300 seconds')
    }
  }

  const existing = await db.customerDisplaySlide.findMany({ select: { videoFilePath: true } })
  const existingVideoPaths = new Set(
    existing.map((r) => r.videoFilePath).filter((p): p is string => !!p)
  )
  const keptVideoPaths = new Set(slides.map((s) => s.videoFilePath).filter((p): p is string => !!p))
  const orphanedVideoPaths = [...existingVideoPaths].filter((p) => !keptVideoPaths.has(p))

  const created = await db.$transaction(async (tx) => {
    await tx.customerDisplaySlide.deleteMany()
    const rows: CustomerDisplaySlideDTO[] = []
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      const type = toSlideType(s.type)
      const row = await tx.customerDisplaySlide.create({
        data: {
          type,
          text: s.text?.trim() ?? '',
          imageDataUrl: type === 'IMAGE' ? s.imageDataUrl : null,
          videoFilePath: type === 'VIDEO' ? s.videoFilePath : null,
          durationSeconds: s.durationSeconds ?? null,
          sortOrder: i
        }
      })
      rows.push(toDTO(row))
    }
    return rows
  })

  if (orphanedVideoPaths.length > 0) {
    await deleteSlideMediaFiles(orphanedVideoPaths)
  }

  return created
}

export async function deleteCustomerDisplaySlide(db: PrismaClient, id: number): Promise<void> {
  const row = await db.customerDisplaySlide.findUnique({ where: { id } })
  await db.customerDisplaySlide.delete({ where: { id } })
  if (row?.videoFilePath) {
    await deleteSlideMediaFiles([row.videoFilePath])
  }
}

export async function getCustomerDisplaySettings(
  db: PrismaClient
): Promise<CustomerDisplaySettingsDTO> {
  const [enabled, duration, email, store] = await Promise.all([
    getSetting(db, 'customerDisplay.enabled', 'true'),
    getSetting(db, 'customerDisplay.slideDurationSeconds', '8'),
    getSetting(db, 'customerDisplay.eTransferEmail', ''),
    getStoreInfo(db)
  ])
  return {
    enabled: enabled === 'true',
    slideDurationSeconds: Number(duration) || 8,
    eTransferEmail: email,
    pharmacyName: store.name
  }
}

export async function saveCustomerDisplaySettings(
  db: PrismaClient,
  input: { enabled: boolean; slideDurationSeconds: number; eTransferEmail: string }
): Promise<CustomerDisplaySettingsDTO> {
  const duration = Math.min(120, Math.max(1, Math.round(input.slideDurationSeconds || 8)))
  await Promise.all([
    setSetting(db, 'customerDisplay.enabled', String(input.enabled)),
    setSetting(db, 'customerDisplay.slideDurationSeconds', String(duration)),
    setSetting(db, 'customerDisplay.eTransferEmail', input.eTransferEmail.trim())
  ])
  return getCustomerDisplaySettings(db)
}
