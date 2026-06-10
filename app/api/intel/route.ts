import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company") ?? ""
  const contactName = req.nextUrl.searchParams.get("contact") ?? ""
  const contactTitle = req.nextUrl.searchParams.get("title") ?? ""
  const linkedinUrl = req.nextUrl.searchParams.get("linkedin") ?? ""

  if (!company) return NextResponse.json({ error: "Missing company" }, { status: 400 })

  // Run company news and contact LinkedIn searches in parallel
  const [companyNews, contactIntel] = await Promise.allSettled([

    // 1. Company sustainability / cage-free news
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as any],
      messages: [{
        role: "user",
        content: `Search for recent news (2024 or 2025) about "${company}" related to sustainability, cage-free eggs, animal welfare, ESG, or supply chain commitments. Return a JSON object:
{
  "items": [
    { "headline": "...", "summary": "one sentence", "date": "approximate date or year", "url": "source URL or null" }
  ]
}
Maximum 3 items. Only include genuinely relevant items. If nothing found, return { "items": [] }.`
      }],
    }),

    // 2. Contact LinkedIn / recent activity
    contactName ? client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as any],
      messages: [{
        role: "user",
        content: `Search for recent public activity from ${contactName}${contactTitle ? `, ${contactTitle}` : ""} at ${company}. ${linkedinUrl ? `Their LinkedIn: ${linkedinUrl}` : ""}
Look for: recent LinkedIn posts, job changes, public statements, conference talks, interviews, or any mentions related to sustainability, supply chain, or animal welfare.
Return a JSON object:
{
  "items": [
    { "type": "post|job_change|interview|mention", "summary": "one sentence description", "date": "approximate date", "relevance": "why this might be useful for outreach", "url": "source URL or null" }
  ]
}
Maximum 3 items. Only include real, verifiable findings. If nothing found, return { "items": [] }.`
      }],
    }) : Promise.resolve(null),
  ])

  function extractJson(result: PromiseSettledResult<any>): any {
    if (result.status === "rejected") return { items: [] }
    const text = result.value?.content
      ?.filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("") ?? ""
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { items: [] }
    try { return JSON.parse(match[0]) } catch { return { items: [] } }
  }

  return NextResponse.json({
    companyNews: extractJson(companyNews).items ?? [],
    contactIntel: extractJson(contactIntel).items ?? [],
  })
}
