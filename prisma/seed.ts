import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  const roles = ['cashier', 'pharmacist', 'manager']
  for (const name of roles) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
  }

  const manager = await prisma.role.findUniqueOrThrow({ where: { name: 'manager' } })
  await prisma.user.upsert({
    where: { id: 1 },
    update: { name: 'Owner', pin: '0000', roleId: manager.id },
    create: { name: 'Owner', pin: '0000', roleId: manager.id },
  })

  const products = [
    { sku: 'OTC-001', name: 'Ibuprofen 200mg 50ct', costCents: 100, priceCents: 300 },
    { sku: 'OTC-002', name: 'Acetaminophen 500mg 100ct', costCents: 250, priceCents: 500 },
    { sku: 'OTC-003', name: 'Bandages 30ct', costCents: 150, priceCents: 450 },
    { sku: 'OTC-004', name: 'Vitamin D 1000IU 90ct', costCents: 400, priceCents: 800 },
    { sku: 'OTC-005', name: 'Hand Sanitizer 250ml', costCents: 120, priceCents: 360 },
  ]
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: p, create: p })
  }

  const customers = [
    { id: 1, name: 'Jane Doe', phone: '555-0100', email: 'jane@example.com' },
    { id: 2, name: 'John Smith', phone: '555-0101', email: null },
  ]
  for (const c of customers) {
    await prisma.customer.upsert({ where: { id: c.id }, update: c, create: c })
  }

  const flags = [
    { key: 'rewardPoints', label: 'Reward Points', description: 'Dollar/product-based loyalty points.' },
    { key: 'lottery', label: 'Lottery Sales', description: 'Ontario lottery ticket sales & win tracking.' },
    {
      key: 'customerTab',
      label: 'Customer Tab / Store Credit',
      description: 'Short-pay tab and pre-loaded store credit ledger.',
    },
  ]
  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { label: f.label, description: f.description },
      create: { ...f, enabled: false },
    })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
