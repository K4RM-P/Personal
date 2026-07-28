import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../shared/formatCurrency'

describe('formatCurrency', () => {
  it('formats positive cents to dollars string', () => {
    expect(formatCurrency(0)).toBe('$0.00')
    expect(formatCurrency(1)).toBe('$0.01')
    expect(formatCurrency(100)).toBe('$1.00')
    expect(formatCurrency(1999)).toBe('$19.99')
  })

  it('formats negative cents with leading minus outside currency symbol', () => {
    expect(formatCurrency(-1)).toBe('-$0.01')
    expect(formatCurrency(-450)).toBe('-$4.50')
    expect(formatCurrency(-1000)).toBe('-$10.00')
  })
})
