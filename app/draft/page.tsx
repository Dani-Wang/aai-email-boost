"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { PreDraftAnswers } from "@/lib/claude"
import { PRIORITY_TAG_COLORS } from "@/lib/airtable"

interface ProgressLine { label: string; value: string }
interface ProgressData {
  progressLines: ProgressLine[]
  reportingYear?: string | null
  sourceNote: string | null
  sourceUrl: string | null
  noDataFound: boolean
}

// Extract a percentage number from a string like "66%", "~66%", "66.3%"
function extractPct(val: string): number | null {
  const m = val.match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? parseFloat(m[1]) : null
}

// Compare web-searched progress with Airtable baseline and return flags
function diffWithAirtable(
  progressLines: ProgressLine[],
  airtable: { globalCfPct: number | null; asiaCfPct: number | null; chinaCfPct: number | null }
): string[] {
  const flags: string[] = []
  const THRESHOLD = 3 // flag if difference > 3 percentage points

  const GLOBAL_KEYWORDS = ["global", "worldwide", "total", "overall"]
  const ASIA_KEYWORDS = ["asia", "apac", "asia pacific", "asia-pacific"]
  const CHINA_KEYWORDS = ["china", "mainland", "prc"]

  for (const line of progressLines) {
    const labelLower = line.label.toLowerCase()
    const pct = extractPct(line.value)
    if (pct === null) continue

    if (GLOBAL_KEYWORDS.some(k => labelLower.includes(k)) && airtable.globalCfPct != null) {
      const diff = Math.abs(pct - airtable.globalCfPct * 100)
      if (diff > THRESHOLD)
        flags.push(`Global: Airtable shows ${Math.round(airtable.globalCfPct * 100)}%, report shows ${pct}%`)
    }
    if (ASIA_KEYWORDS.some(k => labelLower.includes(k)) && airtable.asiaCfPct != null) {
      const diff = Math.abs(pct - airtable.asiaCfPct * 100)
      if (diff > THRESHOLD)
        flags.push(`Asia/APAC: Airtable shows ${Math.round(airtable.asiaCfPct * 100)}%, report shows ${pct}%`)
    }
    if (CHINA_KEYWORDS.some(k => labelLower.includes(k)) && airtable.chinaCfPct != null) {
      const diff = Math.abs(pct - airtable.chinaCfPct * 100)
      if (diff > THRESHOLD)
        flags.push(`China: Airtable shows ${Math.round(airtable.chinaCfPct * 100)}%, report shows ${pct}%`)
    }
  }

  // Flag if report has more granular data than Airtable
  const hasRegionalBreakdown = progressLines.some(l => {
    const ll = l.label.toLowerCase()
    return !GLOBAL_KEYWORDS.some(k => ll.includes(k))
  })
  if (hasRegionalBreakdown && progressLines.length > 1) {
    flags.push(`Report has ${progressLines.length} regional/category breakdowns — Airtable may be missing detail`)
  }

  return flags
}

const FEEL_OPTIONS = [
  "Mild urgency", "Curiosity about our work", "Accountability to their commitment",
  "Credibility of AAI", "Aware the deadline has passed", "Motivated to respond soon",
]
const NOT_FEEL_OPTIONS = [
  "Comfortable ignoring this", "Attacked or defensive", "Overwhelmed by too many asks",
  "Uncertain what we want", "Like this is a mass email",
]
const GOAL_OPTIONS = [
  "Get a reply", "Request a meeting", "Ask for progress data",
  "Find the right contact in their team", "Escalate to a more senior person",
]

const EMPTY_ANSWERS: PreDraftAnswers = {
  primaryGoal: "", secondaryGoal: "",
  shouldFeel: [], mustNotFeel: [],
  includeNow: "", holdBack: "",
}

export const ENGAGEMENT_TAGS = [
  "Active",
  "Early stage emails",
  "Research stage",
  "Escalation",
  "Reactive but silent",
  "Not reactive/ignoring",
] as const

export type EngagementTag = typeof ENGAGEMENT_TAGS[number]

