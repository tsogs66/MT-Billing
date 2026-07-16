/**
 * POS-58 thermal receipt for 58mm rolls (e.g. cnfujun POS-5890U-L).
 * Drivers often ignore centered CSS — use fixed side insets and a narrow
 * inner column (~42mm / 24 chars) so nothing clips on the right edge.
 */
import { isNativeApp } from '../config';

/** Physical roll width (mm). */
const RECEIPT_PAPER_MM = 58;
/** Non-printable / dead zone on each side (mm). */
const RECEIPT_SIDE_MM = 8;
/** Inner content width (mm). */
const RECEIPT_PRINT_MM = RECEIPT_PAPER_MM - RECEIPT_SIDE_MM * 2;
/** Safe monospace character count for ESC/POS / printer apps. */
const RECEIPT_CHARS = 24;

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
  const lines = wrapText(text, width);
  return lines
    .map((line) => {
      if (line.length >= width) return line;
      const pad = Math.floor((width - line.length) / 2);
      return `${' '.repeat(pad)}${line}`;
    })
    .join('\n');
}

function rightLine(text: string, width = RECEIPT_CHARS): string {
  const lines = wrapText(text, width);
  return lines
    .map((line) => {
      if (line.length >= width) return line.slice(0, width);
      return `${' '.repeat(width - line.length)}${line}`;
    })
    .join('\n');
}

