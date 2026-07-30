import React from 'react'
import { AppShell, NavTab } from './components/AppShell'

// Screens are code-split so the initial render only parses/mounts the active
// tab (checkout). The other screens load on first navigation, cutting the
// renderer's startup cost and first paint.
const CheckoutScreen = React.lazy(() =>
  import('./screens/CheckoutScreen').then((m) => ({ default: m.CheckoutScreen }))
)
const ProductsScreen = React.lazy(() =>
  import('./screens/ProductsScreen').then((m) => ({ default: m.ProductsScreen }))
)
const CustomersScreen = React.lazy(() =>
  import('./screens/CustomersScreen').then((m) => ({ default: m.CustomersScreen }))
)
const SettingsScreen = React.lazy(() =>
  import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
)

export function App(): React.JSX.Element {
  // A POS opens to the register, not to settings.
  const [activeTab, setActiveTab] = React.useState<NavTab>('checkout')

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      <React.Suspense fallback={null}>
        {activeTab === 'checkout' && <CheckoutScreen />}
        {activeTab === 'products' && <ProductsScreen />}
        {activeTab === 'customers' && <CustomersScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </React.Suspense>
    </AppShell>
  )
}
