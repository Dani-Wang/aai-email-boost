import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company")
  const reportLink = req.nextUrl.searchParams.get("reportLink") || ""

  if (!company) return NextResponse.json({ error: "Missing company" }, { status: 400 })

  try {
    const prompt = `You are researching cage-free egg progress for ${company}.

${reportLink ? `Their latest sustainability report is here: ${reportLink}` : "No report link on file."}

TASK:
1. Search for ${company}'s most recent cage-free egg progress data. Check their sustainability report, ESG report, animal welfare policy page, or any public announcement from 2023, 2024, or 2025.
   ${reportLink ? `Start with this link: ${reportLink}` : ""}
2. Extract EXACTLY how they report it — use their own category names (e.g. "Americas", "EMEA", "Asia Pacific", "managed properties", "franchised", specific brand names). Do NOT reformat into Global/Asia/China.
3. Always include the actual percentage or figure they state. If they say "66% cage-free in North America" then label="North America", value="66%". If they say "on track to reach 100% by 2025" then value="on track, target 100% by 2025".
4. If they report separately for different product types, brands, or markets — include each as a separate line.

Return a JSON object with this structure:
{
  "progressLines": [
    { "label": "exact category name as company uses it", "value": "exact figure or status they state" }
  ],
  "reportingYear": "the year this data covers, e.g. FY2024",
  "sourceNote": "e.g. 2025 Sustainability Report (covering FY2024)",
  "sourceUrl": "direct URL to the report page or PDF, or null",
  "noDataFound": false
}

If no cage-free progress data can be found, return { "noDataFound": true, "progressLines": [], "reportingYear": null, "sourceNote": null, "sourceUrl": null }.
Only include explicitly stated data. Do not estimate or infer.`

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as any],
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ noDataFound: true, progressLines: [], sourceNote: null, sourceUrl: null })

    return NextResponse.json(JSON.parse(jsonMatch[0]))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
