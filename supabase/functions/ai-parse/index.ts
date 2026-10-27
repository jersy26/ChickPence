// ai-parse — turns a logbook photo or a voice transcript into draft log entries.
//
// The Claude API key stays server-side (secret ANTHROPIC_API_KEY). This function
// never writes to the database: it only returns drafts, which the user reviews
// and saves through the app's normal Repository.save* path.
//
// Request body (JSON):
//   { mode: "image", image: "<base64 jpeg>", media_type?: "image/jpeg", today: "YYYY-MM-DD", batches: ["Batch 2026-09", ...] }
//   { mode: "text",  text: "patay 3 kahapon sa batch setyembre", today, batches }
// Response: { entries: Draft[], notes: string }
//
// Deploy:  supabase functions deploy ai-parse
// Secret:  supabase secrets set ANTHROPIC_API_KEY=...

import Anthropic from "npm:@anthropic-ai/sdk";

const IMAGE_MODEL = "claude-sonnet-5-5";
const TEXT_MODEL = "claude-haiku-5-5";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image (base64-decoded)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every field is present on every entry (strict structured output); unused ones are null.
const nullable = (type: string) => ({ type: [type, "null"] });

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries", "notes"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type", "date", "batch_hint",
          "feed_amount", "other_amount",
          "quantity_kg", "count",
          "buyer_name", "quantity_sold", "weight_kg", "price_per_kg",
          "source_text", "confidence", "uncertain_fields",
        ],
        properties: {
          type: { type: "string", enum: ["expense", "feed", "mortality", "sale"] },
          date: nullable("string"),
          batch_hint: nullable("string"),
          feed_amount: nullable("number"),
          other_amount: nullable("number"),
          quantity_kg: nullable("number"),
          count: nullable("integer"),
          buyer_name: nullable("string"),
          quantity_sold: nullable("integer"),
          weight_kg: nullable("number"),
          price_per_kg: nullable("number"),
          source_text: { type: "string" },
          confidence: { type: "number" },
          uncertain_fields: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes: { type: "string" },
  },
};

const SYSTEM_PROMPT = `You read handwritten or spoken poultry-farm records from a broiler farm in the Philippines and turn them into draft log entries for the ChickPence app. Records may be in English, Filipino or Taglish.

Entry types and the fields each one uses (leave every other field null):
- "expense": a farm-level cost paid in pesos. feed_amount = pesos spent on feed; other_amount = pesos spent on anything else (medicine, vitamins, electricity, labor, transport, chicks' supplies). Expenses are shared across batches, so batch_hint stays null.
- "feed": feed consumed by a batch, in kilograms (quantity_kg). If the record counts sacks, use 50 kg per sack and list "quantity_kg" in uncertain_fields.
- "mortality": birds that died in a batch (count). Words like "patay", "namatay", "dead".
- "sale": birds sold from a batch. buyer_name, quantity_sold (heads), weight_kg (total live weight), price_per_kg (pesos). Words like "benta", "nabenta", "sold", "buyer".

Rules:
- One entry per record line or per spoken item. Do not merge different days.
- date is YYYY-MM-DD. Resolve relative words ("kahapon" = yesterday, "ngayon" = today) and missing years against today's date given below. If no date can be read, use null and list "date" in uncertain_fields.
- batch_hint: copy the batch name exactly from the list of open batches when the record names or clearly implies one; otherwise null.
- Numbers: amounts are plain numbers without the peso sign or commas.
- Never guess a value you cannot read. Use null and list the field in uncertain_fields. Also list any field whose handwriting or wording is ambiguous.
- confidence (0 to 1) is your overall confidence that the entry is correct.
- source_text quotes the line or phrase the entry came from.
- Put anything you could not turn into an entry (illegible lines, totals, unrelated notes) in notes, briefly. Use "" when there is nothing to add.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function contextText(today: string, batches: string[]) {
  const list = batches.length ? batches.map((b) => `- ${b}`).join("\n") : "(none)";
  return `Today is ${today}.\nOpen batches:\n${list}`;
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const mode = body.mode;
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10);
  const batches = Array.isArray(body.batches)
    ? body.batches.filter((b): b is string => typeof b === "string").slice(0, 50)
    : [];

  let content: Anthropic.ContentBlockParam[];
  if (mode === "image") {
    const image = typeof body.image === "string" ? body.image : "";
    const mediaType = body.media_type === "image/png" ? "image/png" : "image/jpeg";
    if (!image) return json({ error: "Missing image" }, 400);
    if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413);
    content = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
      { type: "text", text: `${contextText(today, batches)}\n\nThis is a photo of the farm logbook. Extract every record on it.` },
    ];
  } else if (mode === "text") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "Missing text" }, 400);
    if (text.length > 4000) return json({ error: "Text too long" }, 413);
    content = [
      { type: "text", text: `${contextText(today, batches)}\n\nTranscript of what the farmer said:\n<transcript>\n${text}\n</transcript>` },
    ];
  } else {
    return json({ error: 'mode must be "image" or "text"' }, 400);
  }

  const request = {
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content }],
    output_config: {
      effort: mode === "image" ? "medium" : "low",
      format: { type: "json_schema", schema: DRAFT_SCHEMA },
    },
  };

  try {
    // Vision runs on Sonnet with server-side refusal fallback; text runs on Haiku.
    const response = mode === "image"
      ? await client.beta.messages.create({
        ...request,
        model: IMAGE_MODEL,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsNonStreaming)
      : await client.messages.create({ ...request, model: TEXT_MODEL } as Anthropic.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") {
      return json({ error: "The AI declined to read this input. Please enter the records manually." }, 422);
    }
    if (response.stop_reason === "max_tokens") {
      return json({ error: "Too many records in one go. Try a photo of fewer lines." }, 422);
    }

    const text = response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("");
    const parsed = JSON.parse(text);
    return json({ entries: parsed.entries ?? [], notes: parsed.notes ?? "" });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "The AI service is busy. Try again in a minute." }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return json({ error: "The AI service failed. Try again later." }, 502);
    }
    console.error("ai-parse failed", err);
    return json({ error: "Could not read the AI response." }, 500);
  }
});
