import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
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

  console.log('Database seeded successfully.')
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
