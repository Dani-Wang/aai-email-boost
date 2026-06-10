import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId")
  const contactId = req.nextUrl.searchParams.get("contactId")

  if (!dealId && !contactId) return NextResponse.json({ error: "Missing dealId or contactId" }, { status: 400 })

  try {
    // Fetch engagements ONLY from this specific contact
    // Deal-level engagements include all contacts in the deal — not what we want here
    let engagements: any[] = []

    if (contactId) {
      const res = await fetch(
        `https://api.hubapi.com/engagements/v1/engagements/associated/contact/${contactId}/paged?limit=100`,
        { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
      )
      if (res.ok) {
        const data = await res.json()
        engagements = data.results || []
      }
    }

    // Sort by date descending
    engagements.sort((a: any, b: any) => (b.engagement?.createdAt ?? 0) - (a.engagement?.createdAt ?? 0))

    // Categorise
    const emails = engagements.filter(e => e.engagement?.type === "EMAIL")
    const meetings = engagements.filter(e => e.engagement?.type === "MEETING")
    const calls = engagements.filter(e => e.engagement?.type === "CALL")
    const notes = engagements.filter(e => e.engagement?.type === "NOTE")

    const sentEmails = emails.filter(e => e.engagement?.direction !== "INBOUND")
    const receivedEmails = emails.filter(e => e.engagement?.direction === "INBOUND")
    const openedEmails = sentEmails.filter(e =>
      e.metadata?.status === "OPENED" || e.metadata?.status === "CLICKED"
    )

    function formatDate(ts: number | undefined): string {
      if (!ts) return ""
      return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    }

    // Engagement tag — same logic as frontend deriveEngagementTag
    const totalMeetingsCalls = meetings.length + calls.length
    let level = "Early stage emails"
    if (totalMeetingsCalls > 0) level = "Active"
    else if (sentEmails.length === 0) level = "Research stage"
    else if (sentEmails.length >= 4 && receivedEmails.length === 0 && openedEmails.length === 0) level = "Not reactive/ignoring"
    else if (receivedEmails.length > 0 && sentEmails.length >= 3 && sentEmails.length > receivedEmails.length * 2) level = "Reactive but silent"
    else if (receivedEmails.length > 0 || openedEmails.length > 0) level = "Early stage emails"

    return NextResponse.json({
      relationshipLevel: level,
      summary: {
        meetings: meetings.map(m => ({
          title: m.metadata?.title || "Meeting",
          date: formatDate(m.engagement?.createdAt),
          notes: m.metadata?.body?.slice(0, 120) || "",
        })),
        sentEmails: sentEmails.map(e => ({
          subject: e.metadata?.subject || "(no subject)",
          date: formatDate(e.engagement?.createdAt),
          status: e.metadata?.status || "SENT",
        })),
        receivedEmails: receivedEmails.map(e => ({
          subject: e.metadata?.subject || "(no subject)",
          date: formatDate(e.engagement?.createdAt),
          preview: (e.metadata?.text || "").slice(0, 120),
        })),
        calls: calls.map(c => ({
          date: formatDate(c.engagement?.createdAt),
          notes: c.metadata?.body?.slice(0, 120) || "",
          disposition: c.metadata?.disposition || "",
        })),
        notes: notes.slice(0, 3).map(n => ({
          date: formatDate(n.engagement?.createdAt),
          body: n.metadata?.body?.slice(0, 150) || "",
        })),
      },
      counts: {
        meetings: meetings.length,
        sent: sentEmails.length,
        opened: openedEmails.length,
        received: receivedEmails.length,
        calls: calls.length,
      },
      lastContactDate: engagements[0]?.engagement?.createdAt
        ? formatDate(engagements[0].engagement.createdAt)
        : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
