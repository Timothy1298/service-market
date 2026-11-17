import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapPin, Search } from 'lucide-react'
import { customerPortalApi } from '../services/customerPortalApi'
import { usePortalData } from '../hooks'
import { PortalPage, PortalPanel, PortalState } from '../components/PortalPage'
export default function DiscoverPage() {
 const [params, setParams] = useSearchParams(); const [search, setSearch] = useState(params.get('search') ?? ''); const [category, setCategory] = useState(params.get('category') ?? ''); const [location, setLocation] = useState('')
 const cats = usePortalData(() => customerPortalApi.categories()); const query = new URLSearchParams({ ...(search ? { search } : {}), ...(category ? { category } : {}), ...(location ? { location } : {}) }).toString()
 const providers = usePortalData(() => customerPortalApi.providers(query), [query])
 const submit = (e: React.FormEvent) => { e.preventDefault(); const next = new URLSearchParams(); if(search) next.set('search',search); if(category) next.set('category',category); setParams(next) }
 return <PortalPage title="Find a service" subtitle="Browse local providers and choose the service that fits your needs.">
  <PortalPanel><form className="customer-search-form" onSubmit={submit}><label><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="What do you need help with?" aria-label="Search services and providers"/></label><label><MapPin size={17}/><input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Town or area" aria-label="Filter by town or area"/></label><select value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter by category"><option value="">All services</option>{cats.data?.categories?.map((c:any)=><option key={c.id} value={c.name}>{c.name}</option>)}</select><button className="button">Search</button></form></PortalPanel>
  <PortalPanel title={providers.data?.total ? `${providers.data.total} providers` : 'Service providers'}><PortalState loading={providers.loading} error={providers.error} empty={providers.data?.providers?.length === 0 ? 'No providers match those filters. Try a different service or area.' : undefined}><div className="customer-provider-grid">{providers.data?.providers?.map((p:any)=><article className="customer-provider-card" key={p.id}><div className="customer-provider-icon">{p.name?.slice(0,1)}</div><p className="eyebrow green">{p.providerProfiles?.[0]?.tradeCategory ?? 'LOCAL PROVIDER'}</p><h3>{p.name}</h3><p>{p.slogan || p.providerProfiles?.[0]?.serviceDescription || 'Local services from this provider.'}</p><small><MapPin size={14}/>{p.address || 'Location shared when requesting a quote'}</small><div className="customer-tags">{p.serviceListings?.slice(0,3).map((x:any)=><span key={x.id}>{x.category.name}</span>)}</div><Link className="text-button" to={`/customer/providers/${p.id}`}>View services and profile <span>→</span></Link></article>)}</div></PortalState></PortalPanel>
 </PortalPage>
}
