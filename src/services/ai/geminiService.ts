import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../../utils/logger.ts";
import {
  inferDiscountPercent,
  isLineTotalConsistent,
} from "../../utils/discountMath.ts";
import { recordUsageEvent } from "../usage/recordUsageEvent.ts";
import { USAGE_EVENT_TYPE } from "../../types/usage.ts";

const GEMINI_MODEL = "gemini-3.1-flash-lite";

let genAI: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (genAI) return genAI;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn(
      "GEMINI_API_KEY not configured — invoice extraction unavailable",
    );
    return null;
  }

  genAI = new GoogleGenAI({ apiKey });
  return genAI;
}

export interface InvoiceExtractionResult {
  supplier: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  po_reference?: string;
  items: Array<{
    description: string;
    sku?: string;
    quantity: number;
    unit?: string;
    unit_price: number;
    discount_percent?: number;
    line_total: number;
    out_of_stock?: boolean;
    taxable?: boolean;
    tax_amount?: number;
  }>;
  subtotal?: number;
  tax?: number;
  total: number;
  currency?: string;
  confidence: number;
}

const EXTRACTION_PROMPT = `Extract all structured data from this invoice document.

Extract: supplier (name, email, phone, address), invoice number, date, due date, PO reference, subtotal, tax, total, currency, and all line items (description, SKU, quantity, unit, unit_price, discount_percent, line_total).

Per-item fields:

discount_percent: If the invoice has a discount column (DSC, DISC, Discount, etc.), extract the discount percentage per item. This is common in food distribution invoices. Set to 0 if no discount applies to the item. Only extract if a discount column exists on the invoice.

out_of_stock: true if the item says "out of stock", "backordered", "unavailable", appears under an "OUT OF STOCK" section header, or has $0/blank amount. Mark ALL items under such headers as out_of_stock. Do NOT include section headers in the description — use only the product name.

taxable: IMPORTANT — do NOT default all items to taxable. Carefully check for per-item tax indicators:
- Look at the AMOUNT column for a "T" letter next to the dollar amount. ONLY items with "T" are taxable — set taxable to true. Items WITHOUT "T" are NOT taxable — explicitly set taxable to false. Always set the taxable field for every item.
- Other tax markers: "TX"/"TAX" = taxable, "NT"/"E"/"exempt" = not taxable.
- If the invoice has a FOOD vs NON-FOOD breakdown in the footer, food items are not taxable; non-food items (gloves, supplies, paper, chemicals) are taxable.
- Verify: the "Total Tax" amount should match the tax rate applied ONLY to items you marked taxable, not all items.
- Only default all items to taxable when there are truly no per-item tax indicators anywhere on the invoice.
If a per-item tax_amount is listed, extract it.

Be precise with numbers. Omit fields not present. Estimate confidence (0-1).`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    supplier: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        address: { type: Type.STRING },
      },
      required: ["name"],
    },
    invoice_number: { type: Type.STRING },
    invoice_date: { type: Type.STRING },
    due_date: { type: Type.STRING },
    po_reference: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          sku: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          unit_price: { type: Type.NUMBER },
          discount_percent: { type: Type.NUMBER },
          line_total: { type: Type.NUMBER },
          out_of_stock: { type: Type.BOOLEAN },
          taxable: { type: Type.BOOLEAN },
          tax_amount: { type: Type.NUMBER },
        },
        required: ["description", "quantity", "unit_price", "line_total", "taxable"],
      },
    },
    subtotal: { type: Type.NUMBER },
    tax: { type: Type.NUMBER },
    total: { type: Type.NUMBER },
    currency: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["supplier", "items", "total", "confidence"],
};

/**
 * Extract structured data from an invoice file using Gemini AI.
 * Supports PDF and image files.
 * Retries up to 3 times with exponential backoff.
 */
