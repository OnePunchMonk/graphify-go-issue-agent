import { parseJsonFromText } from "../core/json.js";

export class GeminiProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async generate({ system, prompt, json = false, temperature = 0.2, googleSearch = false }) {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is required unless offline mode is enabled");
    }

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body = {
      systemInstruction: system
        ? {
            parts: [{ text: system }]
          }
        : undefined,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature,
        ...(json && !googleSearch ? { responseMimeType: "application/json" } : {})
      },
      ...(googleSearch ? { tools: [{ googleSearch: {} }] } : {})
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini ${this.model} request failed (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error(`Gemini ${this.model} returned no text`);
    }

    return text;
  }

  async generateJson(args) {
    const text = await this.generate({ ...args, json: true });
    return parseJsonFromText(text);
  }
}

export function createModel({ offline = false, logger } = {}) {
  const provider = new GeminiProvider();
  if (!provider.available || offline) {
    if (!provider.available) {
      logger?.warn("GEMINI_API_KEY not set; using deterministic offline agents.");
    }
    return null;
  }
  return provider;
}
