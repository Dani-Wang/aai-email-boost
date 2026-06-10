import { hubspot } from "@/lib/hubspot"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim()
  if (!query || query.length < 2) return NextResponse.json({ contacts: [] })

  try {
    // Search contacts only — deals search removed to keep this fast
    const contactsRes = await hubspot.crm.contacts.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN" as any, value: query }] },
        { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN" as any, value: query }] },
        { filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN" as any, value: query }] },
        { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN" as any, value: query }] },
      ],
      properties: ["firstname", "lastname", "email", "jobtitle", "company"],
      limit: 8,
    })

    const contacts = contactsRes.results.map((c: any) => ({
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
