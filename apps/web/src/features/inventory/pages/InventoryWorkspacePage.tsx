import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './InventoryWorkspacePage.css'

type Material = { id: string; sku?: string | null; name: string; description?: string | null; category?: string | null; unit: string; costPerUnit: string | number; sellingPrice?: string | number | null; stockQuantity: string | number; reorderLevel: string | number; supplier?: string | null; updatedAt: string }
type Movement = { id: string; type: string; quantity: string | number; reason?: string | null; reference?: string | null; createdAt: string; material: { id: string; name: string; unit: string }; job?: { id: string; jobNumber: string } | null; createdBy?: { fullName: string } }
type Detail = Material & { movements: Movement[]; jobUsages: Array<{ id: string; quantity: string | number; costPerUnit: string | number; createdAt: string; job: { id: string; jobNumber: string; title: string; status: string } }> }
type ItemForm = { name: string; sku: string; description: string; category: string; unit: string; costPerUnit: string; sellingPrice: string; reorderLevel: string; supplier: string }
const blankForm: ItemForm = { name: '', sku: '', description: '', category: '', unit: 'piece', costPerUnit: '', sellingPrice: '', reorderLevel: '0', supplier: '' }
const money = (amount: number) => `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())
const statusOf = (item: Material) => Number(item.stockQuantity) <= 0 ? 'out' : Number(item.stockQuantity) <= Number(item.reorderLevel) ? 'low' : 'healthy'

export default function InventoryWorkspacePage() {
  const [items, setItems] = useState<Material[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [movementTotal, setMovementTotal] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('ALL')
  const [stock, setStock] = useState('ALL')
  const [sort, setSort] = useState('name')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [itemForm, setItemForm] = useState<ItemForm>(blankForm)
  const [editing, setEditing] = useState<Material | null>(null)
  const [itemDialog, setItemDialog] = useState(false)
  const [stockDialog, setStockDialog] = useState<{ item: Material; type: 'receipt' | 'adjustment' | 'return' } | null>(null)
  const [stockForm, setStockForm] = useState({ quantity: '', costPerUnit: '', reason: '', reference: '' })
  const itemId = window.location.hash.replace('#', '').match(/^\/app\/materials\/([^/?#]+)/)?.[1]

  const loadList = useCallback(async (movementPage = page) => {
    setLoading(true)
    setError('')
    try {
      const [materialResult, movementResult] = await Promise.all([
        apiRequest<{ materials: Material[] }>('/materials'),
        apiRequest<{ movements: Movement[]; pageCount: number; total: number }>(`/stock-movements?page=${movementPage}&pageSize=10`),
      ])
      setItems(materialResult.materials)
      setMovements(movementResult.movements)
      setPageCount(movementResult.pageCount)
      setMovementTotal(movementResult.total)
    } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) }
  }, [page])

  const loadDetail = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ material: Detail }>(`/materials/${itemId}`)
      setDetail(result.material)
    } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) }
  }, [itemId])

  useEffect(() => { if (itemId) loadDetail(); else loadList(page) }, [itemId, page, loadDetail, loadList])
  useEffect(() => { const syncRoute = () => { if (window.location.hash.includes('/materials/')) loadDetail(); else { setDetail(null); loadList(1); setPage(1) } }; window.addEventListener('hashchange', syncRoute); return () => window.removeEventListener('hashchange', syncRoute) }, [loadDetail, loadList])

  const categories = useMemo(() => [...new Set(items.map(item => item.category).filter((value): value is string => Boolean(value)))].sort(), [items])
  const visibleItems = useMemo(() => items.filter(item =>
    (category === 'ALL' || item.category === category) &&
    (stock === 'ALL' || (stock === 'OUT' ? Number(item.stockQuantity) <= 0 : stock === 'LOW' ? Number(item.stockQuantity) > 0 && Number(item.stockQuantity) <= Number(item.reorderLevel) : Number(item.stockQuantity) > Number(item.reorderLevel))) &&
    `${item.name} ${item.sku ?? ''} ${item.category ?? ''} ${item.supplier ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((left, right) => sort === 'quantity' ? Number(left.stockQuantity) - Number(right.stockQuantity) : sort === 'cost' ? Number(right.costPerUnit) - Number(left.costPerUnit) : left.name.localeCompare(right.name)), [items, category, stock, query, sort])

  const resetItemDialog = () => { setItemDialog(false); setEditing(null); setItemForm(blankForm) }
  const openEdit = (item: Material) => { setEditing(item); setItemForm({ name: item.name, sku: item.sku ?? '', description: item.description ?? '', category: item.category ?? '', unit: item.unit, costPerUnit: String(item.costPerUnit), sellingPrice: item.sellingPrice == null ? '' : String(item.sellingPrice), reorderLevel: String(item.reorderLevel), supplier: item.supplier ?? '' }); setItemDialog(true) }
  const formPayload = () => ({ ...itemForm, sku: itemForm.sku || undefined, description: itemForm.description || undefined, category: itemForm.category || undefined, supplier: itemForm.supplier || undefined, costPerUnit: Number(itemForm.costPerUnit), sellingPrice: itemForm.sellingPrice ? Number(itemForm.sellingPrice) : undefined, reorderLevel: Number(itemForm.reorderLevel || 0) })
  const saveItem = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      if (editing) await apiRequest(`/materials/${editing.id}`, { method: 'PATCH', body: JSON.stringify(formPayload()) })
      else await apiRequest('/materials', { method: 'POST', body: JSON.stringify(formPayload()) })
      setNotice(editing ? `${itemForm.name} details updated.` : `${itemForm.name} added to inventory.`)
      const wasEditing = Boolean(editing); resetItemDialog(); if (wasEditing && detail) await loadDetail(); else await loadList(page)
    } catch (cause) { setError(errorMessage(cause)) } finally { setSaving(false) }
  }
  const saveStockMovement = async (event: FormEvent) => {
    event.preventDefault(); if (!stockDialog) return
    setSaving(true); setError(''); setNotice('')
    const quantity = Number(stockForm.quantity)
    try {
      if (stockDialog.type === 'receipt') await apiRequest(`/materials/${stockDialog.item.id}/restock`, { method: 'POST', body: JSON.stringify({ quantity, costPerUnit: stockForm.costPerUnit ? Number(stockForm.costPerUnit) : undefined, reason: stockForm.reason || undefined, reference: stockForm.reference || undefined }) })
      if (stockDialog.type === 'return') await apiRequest(`/materials/${stockDialog.item.id}/returns`, { method: 'POST', body: JSON.stringify({ quantity, reason: stockForm.reason, reference: stockForm.reference || undefined }) })
      if (stockDialog.type === 'adjustment') await apiRequest(`/materials/${stockDialog.item.id}/adjustments`, { method: 'POST', body: JSON.stringify({ delta: quantity, reason: stockForm.reason, reference: stockForm.reference || undefined }) })
      setNotice(`${label(stockDialog.type)} recorded for ${stockDialog.item.name}.`); setStockDialog(null); setStockForm({ quantity: '', costPerUnit: '', reason: '', reference: '' })
      if (detail?.id === stockDialog.item.id) await loadDetail(); else await loadList(page)
    } catch (cause) { setError(errorMessage(cause)) } finally { setSaving(false) }
  }
  const openStockDialog = (item: Material, type: 'receipt' | 'adjustment' | 'return') => { setStockForm({ quantity: '', costPerUnit: '', reason: '', reference: '' }); setStockDialog({ item, type }) }
  const openDetail = async (item: Material) => { window.location.hash = `/app/materials/${item.id}` }
  const lowStock = items.filter(item => Number(item.stockQuantity) > 0 && Number(item.stockQuantity) <= Number(item.reorderLevel))
  const outOfStock = items.filter(item => Number(item.stockQuantity) <= 0)
  const stockValue = items.reduce((sum, item) => sum + Number(item.stockQuantity) * Number(item.costPerUnit), 0)

  if (itemId) return <main className="inventory-workspace"><div className="inventory-detail__top"><a href="#/app/materials">← Inventory</a>{detail && <button type="button" onClick={() => openEdit(detail)}>Edit item</button>}</div>{error && <Alert error={error} retry={loadDetail} />}{loading ? <Skeleton /> : detail && <><header className="inventory-detail__header"><div className="inventory-item__icon">▦</div><div><p className="eyebrow green">INVENTORY ITEM</p><h1>{detail.name}</h1><p>{detail.sku || detail.category || 'Material'}{detail.supplier ? ` · ${detail.supplier}` : ''}</p></div><StockBadge value={statusOf(detail)} /></header><div className="inventory-workspace__metrics inventory-detail__metrics"><Metric title="Available stock" value={`${detail.stockQuantity} ${detail.unit}`} hint={`Reorder at ${detail.reorderLevel} ${detail.unit}`} /><Metric title="Unit cost" value={money(Number(detail.costPerUnit))} hint="Recorded purchase cost" /><Metric title="Stock value" value={money(Number(detail.stockQuantity) * Number(detail.costPerUnit))} hint="Quantity × unit cost" /><Metric title="Recent movements" value={String(detail.movements.length)} hint="Latest 20 entries" /></div><div className="inventory-detail__actions"><button onClick={() => openStockDialog(detail, 'receipt')}>Receive stock</button><button onClick={() => openStockDialog(detail, 'adjustment')}>Adjust stock</button><button onClick={() => openStockDialog(detail, 'return')}>Record return</button></div>{detail.description && <section className="inventory-workspace__panel"><h2>Item description</h2><p>{detail.description}</p></section>}<section className="inventory-workspace__panel"><h2>Stock movement history</h2>{detail.movements.length ? detail.movements.map(movement => <MovementRow movement={movement} key={movement.id} />) : <Empty text="No movements recorded for this item." />}</section><section className="inventory-workspace__panel"><h2>Job usage</h2>{detail.jobUsages.length ? detail.jobUsages.map(usage => <a className="inventory-history-row" href={`#/app/jobs/${usage.job.id}`} key={usage.id}><span>{usage.job.jobNumber}</span><span>{usage.job.title}</span><b>{usage.quantity} {detail.unit}</b></a>) : <Empty text="No job consumption recorded for this item." />}</section></>}</main>

  return <main className="inventory-workspace"><header className="inventory-workspace__header"><div><p className="eyebrow green">BUSINESS OPERATIONS</p><h1>Inventory</h1><p>Track materials, monitor stock, and control usage.</p></div><button className="inventory-workspace__primary" onClick={() => { setEditing(null); setItemForm(blankForm); setItemDialog(true) }}>＋ Add item</button></header>{notice && <div className="inventory-workspace__notice is-success">{notice}</div>}{error && <Alert error={error} retry={() => loadList(page)} />}<div className="inventory-workspace__metrics"><Metric title="Total items" value={loading ? '—' : String(items.length)} hint="Active inventory records" /><Metric title="Low stock" value={loading ? '—' : String(lowStock.length)} hint="At or below reorder level" kind="warning" /><Metric title="Out of stock" value={loading ? '—' : String(outOfStock.length)} hint="Zero available quantity" kind="critical" /><Metric title="Stock value" value={loading ? '—' : money(stockValue)} hint="On hand × recorded unit cost" /></div>
    <section className="inventory-workspace__panel"><div className="inventory-workspace__section-head"><div><h2>Stock health</h2><p>Materials that may need replenishment.</p></div><button className="inventory-workspace__text-action" onClick={() => { setStock('LOW'); setFiltersOpen(true) }}>View low stock →</button></div>{!loading && !lowStock.length && !outOfStock.length ? <p className="inventory-workspace__healthy">All stock is above reorder thresholds.</p> : <div className="inventory-workspace__alerts">{[...outOfStock, ...lowStock].slice(0, 4).map(item => <div key={item.id}><StockBadge value={statusOf(item)} /><span><b>{item.name}</b><small>{item.stockQuantity} {item.unit} · reorder level {item.reorderLevel}</small></span><button onClick={() => openStockDialog(item, 'receipt')}>Receive stock</button></div>)}</div>}</section>
    <section className="inventory-workspace__panel"><div className="inventory-workspace__section-head"><div><h2>Inventory items</h2><p>{loading ? 'Loading inventory…' : `${visibleItems.length} of ${items.length} items`}</p></div><div className="inventory-workspace__toolbar"><label className="inventory-workspace__search">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, SKU, supplier" /></label><button onClick={() => setFiltersOpen(value => !value)} className={filtersOpen ? 'is-selected' : ''}>☷ Filters</button></div></div>{filtersOpen && <div className="inventory-workspace__filters"><label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="ALL">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Stock status<select value={stock} onChange={event => setStock(event.target.value)}><option value="ALL">All stock</option><option value="HEALTHY">Healthy</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option></select></label><label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name A–Z</option><option value="quantity">Lowest quantity</option><option value="cost">Highest unit cost</option></select></label><button onClick={() => { setQuery(''); setCategory('ALL'); setStock('ALL'); setSort('name') }}>Clear filters</button></div>}{loading ? <Skeleton /> : visibleItems.length ? <div className="inventory-workspace__item-list">{visibleItems.map(item => <article className="inventory-workspace__item" key={item.id}><button className="inventory-workspace__item-main" onClick={() => openDetail(item)}><span className="inventory-item__icon">▦</span><span><b>{item.name}</b><small>{item.sku || item.category || 'Inventory item'}{item.supplier ? ` · ${item.supplier}` : ''}</small></span></button><div><small>On hand</small><b>{item.stockQuantity} {item.unit}</b><StockBadge value={statusOf(item)} /></div><div><small>Reorder at</small><b>{item.reorderLevel} {item.unit}</b></div><div><small>Unit cost</small><b>{money(Number(item.costPerUnit))}</b></div><div className="inventory-workspace__row-actions"><button onClick={() => openDetail(item)}>Details</button><button onClick={() => openEdit(item)}>Edit</button><button onClick={() => openStockDialog(item, 'receipt')}>Receive</button><button onClick={() => openStockDialog(item, 'adjustment')}>Adjust</button><button onClick={() => openStockDialog(item, 'return')}>Return</button></div></article>)}</div> : <Empty text={items.length ? 'No items match these filters.' : 'No inventory items yet. Add your first item to track stock.'} action={items.length ? () => { setQuery(''); setCategory('ALL'); setStock('ALL') } : () => setItemDialog(true)} actionLabel={items.length ? 'Clear filters' : 'Add item'} />}</section>
    <section className="inventory-workspace__panel"><div className="inventory-workspace__section-head"><div><h2>Stock movements</h2><p>{movementTotal} recorded movements · newest first</p></div></div>{movements.length ? movements.map(movement => <MovementRow movement={movement} key={movement.id} />) : <Empty text="No stock movements recorded yet." />}<div className="inventory-workspace__pagination"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {Math.max(pageCount, 1)}</span><button disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>Next</button></div></section>
    {itemDialog && <div className="inventory-workspace__backdrop"><section className="inventory-workspace__dialog" role="dialog" aria-modal="true" aria-labelledby="item-dialog-title"><DialogHeader eyebrow={editing ? 'EDIT ITEM DETAILS' : 'NEW INVENTORY ITEM'} title={editing ? 'Edit item' : 'Add item'} close={resetItemDialog} /><form onSubmit={saveItem}><div className="inventory-workspace__form-grid">{([['name', 'Item name', true], ['sku', 'SKU / item code'], ['category', 'Category'], ['unit', 'Unit of measure', true], ['costPerUnit', 'Unit cost (KES)', true], ['sellingPrice', 'Selling price (KES)'], ['reorderLevel', 'Reorder level'], ['supplier', 'Supplier']] as const).map(([key, title, required]) => <label key={key}>{title}<input value={itemForm[key]} onChange={event => setItemForm(current => ({ ...current, [key]: event.target.value }))} required={Boolean(required)} type={key === 'costPerUnit' || key === 'sellingPrice' || key === 'reorderLevel' ? 'number' : 'text'} min={key === 'costPerUnit' || key === 'sellingPrice' || key === 'reorderLevel' ? '0' : undefined} step={key === 'costPerUnit' || key === 'sellingPrice' || key === 'reorderLevel' ? '0.01' : undefined} /></label>)}</div><label>Description<textarea rows={3} value={itemForm.description} onChange={event => setItemForm(current => ({ ...current, description: event.target.value }))} /></label><p className="inventory-workspace__form-note">Stock quantity changes are recorded through stock movements.</p><DialogActions cancel={resetItemDialog} busy={saving} submit={editing ? 'Save changes' : 'Add item'} /></form></section></div>}
    {stockDialog && <div className="inventory-workspace__backdrop"><section className="inventory-workspace__dialog inventory-workspace__dialog--small" role="dialog" aria-modal="true" aria-labelledby="stock-dialog-title"><DialogHeader eyebrow={label(stockDialog.type).toUpperCase()} title={`${label(stockDialog.type)} · ${stockDialog.item.name}`} close={() => setStockDialog(null)} /><p className="inventory-workspace__balance">Current balance: <b>{stockDialog.item.stockQuantity} {stockDialog.item.unit}</b></p><form onSubmit={saveStockMovement}><label>{stockDialog.type === 'adjustment' ? 'Quantity change (use minus to reduce)' : 'Quantity'}<input type="number" step="0.001" min={stockDialog.type === 'adjustment' ? undefined : '0.001'} value={stockForm.quantity} onChange={event => setStockForm(current => ({ ...current, quantity: event.target.value }))} required /></label>{stockDialog.type === 'receipt' && <label>New unit cost (optional)<input type="number" min="0" step="0.01" value={stockForm.costPerUnit} onChange={event => setStockForm(current => ({ ...current, costPerUnit: event.target.value }))} /></label>}<label>Reason<input minLength={2} value={stockForm.reason} onChange={event => setStockForm(current => ({ ...current, reason: event.target.value }))} required={stockDialog.type !== 'receipt'} /></label><label>Reference<input value={stockForm.reference} onChange={event => setStockForm(current => ({ ...current, reference: event.target.value }))} /></label><DialogActions cancel={() => setStockDialog(null)} busy={saving} submit={stockDialog.type === 'receipt' ? 'Record receipt' : stockDialog.type === 'return' ? 'Record return' : 'Apply adjustment'} /></form></section></div>}
  </main>
}

