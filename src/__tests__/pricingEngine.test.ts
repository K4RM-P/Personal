import { describe, it, expect } from 'vitest'
import {
  calculateRetailPriceCents,
  findPricingTier,
  previewTierChangeImpact,
  DEFAULT_PRICING_TIERS,
  PricingTier
} from '../shared/pricingEngine'

describe('Tiered Markup Pricing Engine Unit Tests', () => {
  it('retail = cost × (1 + markup%), no rounding: $1.00 cost at 200% markup = $3.00 exactly', () => {
    // $1.00 = 100 cents. Tier 1 ($0-$3) markup is 200%.
    // $1.00 * (1 + 2.00) = $3.00 (300 cents)
    const costCents = 100
    const priceCents = calculateRetailPriceCents(costCents)
    expect(priceCents).toBe(300)
  })

  it('negative costs (edge case): cost of $-5.00 at 100% markup = $-10.00', () => {
    // $-5.00 = -500 cents. Tier 2 ($3.01-$10) markup is 100%.
    // $-5.00 * (1 + 1.00) = $-10.00 (-1000 cents)
    const costCents = -500
    const priceCents = calculateRetailPriceCents(costCents)
    expect(priceCents).toBe(-1000)
  })

  it('tier boundary crossing: cost of $2.99 in the $0–$3 tier (200% markup) vs. $3.01 in the $3.01–$10 tier (100% markup)', () => {
    // $2.99 = 299 cents -> Tier 1 (200% markup) -> 299 * 3 = 897 cents ($8.97)
    const cost299 = 299
    const tier299 = findPricingTier(cost299)
    expect(tier299?.id).toBe('tier-1')
    expect(tier299?.markupPercent).toBe(200)
    expect(calculateRetailPriceCents(cost299)).toBe(897)

    // $3.01 = 301 cents -> Tier 2 (100% markup) -> 301 * 2 = 602 cents ($6.02)
    const cost301 = 301
    const tier301 = findPricingTier(cost301)
    expect(tier301?.id).toBe('tier-2')
    expect(tier301?.markupPercent).toBe(100)
    expect(calculateRetailPriceCents(cost301)).toBe(602)
  })

  it('tier recalculation: cost moves from $5.00 to $15.00, verify it moves from one tier to another and retail price updates', () => {
    // Initial cost: $5.00 (500 cents) -> Tier 2 (100% markup) -> $10.00 (1000 cents)
    const initialCost = 500
    const initialTier = findPricingTier(initialCost)
    expect(initialTier?.id).toBe('tier-2')
    expect(calculateRetailPriceCents(initialCost)).toBe(1000)

    // Cost update: $15.00 (1500 cents) -> Tier 3 (60% markup) -> 1500 * 1.6 = 2400 cents ($24.00)
    const updatedCost = 1500
    const updatedTier = findPricingTier(updatedCost)
    expect(updatedTier?.id).toBe('tier-3')
    expect(calculateRetailPriceCents(updatedCost)).toBe(2400)
  })

  it('zero markup tier: cost at 0% markup = cost (no markup)', () => {
    const customTiers: PricingTier[] = [
      { id: 'zero-markup', minCostCents: 0, maxCostCents: null, markupPercent: 0 }
    ]
    const costCents = 1250 // $12.50
    const priceCents = calculateRetailPriceCents(costCents, customTiers)
    expect(priceCents).toBe(1250)
  })

  it('tier change impact preview shows affected items and price differences', () => {
    const sampleProducts = [
      { id: 1, sku: 'SKU-1', name: 'Item 1', costCents: 100, priceCents: 300 }, // $1 cost, $3 current
      { id: 2, sku: 'SKU-2', name: 'Item 2', costCents: 500, priceCents: 1000 } // $5 cost, $10 current
    ]

    // Modified tiers: change Tier 1 ($0-$3) markup from 200% to 150%
    const modifiedTiers: PricingTier[] = [
      { id: 'tier-1', minCostCents: 0, maxCostCents: 300, markupPercent: 150 },
      { id: 'tier-2', minCostCents: 301, maxCostCents: 1000, markupPercent: 100 }
    ]

    const impact = previewTierChangeImpact(sampleProducts, modifiedTiers)
    expect(impact).toHaveLength(1)
    expect(impact[0].sku).toBe('SKU-1')
    expect(impact[0].currentPriceCents).toBe(300)
    expect(impact[0].newPriceCents).toBe(250) // $1 * 2.5 = $2.50
    expect(impact[0].priceDiffCents).toBe(-50)
  })
})