function stackedField(label: string, value: string): string[] {
  if (!value.trim()) return [];
  const rows = [label];
  const wrapped = wrapText(value, RECEIPT_CHARS);
  for (const line of wrapped) {
    rows.push(rightLine(line));
  }
  return rows;
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

  for (const row of stackedField('Account #:', String(receipt.account || ''))) lines.push(row);
  for (const row of stackedField('Customer:', String(receipt.customer || ''))) lines.push(row);
  for (const row of stackedField('Extension:', extension)) lines.push(row);
  for (const row of stackedField('Plan:', String(receipt.plan || ''))) lines.push(row);
  for (const row of stackedField('Next due:', String(receipt.newDue || ''))) lines.push(row);

  lines.push(RULE);
  for (const row of stackedField('Subtotal:', money(subtotal))) lines.push(row);
  if (discount > 0) {
    for (const row of stackedField(`Discount (${discountDays}d):`, `-${money(discount)}`)) lines.push(row);
  }
  for (const row of stackedField('TOTAL:', money(total))) lines.push(row);
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
  const valClass = bold ? 'stack-val stack-val-bold' : 'stack-val';
  const wrapped = wrapText(value, RECEIPT_CHARS)
    .map((line) => `<div class="${valClass}">${escapeReceiptHtml(line)}</div>`)
    .join('');
  return `<div class="stack"><div class="stack-lab">${label}</div>${wrapped}</div>`;
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
  const addressLines = headerAddressLines(receipt.companyAddress).map(escapeReceiptHtml);
  const phones = contactLines(receipt.companyPhone).map(escapeReceiptHtml);
  const companyEmail = escapeReceiptHtml(receipt.companyEmail);
  const accountTitle = escapeReceiptHtml(receipt.account);

  const discountBlock =
    discount > 0
      ? stackedFieldHtml(`Discount (${discountDays}d):`, `-${money(discount)}`)
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
        }, 200);
      };
    })();
  </script>`
    : '';

  const headerAddr = addressLines.map((line) => `<div class="addr">${line}</div>`).join('');
  const footerAddr = addressLines.map((line) => `<div class="biz-line">${line}</div>`).join('');
  const footerPhones = phones.map((line) => `<div class="biz-line">${line}</div>`).join('');
  const companyLines = wrapText(companyRaw, RECEIPT_CHARS)
    .map((line) => `<div class="brand">${escapeReceiptHtml(line)}</div>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${accountTitle}</title>
  <style>
    @page {
      size: ${RECEIPT_PAPER_MM}mm auto;
      margin: 0 ${RECEIPT_SIDE_MM}mm;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000 !important;
      font-family: 'Courier New', Courier, monospace;
      font-size: 9px;
      line-height: 1.2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: ${RECEIPT_PAPER_MM}mm;
      max-width: ${RECEIPT_PAPER_MM}mm;
      margin: 0 auto;
      padding: 0 ${RECEIPT_SIDE_MM}mm;
      overflow: hidden;
    }
    .ticket {
      width: ${RECEIPT_PRINT_MM}mm;
      max-width: ${RECEIPT_PRINT_MM}mm;
      margin: 0;
      padding: 0;
      overflow: hidden;
      color: #000;
    }
    .brand {
      text-align: center;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.15;
    }
    .addr, .biz-line, .when, .thanks, .disclaimer {
      text-align: center;
      word-break: break-all;
      overflow-wrap: anywhere;
    }
    .addr { font-size: 8px; font-weight: 600; margin-top: 2px; }
    .when { font-size: 8px; font-weight: 700; margin-top: 5px; }
    .rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 5px 0;
      width: 100%;
    }
    .stack { margin: 3px 0 4px; overflow: hidden; }
    .stack-lab {
      text-align: left;
      font-size: 9px;
      font-weight: 600;
      line-height: 1.15;
    }
    .stack-val {
      text-align: right;
      font-size: 9px;
      font-weight: 700;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.15;
      margin-top: 1px;
      max-width: 100%;
      overflow: hidden;
    }
    .stack-val-bold { font-size: 10px; font-weight: 800; }
    .thanks {
      font-size: 9px;
      font-weight: 700;
      margin: 2px 0;
    }
    .biz { margin-top: 2px; overflow: hidden; }
    .biz .brand { font-size: 9px; margin-bottom: 2px; }
    .biz-line { font-size: 8px; font-weight: 600; line-height: 1.3; }
    .disclaimer {
      font-size: 7px;
      font-weight: 800;
      text-transform: uppercase;
      margin-top: 2px;
      line-height: 1.2;
    }
    @media screen {
      body { background: #e5e7eb; padding: 12px 0; }
      .sheet { background: transparent; }
      .ticket { background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 4px 0; }
    }
    @media print {
      html, body {
        width: ${RECEIPT_PAPER_MM}mm;
        margin: 0;
        padding: 0;
        color: #000 !important;
      }
      .sheet {
        width: ${RECEIPT_PAPER_MM}mm;
        padding: 0 ${RECEIPT_SIDE_MM}mm;
        margin: 0;
      }
      .ticket {
        width: ${RECEIPT_PRINT_MM}mm;
        max-width: ${RECEIPT_PRINT_MM}mm;
        box-shadow: none;
      }
      * { color: #000 !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="ticket">
      ${companyLines}
      ${headerAddr}
      <div class="when">${transactionWhen}</div>
      <hr class="rule"/>
      ${stackedFieldHtml('Account #:', String(receipt.account || ''))}
      ${stackedFieldHtml('Customer:', String(receipt.customer || ''))}
      ${stackedFieldHtml('Extension:', extension)}
      ${stackedFieldHtml('Plan:', String(receipt.plan || ''))}
      ${stackedFieldHtml('Next due:', String(receipt.newDue || ''))}
      <hr class="rule"/>
      ${stackedFieldHtml('Subtotal:', money(subtotal))}
      ${discountBlock}
      ${stackedFieldHtml('TOTAL:', money(total), true)}
      <hr class="rule"/>
      <div class="thanks">Thank you for your payment.</div>
      <hr class="rule"/>
      <div class="biz">
        ${companyLines}
        ${footerAddr}
        ${footerPhones}
        ${companyEmail ? `<div class="biz-line">${companyEmail}</div>` : ''}
      </div>
      <hr class="rule"/>
      <div class="disclaimer">THIS IS NOT AN OFFICIAL RECEIPT</div>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}

/** Desktop browser: popup print window. Returns false if blocked (caller should show modal). */
export function printReceiptInBrowser(receipt: PaymentReceipt): boolean {
  const html = buildReceiptHtml(receipt, { autoPrint: true });
  const w = window.open('', '_blank', 'width=280,height=640');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
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