function Metric({ title, value, hint, kind = '' }: { title: string; value: string; hint: string; kind?: string }) { return <div className={`inventory-workspace__metric ${kind}`}><small>{title}</small><strong>{value}</strong><span>{hint}</span></div> }
function StockBadge({ value }: { value: string }) { return <span className={`inventory-workspace__badge is-${value}`}>{value === 'out' ? 'Out of stock' : value === 'low' ? 'Low stock' : 'In stock'}</span> }
function Alert({ error, retry }: { error: string; retry: () => void }) { return <div className="inventory-workspace__notice is-error">{error}<button onClick={retry}>Retry</button></div> }
function Skeleton() { return <div className="inventory-workspace__skeleton"><i /><i /><i /></div> }
function Empty({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) { return <div className="inventory-workspace__empty"><p>{text}</p>{action && <button onClick={action}>{actionLabel}</button>}</div> }
function MovementRow({ movement }: { movement: Movement }) { const isOut = movement.type === 'CONSUMPTION' || movement.type === 'ADJUSTMENT' && !movement.reason?.toLowerCase().includes('increase'); return <article className="inventory-history-row"><span className={`inventory-workspace__movement-icon ${isOut ? 'is-out' : ''}`}>{isOut ? '−' : '+'}</span><span><b>{movement.material.name}</b><small>{label(movement.type)}{movement.job ? ` · ${movement.job.jobNumber}` : ''}{movement.reason ? ` · ${movement.reason}` : ''}{movement.reference ? ` · ${movement.reference}` : ''}</small></span><strong>{isOut ? '−' : '+'}{movement.quantity} {movement.material.unit}</strong><time>{new Date(movement.createdAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></article> }
function DialogHeader({ eyebrow, title, close }: { eyebrow: string; title: string; close: () => void }) { return <div className="inventory-workspace__dialog-head"><div><p className="eyebrow green">{eyebrow}</p><h2>{title}</h2></div><button type="button" onClick={close} aria-label="Close dialog">×</button></div> }
function DialogActions({ cancel, busy, submit }: { cancel: () => void; busy: boolean; submit: string }) { return <div className="inventory-workspace__dialog-actions"><button type="button" onClick={cancel}>Cancel</button><button className="inventory-workspace__primary" disabled={busy}>{busy ? 'Saving…' : submit}</button></div> }
