import * as React from 'react'
import type { Customer } from '@shared/types'

/**
 * Shared customer search + "no match, add new" dropdown, extracted out of
 * CheckoutScreen so the Pharmacy Credit tender flow, the park-sale flow, and the
 * top-of-checkout Link Customer control all drive the exact same search UI instead
 * of three copies of the same JSX.
 */
export function CustomerSearchPanel({
  query,
  onQueryChange,
  results,
  onSelect,
  onAddNew,
  placeholder = 'Search name or phone',
  inputRef
}: {
  query: string
  onQueryChange: (value: string) => void
  results: Customer[]
  onSelect: (customer: Customer) => void
  onAddNew: () => void
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
}): React.JSX.Element {
  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm"
      />
      {results.length > 0 && (
        <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm">
          {results.map((customer) => (
            <button
              key={customer.id}
              onClick={() => onSelect(customer)}
              className="block min-h-11 w-full border-b border-[var(--border)] px-3 text-left text-sm last:border-0"
            >
              <b>
                {customer.firstName} {customer.lastName}
              </b>{' '}
              · {customer.phone}
            </button>
          ))}
        </div>
      )}
      {query.trim() !== '' && results.length === 0 && (
        <div className="relative z-20 mt-1 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-center text-sm shadow-sm">
          <div className="mb-2 text-[var(--muted-foreground)]">Customer not found</div>
          <button
            onClick={onAddNew}
            className="min-h-11 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
          >
            + Add new customer
          </button>
        </div>
      )}
    </div>
  )
}
