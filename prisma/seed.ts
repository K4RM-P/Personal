import { PrismaClient } from '@prisma/client'
import { DEFAULT_PRICING_TIERS } from '../src/shared/pricingEngine'
import { seedDefaultSettings } from '../src/main/db/queries/settingsQueries'

const prisma = new PrismaClient()

async function main() {
  // Feature flags
  const flags = [
    {
      key: 'otcMode',
      label: 'OTC-Only Mode',
      description: 'Hide prescription workflow and operate strictly as OTC retail POS.',
      enabled: false
    },
    {
      key: 'lowStockAlerts',
      label: 'Low-Stock Alerts',
      description: 'Show warning badge and alerts when product stock falls below minimum threshold.',
      enabled: true
    },
    {
      key: 'customerLookup',
      label: 'Customer Lookup',
      description: 'Enable searching and linking customer profiles at checkout.',
      enabled: false
    }
  ]

  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { label: f.label, description: f.description },
      create: f
    })
  }

  // Pricing Tiers
  for (let i = 0; i < DEFAULT_PRICING_TIERS.length; i++) {
    const tier = DEFAULT_PRICING_TIERS[i]
    await prisma.pricingTier.upsert({
      where: { id: tier.id },
      update: {
        minCostCents: tier.minCostCents,
        maxCostCents: tier.maxCostCents,
        markupPercent: tier.markupPercent,
        orderIndex: i
      },
      create: {
        id: tier.id,
        minCostCents: tier.minCostCents,
        maxCostCents: tier.maxCostCents,
        markupPercent: tier.markupPercent,
        orderIndex: i
      }
    })
  }

  // Seed Products
  const products = [
    { sku: 'OTC-001', name: 'Ibuprofen 200mg 50ct', costCents: 100, priceCents: 300, barcode: '012345678901' },
    { sku: 'OTC-002', name: 'Acetaminophen 500mg 100ct', costCents: 250, priceCents: 750, barcode: '012345678902' },
    { sku: 'OTC-003', name: 'Bandages 30ct', costCents: 150, priceCents: 450, barcode: '012345678903' },
    { sku: 'OTC-004', name: 'Vitamin D 1000IU 90ct', costCents: 400, priceCents: 800, barcode: '012345678904' },
    { sku: 'OTC-005', name: 'Hand Sanitizer 250ml', costCents: 120, priceCents: 360, barcode: '012345678905' }
  ]

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: p,
      create: p
    })
  }

  // Seed Customers
  const customers = [
    { id: 1, name: 'Jane Doe', phone: '555-0100', email: 'jane@example.com' },
    { id: 2, name: 'John Smith', phone: '555-0101', email: 'john@example.com' }
  ]

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: c,
      create: c
    })
  }

  await seedDefaultSettings(prisma)

  console.log('Database seeded successfully with Stage 1+2+3+4 data.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
