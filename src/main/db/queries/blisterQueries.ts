import type { Prisma, PrismaClient } from '@prisma/client'
import type { BlisterFrequency } from '../../../shared/types'

const FREQUENCY_DAYS: Record<BlisterFrequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 28
}

const PREP_LEAD_DAYS = 7

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function computePrepDate(dueDate: Date): Date {
  return addDays(dueDate, -PREP_LEAD_DAYS)
}

const blisterInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } }
}

export type CreateBlisterPackInput = {
  customerId: number
  frequency: BlisterFrequency
  dueDate: Date
  numPrescriptions: number
  preparedBy: string
}

export type UpdateBlisterPackInput = Partial<CreateBlisterPackInput> & {
  pickupDate?: Date | null
}

export async function createBlisterPack(db: PrismaClient, data: CreateBlisterPackInput) {
  return db.blisterPack.create({
    data: {
      customerId: data.customerId,
      frequency: data.frequency,
      dueDate: data.dueDate,
      prepDate: computePrepDate(data.dueDate),
      numPrescriptions: data.numPrescriptions,
      preparedBy: data.preparedBy
    },
    include: blisterInclude
  })
}

export async function updateBlisterPack(
  db: PrismaClient,
  id: number,
  data: UpdateBlisterPackInput
) {
  const existing = await db.blisterPack.findUniqueOrThrow({ where: { id } })
  const dueDate = data.dueDate ?? existing.dueDate
  return db.blisterPack.update({
    where: { id },
    data: {
      customerId: data.customerId ?? existing.customerId,
      frequency: data.frequency ?? existing.frequency,
      dueDate,
      prepDate: computePrepDate(dueDate),
      numPrescriptions: data.numPrescriptions ?? existing.numPrescriptions,
      preparedBy: data.preparedBy ?? existing.preparedBy,
      pickupDate: data.pickupDate === undefined ? existing.pickupDate : data.pickupDate
    },
    include: blisterInclude
  })
}

export async function deleteBlisterPack(db: PrismaClient, id: number): Promise<void> {
  await db.blisterPack.delete({ where: { id } })
}

export type BlisterDateField = 'prep' | 'due' | 'pickup'

export type ListBlisterPacksFilters = {
  dateField?: BlisterDateField
  fromDate?: Date
  toDate?: Date
  patientQuery?: string
}

const DATE_COLUMN: Record<BlisterDateField, 'prepDate' | 'dueDate' | 'pickupDate'> = {
  prep: 'prepDate',
  due: 'dueDate',
  pickup: 'pickupDate'
}

export async function listBlisterPacks(db: PrismaClient, filters: ListBlisterPacksFilters = {}) {
  const { dateField, fromDate, toDate, patientQuery } = filters

  const where: Prisma.BlisterPackWhereInput = {}

  if (dateField && (fromDate || toDate)) {
    const column = DATE_COLUMN[dateField]
    where[column] = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {})
    }
  }

  if (patientQuery?.trim()) {
    const term = patientQuery.trim()
    where.customer = {
      OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }]
    }
  }

  return db.blisterPack.findMany({
    where,
    include: blisterInclude,
    orderBy: { dueDate: 'desc' }
  })
}

export async function getPendingBlisterPackForCustomer(db: PrismaClient, customerId: number) {
  return db.blisterPack.findFirst({
    where: { customerId, pickupDate: null },
    include: blisterInclude,
    orderBy: { dueDate: 'asc' }
  })
}

export async function dispenseBlisterPack(
  db: PrismaClient,
  id: number,
  preparedByInitials: string
) {
  return db.$transaction(async (tx) => {
    const pending = await tx.blisterPack.findUniqueOrThrow({ where: { id } })
    if (pending.pickupDate) {
      throw new Error('This blister pack has already been picked up.')
    }
    const pickupDate = new Date()
    const dispensed = await tx.blisterPack.update({
      where: { id },
      data: { pickupDate, preparedBy: preparedByInitials },
      include: blisterInclude
    })
    const frequency = pending.frequency as BlisterFrequency
    const nextDueDate = addDays(pickupDate, FREQUENCY_DAYS[frequency])
    const next = await tx.blisterPack.create({
      data: {
        customerId: pending.customerId,
        frequency: pending.frequency,
        dueDate: nextDueDate,
        prepDate: computePrepDate(nextDueDate),
        numPrescriptions: pending.numPrescriptions,
        preparedBy: ''
      },
      include: blisterInclude
    })
    return { dispensed, next }
  })
}
