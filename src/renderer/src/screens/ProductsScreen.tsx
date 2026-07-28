import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card'

export function ProductsScreen() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Products</h1>
        <p className="text-[#94a3b8]">Inventory, pricing tiers, and stock management (Stage 1+2)</p>
      </div>

      <Card className="border-dashed border-[#334155]">
        <CardHeader>
          <CardTitle>Products & Inventory Placeholder</CardTitle>
          <CardDescription>
            Product catalog CRUD, pricing tier calculations, and barcode management will be built in Stage 1 & 2.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
