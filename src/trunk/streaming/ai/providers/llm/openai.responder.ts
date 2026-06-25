// OpenAI Chat Completions responder (LLM "brain", provider "openai").
//
// Fetch-based REST — no SDK dependency. One instance per call, so it keeps the
// running conversation history internally and the agent stays coherent across
// turns. The system prompt (the agent's persona/instructions, authored by the
// user in the dashboard) is sent as the leading system message.

import type { Responder } from "../../brain";

export interface OpenAiResponderOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export class OpenAiResponder implements Responder {
  private readonly history: ChatMessage[] = [];

  constructor(private readonly opts: OpenAiResponderOptions) {
    if (opts.systemPrompt) {
      this.history.push({ role: "system", content: opts.systemPrompt });
    }
  }

  async respond(userText: string): Promise<string> {
    if (!this.opts.apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.history.push({ role: "user", content: userText });

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: this.opts.temperature,
        messages: this.history,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (reply) this.history.push({ role: "assistant", content: reply });
    return reply;
  }
}
