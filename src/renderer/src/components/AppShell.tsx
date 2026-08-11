import * as React from 'react'
import {
  ShoppingCart,
  Package,
  Users,
  Settings,
  BarChart3,
  Receipt,
  UserCog,
  LogOut,
  Menu,
  X
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useCurrentUser } from '../context/CurrentUserContext'
import { LogoutConfirmModal } from './LogoutConfirmModal'
import { UpdateBanner } from './UpdateBanner'
import vantisLogo from '../assets/vantis-logo.png'
import vantisIcon from '../assets/vantis-icon.png'

export type NavTab =
  'checkout' | 'products' | 'customers' | 'settings' | 'reports' | 'users' | 'sales'

interface AppShellProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: React.ReactNode
}

// Refunds is not a nav tab — it's reached from a button on Checkout, gated by
// manager auth there (see RefundsScreen). Cashiers never see it in the sidebar.
// Past Sales is manager-only too — cashiers only get the Refunds button.
const allNavItems: { id: NavTab; label: string; icon: React.ElementType; managerOnly: boolean }[] =
  [
    { id: 'checkout', label: 'Checkout', icon: ShoppingCart, managerOnly: false },
    { id: 'sales', label: 'Past Sales', icon: Receipt, managerOnly: true },
    { id: 'customers', label: 'Customers', icon: Users, managerOnly: true },
    { id: 'products', label: 'Products', icon: Package, managerOnly: true },
    { id: 'reports', label: 'Reports', icon: BarChart3, managerOnly: true },
    { id: 'settings', label: 'Settings', icon: Settings, managerOnly: true },
    { id: 'users', label: 'Users', icon: UserCog, managerOnly: true }
  ]

export function AppShell({ activeTab, onTabChange, children }: AppShellProps): React.JSX.Element {
  const { user, logout } = useCurrentUser()
  const isManager = user?.role === 'MANAGER'
  const navItems = allNavItems.filter((item) => !item.managerOnly || isManager)

  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [demoMode, setDemoMode] = React.useState(false)

  React.useEffect(() => {
    window.api.settings
      .getDemoMode()
      .then(setDemoMode)
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!mobileMenuOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  const handleLogoutClick = async (): Promise<void> => {
    try {
      const shouldPrompt = await window.api.backup.getPromptOnLogout()
      if (shouldPrompt) {
        setShowLogoutConfirm(true)
      } else {
        await logout()
      }
    } catch {
      // If the setting can't be read, fall back to the safer default: prompt.
      setShowLogoutConfirm(true)
    }
  }

  const handleTabChange = (tab: NavTab): void => {
    onTabChange(tab)
    setMobileMenuOpen(false)
  }

  const navButtonClass = (isActive: boolean, mobile: boolean): string =>
    cn(
      'flex items-center gap-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2',
      mobile
        ? 'min-h-11 w-full rounded-[var(--radius)] px-4 py-3'
        : 'h-16 shrink-0 whitespace-nowrap border-b-2 px-3',
      isActive
        ? mobile
          ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
          : 'border-[var(--primary)] text-[var(--primary)]'
        : mobile
          ? 'text-[var(--secondary-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
          : 'border-transparent text-[var(--secondary-foreground)] hover:text-[var(--foreground)]'
    )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="relative flex h-16 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--card)] px-4 md:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <img src={vantisIcon} alt="" className="icon-9 sm:hidden" />
          <img src={vantisLogo} alt="VantisPOS" className="hidden h-7 w-auto sm:block" />
          {demoMode && (
            <span className="rounded-full border border-[var(--warning)] bg-[var(--warning-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
              Demo Mode
            </span>
          )}
        </div>

        <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={navButtonClass(isActive, false)}
              >
                <Icon className="icon-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          {user && (
            <div className="text-right text-xs text-[var(--muted-foreground)]">
              <div className="font-medium text-[var(--foreground)]">{user.fullName}</div>
              <div>{user.role === 'MANAGER' ? 'Manager' : 'Cashier'} • Station 01</div>
            </div>
          )}
          <button
            onClick={() => void handleLogoutClick()}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors duration-150 hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
          >
            <LogOut className="icon-4" /> Log out
          </button>
        </div>

        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] text-[var(--foreground)] md:hidden"
        >
          {mobileMenuOpen ? <X className="icon-5" /> : <Menu className="icon-5" />}
        </button>

        {mobileMenuOpen && (
          <div className="absolute left-0 right-0 top-16 z-30 border-b border-[var(--border)] bg-[var(--card)] p-4 shadow-sm md:hidden">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => handleTabChange(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={navButtonClass(isActive, true)}
                  >
                    <Icon className="icon-5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
            <div className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-foreground)]">
              {user && (
                <div className="mb-3">
                  <div className="font-medium text-[var(--foreground)]">{user.fullName}</div>
                  <div>{user.role === 'MANAGER' ? 'Manager' : 'Cashier'} • Station 01</div>
                </div>
              )}
              <button
                onClick={() => void handleLogoutClick()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
              >
                <LogOut className="icon-4" /> Log out
              </button>
            </div>
          </div>
        )}
      </header>

      <UpdateBanner />

      <main className="flex-1 overflow-y-auto bg-[var(--background)] p-8">{children}</main>

      {showLogoutConfirm && <LogoutConfirmModal onCancel={() => setShowLogoutConfirm(false)} />}
    </div>
  )
}
