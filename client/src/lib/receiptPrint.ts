/**
 * POS-58 thermal receipt for 58mm rolls (e.g. cnfujun POS-5890U-L).
 * Paper is ~58mm wide; the 384-dot ESC/POS head prints 48mm (~32 chars) — content
 * is centered on the roll. Stacked label/value lines avoid right-edge clipping.
 */
import { isNativeApp } from '../config';

/** Physical roll width (mm). */
const RECEIPT_PAPER_MM = 58;
/** Printable width for POS-5890 / 384-dot 58mm heads (mm). */
const RECEIPT_PRINT_MM = 48;
/** Approx. monospace characters across the printable area. */
const RECEIPT_CHARS = 32;

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

const RULE = '-'.repeat(RECEIPT_CHARS);

function centerLine(text: string, width = RECEIPT_CHARS): string {
  const t = text.trim();
  if (!t) return '';
  if (t.length >= width) return t;
  const pad = Math.floor((width - t.length) / 2);
  return `${' '.repeat(pad)}${t}`;
}

function rightLine(text: string, width = RECEIPT_CHARS): string {
  const t = text.trim();
  if (!t) return '';
  if (t.length >= width) return t.slice(-width);
  return `${' '.repeat(width - t.length)}${t}`;
}

function amountLine(label: string, amount: string, width = RECEIPT_CHARS): string {
  const gap = width - label.length - amount.length;
  return `${label}${' '.repeat(Math.max(1, gap))}${amount}`;
}

function stackedField(label: string, value: string): string[] {
  if (!value.trim()) return [];
  return [label, rightLine(value)];
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

  const lines: string[] = [company];
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
  lines.push(amountLine('Subtotal:', money(subtotal)));
  if (discount > 0) {
    lines.push(amountLine(`Discount (${discountDays} day/s):`, `-${money(discount)}`));
  }
  lines.push(amountLine('TOTAL:', money(total)));
  lines.push(RULE);
  lines.push(centerLine('Thank you for your payment.'));
  lines.push(RULE);

  lines.push(company);
  for (const line of addressLines) lines.push(centerLine(line));
  for (const line of phones) lines.push(centerLine(line));
  if (receipt.companyEmail) lines.push(centerLine(String(receipt.companyEmail)));

  lines.push(RULE);
  lines.push(centerLine('THIS IS NOT AN OFFICIAL RECEIPT'));
  return lines.join('\n');
}

function stackedFieldHtml(label: string, value: string): string {
  if (!value.trim()) return '';
  return `<div class="stack"><div class="stack-lab">${label}</div><div class="stack-val">${value}</div></div>`;
}

function amountRowHtml(label: string, amount: string, total = false): string {
  return `<div class="amount${total ? ' amount-total' : ''}"><span class="amount-lab">${label}</span><span class="amount-val">${amount}</span></div>`;
}

