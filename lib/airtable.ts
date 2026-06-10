const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const MASTER_LIST_TABLE = "tblyPzFqgSnAIT9E9"

// Map region names to Airtable outreach column names
export const REGION_TO_OUTREACH_COLUMN: Record<string, string> = {
  "China":       "China Outreach",
  "Thailand":    "Thailand Outreach",
  "Indonesia":   "Indonesia Outreach",
  "Philippines": "Philippines Outreach",
  "Malaysia":    "Malaysia Outreach",
  "Vietnam":     "Vietnam Outreach",
  "Hong Kong":   "China Outreach", // HK uses China column
}

// Priority tag values as they appear in Airtable outreach columns
export const PRIORITY_TAGS = ["High", "Medium", "Low", "Campaign", "No Outreach", "N.A"]

export const PRIORITY_TAG_COLORS: Record<string, string> = {
  "High":         "bg-red-500 text-white",
  "Medium":       "bg-yellow-200 text-yellow-800",
  "Low":          "bg-cyan-100 text-cyan-700",
  "Campaign":     "bg-purple-600 text-white",
  "No Outreach":  "bg-gray-700 text-white",
  "N.A":          "bg-gray-100 text-gray-500",
}

async function airtableRequest(path: string) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`)
  return res.json()
}

export async function getCompanyFromAirtable(companyName: string) {
  const filterFormula = encodeURIComponent(`SEARCH("${companyName}", {Company Name})`)
  const fields = [
    "Company Name",
    "Industry Type",
    "Global Deadline Year",
    "Deadline Status",
    "Global CF Pct",
    "CF Pct Asia or APAC 2025",
    "CF Pct China 2025 (If not included in Asia)",
    // Country-specific CF% from Research Staging linked data — may not exist on all records
    "CF Pct China 2025 (If not included in Asia)",
    "Reporting Status",
    "Policy Coverage",
    "Commitment Link",
    "Report Link 2023",
    "Report Link 2024",
    "Report Link 2025",
    "Report Link 2026",
    // All country outreach columns
    "China Outreach",
    "Thailand Outreach",
    "Indonesia Outreach",
    "Philippines Outreach",
    "Malaysia Outreach",
    "Vietnam Outreach",
    "AAI Comments",
  ]
  const fieldsParam = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join("&")
  const data = await airtableRequest(
    `${MASTER_LIST_TABLE}?filterByFormula=${filterFormula}&${fieldsParam}&maxRecords=1`
  )
  return data.records?.[0] ?? null
}
