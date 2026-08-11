import type { Customer, PrismaClient, Product } from '@prisma/client'
import { hashPassword } from '../auth/password'
import { normalizePhone } from './queries/customerQueries'
import { seedDefaultSettings } from './queries/settingsQueries'

const DEMO_CUSTOMERS = [
  {
    firstName: 'Olivia',
    lastName: 'Bennett',
    phone: '416-555-0142',
    address: '18 Maple St, Toronto',
    email: 'olivia.bennett@example.com'
  },
  {
    firstName: 'Liam',
    lastName: 'Carter',
    phone: '416-555-0187',
    address: '204 Queen St W, Toronto',
    email: 'liam.carter@example.com'
  },
  {
    firstName: 'Sophia',
    lastName: 'Nguyen',
    phone: '647-555-0113',
    address: '55 Bloor St E, Toronto',
    email: 'sophia.nguyen@example.com'
  },
  {
    firstName: 'Noah',
    lastName: 'Thompson',
    phone: '647-555-0176',
    address: '9 Elm Ave, Etobicoke',
    email: 'noah.thompson@example.com'
  },
  {
    firstName: 'Ava',
    lastName: 'Rodriguez',
    phone: '905-555-0129',
    address: '312 Kingston Rd, Scarborough',
    email: 'ava.rodriguez@example.com'
  },
  {
    firstName: 'Ethan',
    lastName: 'Patel',
    phone: '905-555-0164',
    address: '77 Yonge St, Toronto',
    email: 'ethan.patel@example.com'
  },
  {
    firstName: 'Mia',
    lastName: 'Kowalski',
    phone: '416-555-0198',
    address: '140 Dundas St W, Toronto',
    email: 'mia.kowalski@example.com'
  },
  {
    firstName: 'James',
    lastName: 'Anderson',
    phone: '416-555-0155',
    address: '22 King St E, Toronto',
    email: 'james.anderson@example.com'
  },
  {
    firstName: 'Charlotte',
    lastName: 'Mitchell',
    phone: '647-555-0122',
    address: '5 Harbour Sq, Toronto',
    email: 'charlotte.mitchell@example.com'
  },
  {
    firstName: 'Benjamin',
    lastName: 'Osei',
    phone: '647-555-0181',
    address: '88 College St, Toronto',
    email: 'benjamin.osei@example.com'
  },
  {
    firstName: 'Amelia',
    lastName: 'Singh',
    phone: '905-555-0147',
    address: '410 Steeles Ave, Markham',
    email: 'amelia.singh@example.com'
  },
  {
    firstName: 'Lucas',
    lastName: 'Fontaine',
    phone: '905-555-0133',
    address: '19 Lakeshore Blvd, Mississauga',
    email: 'lucas.fontaine@example.com'
  },
  {
    firstName: 'Isabella',
    lastName: 'Wright',
    phone: '416-555-0169',
    address: '63 Spadina Ave, Toronto',
    email: 'isabella.wright@example.com'
  },
  {
    firstName: 'Henry',
    lastName: 'Okafor',
    phone: '647-555-0158',
    address: '31 Danforth Ave, Toronto',
    email: 'henry.okafor@example.com'
  }
]

// Deliberately generic snack/retail items, never sourced from McKesson, so a
// later WEBCAT import (origin: CATALOG) can never collide with or overwrite them.
const DEMO_PRODUCTS = [
  {
    sku: 'DEMO-001',
    name: 'KitKat 4-Finger Bar',
    costCents: 90,
    priceCents: 199,
    barcode: '060383719021'
  },
  {
    sku: 'DEMO-002',
    name: 'Häagen-Dazs Vanilla Ice Cream 460ml',
    costCents: 450,
    priceCents: 799,
    barcode: '074570017007'
  },
  {
    sku: 'DEMO-003',
    name: 'Crush Orange Soda 355ml Can',
    costCents: 65,
    priceCents: 175,
    barcode: '067000010012'
  },
  {
    sku: 'DEMO-004',
    name: 'Coca-Cola 500ml Bottle',
    costCents: 90,
    priceCents: 249,
    barcode: '067000004011'
  },
  {
    sku: 'DEMO-005',
    name: "Lay's Classic Potato Chips 40g",
    costCents: 55,
    priceCents: 199,
    barcode: '060410015012'
  },
  {
    sku: 'DEMO-006',
    name: 'Snickers Bar 52g',
    costCents: 85,
    priceCents: 189,
    barcode: '040000422911'
  },
  {
    sku: 'DEMO-007',
    name: "Reese's Peanut Butter Cups 2pk",
    costCents: 85,
    priceCents: 189,
    barcode: '034000021014'
  },
  {
    sku: 'DEMO-008',
    name: 'Doritos Nacho Cheese 55g',
    costCents: 60,
    priceCents: 210,
    barcode: '060410017016'
  },
  {
    sku: 'DEMO-009',
    name: 'Gatorade Blue 591ml',
    costCents: 110,
    priceCents: 279,
    barcode: '052000134216'
  },
  {
    sku: 'DEMO-010',
    name: 'Red Bull Energy Drink 250ml',
    costCents: 175,
    priceCents: 349,
    barcode: '090162001670'
  },
  {
    sku: 'DEMO-011',
    name: 'Tim Hortons Timbits 10pk',
    costCents: 300,
    priceCents: 599,
    barcode: '062700100107'
  },
  {
    sku: 'DEMO-012',
    name: 'Trident Spearmint Gum 14pc',
    costCents: 90,
    priceCents: 249,
    barcode: '012546601029'
  },
  {
    sku: 'DEMO-013',
    name: 'Pringles Original 156g',
    costCents: 195,
    priceCents: 399,
    barcode: '038000846908'
  },
  {
    sku: 'DEMO-014',
    name: 'Nestle Pure Life Water 500ml',
    costCents: 40,
    priceCents: 149,
    barcode: '055000011012'
  },
  {
    sku: 'DEMO-015',
    name: 'Oreo Original Cookies 145g',
    costCents: 210,
    priceCents: 429,
    barcode: '066721002926'
  },
  {
    sku: 'DEMO-016',
    name: "Ben & Jerry's Chocolate Fudge Brownie 458ml",
    costCents: 480,
    priceCents: 899,
    barcode: '076840100104'
  },
  {
    sku: 'DEMO-017',
    name: 'Skittles Original 61.5g',
    costCents: 80,
    priceCents: 189,
    barcode: '040000422898'
  },
  {
    sku: 'DEMO-018',
    name: 'A&W Root Beer 355ml Can',
    costCents: 65,
    priceCents: 175,
    barcode: '067000010036'
  },
  {
    sku: 'DEMO-019',
    name: 'Starbucks Frappuccino 281ml',
    costCents: 210,
    priceCents: 449,
    barcode: '762111228309'
  },
  {
    sku: 'DEMO-020',
    name: 'Nature Valley Granola Bars 2pk',
    costCents: 100,
    priceCents: 249,
    barcode: '016000455205'
  }
]

