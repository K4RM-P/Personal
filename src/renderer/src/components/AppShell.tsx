import * as React from 'react'
import { ShoppingCart, Package, Users, Settings } from 'lucide-react'
import { cn } from '../lib/utils'

export type NavTab = 'checkout' | 'products' | 'customers' | 'settings'

interface AppShellProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  children: React.ReactNode
}

const navItems: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: 'checkout', label: 'Checkout', icon: ShoppingCart },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
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
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-[var(--foreground)]">Station 01</span>
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
          </div>
          <div>Offline-ready • Fast checkout</div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[var(--background)] p-8">{children}</main>
    </div>
  )
}
