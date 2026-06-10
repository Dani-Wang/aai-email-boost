"use client"
import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

interface Contact {
  company: string
  contactName: string
  title: string
  email: string
  region: string
  deadline: string
  status: string
  priority: string
  progress: string
  log: string
  note: string
  linkedin: string
  // HubSpot IDs
  contactId: string
  dealId: string
  dealName: string
}

const EMPTY: Contact = {
  company: "", contactName: "", title: "", email: "",
  region: "", deadline: "", status: "", priority: "",
  progress: "", log: "", note: "", linkedin: "",
  contactId: "", dealId: "", dealName: "",
}

const COUNTRIES = ["China", "Thailand", "Indonesia", "Vietnam", "Malaysia", "Philippines", "Hong Kong", "Singapore"]

function regionFromDealName(name: string): string {
  if (!name) return ""
  const match = COUNTRIES.find(c => name.toLowerCase().includes(c.toLowerCase()))
  return match ?? ""
}

const ENGAGEMENT_TAG_COLORS: Record<string, string> = {
  "Active":                "bg-green-100 text-green-700",
  "Early stage emails":    "bg-cyan-100 text-cyan-700",
  "Research stage":        "bg-yellow-100 text-yellow-700",
  "Escalation":            "bg-orange-100 text-orange-700",
  "Reactive but silent":   "bg-purple-100 text-purple-700",
  "Not reactive/ignoring": "bg-gray-100 text-gray-600",
}

