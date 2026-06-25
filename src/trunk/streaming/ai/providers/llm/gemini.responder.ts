// Google Gemini responder (LLM "brain", provider "gemini").
//
// Fetch-based REST against the Generative Language API generateContent endpoint
// — no SDK dependency. One instance per call so it keeps the conversation
// history (Gemini wants the full `contents` turn list on each request). The
// agent's system prompt rides in `systemInstruction`.

import type { Responder } from "../../brain";

export interface GeminiResponderOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

interface GeminiTurn {
  role: "user" | "model";
  parts: { text: string }[];
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiResponder implements Responder {
  private readonly history: GeminiTurn[] = [];

  constructor(private readonly opts: GeminiResponderOptions) {}

  async respond(userText: string): Promise<string> {
    if (!this.opts.apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.history.push({ role: "user", parts: [{ text: userText }] });

    const body: Record<string, unknown> = {
      contents: this.history,
      generationConfig: { temperature: this.opts.temperature },
    };
    if (this.opts.systemPrompt) {
      body.systemInstruction = { parts: [{ text: this.opts.systemPrompt }] };
    }

    const url = `${BASE}/${encodeURIComponent(this.opts.model)}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const reply =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (reply) this.history.push({ role: "model", parts: [{ text: reply }] });
    return reply;
  }
}
