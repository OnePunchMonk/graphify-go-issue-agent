import json
import re


def parse_json_from_text(text: str):
    trimmed = text.strip()
    if not trimmed:
        raise ValueError("Cannot parse empty JSON response")

    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", trimmed, re.IGNORECASE)
        if fenced:
            return json.loads(fenced.group(1).strip())

        first_brace = trimmed.find("{")
        last_brace = trimmed.rfind("}")
        if first_brace >= 0 and last_brace > first_brace:
            return json.loads(trimmed[first_brace : last_brace + 1])

        first_bracket = trimmed.find("[")
        last_bracket = trimmed.rfind("]")
        if first_bracket >= 0 and last_bracket > first_bracket:
            return json.loads(trimmed[first_bracket : last_bracket + 1])

    raise ValueError(f"No JSON object found in response: {trimmed[:160]}")