const TENDER_TYPES = ['CASH', 'CARD', 'CARD', 'E_TRANSFER'] as const

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/** Populates the demo database on first activation: 2 users, 14 customers, 20 products, ~60 sales over 30 days. */
export async function seedDemoDatabase(db: PrismaClient): Promise<void> {
  await seedDefaultSettings(db)

  const managerPasswordHash = await hashPassword('12345678')
  const cashierPasswordHash = await hashPassword('12345678')
  const manager = await db.user.upsert({
    where: { fullName: 'Manager' },
    update: {},
    create: { fullName: 'Manager', passwordHash: managerPasswordHash, role: 'MANAGER' }
  })
  const cashier = await db.user.upsert({
    where: { fullName: 'Cashier' },
    update: {},
    create: { fullName: 'Cashier', passwordHash: cashierPasswordHash, role: 'CASHIER' }
  })

  const customers: Customer[] = []
  for (const c of DEMO_CUSTOMERS) {
    const customer = await db.customer.create({
      data: {
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        phoneNormalized: normalizePhone(c.phone),
        address: c.address,
        email: c.email,
        createdByUserId: manager.id
      }
    })
    customers.push(customer)
  }

  const products: Product[] = []
  for (const p of DEMO_PRODUCTS) {
    const product = await db.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        costCents: p.costCents,
        priceCents: p.priceCents,
        barcode: p.barcode,
        origin: 'MANUAL',
        currentOnHand: 100,
        reorderPoint: 10
      }
    })
    products.push(product)
  }

  // Deterministic pseudo-random spread of ~60 sales across the last 30 days so
  // reruns of the app in demo mode don't keep growing the seed data.
  const rand = seededRandom(20260811)
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(rand() * 30)
    const hour = 9 + Math.floor(rand() * 10)
    const createdAt = new Date(now - daysAgo * dayMs)
    createdAt.setHours(hour, Math.floor(rand() * 60), 0, 0)

    const itemCount = 1 + Math.floor(rand() * 4)
    const chosenProducts = Array.from(
      { length: itemCount },
      () => products[Math.floor(rand() * products.length)]
    )
    const tenderType = TENDER_TYPES[Math.floor(rand() * TENDER_TYPES.length)]
    const cashier_ = rand() > 0.5 ? manager : cashier
    const attachCustomer = rand() > 0.4
    const customer = attachCustomer ? customers[Math.floor(rand() * customers.length)] : null

    const subtotalCents = chosenProducts.reduce((sum, p) => sum + p.priceCents, 0)
    const taxCents = Math.round(subtotalCents * 0.13)
    const totalCents = subtotalCents + taxCents
    const tenderedCents = tenderType === 'CASH' ? totalCents + (rand() > 0.7 ? 500 : 0) : totalCents
    const changeCents = tenderType === 'CASH' ? tenderedCents - totalCents : 0

    const transaction = await db.transaction.create({
      data: {
        receiptNumber: `DEMO-${String(i + 1).padStart(4, '0')}`,
        status: 'COMPLETED',
        subtotalCents,
        taxCents,
        totalCents,
        tenderType,
        tenderedCents,
        changeCents,
        customerId: customer?.id ?? null,
        userId: cashier_.id,
        cashierId: cashier_.id,
        createdAt,
        updatedAt: createdAt
      }
    })

    for (const p of chosenProducts) {
      await db.transactionItem.create({
        data: {
          transactionId: transaction.id,
          productId: p.id,
          quantity: 1,
          costCents: p.costCents,
          unitPriceCents: p.priceCents,
          totalCents: p.priceCents,
          hstApplied: true
        }
      })
    }
  }
}
