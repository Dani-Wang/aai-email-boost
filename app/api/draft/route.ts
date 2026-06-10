import { generateDraft, ContactContext } from "@/lib/claude"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const context: ContactContext = body

  try {
    const draft = await generateDraft(context)
    return NextResponse.json(draft)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
