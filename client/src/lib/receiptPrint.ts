/**
 * POS-58 thermal receipt (cnfujun POS-5890U-L).
 * PC browser print: narrow HTML column (px), left-aligned, 12px Arial.
 * Android Share: plain-text lines (32 chars max).
 */
import { isNativeApp } from '../config';

/** PC print column — px at 96dpi, fits 58mm roll with left inset. */
const RECEIPT_PC_WIDTH_PX = 216;
const RECEIPT_PC_PAD_LEFT_PX = 10;
const RECEIPT_PC_PAD_RIGHT_PX = 6;
/** Plain-text line width for Bluetooth / RawBT. */
const RECEIPT_TEXT_CHARS = 32;

export type PaymentReceipt = {
  company?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  account?: string;
  customer?: string;
  plan?: string;
  months?: number;
  newDue?: string;
  discountDays?: number;
  subtotal?: number;
  discount?: number;
  total?: number;
  transactionAt?: string;
  paymentDate?: string;
};

function escapeReceiptHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return `\u20b1${Number(n || 0).toFixed(2)}`;
}

function extensionLabel(months: number): string {
  return months === 1 ? '1 month' : `${months} months`;
}

function receiptWhen(receipt: PaymentReceipt): string {
  const txRaw = receipt.transactionAt || receipt.paymentDate || new Date().toISOString();
  const txDate = new Date(txRaw);
  if (!Number.isFinite(txDate.getTime())) return String(txRaw);
  return txDate.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function headerAddressLines(address?: string | null): string[] {
  if (!address?.trim()) return [];
  const byNewline = address.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (byNewline.length > 1) return byNewline;
  const single = byNewline[0] || address.trim();
  const parts = single.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return [`${parts[0]}, ${parts[1]}`, parts.slice(2).join(', ')];
  if (parts.length === 2) return [parts.join(', ')];
  return [single];
}

function multilineField(text?: string | null): string[] {
  if (!text?.trim()) return [];
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function wrapText(text: string, width: number): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= width) return [t];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > width) {
      if (cur) lines.push(cur);
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        cur = '';
      } else {
        cur = word;
      }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const RULE_TEXT = '-'.repeat(RECEIPT_TEXT_CHARS);

function stackedFieldText(label: string, value: string): string[] {
  if (!value.trim()) return [];
  const inline = `${label} ${value}`;
  if (inline.length <= RECEIPT_TEXT_CHARS) return [inline];
  return [label, ...wrapText(value, RECEIPT_TEXT_CHARS).map((l) => `  ${l}`)];
}

/** Plain-text receipt for Android Share → printer apps. */
export function buildReceiptText(receipt: PaymentReceipt): string {
  const company = (receipt.company || 'ISP Billing').toUpperCase();
  const months = Number(receipt.months) || 1;
  const extension = extensionLabel(months);
  const subtotal = Number(receipt.subtotal) || 0;
  const discount = Number(receipt.discount) || 0;
  const total = Number(receipt.total) || 0;
  const discountDays = Number(receipt.discountDays) || 0;
  const when = receiptWhen(receipt);
  const addressLines = headerAddressLines(receipt.companyAddress);
  const phones = multilineField(receipt.companyPhone);
  const emails = multilineField(receipt.companyEmail);

  const lines: string[] = [];
  lines.push(...wrapText(company, RECEIPT_TEXT_CHARS));
  for (const line of addressLines) lines.push(...wrapText(line, RECEIPT_TEXT_CHARS));
  lines.push('');
  lines.push(when);
  lines.push(RULE_TEXT);

  lines.push(...stackedFieldText('Account #:', String(receipt.account || '')));
  lines.push(...stackedFieldText('Customer:', String(receipt.customer || '')));
  lines.push(...stackedFieldText('Extension:', extension));
  lines.push(...stackedFieldText('Plan:', String(receipt.plan || '')));
  lines.push(...stackedFieldText('Next due:', String(receipt.newDue || '')));

  lines.push(RULE_TEXT);
  lines.push(`Subtotal: ${money(subtotal)}`);
  if (discount > 0) lines.push(`Discount (${discountDays}d): -${money(discount)}`);
  lines.push(`TOTAL: ${money(total)}`);
  lines.push(RULE_TEXT);
  lines.push('Thank you for your payment.');
  lines.push(RULE_TEXT);

  lines.push(...wrapText(company, RECEIPT_TEXT_CHARS));
  for (const line of addressLines) lines.push(...wrapText(line, RECEIPT_TEXT_CHARS));
  for (const line of phones) lines.push(...wrapText(line, RECEIPT_TEXT_CHARS));
  for (const line of emails) lines.push(...wrapText(line, RECEIPT_TEXT_CHARS));

  lines.push(RULE_TEXT);
  lines.push('THIS IS NOT AN OFFICIAL RECEIPT');
  return lines.join('\n');
}

