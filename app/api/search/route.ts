import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim()
  if (!query || query.length < 2) return NextResponse.json({ contacts: [] })

  try {
    // Use HubSpot's query field — searches firstname, lastname, email, company automatically
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        properties: ["firstname", "lastname", "email", "jobtitle", "company"],
        limit: 8,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error("HubSpot search error:", JSON.stringify(data))
      return NextResponse.json({ contacts: [], error: data.message }, { status: 200 })
    }

    const contacts = (data.results || []).map((c: any) => ({
      type: "contact",
      id: c.id,
      name: `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim(),
      title: c.properties.jobtitle ?? "",
      email: c.properties.email ?? "",
      company: c.properties.company ?? "",
    }))

    return NextResponse.json({ contacts })
  } catch (err: any) {
    console.error("Search fetch failed:", err.message)
    return NextResponse.json({ contacts: [] }, { status: 200 })
  }
}
