import type { VoiceTraceData, VoiceTraceValue } from "./types";

// Preserve harmless model-usage counters such as inputTokens/outputTokens while
// still redacting credential-bearing token fields.
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|(?:access|refresh|auth|bearer)[_-]?token|^token$|secret|password)/iu;
const BEARER_OR_OPENAI_KEY = /(?:Bearer\s+|sk-)[A-Za-z0-9._-]+/giu;

export function redactDiagnosticText(input: string, maxCharacters = 500): string {
  const bounded = input.length > maxCharacters ? `${input.slice(0, maxCharacters)}…` : input;
  return bounded.replace(BEARER_OR_OPENAI_KEY, "[REDACTED]");
}

export function redactDiagnosticData(data: VoiceTraceData | undefined): VoiceTraceData | undefined {
  if (!data) {
    return undefined;
  }
  return redactObject(data);
}

export function redactDiagnosticValue(input: unknown, depth = 0): unknown {
  // Typed diagram plans legitimately nest branch -> edge -> object reference.
  // Keep enough depth to reconstruct the model output while retaining bounds.
  if (depth > 10) {
    return "[depth-limited]";
  }
  if (typeof input === "string") {
    return redactDiagnosticText(input, 1_000);
  }
  if (input === null || typeof input === "number" || typeof input === "boolean") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 40).map((entry) => redactDiagnosticValue(entry, depth + 1));
  }
  if (typeof input === "object" && input) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input).slice(0, 80)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactDiagnosticValue(value, depth + 1);
    }
    return output;
  }
  return String(input).slice(0, 200);
}

function redactObject(input: Record<string, VoiceTraceValue>): VoiceTraceData {
  const output: VoiceTraceData = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(value);
  }
  return output;
}

function redactValue(value: VoiceTraceValue): VoiceTraceValue {
  if (typeof value === "string") {
    return redactDiagnosticText(value, 1_000);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return redactObject(value);
  }
  return value;
}