export const ENGAGEMENT_TAG_COLORS: Record<EngagementTag, string> = {
  "Active":                "bg-green-100 text-green-700",
  "Early stage emails":    "bg-cyan-100 text-cyan-700",
  "Research stage":        "bg-yellow-100 text-yellow-700",
  "Escalation":            "bg-orange-100 text-orange-700",
  "Reactive but silent":   "bg-purple-100 text-purple-700",
  "Not reactive/ignoring": "bg-gray-100 text-gray-600",
}

// Classify engagement from HubSpot history into one of the six tags
function deriveEngagementTag(priorEmails: any[], meetings: any[], calls: any[]): EngagementTag {
  const sent = priorEmails.filter(e => e.direction === "EMAIL").length
  const received = priorEmails.filter(e => e.direction === "INCOMING_EMAIL").length
  const opened = priorEmails.filter(e => e.status === "OPENED" || e.status === "CLICKED").length
  const totalMeetingsCalls = meetings.length + calls.length

  // Active: has meetings or calls, or ongoing two-way exchange
  if (totalMeetingsCalls > 0) return "Active"

  // Not engaged at all yet
  if (sent === 0) return "Research stage"

  // Many attempts, zero response and zero opens
  if (sent >= 4 && received === 0 && opened === 0) return "Not reactive/ignoring"

  // Had replies at some point but now silent (we've sent significantly more than received)
  if (received > 0 && sent >= 3 && sent > received * 2) return "Reactive but silent"

  // Had at least one reply
  if (received > 0) return "Early stage emails"

  // Opened but no reply — still early stage
  if (opened > 0) return "Early stage emails"

  // Sent emails but nothing back yet
  return "Early stage emails"
}

