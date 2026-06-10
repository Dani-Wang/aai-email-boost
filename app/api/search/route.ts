import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim()
  if (!query || query.length < 2) return NextResponse.json({ contacts: [] })

  try {
    // Use direct HubSpot REST API — avoids SDK compatibility issues
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: query }] },
          { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: query }] },
          { filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: query }] },
          { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN", value: query }] },
        ],
        properties: ["firstname", "lastname", "email", "jobtitle", "company"],
        limit: 8,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: err }, { status: 500 })
    }

    const data = await res.json()
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
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
