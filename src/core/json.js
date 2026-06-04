export function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot parse empty JSON response");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    }
  }

  throw new Error(`No JSON object found in response: ${trimmed.slice(0, 160)}`);
}

export function stableStringify(value) {
  return JSON.stringify(value, Object.keys(value).sort(), 2);
}
