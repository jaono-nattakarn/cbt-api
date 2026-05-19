import { normalizeSpeaker, parseTimestampLabel } from "../../utils/transcript";
import { anchorLabel } from "../../modules/ctsr/ctsr.data";
import type { EvidenceRecord, ScoreRecord, TranscriptTurn } from "../../store/types";

interface N8nQuote {
  speaker?: string;
  text?: string;
  timestamp?: string;
  polarity?: string;
}

interface N8nItem {
  item_id?: number;
  item_name?: string;
  score?: number;
  anchor_label?: string;
  reasoning?: string;
  evidence_review?: string;
  quotes?: N8nQuote[];
}

interface N8nResult {
  status?: string;
  session_id?: string | null;
  received_at?: string;
  meta?: Record<string, unknown>;
  ctsr_items?: N8nItem[];
  summary?: Record<string, unknown>;
  reason?: string;
  message?: string;
}

export function normalizeN8nResult(raw: unknown): { result: N8nResult; warnings: string[] } {
  const warnings: string[] = [];
  const result = Array.isArray(raw) ? raw[0] : raw;
  if (Array.isArray(raw)) warnings.push("n8n returned an array; using first item");
  if (!result || typeof result !== "object") {
    return { result: { status: "error", message: "Invalid n8n response" }, warnings: ["n8n response is not an object"] };
  }
  return { result: result as N8nResult, warnings };
}

export function mapScores(input: {
  organizationId: string;
  sessionId: string;
  analysisResultId: string;
  result: N8nResult;
}): Omit<ScoreRecord, "id" | "createdAt" | "updatedAt">[] {
  return (input.result.ctsr_items || [])
    .filter((item): item is Required<Pick<N8nItem, "item_id">> & N8nItem => typeof item.item_id === "number")
    .map((item) => ({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      analysisResultId: input.analysisResultId,
      ctsrItemId: item.item_id,
      aiScore: item.score ?? null,
      aiAnchorLabel: item.anchor_label ?? anchorLabel(item.score),
      aiReasoning: item.reasoning ?? null,
      aiEvidenceReview: item.evidence_review ?? null,
      finalScore: item.score ?? null,
      finalAnchorLabel: item.anchor_label ?? anchorLabel(item.score),
      supervisorComment: null,
      status: "ai_suggested",
      confirmedBy: null,
      confirmedAt: null,
    }));
}

export function mapEvidence(input: {
  organizationId: string;
  sessionId: string;
  analysisResultId: string;
  scoreIdByItemId: Map<number, string>;
  result: N8nResult;
  transcriptTurns?: TranscriptTurn[];
}): Omit<EvidenceRecord, "id" | "createdAt" | "updatedAt">[] {
  return (input.result.ctsr_items || []).flatMap((item) => {
    const itemId = item.item_id;
    if (typeof itemId !== "number") return [];
    return (item.quotes || [])
      .filter((quote) => quote.text)
      .flatMap((quote) => {
        const exactMatch = findExactTherapistQuoteMatch(quote, input.transcriptTurns || []);
        if (input.transcriptTurns?.length && !exactMatch) return [];
        const turn = exactMatch?.turn;
        return [{
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          analysisResultId: input.analysisResultId,
          scoreId: input.scoreIdByItemId.get(itemId) || null,
          ctsrItemId: itemId,
          transcriptTurnNo: turn?.turnNo ?? findTranscriptTurnNo(quote, input.transcriptTurns || []),
          speaker: turn?.speaker ?? normalizeSpeaker(quote.speaker),
          quoteText: exactMatch?.text ?? quote.text!.trim(),
          timestampLabel: turn?.timestamp || quote.timestamp || null,
          timestampSeconds: turn?.startSeconds ?? parseTimestampLabel(quote.timestamp),
          polarity:
            quote.polarity === "positive" || quote.polarity === "negative" || quote.polarity === "neutral"
              ? quote.polarity
              : "neutral",
          source: "ai",
          status: "suggested",
          reviewNote: null,
          createdBy: null,
          reviewedBy: null,
          reviewedAt: null,
        }];
      });
  });
}

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function quotePieces(value?: string | null) {
  return (value || "")
    .split(/(?:\.{2,}|\u2026+)/)
    .map((piece) => normalizeText(piece))
    .filter((piece) => piece.length >= 8);
}

function findExactTherapistQuoteMatch(
  quote: N8nQuote,
  turns: TranscriptTurn[],
): { turn: TranscriptTurn; text: string } | null {
  const quoteText = (quote.text || "").trim();
  if (!quoteText) return null;
  const quoteSpeaker = normalizeSpeaker(quote.speaker);
  if (quoteSpeaker === "Client") return null;

  const therapistTurns = turns.filter((turn) => turn.speaker === "Therapist");
  const matchedTurn = therapistTurns.find((turn) => turn.text.includes(quoteText));
  return matchedTurn ? { turn: matchedTurn, text: quoteText } : null;
}

export function findTranscriptTurnNo(quote: N8nQuote, turns: TranscriptTurn[]): number | null {
  const quoteText = normalizeText(quote.text);
  if (!quoteText) return null;

  const quoteSpeaker = normalizeSpeaker(quote.speaker);
  const quoteSeconds = parseTimestampLabel(quote.timestamp);
  const pieces = quotePieces(quote.text);
  const speakerMatches = turns.filter((turn) => quoteSpeaker === "Unknown" || turn.speaker === quoteSpeaker);

  const matchWithinTurns = (candidates: TranscriptTurn[]) => {
    const exactMatch = candidates.find((turn) => {
      const turnText = normalizeText(turn.text);
      return turnText.includes(quoteText) || quoteText.includes(turnText);
    });
    if (exactMatch) return exactMatch.turnNo;

    let best: { turnNo: number; score: number } | null = null;
    for (const turn of candidates) {
      const turnText = normalizeText(turn.text);
      let score = 0;
      for (const piece of pieces) {
        if (turnText.includes(piece)) score += Math.min(piece.length, 50);
      }
      if (
        quoteSeconds !== null &&
        turn.startSeconds !== null &&
        turn.startSeconds !== undefined &&
        Math.abs(turn.startSeconds - quoteSeconds) <= 2
      ) {
        score += 20;
      }
      if (!best || score > best.score) best = { turnNo: turn.turnNo, score };
    }

    if (best && best.score >= 20) return best.turnNo;

    const fuzzyNeedle = quoteText.slice(0, Math.min(30, quoteText.length));
    const fuzzyMatch = candidates.find((turn) => normalizeText(turn.text).includes(fuzzyNeedle));
    return fuzzyMatch?.turnNo ?? null;
  };

  const speakerMatch = matchWithinTurns(speakerMatches);
  if (speakerMatch) return speakerMatch;

  if (speakerMatches.length !== turns.length) {
    return matchWithinTurns(turns);
  }

  return null;
}
