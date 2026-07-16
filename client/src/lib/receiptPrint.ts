/**
 * POS-58 thermal receipt (58mm). Content uses 3mm side inset for printer dead zone.
 * Web: popup + print dialog. Android/Capacitor: in-app preview + Share.
 */
import { isNativeApp } from '../config';

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

/** Plain-text receipt for Share → Bluetooth / RawBT / printer apps. */
export function buildReceiptText(receipt: PaymentReceipt): string {
  const company = receipt.company || 'ISP Billing';
  const months = Number(receipt.months) || 1;
  const extension = months === 1 ? '1 month' : `${months} months`;
  const subtotal = Number(receipt.subtotal) || 0;
  const discount = Number(receipt.discount) || 0;
  const total = Number(receipt.total) || 0;
  const discountDays = Number(receipt.discountDays) || 0;

  const txRaw = receipt.transactionAt || receipt.paymentDate || new Date().toISOString();
  const txDate = new Date(txRaw);
  const transactionWhen = Number.isFinite(txDate.getTime())
    ? txDate.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : String(txRaw);

  const lines = [
    company.toUpperCase(),
    transactionWhen,
    '--------------------------------',
    `Account #: ${receipt.account || ''}`,
    `Customer: ${receipt.customer || ''}`,
    `Extension: ${extension}`,
    `Plan: ${receipt.plan || ''}`,
    `Next due: ${receipt.newDue || ''}`,
    '--------------------------------',
    `Subtotal: ${money(subtotal)}`,
  ];
  if (discount > 0) {
    lines.push(`Discount (${discountDays} day/s): -${money(discount)}`);
  }
  lines.push(
    `TOTAL: ${money(total)}`,
    '--------------------------------',
    'Thank you for your payment.',
  );
  if (receipt.companyAddress) lines.push(receipt.companyAddress);
  if (receipt.companyPhone) lines.push(`Tel: ${receipt.companyPhone}`);
  if (receipt.companyEmail) lines.push(receipt.companyEmail);
  lines.push('', 'THIS IS NOT AN OFFICIAL RECEIPT', '* * *');
  return lines.join('\n');
}

export function buildReceiptHtml(receipt: PaymentReceipt, opts?: { autoPrint?: boolean }): string {
  const autoPrint = opts?.autoPrint !== false;
  const company = escapeReceiptHtml(receipt.company || 'ISP Billing');
  const companyAddress = escapeReceiptHtml(receipt.companyAddress || '');
  const companyPhone = escapeReceiptHtml(receipt.companyPhone || '');
  const companyEmail = escapeReceiptHtml(receipt.companyEmail || '');
  const account = escapeReceiptHtml(receipt.account);
  const fullName = escapeReceiptHtml(receipt.customer || '');
  const plan = escapeReceiptHtml(receipt.plan);
  const months = Number(receipt.months) || 1;
  const extension = months === 1 ? '1 month' : `${months} months`;
  const newDue = escapeReceiptHtml(receipt.newDue);
  const discountDays = Number(receipt.discountDays) || 0;
  const subtotal = Number(receipt.subtotal) || 0;
  const discount = Number(receipt.discount) || 0;
  const total = Number(receipt.total) || 0;

  const txRaw = receipt.transactionAt || receipt.paymentDate || new Date().toISOString();
  const txDate = new Date(txRaw);
  const transactionWhen = escapeReceiptHtml(
    Number.isFinite(txDate.getTime())
      ? txDate.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : String(txRaw)
  );

  const field = (label: string, value: string) =>
    value
      ? `<div class="field"><div class="lab">${label}</div><div class="val">${value}</div></div>`
      : '';

  const discountBlock =
    discount > 0 ? `${field(`Discount (${discountDays} day/s)`, `- ${money(discount)}`)}` : '';

  const businessBits = [
    companyAddress ? `<div>${companyAddress}</div>` : '',
    companyPhone ? `<div>Tel: ${companyPhone}</div>` : '',
    companyEmail ? `<div>${companyEmail}</div>` : '',
  ]
    .filter(Boolean)
    .join('');

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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${account}</title>
  <style>
    @page { size: 58mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000 !important;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket {
      width: 58mm;
      max-width: 58mm;
      margin: 0 auto;
      padding: 0 3mm;
      color: #000;
    }
    .center { text-align: center; }
    .brand {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.01em;
      word-break: break-word;
      overflow-wrap: anywhere;
      color: #000;
    }
    .when {
      margin-top: 4px;
      font-size: 10px;
      font-weight: 700;
      color: #000;
    }
    hr {
      border: none;
      border-top: 1px dashed #000;
      margin: 7px 0;
    }
    .field { margin: 5px 0; color: #000; }
    .field .lab {
      text-align: left;
      font-size: 9px;
      font-weight: 700;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .field .val {
      text-align: right;
      font-size: 11px;
      font-weight: 700;
      color: #000;
      word-break: break-word;
      overflow-wrap: anywhere;
      margin-top: 1px;
    }
    .tot { margin-top: 6px; color: #000; }
    .tot .lab { font-size: 10px; font-weight: 800; text-align: left; }
    .tot .val { font-size: 14px; font-weight: 800; text-align: right; margin-top: 2px; }
    .biz {
      text-align: center;
      font-size: 9px;
      font-weight: 600;
      color: #000;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .disclaimer {
      text-align: center;
      font-size: 9px;
      font-weight: 800;
      color: #000;
      text-transform: uppercase;
      margin-top: 8px;
      line-height: 1.3;
    }
    .thanks {
      text-align: center;
      font-size: 10px;
      font-weight: 700;
      color: #000;
    }
    .cut {
      text-align: center;
      margin-top: 8px;
      font-size: 9px;
      font-weight: 700;
      color: #000;
      letter-spacing: 0.12em;
    }
    @media screen {
      body { background: #e5e7eb; padding: 12px; }
      .ticket { background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
    }
    @media print {
      html, body { width: 58mm; margin: 0; padding: 0; color: #000 !important; }
      .ticket {
        width: 58mm;
        max-width: 58mm;
        margin: 0 auto;
        padding: 0 3mm;
        box-shadow: none;
      }
      * { color: #000 !important; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <div class="brand">${company}</div>
      <div class="when">${transactionWhen}</div>
    </div>
    <hr/>
    ${field('Account #', account)}
    ${field('Customer Name', fullName)}
    ${field('Extension Availed', extension)}
    ${field('Plan', plan)}
    ${field('Next Due Date', newDue)}
    <hr/>
    ${field('Subtotal', money(subtotal))}
    ${discountBlock}
    <div class="field tot">
      <div class="lab">TOTAL</div>
      <div class="val">${money(total)}</div>
    </div>
    <hr/>
    <div class="thanks">Thank you for your payment.</div>
    ${
      businessBits
        ? `<hr/><div class="biz"><div class="brand" style="font-size:10px;margin-bottom:3px">${company}</div>${businessBits}</div>`
        : ''
    }
    <hr/>
    <div class="disclaimer">This is not an official receipt</div>
    <div class="cut">* * *</div>
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
