export function formatCurrency(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = (abs % 100).toString().padStart(2, '0')
  return `${negative ? '-' : ''}$${dollars}.${remainder}`
}
