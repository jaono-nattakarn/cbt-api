import { sha256 } from "./ids";
import type { TranscriptTurn } from "../store/types";

const TIMESTAMP_ONLY_PATTERN = /^\[?(?<ts>\d{1,2}:\d{2}(?::\d{2})?)\]?$/;

function parseTimestampToSeconds(timestamp?: string | null): number | null {
  if (!timestamp) return null;
  const parts = timestamp.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function normalizeSpeaker(label?: string | null): TranscriptTurn["speaker"] {
  const value = (label ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/[:\uFF1A-]\s*$/g, "")
    .toLowerCase();

  if (["t", "therapist", "therapist name", "speaker a", "counsellor", "counselor"].includes(value)) {
    return "Therapist";
  }
  if (["c", "client", "patient", "speaker b"].includes(value)) {
    return "Client";
  }
  return "Unknown";
}

export function parseTranscriptTurns(text: string): TranscriptTurn[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const turns: TranscriptTurn[] = [];
  const speakerPattern =
    /^(?:\[?(?<ts>\d{1,2}:\d{2}(?::\d{2})?)\]?\s*)?\[?(?<speaker>Therapist|Client|T|C|Speaker A|Speaker B|Counsellor|Counselor|Patient)\]?\s*[:\uFF1A-]\s*(?<text>.+)$/i;
  let currentTimestamp: string | null = null;

  for (const line of lines) {
    const timestampOnly = line.match(TIMESTAMP_ONLY_PATTERN);
    if (timestampOnly?.groups?.ts) {
      currentTimestamp = timestampOnly.groups.ts;
      continue;
    }

    const match = line.match(speakerPattern);
    const groups = match?.groups;
    const speakerLabel = groups?.speaker || "Unknown";
    const timestamp = groups?.ts || currentTimestamp;
    turns.push({
      turnNo: turns.length + 1,
      speaker: normalizeSpeaker(speakerLabel),
      speakerLabel,
      timestamp,
      startSeconds: parseTimestampToSeconds(timestamp),
      endSeconds: null,
      text: groups?.text || line,
    });
  }

  if (turns.length === 0 && text.trim()) {
    turns.push({
      turnNo: 1,
      speaker: "Unknown",
      speakerLabel: "Unknown",
      timestamp: null,
      startSeconds: null,
      endSeconds: null,
      text: text.trim(),
    });
  }

  return turns;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function extractTranscriptText(input: {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<string> {
  const lower = input.filename.toLowerCase();
  if (lower.endsWith(".txt") || input.mimetype.startsWith("text/")) {
    return input.buffer.toString("utf8");
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return result.value;
  }

  throw new Error("Only .txt and .docx transcript files are supported");
}

export function transcriptHash(buffer: Buffer): string {
  return sha256(buffer);
}

export function turnsToPlainText(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => {
      const ts = turn.timestamp ? `[${turn.timestamp}] ` : "";
      const speaker = turn.speaker === "Unknown" ? "" : `${turn.speaker}: `;
      return `${ts}${speaker}${turn.text}`;
    })
    .join("\n");
}

export function parseTimestampLabel(timestamp?: string | null): number | null {
  return parseTimestampToSeconds(timestamp);
}
