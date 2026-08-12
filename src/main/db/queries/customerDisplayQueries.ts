import { PrismaClient } from '@prisma/client'
import {
  CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH,
  type CustomerDisplaySettingsDTO,
  type CustomerDisplaySlideDTO
} from '../../../shared/customerDisplay'
import { getStoreInfo } from './settingsQueries'

async function getSetting(db: PrismaClient, key: string, fallback: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? fallback
}

async function setSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function getCustomerDisplaySlides(
  db: PrismaClient
): Promise<CustomerDisplaySlideDTO[]> {
  const rows = await db.customerDisplaySlide.findMany({ orderBy: { sortOrder: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    type: r.type === 'IMAGE' ? 'IMAGE' : 'TEXT',
    text: r.text,
    imageDataUrl: r.imageDataUrl,
    sortOrder: r.sortOrder
  }))
}

/**
 * Replaces the full ordered slide list. `sortOrder` is assigned by array position,
 * so reordering in the UI is just a re-save of the array in the new order.
 */
export async function saveCustomerDisplaySlides(
  db: PrismaClient,
  slides: Array<{
    id?: number
    type?: 'TEXT' | 'IMAGE'
    text: string
    imageDataUrl?: string | null
  }>
): Promise<CustomerDisplaySlideDTO[]> {
  for (const s of slides) {
    const type = s.type === 'IMAGE' ? 'IMAGE' : 'TEXT'
    if (type === 'IMAGE') {
      if (!s.imageDataUrl) throw new Error('Image slide is missing an uploaded image')
    } else {
      const text = s.text?.trim() ?? ''
      if (text.length === 0 || text.length > CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH) {
        throw new Error(`Slide text must be 1-${CUSTOMER_DISPLAY_SLIDE_MAX_LENGTH} characters`)
      }
    }
  }
  return db.$transaction(async (tx) => {
    await tx.customerDisplaySlide.deleteMany()
    const created: CustomerDisplaySlideDTO[] = []
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      const type = s.type === 'IMAGE' ? 'IMAGE' : 'TEXT'
      const row = await tx.customerDisplaySlide.create({
        data: {
          type,
          text: s.text?.trim() ?? '',
          imageDataUrl: type === 'IMAGE' ? s.imageDataUrl : null,
          sortOrder: i
        }
      })
      created.push({
        id: row.id,
        type: row.type === 'IMAGE' ? 'IMAGE' : 'TEXT',
        text: row.text,
        imageDataUrl: row.imageDataUrl,
        sortOrder: row.sortOrder
      })
    }
    return created
  })
}

export async function deleteCustomerDisplaySlide(db: PrismaClient, id: number): Promise<void> {
  await db.customerDisplaySlide.delete({ where: { id } })
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
