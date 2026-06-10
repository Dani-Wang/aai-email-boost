import { NextRequest, NextResponse } from "next/server"

async function openRouterChat(prompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aai-email-boost.vercel.app",
    },
    body: JSON.stringify({
      model: "mistralai/mistral-7b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
    }),
  })
  const data = await res.json()
  if (!res.ok) return ""
  return data.choices?.[0]?.message?.content ?? ""
}

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company") ?? ""
  const contactName = req.nextUrl.searchParams.get("contact") ?? ""
  const contactTitle = req.nextUrl.searchParams.get("title") ?? ""
  const linkedinUrl = req.nextUrl.searchParams.get("linkedin") ?? ""

  if (!company) return NextResponse.json({ error: "Missing company" }, { status: 400 })

  // Run company news and contact LinkedIn searches in parallel
  const [companyNews, contactIntel] = await Promise.allSettled([

    // 1. Company sustainability / cage-free news
    openRouterChat(`Search your knowledge for recent news (2024 or 2025) about "${company}" related to sustainability, cage-free eggs, animal welfare, ESG, or supply chain commitments. Return a JSON object:
{
  "items": [
    { "headline": "...", "summary": "one sentence", "date": "approximate date or year", "url": "source URL or null" }
  ]
}
Maximum 3 items. Only include genuinely relevant items. If nothing found, return { "items": [] }.`),

    // 2. Contact LinkedIn / recent activity
    contactName ? openRouterChat(`Search your knowledge for recent public activity from ${contactName}${contactTitle ? `, ${contactTitle}` : ""} at ${company}. ${linkedinUrl ? `Their LinkedIn: ${linkedinUrl}` : ""}
Look for: recent LinkedIn posts, job changes, public statements, conference talks, interviews, or any mentions related to sustainability, supply chain, or animal welfare.
Return a JSON object:
{
  "items": [
    { "type": "post|job_change|interview|mention", "summary": "one sentence description", "date": "approximate date", "relevance": "why this might be useful for outreach", "url": "source URL or null" }
  ]
}
Maximum 3 items. Only include real, verifiable findings. If nothing found, return { "items": [] }.`) : Promise.resolve(null),
  ])

  function extractJson(result: PromiseSettledResult<any>): any {
    if (result.status === "rejected") return { items: [] }
    const text = typeof result.value === "string" ? result.value : ""
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { items: [] }
    try { return JSON.parse(match[0]) } catch { return { items: [] } }
  }

  return NextResponse.json({
    companyNews: extractJson(companyNews).items ?? [],
    contactIntel: extractJson(contactIntel).items ?? [],
  })
}
