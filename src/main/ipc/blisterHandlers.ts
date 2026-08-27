import { ipcMain } from 'electron'
import type { PrismaClient } from '@prisma/client'
import { IPC } from '../../shared/channels'
import type {
  CreateBlisterPackInput,
  ListBlisterPacksFilters,
  UpdateBlisterPackInput
} from '../../shared/types'
import {
  createBlisterPack,
  deleteBlisterPack,
  dispenseBlisterPack,
  getPendingBlisterPackForCustomer,
  listBlisterPacks,
  updateBlisterPack
} from '../db/queries/blisterQueries'

export function registerBlisterHandlers(db: PrismaClient): void {
  ipcMain.handle(IPC.BLISTER_LIST, (_e, filters: ListBlisterPacksFilters) =>
    listBlisterPacks(db, {
      dateField: filters?.dateField,
      patientQuery: filters?.patientQuery,
      fromDate: filters?.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters?.toDate ? new Date(filters.toDate) : undefined
    })
  )

  ipcMain.handle(IPC.BLISTER_CREATE, (_e, input: CreateBlisterPackInput) =>
    createBlisterPack(db, {
      ...input,
      prepDate: input.prepDate ? new Date(input.prepDate) : undefined,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      pickupDate: input.pickupDate ? new Date(input.pickupDate) : null
    })
  )

  ipcMain.handle(
    IPC.BLISTER_UPDATE,
    (_e, { id, input }: { id: number; input: UpdateBlisterPackInput }) =>
      updateBlisterPack(db, id, {
        ...input,
        prepDate: input.prepDate ? new Date(input.prepDate) : undefined,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        pickupDate:
          input.pickupDate === undefined
            ? undefined
            : input.pickupDate
              ? new Date(input.pickupDate)
              : null
      })
  )

  ipcMain.handle(IPC.BLISTER_DELETE, (_e, id: number) => deleteBlisterPack(db, id))

  ipcMain.handle(IPC.BLISTER_GET_PENDING_FOR_CUSTOMER, (_e, customerId: number) =>
    getPendingBlisterPackForCustomer(db, customerId)
  )

  ipcMain.handle(
    IPC.BLISTER_DISPENSE,
    (_e, { id, preparedBy }: { id: number; preparedBy: string }) =>
      dispenseBlisterPack(db, id, preparedBy)
  )
}
