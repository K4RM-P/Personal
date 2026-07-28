export interface PricingTier {
  id: string
  minCostCents: number
  maxCostCents: number | null // null means no upper bound (e.g. $30.01+)
  markupPercent: number
}

/**
 * Default pricing tier configuration:
 * $0.00 – $3.00: 200% markup
 * $3.01 – $10.00: 100% markup
 * $10.01 – $30.00: 60% markup
 * $30.01+: 30% markup
 */
export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  { id: 'tier-1', minCostCents: 0, maxCostCents: 300, markupPercent: 200 },
  { id: 'tier-2', minCostCents: 301, maxCostCents: 1000, markupPercent: 100 },
  { id: 'tier-3', minCostCents: 1001, maxCostCents: 3000, markupPercent: 60 },
  { id: 'tier-4', minCostCents: 3001, maxCostCents: null, markupPercent: 30 }
]

/**
 * Calculates retail price in cents using exact formula: cost × (1 + markup%)
 * NO ROUNDING to price endings. Sub-cent results are rounded using Math.round.
 */
export function calculateRetailPriceCents(
  costCents: number,
  tiers: PricingTier[] = DEFAULT_PRICING_TIERS
): number {
  if (tiers.length === 0) {
    return costCents
  }

  const absCost = Math.abs(costCents)

  // Find matching tier
  const matchedTier = tiers.find((tier) => {
    if (tier.maxCostCents === null) {
      return absCost >= tier.minCostCents
    }
    return absCost >= tier.minCostCents && absCost <= tier.maxCostCents
  })

  const markupPercent = matchedTier ? matchedTier.markupPercent : 0
  const retailAbs = Math.round(absCost * (1 + markupPercent / 100))

  return costCents < 0 ? -retailAbs : retailAbs
}

/**
 * Finds which tier a given cost falls into.
 */
export function findPricingTier(
  costCents: number,
  tiers: PricingTier[] = DEFAULT_PRICING_TIERS
): PricingTier | undefined {
  const absCost = Math.abs(costCents)
  return tiers.find((tier) => {
    if (tier.maxCostCents === null) {
      return absCost >= tier.minCostCents
    }
    return absCost >= tier.minCostCents && absCost <= tier.maxCostCents
  })
}

export interface TierChangePreviewItem {
  productId: number
  sku: string
  name: string
  costCents: number
  currentPriceCents: number
  newPriceCents: number
  priceDiffCents: number
}

/**
 * Preview impact of changing tier table on a product catalog
 */
export function previewTierChangeImpact(
  products: { id: number; sku: string; name: string; costCents: number; priceCents: number }[],
  newTiers: PricingTier[]
): TierChangePreviewItem[] {
  return products
    .map((product) => {
      const newPriceCents = calculateRetailPriceCents(product.costCents, newTiers)
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        costCents: product.costCents,
        currentPriceCents: product.priceCents,
        newPriceCents,
        priceDiffCents: newPriceCents - product.priceCents
      }
    })
    .filter((item) => item.priceDiffCents !== 0)
}