export default function DraftPage() {
  const router = useRouter()
  const [contact, setContact] = useState<any>(null)
  const [context, setContext] = useState<any>(null)
  const [relationshipLevel, setRelationshipLevel] = useState<string>("")
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [progressLoading, setProgressLoading] = useState(false)
  const [intel, setIntel] = useState<{ companyNews: any[]; contactIntel: any[] } | null>(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [answers, setAnswers] = useState<PreDraftAnswers>(EMPTY_ANSWERS)
  const [draft, setDraft] = useState<any>(null)
  const [selectedSubject, setSelectedSubject] = useState("")
  const [editedBody, setEditedBody] = useState("")
  const [step, setStep] = useState<"loading" | "qa" | "draft">("loading")
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState<"subject" | "body" | "all" | null>(null)
  const [feedback, setFeedback] = useState("")
  const [revising, setRevising] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem("draftContact")
    if (!stored) { router.push("/queue"); return }
    const parsed = JSON.parse(stored)
    setContact(parsed)
    fetchContext(parsed)
  }, [])

  async function fetchProgress(company: string, reportLink: string) {
    setProgressLoading(true)
    try {
      const params = new URLSearchParams({ company })
      if (reportLink) params.set("reportLink", reportLink)
      const res = await fetch(`/api/progress?${params}`)
      const data = await res.json()
      if (!data.error) setProgress(data)
    } catch (_) {}
    finally { setProgressLoading(false) }
  }

  async function fetchIntel(c: any) {
    setIntelLoading(true)
    try {
      const params = new URLSearchParams({ company: c.company, contact: c.contactName })
      if (c.title) params.set("title", c.title)
      if (c.linkedin) params.set("linkedin", c.linkedin)
      const res = await fetch(`/api/intel?${params}`)
      const data = await res.json()
      if (!data.error) setIntel(data)
    } catch (_) {}
    finally { setIntelLoading(false) }
  }

  async function fetchContext(c: any) {
    setStep("loading")
    setError("")
    try {
      const res = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: c.company, contactEmail: c.email, dealId: c.dealId ?? null, region: c.region ?? null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setContext(data)
      // Prefer Airtable engagement status (authoritative) over HubSpot-derived
      const airtableStatus = data.airtable?.countryEngagementStatus
      const derivedLevel = deriveEngagementTag(data.priorEmails ?? [], data.meetings ?? [], data.calls ?? [])
      setRelationshipLevel(airtableStatus ?? derivedLevel)
      setStep("qa")
      // Kick off progress + intel fetches in parallel
      fetchProgress(c.company, data.airtable?.latestReportLink ?? "")
      fetchIntel(c)
    } catch (err: any) {
      setError(err.message)
      fetchProgress(c.company, "")
      fetchIntel(c)
      setStep("qa")
    }
  }

  async function generateDraft(revisionNote?: string) {
    if (!contact) return
    setGenerating(true)
    setError("")
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contact,
          priorEmails: context?.priorEmails ?? [],
          meetings: context?.meetings ?? [],
          calls: context?.calls ?? [],
          notes: context?.notes ?? [],
          deadlineStatus: context?.airtable?.deadlineStatus,
          reportingStatus: context?.airtable?.reportingStatus,
          commitmentLink: context?.airtable?.commitmentLink,
          latestReportLink: context?.airtable?.latestReportLink,
          latestReportYear: context?.airtable?.latestReportYear,
          // Airtable engagement status overrides HubSpot-derived
          countryEngagementStatus: context?.airtable?.countryEngagementStatus ?? null,
          progressData: progress && !progress.noDataFound ? progress.progressLines : null,
          progressSource: progress?.sourceNote ?? null,
          preDraftAnswers: answers,
          revisionNote: revisionNote ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDraft(data)
      setSelectedSubject(data.subjectLines?.[0] ?? "")
      setEditedBody(data.emailBody ?? "")
      setFeedback("")
      setStep("draft")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGenerating(false)
      setRevising(false)
    }
  }

  async function handleRevise() {
    if (!feedback.trim()) return
    setRevising(true)
    await generateDraft(feedback)
  }

  function toggleMulti(key: "shouldFeel" | "mustNotFeel", value: string) {
    setAnswers(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }))
  }

  function copyToClipboard(text: string, type: "subject" | "body" | "all") {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  if (!contact) return null

  // Resolve the best report link to show
  const reportLink = draft?.verifiedReportLink || context?.airtable?.latestReportLink
  const reportYear = draft?.verifiedReportYear || context?.airtable?.latestReportYear

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-2">
        <button onClick={() => router.push("/queue")} className="text-gray-400 hover:text-gray-700 text-sm">
          Queue
        </button>
        <span className="text-gray-300">/</span>
        <span className="text-gray-700 font-medium text-sm">
          {contact.contactName} at {contact.company}
        </span>
        {step === "draft" && (
          <>
            <span className="text-gray-300">/</span>
            <button
              onClick={() => setStep("qa")}
              className="text-gray-400 hover:text-blue-600 text-sm"
            >
              Edit Q&A
            </button>
          </>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-5 gap-6">

        {/* Left panel: context — always visible */}
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-medium text-gray-900 mb-3">Contact</h3>
            <dl className="space-y-1.5">
              {[
                ["Name", contact.contactName],
                ["Title", contact.title],
                ["Email", contact.email],
                ["Status", contact.status],
                ["Deadline", contact.deadline],
                ["Priority", contact.priority],
              ].map(([label, value]) => value ? (
                <div key={label} className="flex gap-2">
                  <dt className="text-gray-400 w-16 shrink-0 text-xs pt-0.5">{label}</dt>
                  <dd className="text-gray-800 text-xs break-all">{value}</dd>
                </div>
              ) : null)}
              {contact.region && (
                <div className="flex gap-2">
                  <dt className="text-gray-400 w-16 shrink-0 text-xs pt-0.5">Region</dt>
                  <dd className="text-xs">
                    <span className="text-gray-800">{contact.region}</span>
                    {contact.dealName && (
                      <span className="text-gray-400 ml-1 text-xs">({contact.dealName})</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {contact.note && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Note</p>
                <p className="text-xs text-gray-700">{contact.note}</p>
              </div>
            )}
            {contact.log && (
              <div className="mt-2">
                <p className="text-xs text-gray-400 mb-1">Log</p>
                <p className="text-xs text-gray-700">{contact.log}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            {/* Header: Company section with priority tag */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">Company</h3>
              <div className="flex items-center gap-2">
                {progressLoading && (
                  <div className="flex gap-0.5">
                    {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </div>
                )}
                {context?.airtable?.countryPriority && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${PRIORITY_TAG_COLORS[context.airtable.countryPriority] ?? "bg-gray-100 text-gray-500"}`}>
                    {context.airtable.countryPriority}
                  </span>
                )}
              </div>
            </div>

            {/* Deadline + reporting status */}
            {context?.airtable && (
              <dl className="space-y-1.5 text-xs mb-3">
                {context.airtable.deadlineStatus && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">Deadline</dt>
                    <dd className={context.airtable.deadlineStatus === "Overdue" ? "text-red-600 font-medium" : "text-gray-800"}>
                      {contact.deadline}{contact.deadline ? " — " : ""}{context.airtable.deadlineStatus}
                    </dd>
                  </div>
                )}
                {context.airtable.reportingStatus && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">Reporting</dt>
                    <dd className="text-gray-800">{context.airtable.reportingStatus}</dd>
                  </div>
                )}
              </dl>
            )}

            {/* Cage-free progress */}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-600">Cage-free progress</p>
                {progressLoading && (
                  <div className="flex gap-0.5">
                    {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-blue-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                  </div>
                )}
              </div>

              {/* ALWAYS show Airtable data — this is the primary source */}
              {context?.airtable && (
                <dl className="space-y-1.5 text-xs mb-2">
                  {context.airtable.globalCfPct != null && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Global</dt>
                      <dd className="font-semibold text-gray-900">{Math.round(context.airtable.globalCfPct * 100)}%</dd>
                    </div>
                  )}
                  {context.airtable.asiaCfPct != null && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Asia / APAC</dt>
                      <dd className="font-semibold text-gray-900">{Math.round(context.airtable.asiaCfPct * 100)}%</dd>
                    </div>
                  )}
                  {context.airtable.countryCfPct != null && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500">{context.airtable.countryName}</dt>
                      <dd className="font-semibold text-gray-900">{Math.round(context.airtable.countryCfPct * 100)}%</dd>
                    </div>
                  )}
                  {context.airtable.globalCfPct == null && context.airtable.asiaCfPct == null && context.airtable.countryCfPct == null && (
                    <p className="text-gray-400">No data in AAI database yet.</p>
                  )}
                </dl>
              )}

              {/* Web search — supplemental, in company's own format */}
              {progress && !progress.noDataFound && progress.progressLines.length > 0 && (() => {
                const dealCountry = (contact?.region ?? "").toLowerCase()
                const ASIA_KEYWORDS = ["asia", "apac", "asia pacific", "asia-pacific", "emerging", "apac"]
                const filteredLines = progress.progressLines.filter(line => {
                  const ll = line.label.toLowerCase()
                  return ASIA_KEYWORDS.some(k => ll.includes(k)) || (dealCountry && ll.includes(dealCountry))
                })
                const displayLines = filteredLines.length > 0 ? filteredLines : progress.progressLines
                return (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">
                      From report{(progress as any).reportingYear ? ` (${(progress as any).reportingYear})` : ""} — company's own format
                    </p>
                    <dl className="space-y-1 text-xs">
                      {displayLines.map((line, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <dt className="text-gray-400 flex-1">{line.label}</dt>
                          <dd className="font-medium text-gray-700 text-right">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {/* Diff flags */}
                    {context?.airtable && (() => {
                      const flags = diffWithAirtable(progress.progressLines, {
                        globalCfPct: context.airtable.globalCfPct,
                        asiaCfPct: context.airtable.asiaCfPct,
                        chinaCfPct: context.airtable.countryCfPct,
                      })
                      return flags.length > 0 ? (
                        <div className="mt-1.5 p-2 bg-amber-50 rounded">
                          <p className="text-xs font-medium text-amber-700 mb-0.5">Differs from Airtable</p>
                          {flags.map((f, i) => <p key={i} className="text-xs text-amber-600">⚠ {f}</p>)}
                        </div>
                      ) : <p className="text-xs text-green-600 mt-1">✓ Consistent with Airtable</p>
                    })()}
                    {progress.sourceUrl && (
                      <a href={progress.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline mt-1 block">
                        {progress.sourceNote ?? "View source"} ↗
                      </a>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Links */}
            {(reportLink || context?.airtable?.commitmentLink) && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                {reportLink && (
                  <div>
                    <span className="text-gray-400">Report {reportYear ? `(${reportYear})` : ""} — </span>
                    <a href={reportLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View ↗</a>
                  </div>
                )}
                {progress?.sourceUrl && progress.sourceUrl !== reportLink && (
                  <div>
                    <span className="text-gray-400">Source — </span>
                    <a href={progress.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{progress.sourceNote ?? "View"} ↗</a>
                  </div>
                )}
                {context?.airtable?.commitmentLink && (
                  <div>
                    <span className="text-gray-400">Commitment — </span>
                    <a href={context.airtable.commitmentLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View ↗</a>
                  </div>
                )}
              </div>
            )}

            {context?.hubspot?.crossRegionalFlag && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-amber-600">Also active in</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {context.hubspot.otherDeals.map((d: any) => d.properties.dealname).join(", ")}
                </p>
              </div>
            )}
          </div>

          {(context?.priorEmails?.length > 0 || context?.meetings?.length > 0) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-medium text-gray-900 mb-1">Engagement history</h3>
              <p className="text-xs text-gray-400 mb-3">
                {contact.dealName || "Deal"} — {context.priorEmails?.length ?? 0} emails, {context.meetings?.length ?? 0} meetings, {context.calls?.length ?? 0} calls
              </p>
              <div className="space-y-2">
                {/* Meetings */}
                {context.meetings?.slice(0, 3).map((m: any, i: number) => (
                  <div key={`m${i}`} className="text-xs border-l-2 border-green-200 pl-3">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded font-medium bg-green-100 text-green-700">Meeting</span>
                      <span className="text-gray-400">{m.date ? new Date(m.date).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="text-gray-600 mt-0.5">{m.title}</p>
                    {m.notes && <p className="text-gray-400 line-clamp-1">{m.notes.slice(0, 100)}</p>}
                  </div>
                ))}
                {/* Emails */}
                {context.priorEmails?.slice(0, 5).map((e: any, i: number) => (
                  <div key={`e${i}`} className="text-xs border-l-2 border-gray-100 pl-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded font-medium ${
                        e.direction === "INCOMING_EMAIL" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {e.direction === "INCOMING_EMAIL" ? "Reply" : "Sent"}
                      </span>
                      {e.status && e.status !== "SENT" && (
                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                          e.status === "OPENED" || e.status === "CLICKED" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"
                        }`}>{e.status}</span>
                      )}
                      <span className="text-gray-400">{e.date ? new Date(e.date).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="font-medium text-gray-700 mt-0.5 truncate">{e.subject}</p>
                    <p className="text-gray-400 line-clamp-1">{e.body?.slice(0, 120)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Company news */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900 text-sm">Recent company news</h3>
              {intelLoading && (
                <div className="flex gap-0.5">
                  {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              )}
            </div>
            {intel?.companyNews?.length ? (
              <div className="space-y-3">
                {intel.companyNews.map((item: any, i: number) => (
                  <div key={i} className="text-xs border-l-2 border-blue-100 pl-3">
                    <p className="font-medium text-gray-800">{item.headline}</p>
                    <p className="text-gray-500 mt-0.5">{item.summary}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.date && <span className="text-gray-400">{item.date}</span>}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-500 hover:underline">Source ↗</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : intelLoading ? (
              <p className="text-xs text-gray-400">Searching...</p>
            ) : (
              <p className="text-xs text-gray-400">No recent news found.</p>
            )}
          </div>

          {/* Contact LinkedIn intel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900 text-sm">Contact intel</h3>
              <span className="text-xs text-amber-600 font-medium">Flag — decide whether to use</span>
            </div>
            {intel?.contactIntel?.length ? (
              <div className="space-y-3">
                {intel.contactIntel.map((item: any, i: number) => (
                  <div key={i} className="text-xs border-l-2 border-amber-200 pl-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium capitalize">{item.type?.replace("_", " ")}</span>
                      {item.date && <span className="text-gray-400">{item.date}</span>}
                    </div>
                    <p className="text-gray-800">{item.summary}</p>
                    {item.relevance && <p className="text-gray-400 mt-0.5 italic">{item.relevance}</p>}
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-500 hover:underline mt-0.5 block">Source ↗</a>
                    )}
                  </div>
                ))}
              </div>
            ) : intelLoading ? (
              <p className="text-xs text-gray-400">Searching LinkedIn activity...</p>
            ) : (
              <p className="text-xs text-gray-400">No recent public activity found for this contact.</p>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="col-span-3 space-y-4">

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
          )}

          {/* STEP: Loading */}
          {step === "loading" && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <p className="text-sm text-gray-500">Pulling context from HubSpot and Airtable...</p>
              <div className="mt-3 flex justify-center gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* STEP: Q&A */}
          {step === "qa" && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Before drafting</h2>
                  {relationshipLevel && (
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ENGAGEMENT_TAG_COLORS[relationshipLevel as EngagementTag] ?? "bg-gray-100 text-gray-600"}`}>
                      {relationshipLevel}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Answer a few questions so the email is shaped by your intent, not just the data.
                </p>
                {relationshipLevel && (
                  <p className="text-xs text-gray-400 mt-1">
                    {relationshipLevel === "Active" && "Meetings or calls on record — keep it short, direct, reference shared history."}
                    {relationshipLevel === "Early stage emails" && "Emails sent, some engagement — build on prior contact without re-introducing fully."}
                    {relationshipLevel === "Research stage" && "No outreach yet — first email should introduce and set context."}
                    {relationshipLevel === "Escalation" && "Escalation path — reference prior silence, ask for direction to the right person."}
                    {relationshipLevel === "Reactive but silent" && "Was engaging, now quiet — acknowledge prior exchange, prompt gently."}
                    {relationshipLevel === "Not reactive/ignoring" && "Many attempts, no response — consider a fresh angle or different contact."}
                  </p>
                )}
              </div>

              {/* Primary goal */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Primary goal of this email
                </label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => setAnswers(prev => ({ ...prev, primaryGoal: opt }))}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        answers.primaryGoal === opt
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-gray-200 text-gray-600 hover:border-blue-300"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={GOAL_OPTIONS.includes(answers.primaryGoal) ? "" : answers.primaryGoal}
                  onChange={e => setAnswers(prev => ({ ...prev, primaryGoal: e.target.value }))}
                  placeholder="Or type a custom goal..."
                  className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Secondary goal */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Secondary goal <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={answers.secondaryGoal}
                  onChange={e => setAnswers(prev => ({ ...prev, secondaryGoal: e.target.value }))}
                  placeholder="e.g. Get progress data, warm up the relationship..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Should feel */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  After reading this, the company should feel...
                  <span className="text-gray-400 font-normal ml-1">(select all that apply)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {FEEL_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => toggleMulti("shouldFeel", opt)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        answers.shouldFeel.includes(opt)
                          ? "bg-green-600 text-white border-green-600"
                          : "border-gray-200 text-gray-600 hover:border-green-300"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Must NOT feel */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  They must NOT feel...
                  <span className="text-gray-400 font-normal ml-1">(select all that apply)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {NOT_FEEL_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => toggleMulti("mustNotFeel", opt)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        answers.mustNotFeel.includes(opt)
                          ? "bg-red-500 text-white border-red-500"
                          : "border-gray-200 text-gray-600 hover:border-red-300"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Include now / hold back */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">
                    Anything specific to include?
                    <span className="text-gray-400 font-normal ml-1 text-xs">(optional)</span>
                  </label>
                  <textarea
                    value={answers.includeNow}
                    onChange={e => setAnswers(prev => ({ ...prev, includeNow: e.target.value }))}
                    placeholder="e.g. Mention their Thailand progress, reference upcoming report..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">
                    Anything to hold back for a call?
                    <span className="text-gray-400 font-normal ml-1 text-xs">(optional)</span>
                  </label>
                  <textarea
                    value={answers.holdBack}
                    onChange={e => setAnswers(prev => ({ ...prev, holdBack: e.target.value }))}
                    placeholder="e.g. Campaign threat, detailed China supply data..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 resize-none"
                  />
                </div>
              </div>

              <button
                onClick={() => generateDraft()}
                disabled={generating}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 text-sm"
              >
                {generating ? "Generating draft..." : "Generate draft"}
              </button>
              <p className="text-xs text-gray-400 text-center -mt-2">
                All fields above are optional — you can skip any or all of them.
              </p>
            </div>
          )}

          {/* STEP: Draft */}
          {step === "draft" && draft && !generating && (
            <>
              {/* Relationship level + pre-email thinking */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    {draft.scenario}
                  </p>
                  {(draft.relationshipLevel || relationshipLevel) && (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                      ENGAGEMENT_TAG_COLORS[(draft.relationshipLevel || relationshipLevel) as EngagementTag] ?? "bg-gray-100 text-gray-600"
                    }`}>
                      {draft.relationshipLevel || relationshipLevel}
                    </span>
                  )}
                </div>
                {draft.relationshipSummary && (
                  <p className="text-xs text-blue-600 mb-2 italic">{draft.relationshipSummary}</p>
                )}
                <dl className="space-y-1 text-xs text-blue-800">
                  <div><dt className="font-medium inline">Should feel: </dt><dd className="inline">{draft.preEmailThinking?.feel}</dd></div>
                  <div><dt className="font-medium inline">Must not feel: </dt><dd className="inline">{draft.preEmailThinking?.notFeel}</dd></div>
                  <div><dt className="font-medium inline">Include now: </dt><dd className="inline">{draft.preEmailThinking?.include}</dd></div>
                  <div><dt className="font-medium inline">Hold back: </dt><dd className="inline">{draft.preEmailThinking?.holdBack}</dd></div>
                </dl>
                {draft.verifiedReportLink && draft.verifiedReportLink !== context?.airtable?.latestReportLink && (
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    <p className="text-xs text-blue-600">
                      Newer report found ({draft.verifiedReportYear}):&nbsp;
                      <a href={draft.verifiedReportLink} target="_blank" rel="noopener noreferrer"
                        className="underline hover:text-blue-800">View ↗</a>
                    </p>
                  </div>
                )}
              </div>

              {/* Subject line */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900">Subject line</h3>
                  <button onClick={() => copyToClipboard(selectedSubject, "subject")}
                    className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
                    {copied === "subject" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="space-y-2 mb-3">
                  {draft.subjectLines?.map((s: string, i: number) => (
                    <label key={i} className="flex items-start gap-3 cursor-pointer group">
                      <input type="radio" name="subject" value={s}
                        checked={selectedSubject === s}
                        onChange={() => setSelectedSubject(s)}
                        className="mt-0.5 accent-blue-600" />
                      <span className="text-sm text-gray-800">{s}</span>
                    </label>
                  ))}
                </div>
                <input type="text" value={selectedSubject}
                  onChange={e => setSelectedSubject(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Edit or type a custom subject..." />
              </div>

              {/* Email body */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900">Email body</h3>
                  <button onClick={() => copyToClipboard(editedBody, "body")}
                    className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
                    {copied === "body" ? "Copied!" : "Copy body"}
                  </button>
                </div>
                <textarea value={editedBody} onChange={e => setEditedBody(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm font-mono h-72 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed" />
              </div>

              {/* Copy all */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <button
                  onClick={() => copyToClipboard(`Subject: ${selectedSubject}\n\n${editedBody}`, "all")}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
                >
                  {copied === "all" ? "Copied to clipboard!" : "Copy subject + body"}
                </button>
                <p className="text-xs text-gray-400 text-center mt-2">
                  Paste into Outlook, activate Engagement Tracker, then send
                </p>
              </div>

              {/* Revision */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-medium text-gray-900 mb-2">Request a revision</h3>
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
                  placeholder="e.g. Make it shorter, add a booking link, warmer tone..."
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={handleRevise} disabled={!feedback.trim() || revising}
                  className="mt-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40">
                  {revising ? "Revising..." : "Revise"}
                </button>
              </div>
            </>
          )}

          {generating && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <p className="text-sm text-gray-500">Generating draft with Claude...</p>
              <div className="mt-3 flex justify-center gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
