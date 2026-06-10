// OpenRouter — free tier with Llama 3.3 70B
async function openRouterChat(prompt: string, maxTokens = 4000): Promise<string> {
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
      max_tokens: maxTokens,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? "OpenRouter error")
  return data.choices?.[0]?.message?.content ?? ""
}

export interface PreDraftAnswers {
  primaryGoal: string        // e.g. "Get a reply", "Request a meeting"
  secondaryGoal: string      // e.g. "Get data", "Find the right contact"
  shouldFeel: string[]       // e.g. ["Mild urgency", "Accountability"]
  mustNotFeel: string[]      // e.g. ["Defensive", "Comfortable ignoring"]
  includeNow: string         // free text — what to include
  holdBack: string           // free text — what to save for a call
}

export interface ContactContext {
  // From pipeline row / form
  company: string
  contactName: string
  title: string
  email: string
  deadline: string
  status: string
  region: string
  progress: string
  log: string
  nextStep: string
  note: string
  // From HubSpot — full engagement history
  priorEmails: { subject: string; body: string; date: string; direction: string; status?: string | null }[]
  meetings: { title: string; date: string; notes: string }[]
  calls: { date: string; notes: string; disposition: string }[]
  notes: { date: string; body: string }[]
  // From Airtable + report search
  deadlineStatus?: string
  reportingStatus?: string
  commitmentLink?: string
  latestReportLink?: string
  latestReportYear?: string
  // Flexible progress in the company's own reporting format
  progressData?: { label: string; value: string }[] | null
  progressSource?: string | null
  // Pre-draft Q&A answers (Fortify framework)
  preDraftAnswers?: PreDraftAnswers
  // Optional revision instruction
  revisionNote?: string | null
}

const SHARED_LAYER_GUIDELINES = `
You are helping draft corporate outreach emails for country leads at Asia Accountability Initiative (AAI)
and its partner initiatives. AAI holds food companies accountable for their cage-free egg commitments
across Asia, with country leads working on China, Thailand, Indonesia, Vietnam, Malaysia, and the Philippines.

═══════════════════════════════════════
SHARED LAYER — applies to all country leads
═══════════════════════════════════════

TONE LADDER:
- Email 1: Warm, credible, single clear ask. Introduce the organisation on first contact only.
- Follow-up 1: Short polite nudge. Offer to redirect if wrong person. No repeated intro.
- Follow-up 2: Slightly firmer. Include a booking link if not sent before. Still warm.
- Escalation: New or more senior contact. Reference prior silence factually, not accusatorially.
- Campaign: Only after documented evidence and team approval. Not handled here.

UNIVERSAL EMAIL RULES:
1. ONE ask per email. Multiple asks get ignored.
2. Short wins. Long explanatory emails do not get replies.
3. Speak corporate language, not activist language.
   Use: "sustainable sourcing progress", "cage-free transition", "regional reporting"
   Avoid: campaign framing, emotional appeals, words like "cruelty" or "torture"
4. Stay factual and question-based until escalation.
5. Follow-ups must always be shorter than the previous email.
6. Never repeat sentences or phrases from prior emails.
7. Always offer a redirect line at the end ("if someone else is better placed, I'd welcome the introduction").
8. No em dashes. Use commas, periods, or "and" instead.

EQUITY FRAMING (core leverage — use in all regions):
The central argument is: "You have already done this in Europe and North America. Why not here?"
- Use the company's progress elsewhere as proof of capability, not just as praise.
- Bridge from their global achievement into the specific country or region you are writing about.
- This framing works for all country leads, not just China.

PRE-EMAIL THINKING (answer before every draft):
1. What should the company feel after reading this? (urgency, curiosity, mild accountability?)
2. What must they NOT feel? (comfortable ignoring it, defensive, targeted unfairly?)
3. What information is essential to include now?
4. What should be held back for a call?

EMAIL SEQUENCE LOGIC:
- If no prior emails: write Email 1. Include org introduction. Single ask.
- If 1 prior outbound email, no reply: write Follow-up 1. Short. No repeated intro. Redirect offer.
- If 2 prior outbound emails, no reply: write Follow-up 2. Even shorter. Include booking link if not sent before.
- If company has replied: respond directly to their message. Two paragraphs max: (1) reply to their point, (2) move toward a meeting or next step.
- If company has been silent for 3+ emails: flag for escalation to a different contact.

SUBJECT LINE RULES:
- Offer 3 options, each tailored to the contact's specific title and role.
- For senior roles (VP, Director, C-suite): lead with the business or strategic angle.
- For sustainability/CSR roles: lead with the commitment or progress angle.
- For procurement roles: lead with supply chain or sourcing angle.

COMMON COMPANY EXCUSES AND COUNTERS:
- "Local office — global commitment does not apply to us"
  → Return to the public global commitment. Ask what the local plan is.
- "Supply not available / market challenges"
  → Reference growth of cage-free supply in the region. Offer to connect with GFP or IQC.
- "Cannot share data — confidential"
  → Ask only for direction of travel or a percentage range, not exact numbers.
- "We are working on it / making progress"
  → Ask for a date, a roadmap, or a preview of the next report.
- Redirected to annual report
  → Acknowledge the report. Ask for a country-specific breakdown not covered there.

SPAM FILTER AWARENESS:
- Some companies filter emails containing "cage-free". If context suggests this risk, use alternatives:
  "ethically sourced eggs", "hens raised without cages", "uncaged eggs", "sustainable egg sourcing"

═══════════════════════════════════════
USER LAYER — additional rules for this specific user
═══════════════════════════════════════
- Lead with specific, accurate praise anchored in the company's actual report or public data.
  Name specific brands, regions, or product lines — not generic compliments.
- Use the company's achievement in one region as a bridge into the region you are writing about.
  Their proven capability elsewhere is the launching point, not just context.
- Frame the ask as cooperative and partnership-building:
  "informal introduction", "share notes", "explore common ground"
- Keep tone warm and collaborative throughout. Save firmer language for escalation scenarios only.
`