export async function extractInvoiceData(
  fileBuffer: Buffer,
  mimeType: string,
  supplierContext?: string | null,
  tenantId?: string,
): Promise<InvoiceExtractionResult> {
  const ai = getGenAI();
  if (!ai) {
    throw new Error("Gemini AI not configured — set GEMINI_API_KEY");
  }

  const fileData = {
    inlineData: {
      data: fileBuffer.toString("base64"),
      mimeType,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fullPrompt = supplierContext
        ? `${supplierContext}\n\n${EXTRACTION_PROMPT}`
        : EXTRACTION_PROMPT;
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [fullPrompt, fileData],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      if (tenantId) {
        const promptTokens = result.usageMetadata?.promptTokenCount ?? 0;
        const candidateTokens = result.usageMetadata?.candidatesTokenCount ?? 0;
        await recordUsageEvent({
          tenantId,
          eventType: USAGE_EVENT_TYPE.ai_invoice_extraction,
          quantity: promptTokens + candidateTokens,
          metadata: { model: GEMINI_MODEL, promptTokens, candidateTokens, attempt: attempt + 1 },
        });
      }

      const text = result.text;
      if (!text) {
        throw new Error("Gemini returned an empty response");
      }
      const parsed: InvoiceExtractionResult = JSON.parse(text);

      // Post-processing: infer discounts when qty × unit_price ≠ line_total
      for (const item of parsed.items) {
        if (item.out_of_stock || item.line_total === 0) continue;
        const expected = item.quantity * item.unit_price;
        if (expected === 0) continue;
        const diff = Math.abs(expected - item.line_total);
        // Only process if there's a meaningful mismatch (> $0.02)
        if (diff > 0.02) {
          if (item.discount_percent != null && item.discount_percent > 0) {
            // AI extracted a discount — verify line_total matches qty × price × (1 - disc%)
            const consistent = isLineTotalConsistent({
              qty: item.quantity,
              unitPrice: item.unit_price,
              discountPercent: item.discount_percent,
              observedLineTotal: item.line_total,
            });
            if (!consistent) {
              // Discount doesn't explain the total — recalculate the correct discount
              const inferred = inferDiscountPercent({
                qty: item.quantity,
                unitPrice: item.unit_price,
                observedLineTotal: item.line_total,
              });
              if (inferred != null) {
                item.discount_percent = inferred;
              }
            }
          } else if (item.line_total < expected) {
            // No discount extracted but total is less than expected — infer discount
            const inferred = inferDiscountPercent({
              qty: item.quantity,
              unitPrice: item.unit_price,
              observedLineTotal: item.line_total,
            });
            if (inferred != null) {
              item.discount_percent = inferred;
              logger.info(
                { description: item.description, expected, actual: item.line_total, discount: item.discount_percent },
                "Inferred discount from price mismatch",
              );
            }
          }
        }
      }

      // Post-processing: if total matches subtotal (no tax), mark all items non-taxable
      const computedSubtotal = parsed.items
        .filter((i) => !i.out_of_stock)
        .reduce((sum, i) => sum + (i.line_total || 0), 0);
      const invoiceTotal = parsed.total;
      const invoiceTax = parsed.tax ?? 0;
      const noTaxOnInvoice = invoiceTax === 0 || Math.abs(invoiceTotal - computedSubtotal) < 0.02;

      if (noTaxOnInvoice) {
        for (const item of parsed.items) {
          item.taxable = false;
          delete item.tax_amount;
        }
        parsed.tax = 0;
        logger.info("No tax detected on invoice (total matches subtotal) — all items set to non-taxable");
      }

      logger.info(
        {
          supplierName: parsed.supplier.name,
          itemCount: parsed.items.length,
          total: parsed.total,
          confidence: parsed.confidence,
        },
        "Invoice data extracted successfully",
      );

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRetryable =
        lastError.message.includes("429") ||
        lastError.message.includes("503") ||
        lastError.message.includes("RESOURCE_EXHAUSTED");

      if (!isRetryable) {
        // Non-retryable error — throw immediately regardless of which
        // attempt this is, rather than sleeping through the remaining
        // backoff for an error retrying can never fix.
        throw lastError;
      }

      if (attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
        logger.warn(
          { attempt: attempt + 1, error: lastError.message, delay },
          "Gemini extraction failed, retrying...",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Gemini extraction failed after 3 attempts");
}
