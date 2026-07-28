import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'

export function CustomersScreen() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Customers</h1>
        <p className="text-[#94a3b8]">Customer profiles, history, and store tab balance (Stage 6)</p>
      </div>

      <Card className="border-dashed border-[#334155]">
        <CardHeader>
          <CardTitle>Customers Placeholder</CardTitle>
          <CardDescription>
            Customer directory, purchase history, and store credit ledger will be built in Stage 6.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
