import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

// Email delivery goes through the Replit-managed Resend connector rather
// than a raw RESEND_API_KEY -- the connector attaches identity-based auth
// automatically, so there's no API key to store or rotate. Never cache the
// client: it re-resolves the Replit identity token per call, and that token
// can expire between requests.
function connectors(): ReplitConnectors {
  return new ReplitConnectors();
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL || process.env.REPLIT_CLI);
}

function fromAddress(): string {
  return process.env.INVOICE_EMAIL_FROM || "UpDownBid <invoices@updownbid.dev>";
}

export type SendInvoiceEmailInput = {
  to: string;
  subject: string;
  html: string;
  pdf: Buffer;
  filename: string;
};

export type SendInvoiceEmailResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string };

type ResendSendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

// Failure here must never throw past the caller -- an email provider outage
// or misconfiguration can never affect payment status. The caller logs the
// outcome into invoice_email_deliveries and may retry later.
export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
  if (!isEmailDeliveryConfigured()) {
    return { ok: false, error: "Email delivery is not configured (Resend connector not attached)" };
  }
  try {
    const response = await connectors().proxy("resend", "/emails", {
      method: "POST",
      body: {
        from: fromAddress(),
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: [
          {
            filename: input.filename,
            content: input.pdf.toString("base64"),
          },
        ],
      },
    });
    const data = (await response.json().catch(() => null)) as ResendSendResponse | null;
    if (!response.ok) {
      const message = data?.message || `Resend request failed with status ${response.status}`;
      logger.warn({ event: "INVOICE_EMAIL_PROVIDER_ERROR", to: input.to, error: message }, "Resend rejected an invoice email");
      return { ok: false, error: message };
    }
    return { ok: true, providerMessageId: data?.id ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    logger.warn({ event: "INVOICE_EMAIL_SEND_FAILED", to: input.to, error: message }, "Invoice email delivery failed");
    return { ok: false, error: message };
  }
}
