/**
 * POS-58 thermal receipt (cnfujun POS-5890U-L).
 * PC browser print: plain-text <pre> block (20 chars wide) — most reliable on
 * Windows thermal drivers. Android: same text via Share.
 */
import { isNativeApp } from '../config';

/** Max characters per line on 58mm / 384-dot head (conservative for PC print). */
const RECEIPT_CHARS = 20;

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

function wrapText(text: string, width = RECEIPT_CHARS): string[] {
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

const RULE = '-'.repeat(RECEIPT_CHARS);

function centerLine(text: string, width = RECEIPT_CHARS): string {
  return wrapText(text, width)
    .map((line) => {
      if (line.length >= width) return line;
      const pad = Math.floor((width - line.length) / 2);
      return `${' '.repeat(pad)}${line}`;
    })
    .join('\n');
}

function stackedField(label: string, value: string): string[] {
  if (!value.trim()) return [];
  return [label, ...wrapText(value, RECEIPT_CHARS)];
}

/** Plain-text receipt — used for Share and PC browser print. */
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
  for (const line of wrapText(company, RECEIPT_CHARS)) lines.push(centerLine(line));
  for (const line of addressLines) {
    for (const wrapped of wrapText(line, RECEIPT_CHARS)) lines.push(centerLine(wrapped));
  }
  if (addressLines.length) lines.push('');
  lines.push(centerLine(when));
  lines.push(RULE);

  lines.push(...stackedField('Account #:', String(receipt.account || '')));
  lines.push(...stackedField('Customer:', String(receipt.customer || '')));
  lines.push(...stackedField('Extension:', extension));
  lines.push(...stackedField('Plan:', String(receipt.plan || '')));
  lines.push(...stackedField('Next due:', String(receipt.newDue || '')));

  lines.push(RULE);
  lines.push(...wrapText(`Subtotal: ${money(subtotal)}`, RECEIPT_CHARS));
  if (discount > 0) {
    lines.push(...wrapText(`Discount (${discountDays}d): -${money(discount)}`, RECEIPT_CHARS));
  }
  lines.push(...wrapText(`TOTAL: ${money(total)}`, RECEIPT_CHARS));
  lines.push(RULE);
  lines.push(centerLine('Thank you for your'));
  lines.push(centerLine('payment.'));
  lines.push(RULE);

  for (const line of wrapText(company, RECEIPT_CHARS)) lines.push(centerLine(line));
  for (const line of addressLines) {
    for (const wrapped of wrapText(line, RECEIPT_CHARS)) lines.push(centerLine(wrapped));
  }
  for (const line of phones) {
    for (const wrapped of wrapText(line, RECEIPT_CHARS)) lines.push(centerLine(wrapped));
  }
  for (const line of emails) {
    for (const wrapped of wrapText(line, RECEIPT_CHARS)) lines.push(centerLine(wrapped));
  }

  lines.push(RULE);
  lines.push(centerLine('THIS IS NOT AN'));
  lines.push(centerLine('OFFICIAL RECEIPT'));
  return lines.join('\n');
}

export function buildReceiptHtml(receipt: PaymentReceipt, opts?: { autoPrint?: boolean }): string {
  const autoPrint = opts?.autoPrint !== false;
  const text = buildReceiptText(receipt);
  const body = escapeReceiptHtml(text);
  const accountTitle = escapeReceiptHtml(receipt.account);

  const printScript = autoPrint
    ? `<script>
    (function () {
      function closeWin() {
        try { window.close(); } catch (e) {}
      }
      window.addEventListener('afterprint', function () {
        setTimeout(closeWin, 120);
      });
      try {
        var mql = window.matchMedia('print');
        mql.addEventListener('change', function (mq) {
          if (!mq.matches) setTimeout(closeWin, 200);
        });
      } catch (e) {}
      window.onload = function () {
        setTimeout(function () {
          try { window.focus(); window.print(); } catch (e) { closeWin(); }
        }, 250);
      };
    })();
  </script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${accountTitle}</title>
  <style>
    @page { margin: 0; size: auto; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    pre {
      margin: 0;
      padding: 2px 4px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 10px;
      line-height: 1.15;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
      width: ${RECEIPT_CHARS}ch;
      max-width: ${RECEIPT_CHARS}ch;
      min-width: 0;
    }
    @media screen {
      html { background: #e5e7eb; }
      body { padding: 12px; }
      pre {
        margin: 0 auto;
        background: #fff;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        padding: 8px 6px;
      }
    }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      pre {
        font-size: 10px !important;
        width: ${RECEIPT_CHARS}ch !important;
        max-width: ${RECEIPT_CHARS}ch !important;
        padding: 0 2px !important;
        margin: 0 !important;
      }
    }
  </style>
</head>
<body>
  <pre>${body}</pre>
  ${printScript}
</body>
</html>`;
}

/** Desktop browser: popup print window. Returns false if blocked (caller should show modal). */
export function printReceiptInBrowser(receipt: PaymentReceipt): boolean {
  const html = buildReceiptHtml(receipt, { autoPrint: true });
  const popup = window.open('', '_blank', 'width=240,height=720,left=0,top=0');
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
