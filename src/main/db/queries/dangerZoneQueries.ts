import { PrismaClient } from '@prisma/client'

/**
 * Full factory-reset wipe — every row in every table, in FK-dependency order
 * (children before parents) so this works regardless of whether SQLite
 * foreign-key enforcement is on. Wrapped in a single transaction: either the
 * whole store resets or nothing does.
 */
export async function wipeAllData(db: PrismaClient): Promise<void> {
  await db.$transaction([
    db.transactionItem.deleteMany(),
    db.discount.deleteMany(),
    db.refund.deleteMany(),
    db.inventoryAdjustment.deleteMany(),
    db.creditLedgerEntry.deleteMany(),
    db.loyaltyPointEvent.deleteMany(),
    db.catalogDeal.deleteMany(),
    db.backupLog.deleteMany(),
    db.transaction.deleteMany(),
    db.catalogProduct.deleteMany(),
    db.customerDisplaySlide.deleteMany(),
    db.pricingTier.deleteMany(),
    db.product.deleteMany(),
    db.customer.deleteMany(),
    db.catalogImportBatch.deleteMany(),
    db.user.deleteMany(),
    db.featureFlag.deleteMany(),
    db.setting.deleteMany()
  ])
}
