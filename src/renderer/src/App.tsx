import React from 'react'
import { AppShell, NavTab } from './components/AppShell'
import { CurrentUserProvider, useCurrentUser } from './context/CurrentUserContext'
import { DensityProvider } from './context/DensityContext'
import { LoginScreen } from './screens/LoginScreen'
import { SetupWizard } from './screens/SetupWizard'
import { useIdleLogout } from './hooks/useIdleLogout'

// Screens are code-split so the initial render only parses/mounts the active
// tab. The other screens load on first navigation, cutting startup cost.
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
const ReportsScreen = React.lazy(() =>
  import('./screens/ReportsScreen').then((m) => ({ default: m.ReportsScreen }))
)
const UsersScreen = React.lazy(() =>
  import('./screens/UsersScreen').then((m) => ({ default: m.UsersScreen }))
)
const SalesHistoryScreen = React.lazy(() =>
  import('./screens/SalesHistoryScreen').then((m) => ({ default: m.SalesHistoryScreen }))
)

const MANAGER_ONLY: NavTab[] = ['products', 'customers', 'settings', 'reports', 'users', 'sales']

function PermissionDenied(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-[var(--radius)] border border-[var(--error)]/30 bg-[var(--error-bg)] px-6 py-4 text-center text-sm text-[var(--error)]">
        You don&apos;t have permission to access this feature
      </div>
    </div>
  )
}

function AuthedApp(): React.JSX.Element {
  const { user, logout } = useCurrentUser()
  const isManager = user?.role === 'MANAGER'
  // A POS opens to the register, not to settings.
  const [activeTab, setActiveTab] = React.useState<NavTab>('checkout')

  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = React.useState<number | null>(null)
  React.useEffect(() => {
    window.api.settings
      .getIdleTimeoutMinutes()
      .then(setIdleTimeoutMinutes)
      .catch(() => setIdleTimeoutMinutes(0))
  }, [])
  const handleIdle = React.useCallback((): void => {
    void logout()
  }, [logout])
  useIdleLogout(idleTimeoutMinutes, handleIdle)

  const canAccess = (tab: NavTab): boolean => (MANAGER_ONLY.includes(tab) ? isManager : true)

  const renderTab = (): React.ReactNode => {
    // Defense in depth: even if a manager-only tab is somehow active for a
    // cashier, gate the render as well as the nav.
    if (!canAccess(activeTab)) return <PermissionDenied />
    switch (activeTab) {
      case 'checkout':
        return <CheckoutScreen />
      case 'sales':
        return <SalesHistoryScreen />
      case 'products':
        return <ProductsScreen />
      case 'customers':
        return <CustomersScreen />
      case 'settings':
        return <SettingsScreen />
      case 'reports':
        return <ReportsScreen />
      case 'users':
        return <UsersScreen />
      default:
        return <CheckoutScreen />
    }
  }

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      <React.Suspense fallback={null}>{renderTab()}</React.Suspense>
    </AppShell>
  )
}

function Gate(): React.JSX.Element | null {
  const { user } = useCurrentUser()
  const [firstBoot, setFirstBoot] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    void (async () => {
      try {
        setFirstBoot(await window.api.auth.checkFirstBoot())
      } catch {
        setFirstBoot(false)
      }
    })()
  }, [user])

  if (firstBoot === null) return null // brief boot check
  if (firstBoot && !user) return <SetupWizard />
  if (!user) return <LoginScreen />
  return <AuthedApp />
}

export function App(): React.JSX.Element {
  return (
    <CurrentUserProvider>
      <DensityProvider>
        <Gate />
      </DensityProvider>
    </CurrentUserProvider>
  )
}
