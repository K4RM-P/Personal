import React from 'react'
import { AppShell, NavTab } from './components/AppShell'
import { CheckoutScreen } from './screens/CheckoutScreen'
import { ProductsScreen } from './screens/ProductsScreen'
import { CustomersScreen } from './screens/CustomersScreen'
import { SettingsScreen } from './screens/SettingsScreen'

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = React.useState<NavTab>('settings')

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'checkout' && <CheckoutScreen />}
      {activeTab === 'products' && <ProductsScreen />}
      {activeTab === 'customers' && <CustomersScreen />}
      {activeTab === 'settings' && <SettingsScreen />}
    </AppShell>
  )
}
