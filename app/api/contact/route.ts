import { hubspot } from "@/lib/hubspot"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("id")
  if (!contactId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  try {
    // Get contact properties — country = HubSpot's Country/Region field
    const contact = await hubspot.crm.contacts.basicApi.getById(
      contactId,
      ["firstname", "lastname", "email", "jobtitle", "company", "country",
       "hs_linkedin_profile_url", "linkedin_url", "notes_last_contacted",
       "hubspot_owner_id", "hs_content_membership_notes"]
    )
    const p = contact.properties
    const contactName = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim()
    // "country" is the HubSpot property name for the "Country/Region" field
    const region = p.country ?? ""
    // LinkedIn — try both standard and custom fields
    const linkedinUrl = p.hs_linkedin_profile_url || p.linkedin_url || ""

    // Only fetch deals explicitly linked to this contact in HubSpot
    let deals: any[] = []
    try {
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
        { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
      )
      if (assocRes.ok) {
        const assocData = await assocRes.json()
        const dealIds: string[] = (assocData.results || []).map((r: any) => r.id).slice(0, 10)
        if (dealIds.length > 0) {
          const dealsRes = await fetch(
            `https://api.hubapi.com/crm/v3/objects/deals/batch/read`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({ inputs: dealIds.map(id => ({ id })), properties: ["dealname", "dealstage"] }),
            }
          )
          if (dealsRes.ok) {
            const data = await dealsRes.json()
            deals = (data.results || []).map((d: any) => ({
              id: d.id,
              name: d.properties.dealname,
              stage: d.properties.dealstage,
            }))
          }
        }
      }
    } catch (_) {}

    // Try to get company name from associated company if not on contact
    let company = p.company ?? ""
    if (!company) {
      try {
        const companyAssocRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/companies`,
          { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
        )
        if (companyAssocRes.ok) {
          const companyAssocData = await companyAssocRes.json()
          const companyId = companyAssocData.results?.[0]?.id
          if (companyId) {
            const companyRes = await fetch(
              `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name`,
              { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
            )
            if (companyRes.ok) {
              const companyData = await companyRes.json()
              company = companyData.properties?.name ?? ""
            }
          }
        }
      } catch (_) {}
    }

    return NextResponse.json({
      id: contactId,
      company,
      contactName,
      title: p.jobtitle ?? "",
      email: p.email ?? "",
      region,  // HubSpot "country" property = the "Country/Region" field shown in HubSpot
      linkedin: linkedinUrl,
      deals,
    })
  } catch (err: any) {
    console.error("Contact fetch error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
