import * as React from 'react'
import { Banknote, CreditCard, Send, HeartHandshake, ChevronLeft } from 'lucide-react'
import { Card, CardTitle, CardDescription } from './ui/Card'
import { Alert } from './ui/Alert'
import { formatCurrency } from '@shared/formatCurrency'
import type { AuthUser, Customer, RefundType, SaleRefundDetail } from '@shared/types'

type Step = 'loading' | 'scope' | 'items' | 'method' | RefundType | 'success'

interface RefundWorkflowModalProps {
  transactionId: string
  manager: AuthUser
  /** Called when the modal closes. `refunded` is true if a refund was completed, so the caller can reload the list. */
  onClose: (refunded: boolean) => void
}

type CustomerWithBalance = Customer & { currentBalanceCents: number }

/**
 * Scope → (items) → method → type-specific confirmation. Loads the sale once
 * on mount; every step reads from the same `sale` + `amountCents` state so the
 * amount is computed exactly once per scope choice and never re-derived.
 */
export function RefundWorkflowModal({ transactionId, manager, onClose }: RefundWorkflowModalProps): React.JSX.Element {
  const [sale, setSale] = React.useState<SaleRefundDetail | null>(null)
  const [step, setStep] = React.useState<Step>('loading')
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [selectedItemIds, setSelectedItemIds] = React.useState<Set<string>>(new Set())
  const [amountCents, setAmountCents] = React.useState(0)

  const [reason, setReason] = React.useState('')
  const [customerEmail, setCustomerEmail] = React.useState('')
  const [linkedCustomerId, setLinkedCustomerId] = React.useState<number | null>(null)
  const [linkedCustomer, setLinkedCustomer] = React.useState<CustomerWithBalance | null>(null)
  const [customerLinkMode, setCustomerLinkMode] = React.useState<'search' | 'create' | null>(null)
  const [customerSearchQuery, setCustomerSearchQuery] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<Customer[]>([])
  const [newCustomer, setNewCustomer] = React.useState({ firstName: '', lastName: '', phone: '', address: '', email: '' })

  const [processing, setProcessing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    void (async () => {
      try {
        const detail = await window.api.refund.getSaleDetails(transactionId)
        setSale(detail)
        setCustomerEmail(detail.customer?.email || detail.email || '')
        setStep('scope')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load sale.')
      }
    })()
  }, [transactionId])

  // Load the linked customer's live balance whenever the effective customer id changes.
  const effectiveCustomerId = sale?.customerId ?? linkedCustomerId
  React.useEffect(() => {
    if (!effectiveCustomerId) {
      setLinkedCustomer(null)
      return
    }
    void (async () => {
      try {
        const detail = (await window.api.customer.get(effectiveCustomerId)) as CustomerWithBalance
        setLinkedCustomer(detail)
      } catch {
        setLinkedCustomer(null)
      }
    })()
  }, [effectiveCustomerId])

  React.useEffect(() => {
    if (customerLinkMode !== 'search') return
    const q = customerSearchQuery.trim()
    if (!q) {
      setCustomerSearchResults([])
      return
    }
    const timer = setTimeout(() => {
      window.api.customer.search(q).then(setCustomerSearchResults).catch(() => setCustomerSearchResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [customerSearchQuery, customerLinkMode])

  const toggleItem = (itemId: string): void => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const selectedItemsSubtotalCents = sale
    ? sale.items.filter((i) => selectedItemIds.has(i.id)).reduce((sum, i) => sum + i.totalCents, 0)
    : 0

  const processRefund = async (type: RefundType, opts?: { customerEmail?: string; linkCustomerId?: number }): Promise<void> => {
    if (!sale) return
    setProcessing(true)
    setError(null)
    try {
      const result = await window.api.refund.process({
        transactionId: sale.id,
        type,
        amountCents,
        reason: reason.trim() || undefined,
        customerEmail: opts?.customerEmail,
        linkCustomerId: opts?.linkCustomerId,
        refundedByUserId: manager.id
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      const messages: Record<RefundType, string> = {
        CASH: `Refund of ${formatCurrency(amountCents)} processed. Give customer cash.`,
        CARD: 'Refund processed. Customer will see credit within 1-3 business days.',
        E_TRANSFER: `Refund recorded. Manager must initiate e-transfer to ${opts?.customerEmail} for ${formatCurrency(amountCents)}.`,
        TAB_CREDIT: `Refund deposited to the customer's tab.`
      }
      setSuccessMessage(messages[type])
      setStep('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed.')
    } finally {
      setProcessing(false)
    }
  }

  if (loadError) {
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--error)] bg-[var(--card)] p-6 space-y-4">
          <Alert variant="error">{loadError}</Alert>
          <button onClick={() => onClose(false)} className="w-full min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)]">
            Close
          </button>
        </Card>
      </Overlay>
    )
  }

  if (step === 'loading' || !sale) {
    return (
      <Overlay>
        <Card className="w-[420px] bg-[var(--card)] p-6 text-center text-sm text-[var(--muted-foreground)]">Loading sale…</Card>
      </Overlay>
    )
  }

  // ---------------------------------------------------------------- Scope
  if (step === 'scope') {
    return (
      <Overlay>
        <Card className="w-[460px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <div>
            <CardTitle className="text-[var(--foreground)]">Refund Sale #{sale.receiptNumber}</CardTitle>
            <CardDescription>
              {sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName} · ` : ''}
              Total {formatCurrency(sale.totalCents)}
              {sale.refundedCents > 0 && ` · already refunded ${formatCurrency(sale.refundedCents)}`}
            </CardDescription>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => {
                setAmountCents(sale.refundableCents)
                setStep('method')
              }}
              className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
            >
              Refund Entire Sale ({formatCurrency(sale.refundableCents)} remaining)
            </button>
            <button
              onClick={() => setStep('items')}
              className="w-full min-h-11 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)]"
            >
              Refund Specific Items
            </button>
          </div>
          <button onClick={() => onClose(false)} className="min-h-9 w-full rounded-[var(--radius)] text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            Cancel
          </button>
        </Card>
      </Overlay>
    )
  }

  // ---------------------------------------------------------------- Items
  if (step === 'items') {
    return (
      <Overlay>
        <Card className="w-[500px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">Select items to refund</CardTitle>
          <div className="max-h-[300px] space-y-2 overflow-y-auto">
            {sale.items.map((item) => (
              <label key={item.id} className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
                <span className="flex items-center gap-2.5">
                  <input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => toggleItem(item.id)} className="h-4 w-4 shrink-0" />
                  {item.product.name} (qty {item.quantity}) @ {formatCurrency(item.unitPriceCents)} ea
                </span>
                <span className="font-semibold text-[var(--foreground)]">{formatCurrency(item.totalCents)}</span>
              </label>
            ))}
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm font-semibold text-[var(--foreground)]">
            Refund subtotal: {formatCurrency(selectedItemsSubtotalCents)} ({selectedItemIds.size} checked)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStep('scope')} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)]">
              Back
            </button>
            <button
              onClick={() => {
                setAmountCents(Math.min(selectedItemsSubtotalCents, sale.refundableCents))
                setStep('method')
              }}
              disabled={selectedItemIds.size === 0}
              className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Continue to Refund Method
            </button>
          </div>
        </Card>
      </Overlay>
    )
  }

  // ---------------------------------------------------------------- Method
  if (step === 'method') {
    const cardAvailable = Boolean(sale.processorTransactionId)
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">Refund Amount: {formatCurrency(amountCents)}</CardTitle>
          <CardDescription>How should this refund be processed?</CardDescription>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setStep('CASH')}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)]"
            >
              <Banknote className="h-5 w-5 shrink-0" />
              CASH
            </button>
            <button
              onClick={() => setStep('CARD')}
              disabled={!cardAvailable}
              title={!cardAvailable ? 'This sale has no card charge on file to reverse.' : undefined}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CreditCard className="h-5 w-5 shrink-0" />
              CARD
            </button>
            <button
              onClick={() => setStep('E_TRANSFER')}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--muted)]"
            >
              <Send className="h-5 w-5 shrink-0" />
              E-TRANSFER
            </button>
            <button
              onClick={() => setStep('TAB_CREDIT')}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)]"
            >
              <HeartHandshake className="h-5 w-5 shrink-0" />
              DEPOSIT TO TAB
            </button>
          </div>
          <button
            onClick={() => setStep(selectedItemIds.size > 0 ? 'items' : 'scope')}
            className="flex min-h-9 w-full items-center justify-center gap-1 rounded-[var(--radius)] text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </Card>
      </Overlay>
    )
  }

  // ---------------------------------------------------------------- Success
  if (step === 'success') {
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--success)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">Refund complete</CardTitle>
          <Alert variant="success">{successMessage}</Alert>
          <button onClick={() => onClose(true)} className="w-full min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]">
            Back to sales list
          </button>
        </Card>
      </Overlay>
    )
  }

  // ---------------------------------------------------------------- Type-specific confirmation forms
  const errorBanner = error && <Alert variant="error">{error}</Alert>
  const reasonField = (
    <div>
      <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Refund reason (optional)</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
      />
    </div>
  )

  if (step === 'CASH') {
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">Cash Refund — {formatCurrency(amountCents)}</CardTitle>
          <div className="text-sm text-[var(--foreground)]">Give customer {formatCurrency(amountCents)} in cash.</div>
          {errorBanner}
          {reasonField}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStep('method')} disabled={processing} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={() => void processRefund('CASH')}
              disabled={processing}
              className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {processing ? 'Processing…' : 'Confirm Refund'}
            </button>
          </div>
        </Card>
      </Overlay>
    )
  }

  if (step === 'CARD') {
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">Card Refund — {formatCurrency(amountCents)}</CardTitle>
          <div className="text-sm text-[var(--foreground)]">
            This will refund to the customer&apos;s original card.
            {sale.cardLast4 && <div className="mt-1 text-[var(--muted-foreground)]">Original payment: card •••• {sale.cardLast4}</div>}
          </div>
          {errorBanner}
          {reasonField}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStep('method')} disabled={processing} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={() => void processRefund('CARD')}
              disabled={processing}
              className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {processing ? 'Processing…' : 'Process Card Refund'}
            </button>
          </div>
        </Card>
      </Overlay>
    )
  }

  if (step === 'E_TRANSFER') {
    return (
      <Overlay>
        <Card className="w-[420px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
          <CardTitle className="text-[var(--foreground)]">E-Transfer Refund — {formatCurrency(amountCents)}</CardTitle>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Customer email (for sending refund instructions)</label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>
          {errorBanner}
          {reasonField}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStep('method')} disabled={processing} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={() => void processRefund('E_TRANSFER', { customerEmail: customerEmail.trim() })}
              disabled={processing || !customerEmail.trim()}
              className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {processing ? 'Processing…' : 'Confirm E-Transfer Refund'}
            </button>
          </div>
        </Card>
      </Overlay>
    )
  }

  // TAB_CREDIT
  const hasCustomer = Boolean(effectiveCustomerId)
  return (
    <Overlay>
      <Card className="w-[440px] border-[var(--primary)] bg-[var(--card)] p-6 space-y-4">
        <CardTitle className="text-[var(--foreground)]">Deposit to Customer Tab — {formatCurrency(amountCents)}</CardTitle>

        {!hasCustomer && customerLinkMode === null && (
          <>
            <Alert variant="warning">This sale is not linked to a customer. Create or link one to deposit the refund.</Alert>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCustomerLinkMode('create')} className="min-h-11 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)]">
                Create New Customer
              </button>
              <button onClick={() => setCustomerLinkMode('search')} className="min-h-11 rounded-[var(--radius)] border border-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary)]">
                Link Existing Customer
              </button>
            </div>
            <button onClick={() => setStep('method')} className="w-full text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Back
            </button>
          </>
        )}

        {!hasCustomer && customerLinkMode === 'search' && (
          <div className="space-y-2">
            <input
              type="text"
              value={customerSearchQuery}
              onChange={(e) => setCustomerSearchQuery(e.target.value)}
              placeholder="Search name or phone…"
              className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
              autoFocus
            />
            <div className="max-h-[180px] space-y-1 overflow-y-auto">
              {customerSearchResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setLinkedCustomerId(c.id)}
                  className="block w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-left text-sm"
                >
                  <b>{c.firstName} {c.lastName}</b> · {c.phone}
                </button>
              ))}
            </div>
            <button onClick={() => setCustomerLinkMode(null)} className="w-full text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Back
            </button>
          </div>
        )}

        {!hasCustomer && customerLinkMode === 'create' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="First name" value={newCustomer.firstName} onChange={(e) => setNewCustomer((p) => ({ ...p, firstName: e.target.value }))} className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
              <input placeholder="Last name" value={newCustomer.lastName} onChange={(e) => setNewCustomer((p) => ({ ...p, lastName: e.target.value }))} className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            </div>
            <input placeholder="Phone (required)" value={newCustomer.phone} onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            <input placeholder="Address" value={newCustomer.address} onChange={(e) => setNewCustomer((p) => ({ ...p, address: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            <input placeholder="Email (optional)" value={newCustomer.email} onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))} className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm" />
            {errorBanner}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCustomerLinkMode(null)} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)]">
                Back
              </button>
              <button
                onClick={async () => {
                  setError(null)
                  try {
                    const created = await window.api.customer.create(newCustomer)
                    if (created && 'id' in created) setLinkedCustomerId(created.id)
                    else setError('Could not create customer.')
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not create customer.')
                  }
                }}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)]"
              >
                Create &amp; link
              </button>
            </div>
          </div>
        )}

        {hasCustomer && (
          <>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
              <div className="text-[var(--foreground)]">
                Customer: {sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : linkedCustomer ? `${linkedCustomer.firstName} ${linkedCustomer.lastName}` : `#${effectiveCustomerId}`}
              </div>
              {linkedCustomer && (
                <>
                  <div className="text-[var(--muted-foreground)]">Current balance: {formatCurrency(linkedCustomer.currentBalanceCents)}</div>
                  <div className="text-[var(--muted-foreground)]">After deposit: {formatCurrency(linkedCustomer.currentBalanceCents + amountCents)}</div>
                </>
              )}
            </div>
            {errorBanner}
            {reasonField}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setStep('method')} disabled={processing} className="min-h-11 rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm text-[var(--foreground)] disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={() => void processRefund('TAB_CREDIT', linkedCustomerId ? { linkCustomerId: linkedCustomerId } : undefined)}
                disabled={processing}
                className="min-h-11 rounded-[var(--radius)] bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {processing ? 'Processing…' : 'Confirm Deposit'}
              </button>
            </div>
          </>
        )}
      </Card>
    </Overlay>
  )
}

function Overlay({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">{children}</div>
}
