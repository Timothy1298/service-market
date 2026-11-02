import { useMemo, useState, type FormEvent } from 'react'

type PaymentDraft = {
  amount: string
  method: 'CASH' | 'BANK_TRANSFER' | 'OTHER'
  reference: string
  paymentDate: string
}

type Props = {
  open: boolean
  onClose: () => void
  invoiceNumber?: string
  maxAmount?: number
  onSave: (draft: PaymentDraft) => Promise<void> | void
}

const emptyDraft = (maxAmount: number) => ({
  amount: maxAmount > 0 ? String(maxAmount) : '',
  method: 'CASH' as const,
  reference: '',
  paymentDate: new Date().toISOString().slice(0, 10),
})

export default function RecordPaymentModal({ open, onClose, invoiceNumber, maxAmount = 0, onSave }: Props) {
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft(maxAmount))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useMemo(() => {
    setDraft(emptyDraft(maxAmount))
    setError('')
  }, [maxAmount, open])

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount greater than zero.')
      return
    }
    if (maxAmount > 0 && amount > maxAmount) {
      setError(`Payment cannot exceed the outstanding balance of ${maxAmount.toFixed(2)}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="payments-page__modal" role="dialog" aria-modal="true" aria-label="Record payment">
      <section>
        <header className="payments-page__modal-head">
          <div>
            <p className="eyebrow green">RECORD PAYMENT</p>
            <h2>{invoiceNumber ?? 'Payment entry'}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <form onSubmit={event => void submit(event)}>
          <div className="payments-page__two-col">
            <label>
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={draft.amount}
                onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
              />
            </label>
            <label>
              Method
              <select
                value={draft.method}
                onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value as PaymentDraft['method'] }))}
              >
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>
          <label>
            Payment date
            <input
              type="date"
              value={draft.paymentDate}
              onChange={(event) => setDraft((current) => ({ ...current, paymentDate: event.target.value }))}
            />
          </label>
          <label>
            Reference (optional)
            <input
              value={draft.reference}
              onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))}
            />
          </label>
          {error && <div className="payments-page__alert payments-page__alert--error" role="alert">{error}</div>}
          <div className="payments-page__modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="payments-page__primary" disabled={saving}>{saving ? 'Recording…' : 'Save payment'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