function fieldHtml(label: string, value: string, bold = false): string {
  if (!value.trim()) return '';
  const cls = bold ? 'val val-bold' : 'val';
  return `<div class="field"><div class="lab">${label}</div><div class="${cls}">${escapeReceiptHtml(value)}</div></div>`;
}

function centerHtml(text: string, cls = 'line'): string {
  return wrapText(text, 28)
    .map((line) => `<div class="${cls}">${escapeReceiptHtml(line)}</div>`)
    .join('');
}

export function buildReceiptHtml(receipt: PaymentReceipt, opts?: { autoPrint?: boolean }): string {
  const autoPrint = opts?.autoPrint !== false;
  const companyRaw = (receipt.company || 'ISP Billing').toUpperCase();
  const months = Number(receipt.months) || 1;
  const extension = extensionLabel(months);
  const discountDays = Number(receipt.discountDays) || 0;
  const subtotal = Number(receipt.subtotal) || 0;
  const discount = Number(receipt.discount) || 0;
  const total = Number(receipt.total) || 0;
  const when = escapeReceiptHtml(receiptWhen(receipt));
  const addressLines = headerAddressLines(receipt.companyAddress);
  const phones = multilineField(receipt.companyPhone);
  const emails = multilineField(receipt.companyEmail);
  const accountTitle = escapeReceiptHtml(receipt.account);
  const w = RECEIPT_PC_WIDTH_PX;
  const pl = RECEIPT_PC_PAD_LEFT_PX;
  const pr = RECEIPT_PC_PAD_RIGHT_PX;

  const discountBlock =
    discount > 0
      ? `<div class="amount">Discount (${discountDays}d): -${escapeReceiptHtml(money(discount))}</div>`
      : '';

  const printScript = autoPrint
    ? `<script>
    (function () {
      function closeWin() { try { window.close(); } catch (e) {} }
      window.addEventListener('afterprint', function () { setTimeout(closeWin, 120); });
      try {
        var mql = window.matchMedia('print');
        mql.addEventListener('change', function (mq) { if (!mq.matches) setTimeout(closeWin, 200); });
      } catch (e) {}
      window.onload = function () {
        setTimeout(function () {
          try { window.focus(); window.print(); } catch (e) { closeWin(); }
        }, 300);
      };
    })();
  </script>`
    : '';

  const headerAddr = addressLines.map((l) => `<div class="addr">${escapeReceiptHtml(l)}</div>`).join('');
  const footerAddr = addressLines.map((l) => `<div class="biz">${escapeReceiptHtml(l)}</div>`).join('');
  const footerPhones = phones.map((l) => `<div class="biz">${escapeReceiptHtml(l)}</div>`).join('');
  const footerEmails = emails.map((l) => `<div class="biz">${escapeReceiptHtml(l)}</div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${w}, initial-scale=1" />
  <title>Receipt ${accountTitle}</title>
  <style>
    @page { margin: 0; size: auto; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket {
      width: ${w}px;
      max-width: ${w}px;
      padding: 6px ${pr}px 8px ${pl}px;
      overflow: hidden;
    }
    .brand {
      text-align: center;
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      line-height: 1.25;
      word-break: break-word;
    }
    .addr, .biz, .when, .thanks, .disclaimer, .rule {
      text-align: center;
      word-break: break-word;
    }
    .addr, .biz { font-size: 11px; font-weight: 600; margin-top: 2px; }
    .when { font-size: 11px; font-weight: 700; margin: 8px 0 6px; }
    .rule {
      font-size: 11px;
      letter-spacing: 1px;
      margin: 7px 0;
      overflow: hidden;
    }
    .field { margin: 5px 0; }
    .lab { font-size: 12px; font-weight: 600; text-align: left; }
    .val {
      font-size: 12px;
      font-weight: 700;
      text-align: left;
      padding-left: 8px;
      margin-top: 1px;
      word-break: break-word;
    }
    .val-bold { font-size: 14px; font-weight: 800; }
    .amount {
      font-size: 12px;
      font-weight: 700;
      text-align: left;
      margin: 4px 0;
    }
    .amount-total { font-size: 14px; font-weight: 800; margin-top: 5px; }
    .thanks { font-size: 12px; font-weight: 700; margin: 6px 0; }
    .disclaimer {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      margin-top: 4px;
    }
    @media screen {
      html { background: #e5e7eb; }
      body { padding: 12px 0; }
      .ticket {
        margin: 0 auto;
        background: #fff;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      }
    }
    @media print {
      html, body {
        width: ${w}px !important;
        max-width: ${w}px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .ticket {
        width: ${w}px !important;
        max-width: ${w}px !important;
        padding: 4px ${pr}px 6px ${pl}px !important;
      }
    }
  </style>
</head>
<body>
  <div class="ticket">
    ${centerHtml(companyRaw, 'brand')}
    ${headerAddr}
    <div class="when">${when}</div>
    <div class="rule">${'-'.repeat(24)}</div>
    ${fieldHtml('Account #:', String(receipt.account || ''))}
    ${fieldHtml('Customer:', String(receipt.customer || ''))}
    ${fieldHtml('Extension:', extension)}
    ${fieldHtml('Plan:', String(receipt.plan || ''))}
    ${fieldHtml('Next due:', String(receipt.newDue || ''))}
    <div class="rule">${'-'.repeat(24)}</div>
    <div class="amount">Subtotal: ${escapeReceiptHtml(money(subtotal))}</div>
    ${discountBlock}
    <div class="amount amount-total">TOTAL: ${escapeReceiptHtml(money(total))}</div>
    <div class="rule">${'-'.repeat(24)}</div>
    <div class="thanks">Thank you for your payment.</div>
    <div class="rule">${'-'.repeat(24)}</div>
    ${centerHtml(companyRaw, 'brand')}
    ${footerAddr}
    ${footerPhones}
    ${footerEmails}
    <div class="rule">${'-'.repeat(24)}</div>
    <div class="disclaimer">THIS IS NOT AN OFFICIAL RECEIPT</div>
  </div>
  ${printScript}
</body>
</html>`;
}

/** Desktop browser: popup print window. Returns false if blocked (caller should show modal). */
export function printReceiptInBrowser(receipt: PaymentReceipt): boolean {
  const html = buildReceiptHtml(receipt, { autoPrint: true });
  const popup = window.open('', '_blank', `width=${RECEIPT_PC_WIDTH_PX + 40},height=760,left=0,top=0`);
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}

/** Open receipt in browser print dialog or in-app modal (Android/Capacitor). */
export function openReceiptForPrint(
  receipt: PaymentReceipt,
  onModal: (receipt: PaymentReceipt) => void
): void {
  if (shouldUseReceiptModal() || !printReceiptInBrowser(receipt)) {
    onModal(receipt);
  }
}

/** Prefer in-app receipt UI on Capacitor — Android WebView print dialog often freezes the app. */
export function shouldUseReceiptModal(): boolean {
  return isNativeApp();
}
