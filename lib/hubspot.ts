import { Client } from "@hubspot/api-client"

export const hubspot = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN })

export async function getChinalDeal(companyName: string) {
  const response = await hubspot.crm.deals.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "dealname",
            operator: "CONTAINS_TOKEN" as any,
            value: companyName,
          },
          {
            propertyName: "dealname",
            operator: "CONTAINS_TOKEN" as any,
            value: "China",
          },
        ],
      },
    ],
    properties: ["dealname", "dealstage", "pipeline", "hs_lastmodifieddate"],
    limit: 5,
  })
  return response.results
}

export async function getDealContacts(dealId: string) {
  const response = await (hubspot.crm.deals as any).associationsApi.getAll(
    dealId,
    "contacts"
  )
  return response.results
}

export async function getContactEmails(contactId: string) {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/emails?associations.contact=${contactId}&properties=hs_email_subject,hs_email_text,hs_email_direction,hs_timestamp,hs_email_status&limit=10&sort=-hs_timestamp`,
    { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } }
  )
  const data = await res.json()
  return data.results ?? []
}
