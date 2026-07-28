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
    <div className="flex h-screen w-screen overflow-hidden bg-[#0f172a] text-[#f8fafc]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#334155] bg-[#1e293b] flex flex-col justify-between">
        <div>
          {/* Logo / Header */}
          <div className="p-6 border-b border-[#334155]">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-[#0d9488] flex items-center justify-center font-bold text-white shadow-md">
                Rx
              </div>
              <div>
                <h1 className="font-bold text-lg leading-tight text-white">PharmaPOS</h1>
                <p className="text-xs text-[#94a3b8]">Pharmacy Management</p>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id

              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    'w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-[#0d9488] text-white shadow-sm'
                      : 'text-[#94a3b8] hover:bg-[#334155]/50 hover:text-white'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Footer / Station Info */}
        <div className="p-4 border-t border-[#334155] text-xs text-[#94a3b8]">
          <div className="flex justify-between items-center mb-1">
            <span className="font-medium text-white">Station 01</span>
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
          </div>
          <div>Stage 0 Skeleton • Offline Ready</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8 bg-[#0f172a]">{children}</main>
    </div>
  )
}
