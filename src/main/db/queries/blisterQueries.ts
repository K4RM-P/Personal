import type { Prisma, PrismaClient } from '@prisma/client'

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
  intervalDays: number
  prepDate?: Date
  dueDate?: Date
  pickupDate?: Date | null
  numPrescriptions: number
  preparedBy: string
}

export type UpdateBlisterPackInput = Partial<CreateBlisterPackInput>

/**
 * Fills in whichever of prep/due date wasn't explicitly given, per the
 * standing rule that prep date = due date - 7 days. If only a pickup date is
 * given (e.g. backfilling a historical record), due date is derived as
 * pickup + intervalDays. At least one of the three dates must be given.
 */
function resolveDates(
  input: { prepDate?: Date; dueDate?: Date; pickupDate?: Date | null },
  intervalDays: number
): { prepDate: Date; dueDate: Date; pickupDate: Date | null } {
  let dueDate = input.dueDate
  if (!dueDate) {
    if (input.prepDate) {
      dueDate = addDays(input.prepDate, PREP_LEAD_DAYS)
    } else if (input.pickupDate) {
      dueDate = addDays(input.pickupDate, intervalDays)
    } else {
      throw new Error('Provide at least a prep date, due date, or pickup date.')
    }
  }
  const prepDate = input.prepDate ?? computePrepDate(dueDate)
  const pickupDate = input.pickupDate ?? null
  return { prepDate, dueDate, pickupDate }
}

export async function createBlisterPack(db: PrismaClient, data: CreateBlisterPackInput) {
  const { prepDate, dueDate, pickupDate } = resolveDates(data, data.intervalDays)
  return db.blisterPack.create({
    data: {
      customerId: data.customerId,
      intervalDays: data.intervalDays,
      prepDate,
      dueDate,
      pickupDate,
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
  const intervalDays = data.intervalDays ?? existing.intervalDays

  let dueDate = data.dueDate ?? existing.dueDate
  let prepDate: Date
  if (data.prepDate) {
    prepDate = data.prepDate
  } else if (data.dueDate) {
    // Due date explicitly changed and prep wasn't — recompute from the rule.
    prepDate = computePrepDate(dueDate)
  } else {
    prepDate = existing.prepDate
  }
  if (!data.dueDate && !data.prepDate && data.pickupDate === undefined) {
    dueDate = existing.dueDate
  }

  return db.blisterPack.update({
    where: { id },
    data: {
      customerId: data.customerId ?? existing.customerId,
      intervalDays,
      prepDate,
      dueDate,
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
    const nextDueDate = addDays(pickupDate, pending.intervalDays)
    const next = await tx.blisterPack.create({
      data: {
        customerId: pending.customerId,
        intervalDays: pending.intervalDays,
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
