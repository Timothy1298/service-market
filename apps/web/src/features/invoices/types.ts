export type Invoice = {
  id: string; invoiceNumber: string; status: string; issueDate?: string | null; dueDate?: string | null; currency: string
  subtotal: number | string; discount: number | string; tax: number | string; grandTotal: number | string; amountPaid: number | string
  paymentTerms?: string | null; notes?: string | null; createdAt: string
  customer: { id: string; name: string; phone: string; email?: string | null; billingAddress?: string | null }
  business: { name: string; phone: string; email?: string | null; address?: string | null; paymentInstructions?: string | null; currency: string }
  items: Array<{ id: string; description: string; quantity: number | string; unit: string; unitPrice: number | string; lineTotal: number | string }>
  payments: Array<{ id: string; amount: number | string; paymentDate: string; method: string; reference?: string | null }>
  quotation?: { id: string; quotationNumber: string; title: string } | null
  job?: { id: string; jobNumber: string; title: string } | null
  issuedSnapshot?: { business?: { name: string; phone: string; email?: string | null; address?: string | null; paymentInstructions?: string | null }; customer?: { name: string; phone: string; email?: string | null; billingAddress?: string | null } } | null
}

