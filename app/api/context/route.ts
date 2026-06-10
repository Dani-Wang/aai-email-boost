import { getCompanyFromAirtable, REGION_TO_PRIORITY_COLUMN, REGION_TO_STATUS_COLUMN, PRIORITY_TAGS } from "@/lib/airtable"
import { NextRequest, NextResponse } from "next/server"

async function hubspotPost(path: string, body: any) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HubSpot ${path} error: ${res.status}`)
  return res.json()
}

async function fetchEngagements(entityType: "deal" | "contact", entityId: string): Promise<any[]> {
  const res = await fetch(
    `https://api.hubapi.com/engagements/v1/engagements/associated/${entityType}/${entityId}/paged?limit=50`,
    { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || []
}

export async function POST(req: NextRequest) {
  const { company, contactEmail, dealId, region, dealName } = await req.json()

  try {
    const [airtableRecord, dealsResponse] = await Promise.all([
      getCompanyFromAirtable(company),
      hubspotPost("/crm/v3/objects/deals/search", {
        filterGroups: [{ filters: [{ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: company }] }],
        properties: ["dealname", "dealstage", "hs_lastmodifieddate"],
        limit: 10,
      }),
    ])

    const chinaDeal = (dealsResponse.results ?? []).find(
      (d: any) => d.properties.dealname.toLowerCase().includes("china")
    ) ?? null
    const otherDeals = (dealsResponse.results ?? []).filter(
      (d: any) => !d.properties.dealname.toLowerCase().includes("china")
    )

    // Fetch engagements ONLY from this specific contact — not from the deal
    // (deal engagements include all contacts; we only want this person's history)
    let allEngagements: any[] = []
    if (contactEmail) {
      try {
        const contactSearch = await hubspotPost("/crm/v3/objects/contacts/search", {
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: contactEmail }] }],
          properties: ["firstname", "lastname", "email"],
          limit: 1,
        })
        if ((contactSearch.results ?? []).length > 0) {
          const contactId = contactSearch.results[0].id
          allEngagements = await fetchEngagements("contact", contactId).catch(() => [])
        }
      } catch (_) {}
    }

    // Sort all engagements by date descending
    allEngagements.sort((a: any, b: any) =>
      (b.engagement?.createdAt ?? 0) - (a.engagement?.createdAt ?? 0)
    )

    // Separate into typed lists
    const priorEmails = allEngagements
      .filter((e: any) => e.engagement?.type === "EMAIL")
      .map((e: any) => ({
        subject: e.metadata?.subject || "(no subject)",
        body: e.metadata?.text || e.metadata?.html || "",
        date: e.engagement?.createdAt ? new Date(e.engagement.createdAt).toISOString() : "",
        direction: e.engagement?.direction === "INBOUND" ? "INCOMING_EMAIL" : "EMAIL",
        // Email open/click/reply status from HubSpot tracking
        status: e.metadata?.status ?? null,  // SENT, OPENED, CLICKED, BOUNCED
      }))

    const meetings = allEngagements
      .filter((e: any) => e.engagement?.type === "MEETING")
      .map((e: any) => ({
        title: e.metadata?.title || "Meeting",
        date: e.engagement?.createdAt ? new Date(e.engagement.createdAt).toISOString() : "",
        notes: e.metadata?.body || "",
      }))

    const calls = allEngagements
      .filter((e: any) => e.engagement?.type === "CALL")
      .map((e: any) => ({
        date: e.engagement?.createdAt ? new Date(e.engagement.createdAt).toISOString() : "",
        notes: e.metadata?.body || "",
        disposition: e.metadata?.disposition || "",
      }))

    const notes = allEngagements
      .filter((e: any) => e.engagement?.type === "NOTE")
      .map((e: any) => ({
        date: e.engagement?.createdAt ? new Date(e.engagement.createdAt).toISOString() : "",
        body: e.metadata?.body || "",
      }))

    const f = airtableRecord?.fields ?? {}
    const latestReportLink = f["Report Link 2026"] || f["Report Link 2025"] || f["Report Link 2024"] || f["Report Link 2023"] || null
    const latestReportYear = f["Report Link 2026"] ? "2026" : f["Report Link 2025"] ? "2025" : f["Report Link 2024"] ? "2024" : f["Report Link 2023"] ? "2023" : null

    // Determine the country for Airtable lookup
    // Priority: (1) direct region match, (2) country from deal name
    const COUNTRIES = ["China", "Thailand", "Indonesia", "Vietnam", "Malaysia", "Philippines", "Hong Kong"]
    const countryFromDeal = dealName
      ? COUNTRIES.find(c => dealName.toLowerCase().includes(c.toLowerCase())) ?? null
      : null
    const lookupCountry = (region && REGION_TO_PRIORITY_COLUMN[region])
      ? region
      : (countryFromDeal ?? region ?? "")

    // Priority: read from the priority column for this country
    const priorityColumnName = lookupCountry ? REGION_TO_PRIORITY_COLUMN[lookupCountry] ?? null : null
    const priorityValues: string[] = priorityColumnName
      ? (f[priorityColumnName] ?? []).map((v: any) => typeof v === "object" ? v.name?.trim() : String(v).trim())
      : []
    const countryPriority = priorityValues.find(v => PRIORITY_TAGS.includes(v)) ?? null

    // Engagement status: China uses its own separate "China Outreach Status" field
    // Other countries: status is in the same combined outreach column
    const ENGAGEMENT_STATUS_TAGS = [
      "Active", "Early stage emails", "Research stage",
      "Escalation", "Reactive but silent", "Not reactive/ignoring",
    ]
    const statusColumnName = lookupCountry ? REGION_TO_STATUS_COLUMN[lookupCountry] ?? null : null
    const statusValues: string[] = statusColumnName
      ? (f[statusColumnName] ?? []).map((v: any) => typeof v === "object" ? v.name?.trim() : String(v).trim())
      : []
    const rawEngagementValue = statusValues.find(v =>
      ENGAGEMENT_STATUS_TAGS.some(tag => v.toLowerCase().startsWith(tag.toLowerCase()))
    ) ?? null
    const countryEngagementStatus = rawEngagementValue
      ? ENGAGEMENT_STATUS_TAGS.find(tag =>
          rawEngagementValue.toLowerCase().startsWith(tag.toLowerCase())
        ) ?? null
      : null

    // Country-level CF% — only for the matching deal country
    const COUNTRY_CF_FIELDS: Record<string, string> = {
      "China":       "CF Pct China 2025 (If not included in Asia)",
      "Hong Kong":   "CF Pct China 2025 (If not included in Asia)",
    }
    const countryField = region ? COUNTRY_CF_FIELDS[region] ?? null : null
    const countryCfPct = countryField ? (f[countryField] ?? null) : null

    return NextResponse.json({
      airtable: {
        // All three tiers — always include when data exists
        globalCfPct: f["Global CF Pct"] ?? null,
        asiaCfPct: f["CF Pct Asia or APAC 2025"] ?? null,
        countryCfPct,      // only for the deal's matching country
        countryName: region ?? null,
        deadlineYear: f["Global Deadline Year"],
        deadlineStatus: f["Deadline Status"],
        reportingStatus: f["Reporting Status"]?.name ?? f["Reporting Status"],
        commitmentLink: f["Commitment Link"],
        latestReportLink,
        latestReportYear,
        // Country-specific priority and engagement status — from Airtable outreach column
        countryPriority,
        countryEngagementStatus,  // authoritative — overrides HubSpot-derived status
        outreachRegion: region ?? null,
        aaiComments: f["AAI Comments"],
      },
      hubspot: {
        chinaDeal,
        otherDeals,
        crossRegionalFlag: otherDeals.length > 0,
      },
      priorEmails,
      meetings,
      calls,
      notes,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
