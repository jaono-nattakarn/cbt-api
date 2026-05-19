import { ValidationError } from "../../utils/errors";

export class N8nWebhookTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class N8nClient {
  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly trustedHeaderValue: string,
    private readonly binaryFieldName: string,
    private readonly callbackUrl: string | undefined,
  ) {}

  async analyzeTranscript(input: { jobId: string; sessionId: string; transcriptText: string }): Promise<unknown> {
    if (!this.webhookUrl) {
      throw new ValidationError("N8N_WEBHOOK_URL is not configured");
    }

    const form = new FormData();
    form.append("job_id", input.jobId);
    form.append("session_id", input.sessionId);
    if (this.callbackUrl) {
      form.append("callback_url", this.callbackUrl);
      form.append("callback_header_name", "x-is-trusted");
      form.append("callback_secret", this.trustedHeaderValue);
    }
    form.append(
      this.binaryFieldName,
      new Blob([input.transcriptText], { type: "text/plain" }),
      `session-${input.sessionId}.txt`,
    );

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "x-is-trusted": this.trustedHeaderValue,
      },
      body: form,
    });

    const responseText = await response.text();
    const body = responseText ? parseJson(responseText) : undefined;
    if (!response.ok) {
      const details = responseText ? `: ${responseText.slice(0, 500)}` : "";
      if (response.status === 524 || response.status === 504 || response.status === 408) {
        throw new N8nWebhookTimeoutError(`n8n webhook timed out with HTTP ${response.status}${details}`);
      }
      throw new Error(`n8n returned HTTP ${response.status}${details}`);
    }
    return body;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
