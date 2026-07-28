import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'

export function CheckoutScreen() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Checkout</h1>
        <p className="text-[#94a3b8]">Point of sale cart and checkout interface (Stage 1+2)</p>
      </div>

      <Card className="border-dashed border-[#334155]">
        <CardHeader>
          <CardTitle>Checkout Placeholder</CardTitle>
          <CardDescription>
            Transaction cart, barcode scanning, item lookup, and payment flows will be built in Stage 1 & 2.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