export function buildReceiptHtml(receipt: PaymentReceipt, opts?: { autoPrint?: boolean }): string {
  const autoPrint = opts?.autoPrint !== false;
  const company = escapeReceiptHtml((receipt.company || 'ISP Billing').toUpperCase());
  const account = escapeReceiptHtml(receipt.account);
  const fullName = escapeReceiptHtml(receipt.customer || '');
  const plan = escapeReceiptHtml(receipt.plan);
  const months = Number(receipt.months) || 1;
  const extension = escapeReceiptHtml(extensionLabel(months));
  const newDue = escapeReceiptHtml(receipt.newDue);
  const discountDays = Number(receipt.discountDays) || 0;
  const subtotal = Number(receipt.subtotal) || 0;
  const discount = Number(receipt.discount) || 0;
  const total = Number(receipt.total) || 0;
  const transactionWhen = escapeReceiptHtml(receiptWhen(receipt));
  const addressLines = headerAddressLines(receipt.companyAddress).map(escapeReceiptHtml);
  const phones = contactLines(receipt.companyPhone).map(escapeReceiptHtml);
  const companyEmail = escapeReceiptHtml(receipt.companyEmail);

  const discountBlock =
    discount > 0
      ? amountRowHtml(`Discount (${discountDays} day/s):`, `-${money(discount)}`)
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${account}</title>
  <style>
    @page { size: ${RECEIPT_PAPER_MM}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000 !important;
      font-family: 'Courier New', Courier, monospace;
      font-size: 10px;
      line-height: 1.25;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket {
      width: ${RECEIPT_PRINT_MM}mm;
      max-width: ${RECEIPT_PRINT_MM}mm;
      margin: 0 auto;
      padding: 0;
      color: #000;
    }
    .brand {
      text-align: center;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.2;
    }
    .addr, .biz-line, .when, .thanks, .disclaimer {
      text-align: center;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .addr { font-size: 9px; font-weight: 600; margin-top: 2px; }
    .when { font-size: 9px; font-weight: 700; margin-top: 6px; }
    .rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .stack { margin: 4px 0 5px; }
    .stack-lab {
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      line-height: 1.2;
    }
    .stack-val {
      text-align: right;
      font-size: 10px;
      font-weight: 700;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.2;
      margin-top: 1px;
    }
    .amount {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      margin: 3px 0;
    }
    .amount-lab { flex: 0 0 auto; text-align: left; }
    .amount-val { flex: 1 1 auto; text-align: right; white-space: nowrap; }
    .amount-total { margin-top: 4px; }
    .amount-total .amount-lab,
    .amount-total .amount-val { font-size: 11px; font-weight: 800; }
    .thanks {
      font-size: 10px;
      font-weight: 700;
      margin: 2px 0;
    }
    .biz { margin-top: 2px; }
    .biz .brand { font-size: 10px; margin-bottom: 2px; }
    .biz-line { font-size: 9px; font-weight: 600; line-height: 1.35; }
    .disclaimer {
      font-size: 8px;
      font-weight: 800;
      text-transform: uppercase;
      margin-top: 2px;
      line-height: 1.25;
    }
    @media screen {
      body { background: #e5e7eb; padding: 12px; width: ${RECEIPT_PAPER_MM}mm; margin: 0 auto; }
      .ticket { background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 4px 0; }
    }
    @media print {
      html, body { width: ${RECEIPT_PAPER_MM}mm; margin: 0; padding: 0; color: #000 !important; }
      .ticket {
        width: ${RECEIPT_PRINT_MM}mm;
        max-width: ${RECEIPT_PRINT_MM}mm;
        margin: 0 auto;
        padding: 0;
        box-shadow: none;
      }
      * { color: #000 !important; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="brand">${company}</div>
    ${headerAddr}
    <div class="when">${transactionWhen}</div>
    <hr class="rule"/>
    ${stackedFieldHtml('Account #:', account)}
    ${stackedFieldHtml('Customer:', fullName)}
    ${stackedFieldHtml('Extension:', extension)}
    ${stackedFieldHtml('Plan:', plan)}
    ${stackedFieldHtml('Next due:', newDue)}
    <hr class="rule"/>
    ${amountRowHtml('Subtotal:', money(subtotal))}
    ${discountBlock}
    ${amountRowHtml('TOTAL:', money(total), true)}
    <hr class="rule"/>
    <div class="thanks">Thank you for your payment.</div>
    <hr class="rule"/>
    <div class="biz">
      <div class="brand">${company}</div>
      ${footerAddr}
      ${footerPhones}
      ${companyEmail ? `<div class="biz-line">${companyEmail}</div>` : ''}
    </div>
    <hr class="rule"/>
    <div class="disclaimer">THIS IS NOT AN OFFICIAL RECEIPT</div>
  </div>
  ${printScript}
</body>
</html>`;
}

/** Desktop browser: popup print window. Returns false if blocked (caller should show modal). */
export function printReceiptInBrowser(receipt: PaymentReceipt): boolean {
  const html = buildReceiptHtml(receipt, { autoPrint: true });
  const w = window.open('', '_blank', 'width=300,height=640');
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
