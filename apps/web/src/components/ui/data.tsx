import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react'

export type DataColumn<T> = { key: string; label: string; render: (row: T) => ReactNode; sortValue?: (row: T) => string | number; sortable?: boolean; numeric?: boolean; mobile?: boolean }

export function DataTable<T>({ rows, columns, getKey, loading = false, empty, mobileCard, pageSize = 25 }: { rows: T[]; columns: DataColumn<T>[]; getKey: (row: T) => string; loading?: boolean; empty?: ReactNode; mobileCard?: (row: T) => ReactNode; pageSize?: number }) {
  const [sortKey, setSortKey] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const column = columns.find(item => item.key === sortKey)
    if (!column) return rows
    return [...rows].sort((left, right) => {
      const leftValue = String(column.sortValue?.(left) ?? column.render(left) ?? '').toLocaleLowerCase()
      const rightValue = String(column.sortValue?.(right) ?? column.render(right) ?? '').toLocaleLowerCase()
      return leftValue.localeCompare(rightValue, undefined, { numeric: true }) * (direction === 'asc' ? 1 : -1)
    })
  }, [rows, columns, sortKey, direction])
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  return <div className="ui-data-table">
    {loading ? <div className="ui-data-table__loading" aria-label="Loading records">{Array.from({ length: 6 }, (_, index) => <SkeletonRow key={index} />)}</div> : sorted.length ? <>
      <div className="ui-data-table__desktop"><table><thead><tr>{columns.map(column => <th key={column.key} className={column.numeric ? 'is-numeric' : ''} aria-sort={sortKey === column.key ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>{column.sortable ? <button type="button" onClick={() => { setDirection(sortKey === column.key && direction === 'asc' ? 'desc' : 'asc'); setSortKey(column.key); setPage(1) }}>{column.label}{sortKey === column.key ? direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : <ArrowUpDown size={14} />}</button> : column.label}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={getKey(row)}>{columns.map(column => <td key={column.key} className={column.numeric ? 'is-numeric' : ''}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>
      <div className="ui-data-table__mobile">{visibleRows.map(row => <article key={getKey(row)}>{mobileCard ? mobileCard(row) : columns.filter(column => column.mobile !== false).map(column => <div key={column.key}><span>{column.label}</span><strong>{column.render(row)}</strong></div>)}</article>)}</div>
    </> : empty ?? <div className="ui-data-table__empty">No records found.</div>}
    {sorted.length > pageSize && <footer className="ui-data-table__footer"><span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} of {sorted.length}</span><div><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={currentPage <= 1} aria-label="Previous page"><ChevronLeft size={17} /></button><button type="button" onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount} aria-label="Next page"><ChevronRight size={17} /></button></div></footer>}
  </div>
}

function SkeletonRow() { return <div className="ui-data-table__skeleton-row"><i /><i /><i /></div> }

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <label className="ui-search-input"><Search size={18} aria-hidden="true" /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={label} /></label>
}

export function FilterChips<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (value: T) => void }) {
  return <div className="ui-filter-chips" role="group">{options.map(option => <button type="button" key={option.value} className={value === option.value ? 'is-active' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <span>{option.count}</span>}</button>)}</div>
}

export function Toolbar({ children, count, filtersActive = 0, onFilters }: { children?: ReactNode; count?: string; filtersActive?: number; onFilters?: () => void }) {
  return <div className="ui-toolbar"><div>{children}</div><div>{count && <small>{count}</small>}{onFilters && <button type="button" onClick={onFilters}><SlidersHorizontal size={16} />Filters{filtersActive > 0 && <span>{filtersActive}</span>}</button>}</div></div>
}

export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  return <nav className="ui-pagination" aria-label="Pagination"><span>Page {page} of {Math.max(1, pageCount)}</span><button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}><ChevronLeft size={17} />Previous</button><button type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>Next<ChevronRight size={17} /></button></nav>
}

export function KeyValueList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="ui-key-value-list">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
}

export function Timeline({ items }: { items: Array<{ title: string; detail?: string; done?: boolean }> }) {
  return <ol className="ui-timeline">{items.map((item, index) => <li className={item.done ? 'is-done' : ''} key={`${item.title}-${index}`}><i /><span><b>{item.title}</b>{item.detail && <small>{item.detail}</small>}</span></li>)}</ol>
}