export async function generateDraft(context: ContactContext): Promise<{
  preEmailThinking: { feel: string; notFeel: string; include: string; holdBack: string }
  scenario: string
  subjectLines: string[]
  emailBody: string
}> {
  const sentEmails = (context.priorEmails ?? []).filter(e => e.direction === "EMAIL")
  const receivedEmails = (context.priorEmails ?? []).filter(e => e.direction === "INCOMING_EMAIL")
  const followUpCount = sentEmails.length
  const hasALAIntro = followUpCount > 0
  const hasBookingLink = sentEmails.some(e =>
    e.body.toLowerCase().includes("calendar") || e.body.toLowerCase().includes("booking")
  )
  const openedEmails = sentEmails.filter(e => e.status === "OPENED" || e.status === "CLICKED")
  const meetings = context.meetings ?? []
  const calls = context.calls ?? []
  const notes = context.notes ?? []

  // Build a relationship summary for Claude to reason from
  const relationshipSummary = `
RELATIONSHIP HISTORY WITH ${context.contactName.toUpperCase()}:
- Emails sent by us: ${sentEmails.length}
- Replies received: ${receivedEmails.length}
- Emails opened (tracked): ${openedEmails.length}
- Meetings on record: ${meetings.length}${meetings.length > 0 ? " — " + meetings.map(m => `"${m.title}" on ${new Date(m.date).toLocaleDateString()}`).join(", ") : ""}
- Calls on record: ${calls.length}
- Notes on record: ${notes.length}${notes.length > 0 ? "\n  Notes: " + notes.slice(0, 2).map(n => n.body.slice(0, 100)).join(" | ") : ""}

ENGAGEMENT STATUS:
${(context as any).countryEngagementStatus
  ? `Airtable has already classified this as: "${(context as any).countryEngagementStatus}" — use this, do not override it.`
  : `Classify using one of these six tags:`
}
- "Active": meetings or calls on record, or ongoing two-way exchange
- "Early stage emails": emails sent, some engagement (opens or replies), no meeting yet
- "Research stage": in CRM but no outreach sent yet
- "Escalation": multiple rounds without response, escalated to senior contact
- "Reactive but silent": had replies before but has gone quiet — we've sent far more than received
- "Not reactive/ignoring": many emails sent, zero opens, zero replies

This tag must directly shape every sentence:
- Active → short, direct, no intro needed, reference specific shared history (meeting/call/last discussion)
- Early stage emails → warm, some context, reference prior email or open, build rapport
- Research stage → full introduction, set context, single clear ask
- Escalation → direct, reference silence factually, ask for direction to right person
- Reactive but silent → acknowledge prior engagement warmly, gentle nudge, short
- Not reactive/ignoring → try a different angle, keep very short, or suggest a different contact

FULL EMAIL HISTORY (most recent first):
${(context.priorEmails ?? []).slice(0, 6).map(e =>
    `[${e.date ? new Date(e.date).toLocaleDateString() : "?"}] ${e.direction === "INCOMING_EMAIL" ? "REPLY FROM THEM" : `SENT BY US${e.status ? ` (${e.status})` : ""}`}
Subject: ${e.subject}
${e.body.slice(0, 300)}${e.body.length > 300 ? "..." : ""}`
  ).join("\n\n---\n\n") || "No emails on record."}
`

  const prompt = `
${SHARED_LAYER_GUIDELINES}

CONTACT CONTEXT:
Company: ${context.company}
Contact: ${context.contactName}, ${context.title}
Email: ${context.email}
Region: ${context.region}
Deadline: ${context.deadline} (Status: ${context.deadlineStatus ?? "unknown"})
Pipeline Status: ${context.status}
Progress note: ${context.progress}
Pipeline log: ${context.log}
Next step note: ${context.note}

COMPANY DATA:
- Reporting status: ${context.reportingStatus ?? "unknown"}
- Deadline status: ${context.deadlineStatus ?? "unknown"}
- Commitment link: ${context.commitmentLink ?? "not found"}
- Latest report on file: ${context.latestReportLink ? `${context.latestReportYear} report — ${context.latestReportLink}` : "none on file"}

CAGE-FREE PROGRESS (in the company's own reporting format):
${context.progressData && context.progressData.length > 0
  ? context.progressData.map((l: any) => `- ${l.label}: ${l.value}`).join("\n") + (context.progressSource ? `\n(Source: ${context.progressSource})` : "")
  : "No progress data found — Claude should search for this during draft generation."
}

PRE-DRAFT ANSWERS FROM USER:
- Primary goal: ${context.preDraftAnswers?.primaryGoal ?? "not specified"}
- Secondary goal: ${context.preDraftAnswers?.secondaryGoal ?? "not specified"}
- Company should feel: ${context.preDraftAnswers?.shouldFeel?.join(", ") || "not specified"}
- Company must NOT feel: ${context.preDraftAnswers?.mustNotFeel?.join(", ") || "not specified"}
- User wants to include: ${context.preDraftAnswers?.includeNow || "not specified"}
- User wants to hold back: ${context.preDraftAnswers?.holdBack || "not specified"}

${relationshipSummary}

FOLLOW-UP STATE:
- AAI intro already given: ${hasALAIntro}
- Booking link already sent: ${hasBookingLink}
- This is email number: ${followUpCount + 1}

${context.revisionNote ? `REVISION REQUEST:\n"${context.revisionNote}"\nKeep the same scenario and context. Apply this feedback to the subject lines and email body.` : ""}

TASK:
1. Classify the engagement status using one of the six tags above. This is the most important step — it determines tone, length, and opener.
2. Search the web for: (a) the most recent cage-free or sustainability report from ${context.company}, (b) any new progress announcements in 2024 or 2025. Use as praise anchors.
3. Based on relationship level and pre-draft answers, determine the email scenario and pre-email thinking.
4. Draft 3 subject line options tailored to this contact's title and role.
5. Draft the email body. Relationship level must be visible in every sentence — the tone, length, opener, and references to past interaction should all reflect how well these two people know each other.

Return your response as a JSON object with this exact structure:
{
  "relationshipLevel": "Active | Early stage emails | Research stage | Escalation | Reactive but silent | Not reactive/ignoring",
  "relationshipSummary": "one sentence explaining why — e.g. '2 sent emails, both opened, one brief reply received'",
  "preEmailThinking": {
    "feel": "what the company should feel",
    "notFeel": "what they must not feel",
    "include": "what to include now",
    "holdBack": "what to save for a call"
  },
  "scenario": "scenario name",
  "verifiedReportLink": "URL of the most recent report found, or null",
  "verifiedReportYear": "year of the report, or null",
  "subjectLines": ["option A", "option B", "option C"],
  "emailBody": "the full email body text"
}
`

  const text = await openRouterChat(prompt, 4000)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No valid JSON in response")
  return JSON.parse(jsonMatch[0])
}