export default function QueuePage() {
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [showPanel, setShowPanel] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<{ contacts: any[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Contact>(EMPTY)
  const [availableDeals, setAvailableDeals] = useState<any[]>([])
  const [loadingContact, setLoadingContact] = useState(false)
  const [engagementSummary, setEngagementSummary] = useState<any>(null)
  const [loadingEngagement, setLoadingEngagement] = useState(false)
  const [step, setStep] = useState<"search" | "confirm">("search")
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.length < 3) { setResults(null); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data)
      } finally {
        setSearching(false)
      }
    }, 500)
  }, [query])

  async function fetchEngagementSummary(dealId: string, contactId: string) {
    if (!dealId && !contactId) return
    setLoadingEngagement(true)
    setEngagementSummary(null)
    try {
      const params = new URLSearchParams()
      if (dealId) params.set("dealId", dealId)
      if (contactId) params.set("contactId", contactId)
      const res = await fetch(`/api/engagement-summary?${params}`)
      const data = await res.json()
      if (!data.error) setEngagementSummary(data)
    } catch (_) {}
    finally { setLoadingEngagement(false) }
  }

  async function handleSelectContact(c: any) {
    setLoadingContact(true)
    setEngagementSummary(null)
    setResults(null)
    setQuery("")
    try {
      const res = await fetch(`/api/contact?id=${c.id}`)
      const data = await res.json()
      const deals = data.deals ?? []
      setAvailableDeals(deals)
      const firstDeal = deals[0] ?? null
      if (data.error) {
        setSelected({ ...EMPTY, company: c.company ?? "", contactName: c.name ?? "", title: c.title ?? "", email: c.email ?? "", contactId: c.id ?? "" })
      } else {
        setSelected({
          ...EMPTY,
          ...data,
          contactId: c.id,
          dealId: firstDeal?.id ?? "",
          dealName: firstDeal?.name ?? "",
          // region is the contact's Country/Region property from HubSpot (property name: "country")
          region: data.region ?? "",
        })
      }
      if (firstDeal?.id || c.id) fetchEngagementSummary(firstDeal?.id ?? "", c.id)
      setStep("confirm")
    } catch {
      setSelected({ ...EMPTY, company: c.company ?? "", contactName: c.name ?? "", title: c.title ?? "", email: c.email ?? "", contactId: c.id ?? "" })
      setStep("confirm")
    } finally {
      setLoadingContact(false)
    }
  }

  function handleDealSelect(dealId: string) {
    const deal = availableDeals.find(d => d.id === dealId)
    if (!deal) return
    setSelected(prev => ({
      ...prev,
      dealId: deal.id,
      dealName: deal.name,
      // Region stays as the contact's HubSpot Country/Region — deal selection doesn't change it
    }))
    fetchEngagementSummary(deal.id, selected.contactId)
  }

  function handleAddToQueue() {
    if (!selected.company || !selected.email) return
    setContacts(prev => [...prev, selected])
    setSelected(EMPTY)
    setAvailableDeals([])
    setEngagementSummary(null)
    setStep("search")
    setShowPanel(false)
  }

  function handleDraft(contact: Contact) {
    sessionStorage.setItem("draftContact", JSON.stringify(contact))
    router.push("/draft")
  }

  function handleRemove(i: number) {
    setContacts(prev => prev.filter((_, idx) => idx !== i))
  }

  function priorityColor(p: string) {
    const l = p.toLowerCase()
    if (l === "high") return "bg-red-100 text-red-700"
    if (l === "medium") return "bg-yellow-100 text-yellow-700"
    return "bg-gray-100 text-gray-500"
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-gray-900">AAI Email Boost</span>
        <button
          onClick={() => { setShowPanel(true); setStep("search") }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Add contact
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {showPanel && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-gray-900">
                {step === "search" ? "Find a contact" : "Confirm contact"}
              </h2>
              <button
                onClick={() => { setShowPanel(false); setStep("search"); setQuery(""); setResults(null) }}
                className="text-gray-400 hover:text-gray-600 text-sm"
              >
                Cancel
              </button>
            </div>

            {step === "search" && (
              <>
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search by company, contact name, or email..."
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                  />
                  {searching && (
                    <div className="absolute right-3 top-3 flex gap-0.5">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  )}
                </div>

                {results && (
                  <div className="mt-2 border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50">
                    {results.contacts.length === 0 && (
                      <p className="text-sm text-gray-400 p-4 text-center">No results found in HubSpot.</p>
                    )}
                    {results.contacts.map((c: any) => (
                      <button key={c.id} onClick={() => handleSelectContact(c)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                            {c.company && <span className="text-gray-400 text-sm"> at {c.company}</span>}
                          </div>
                        </div>
                        {c.title && <p className="text-xs text-gray-500 mt-0.5">{c.title}</p>}
                        {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                      </button>
                    ))}
                  </div>
                )}
                {loadingContact && (
                  <p className="text-sm text-gray-400 mt-3 text-center">Loading contact from HubSpot...</p>
                )}
              </>
            )}

            {step === "confirm" && (
              <>
                {/* Contact card — read only */}
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg mb-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{selected.contactName}</p>
                    <p className="text-xs text-gray-500">{selected.title}</p>
                    <p className="text-xs text-gray-400">{selected.email}</p>
                  </div>
                  <button onClick={() => setStep("search")} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
                    Change
                  </button>
                </div>

                {/* Region from HubSpot contact */}
                {selected.region && (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs text-gray-400">Country / Region</span>
                    <span className="text-xs font-medium text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                      {selected.region}
                    </span>
                    <span className="text-xs text-gray-400">from HubSpot</span>
                  </div>
                )}

                {/* Deal selector */}
                {availableDeals.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-2">Which deal?</p>
                    <div className="flex flex-wrap gap-2">
                      {availableDeals.map((d: any) => (
                        <button
                          key={d.id}
                          onClick={() => handleDealSelect(d.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                            selected.dealId === d.id
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white border-gray-200 text-gray-700 hover:border-blue-300"
                          }`}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Engagement summary — auto-loaded from HubSpot */}
                <div className="mb-4">
                  {loadingEngagement ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <div className="flex gap-0.5">
                        {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                      </div>
                      Loading engagement history...
                    </div>
                  ) : engagementSummary ? (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      {/* Relationship badge + counts */}
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ENGAGEMENT_TAG_COLORS[engagementSummary.relationshipLevel] ?? "bg-gray-100 text-gray-600"}`}>
                          {engagementSummary.relationshipLevel}
                        </span>
                        <div className="flex gap-3 text-xs text-gray-400">
                          {engagementSummary.counts.meetings > 0 && <span>{engagementSummary.counts.meetings} meeting{engagementSummary.counts.meetings > 1 ? "s" : ""}</span>}
                          {engagementSummary.counts.sent > 0 && <span>{engagementSummary.counts.sent} sent</span>}
                          {engagementSummary.counts.opened > 0 && <span>{engagementSummary.counts.opened} opened</span>}
                          {engagementSummary.counts.received > 0 && <span>{engagementSummary.counts.received} repl{engagementSummary.counts.received > 1 ? "ies" : "y"}</span>}
                          {engagementSummary.counts.calls > 0 && <span>{engagementSummary.counts.calls} call{engagementSummary.counts.calls > 1 ? "s" : ""}</span>}
                        </div>
                      </div>

                      <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
                        {/* Meetings */}
                        {engagementSummary.summary.meetings.map((m: any, i: number) => (
                          <div key={`m${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium shrink-0">Meeting</span>
                            <div className="min-w-0">
                              <span className="text-gray-700">{m.title}</span>
                              {m.date && <span className="text-gray-400 ml-1">— {m.date}</span>}
                              {m.notes && <p className="text-gray-400 truncate mt-0.5">{m.notes}</p>}
                            </div>
                          </div>
                        ))}
                        {/* Calls */}
                        {engagementSummary.summary.calls.map((c: any, i: number) => (
                          <div key={`c${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-medium shrink-0">Call</span>
                            <div>
                              {c.date && <span className="text-gray-400">{c.date}</span>}
                              {c.notes && <p className="text-gray-400 truncate">{c.notes}</p>}
                            </div>
                          </div>
                        ))}
                        {/* Replies */}
                        {engagementSummary.summary.receivedEmails.map((e: any, i: number) => (
                          <div key={`r${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium shrink-0">Reply</span>
                            <div className="min-w-0">
                              <span className="text-gray-700 truncate block">{e.subject}</span>
                              {e.date && <span className="text-gray-400">{e.date}</span>}
                            </div>
                          </div>
                        ))}
                        {/* Sent emails */}
                        {engagementSummary.summary.sentEmails.map((e: any, i: number) => (
                          <div key={`s${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${
                              e.status === "OPENED" || e.status === "CLICKED" ? "bg-yellow-50 text-yellow-700" : "bg-blue-50 text-blue-600"
                            }`}>
                              {e.status === "OPENED" || e.status === "CLICKED" ? "Opened" : "Sent"}
                            </span>
                            <div className="min-w-0">
                              <span className="text-gray-600 truncate block">{e.subject}</span>
                              {e.date && <span className="text-gray-400">{e.date}</span>}
                            </div>
                          </div>
                        ))}
                        {/* Notes */}
                        {engagementSummary.summary.notes.map((n: any, i: number) => (
                          <div key={`n${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium shrink-0">Note</span>
                            <p className="text-gray-500 truncate">{n.body}</p>
                          </div>
                        ))}
                        {engagementSummary.counts.sent === 0 && engagementSummary.counts.meetings === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-2">No engagement history found for this deal.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Optional note */}
                <input
                  type="text"
                  value={selected.note}
                  onChange={e => setSelected(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Anything to add? e.g. based in HK, ask for CN contact..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                />

                <button
                  onClick={handleAddToQueue}
                  disabled={!selected.email}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
                >
                  Add to queue
                </button>
              </>
            )}
          </div>
        )}

        {contacts.length > 0 ? (
          <div className="space-y-3">
            {contacts.map((c, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{c.contactName}</span>
                    <span className="text-gray-400 text-sm">at</span>
                    <span className="font-medium text-gray-900">{c.company}</span>
                    {c.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColor(c.priority)}`}>
                        {c.priority}
                      </span>
                    )}
                    {c.status && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{c.status}</span>
                    )}
                  </div>
                  {c.title && <p className="text-sm text-gray-500 mt-0.5">{c.title}</p>}
                  <div className="flex gap-4 mt-1.5 text-xs text-gray-400 flex-wrap">
                    {c.region && <span>Region: {c.region}</span>}
                    {c.dealName && <span>Deal: {c.dealName}</span>}
                    {c.deadline && <span>Deadline: {c.deadline}</span>}
                    {c.email && <span>{c.email}</span>}
                  </div>
                  {c.log && <p className="text-xs text-gray-400 mt-1 truncate">Log: {c.log}</p>}
                  {c.note && <p className="text-xs text-gray-400 truncate">Note: {c.note}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleDraft(c)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Draft email
                  </button>
                  <button onClick={() => handleRemove(i)}
                    className="text-gray-300 hover:text-gray-500 px-2 py-2 rounded-lg text-sm transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-gray-400">
            <p className="text-sm">No contacts in queue yet.</p>
            <p className="text-xs mt-1">Click "Add contact" and search by name, company, or email.</p>
          </div>
        )}
      </main>
    </div>
  )
}
