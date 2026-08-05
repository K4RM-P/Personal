import * as React from 'react'
import { ShoppingCart, Package, Users, Settings, BarChart3, Receipt, UserCog, LogOut } from 'lucide-react'
import { cn } from '../lib/utils'
import { useCurrentUser } from '../context/CurrentUserContext'
import { LogoutConfirmModal } from './LogoutConfirmModal'

export type NavTab = 'checkout' | 'products' | 'customers' | 'settings' | 'reports' | 'users' | 'sales'

interface AppShellProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: React.ReactNode
}

// Refunds is not a nav tab — it's reached from a button on Checkout, gated by
// manager auth there (see RefundsScreen). Cashiers never see it in the sidebar.
// Past Sales is manager-only too — cashiers only get the Refunds button.
const allNavItems: { id: NavTab; label: string; icon: React.ElementType; managerOnly: boolean }[] = [
  { id: 'checkout', label: 'Checkout', icon: ShoppingCart, managerOnly: false },
  { id: 'sales', label: 'Past Sales', icon: Receipt, managerOnly: true },
  { id: 'customers', label: 'Customers', icon: Users, managerOnly: true },
  { id: 'products', label: 'Products', icon: Package, managerOnly: true },
  { id: 'reports', label: 'Reports', icon: BarChart3, managerOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings, managerOnly: true },
  { id: 'users', label: 'Users', icon: UserCog, managerOnly: true }
]

export function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
  const { user, logout } = useCurrentUser()
  const isManager = user?.role === 'MANAGER'
  const navItems = allNavItems.filter((item) => !item.managerOnly || isManager)

  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false)

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <aside className="flex w-64 flex-col justify-between border-r border-[var(--border)] bg-[#f8fafb]">
        <div>
          <div className="border-b border-[var(--border)] p-6">
            <div className="flex items-center space-x-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] font-bold text-[var(--primary-foreground)]">
                Rx
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight text-[var(--foreground)]">PharmaPOS</h1>
                <p className="text-xs text-[var(--muted-foreground)]">Pharmacy Management</p>
              </div>
            </div>
          </div>

          <nav className="space-y-1 p-4">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id

              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    'flex w-full items-center space-x-3 rounded-[var(--radius)] px-4 py-3 text-sm font-medium',
                    isActive
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'text-[var(--secondary-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        <div className="border-t border-[var(--border)] p-4 text-xs text-[var(--muted-foreground)]">
          {user && (
            <div className="mb-3">
              <div className="font-medium text-[var(--foreground)]">{user.fullName}</div>
              <div className="text-[var(--muted-foreground)]">{user.role === 'MANAGER' ? 'Manager' : 'Cashier'} • Station 01</div>
            </div>
          )}
          <button
            onClick={() => void handleLogoutClick()}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[var(--background)] p-8">{children}</main>

      {showLogoutConfirm && <LogoutConfirmModal onCancel={() => setShowLogoutConfirm(false)} />}
    </div>
  )
}