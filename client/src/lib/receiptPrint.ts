/**
 * POS-58 thermal receipt (cnfujun POS-5890U-L).
 * PC browser print: fixed pixel width, top-left, left-aligned — Windows drivers
 * ignore mm @page sizes and clip right-aligned text. Android: plain-text Share.
 */
import { isNativeApp } from '../config';

/** Browser print column width (px @ 96dpi ≈ 53mm on 58mm roll). */
const RECEIPT_PC_WIDTH_PX = 200;
const RECEIPT_PC_PAD_PX = 6;
/** Plain-text line width for Bluetooth / RawBT printer apps. */
const RECEIPT_CHARS = 22;

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
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return [`${parts[0]}, ${parts[1]}`, parts.slice(2).join(', ')];
  if (parts.length === 2) return [parts.join(', ')];
  return [address.trim()];
}

function contactLines(phone?: string | null): string[] {
  if (!phone?.trim()) return [];
  return phone.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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

function stackedFieldText(label: string, value: string): string[] {
  if (!value.trim()) return [];
  return [label, ...wrapText(value, RECEIPT_CHARS)];
}

/** Plain-text receipt for Share → Bluetooth / RawBT / printer apps. */
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
  const phones = contactLines(receipt.companyPhone);

  const lines: string[] = [];
  for (const line of wrapText(company, RECEIPT_CHARS)) lines.push(centerLine(line));
  for (const line of addressLines) lines.push(centerLine(line));
  if (addressLines.length) lines.push('');
  lines.push(centerLine(when));
  lines.push(RULE);

  lines.push(...stackedFieldText('Account #:', String(receipt.account || '')));
  lines.push(...stackedFieldText('Customer:', String(receipt.customer || '')));
  lines.push(...stackedFieldText('Extension:', extension));
  lines.push(...stackedFieldText('Plan:', String(receipt.plan || '')));
  lines.push(...stackedFieldText('Next due:', String(receipt.newDue || '')));

  lines.push(RULE);
  lines.push(`Subtotal: ${money(subtotal)}`);
  if (discount > 0) lines.push(`Discount (${discountDays}d): -${money(discount)}`);
  lines.push(`TOTAL: ${money(total)}`);
  lines.push(RULE);
  lines.push(centerLine('Thank you for your payment.'));
  lines.push(RULE);

  for (const line of wrapText(company, RECEIPT_CHARS)) lines.push(centerLine(line));
  for (const line of addressLines) lines.push(centerLine(line));
  for (const line of phones) lines.push(centerLine(line));
  if (receipt.companyEmail) lines.push(centerLine(String(receipt.companyEmail)));

  lines.push(RULE);
  lines.push(centerLine('THIS IS NOT AN OFFICIAL RECEIPT'));
  return lines.join('\n');
}

function stackedFieldHtml(label: string, value: string, bold = false): string {
  if (!value.trim()) return '';
  const valClass = bold ? 'val val-bold' : 'val';
  const vals = wrapText(value, RECEIPT_CHARS)
    .map((line) => `<div class="${valClass}">${escapeReceiptHtml(line)}</div>`)
    .join('');
  return `<div class="stack"><div class="lab">${label}</div>${vals}</div>`;
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
  const transactionWhen = escapeReceiptHtml(receiptWhen(receipt));
  const addressLines = headerAddressLines(receipt.companyAddress);
  const phones = contactLines(receipt.companyPhone);
  const accountTitle = escapeReceiptHtml(receipt.account);
  const w = RECEIPT_PC_WIDTH_PX;
  const pad = RECEIPT_PC_PAD_PX;

  const discountBlock =
    discount > 0
      ? `<div class="amount">Discount (${discountDays}d): -${escapeReceiptHtml(money(discount))}</div>`
      : '';

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

  const companyLines = wrapText(companyRaw, RECEIPT_CHARS)
    .map((line) => `<div class="brand">${escapeReceiptHtml(line)}</div>`)
    .join('');
  const headerAddr = addressLines.map((line) => `<div class="addr">${escapeReceiptHtml(line)}</div>`).join('');
  const footerAddr = addressLines.map((line) => `<div class="biz">${escapeReceiptHtml(line)}</div>`).join('');
  const footerPhones = phones.map((line) => `<div class="biz">${escapeReceiptHtml(line)}</div>`).join('');

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
      width: ${w}px;
      max-width: ${w}px;
      margin: 0;
      padding: ${pad}px;
      background: #fff;
      color: #000;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket {
      width: 100%;
      max-width: 100%;
      overflow: hidden;
    }
    .brand, .addr, .biz, .when, .thanks, .disclaimer, .rule {
      text-align: center;
      word-break: break-word;
      overflow-wrap: break-word;
      width: 100%;
    }
    .brand { font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .addr, .biz { font-size: 10px; font-weight: 600; margin-top: 2px; }
    .when { font-size: 10px; font-weight: 700; margin: 6px 0 4px; }
    .rule {
      font-size: 10px;
      letter-spacing: -1px;
      margin: 5px 0;
      overflow: hidden;
    }
    .stack { margin: 4px 0; width: 100%; }
    .lab { font-size: 11px; font-weight: 600; text-align: left; }
    .val {
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      padding-left: 8px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .val-bold { font-size: 12px; font-weight: 800; }
    .amount {
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      margin: 3px 0;
      word-break: break-word;
    }
    .amount-total { font-size: 12px; font-weight: 800; margin-top: 4px; }
    .thanks { font-size: 11px; font-weight: 700; margin: 4px 0; }
    .disclaimer {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      margin-top: 4px;
    }
    @media screen {
      html { background: #e5e7eb; }
      body {
        margin: 12px auto;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      }
    }
    @media print {
      html, body {
        width: ${w}px !important;
        max-width: ${w}px !important;
        margin: 0 !important;
        padding: ${pad}px !important;
      }
    }
  </style>
</head>
<body>
  <div class="ticket">
    ${companyLines}
    ${headerAddr}
    <div class="when">${transactionWhen}</div>
    <div class="rule">${RULE}</div>
    ${stackedFieldHtml('Account #:', String(receipt.account || ''))}
    ${stackedFieldHtml('Customer:', String(receipt.customer || ''))}
    ${stackedFieldHtml('Extension:', extension)}
    ${stackedFieldHtml('Plan:', String(receipt.plan || ''))}
    ${stackedFieldHtml('Next due:', String(receipt.newDue || ''))}
    <div class="rule">${RULE}</div>
    <div class="amount">Subtotal: ${escapeReceiptHtml(money(subtotal))}</div>
    ${discountBlock}
    <div class="amount amount-total">TOTAL: ${escapeReceiptHtml(money(total))}</div>
    <div class="rule">${RULE}</div>
    <div class="thanks">Thank you for your payment.</div>
    <div class="rule">${RULE}</div>
    ${companyLines}
    ${footerAddr}
    ${footerPhones}
    ${receipt.companyEmail ? `<div class="biz">${escapeReceiptHtml(receipt.companyEmail)}</div>` : ''}
    <div class="rule">${RULE}</div>
    <div class="disclaimer">THIS IS NOT AN OFFICIAL RECEIPT</div>
  </div>
  ${printScript}
</body>
</html>`;
}

/** Desktop browser: popup print window. Returns false if blocked (caller should show modal). */
export function printReceiptInBrowser(receipt: PaymentReceipt): boolean {
  const html = buildReceiptHtml(receipt, { autoPrint: true });
  const w = RECEIPT_PC_WIDTH_PX + RECEIPT_PC_PAD_PX * 2 + 24;
  const popup = window.open('', '_blank', `width=${w},height=720,left=0,top=0`);
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
