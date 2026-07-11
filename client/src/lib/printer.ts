/** Receipt / portable printer helpers (USB, Wi‑Fi, Bluetooth, network via OS print). */

export type PrinterConnection = 'system' | 'usb' | 'bluetooth' | 'network' | 'serial';

export interface PrinterProfile {
  id: string;
  name: string;
  connection: PrinterConnection;
  /** ESC/POS paper width in characters (32 / 42 / 48). */
  paperChars: 32 | 42 | 48;
  /** Network host:port for raw TCP (server-side) — optional. */
  networkHost?: string;
  networkPort?: number;
  notes?: string;
  createdAt: string;
}

const STORAGE_KEY = 'mt_printers';
const ACTIVE_KEY = 'mt_printer_active';

export function listPrinters(): PrinterProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePrinters(list: PrinterProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getActivePrinterId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActivePrinterId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function getActivePrinter(): PrinterProfile | null {
  const id = getActivePrinterId();
  if (!id) return null;
  return listPrinters().find((p) => p.id === id) || null;
}

export function browserSupports(feature: 'usb' | 'bluetooth' | 'serial'): boolean {
  if (feature === 'usb') return typeof (navigator as any).usb?.requestDevice === 'function';
  if (feature === 'bluetooth') return typeof (navigator as any).bluetooth?.requestDevice === 'function';
  if (feature === 'serial') return typeof (navigator as any).serial?.requestPort === 'function';
  return false;
}

/** Build ESC/POS bytes for a simple text receipt (thermal printers). */
export function buildEscPosReceipt(lines: string[], paperChars = 32): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const push = (arr: number[] | Uint8Array) => {
    for (const b of arr) chunks.push(b);
  };
  // Init
  push([0x1b, 0x40]);
  // Align center for header handled by caller; left for body
  push([0x1b, 0x61, 0x00]);
  for (const line of lines) {
    const clipped = line.length > paperChars ? line.slice(0, paperChars) : line;
    push(enc.encode(clipped + '\n'));
  }
  push(enc.encode('\n\n'));
  // Cut (partial)
  push([0x1d, 0x56, 0x01]);
  return new Uint8Array(chunks);
}

export async function printEscPosViaUsb(data: Uint8Array): Promise<void> {
  const usb = (navigator as any).usb;
  if (!usb) throw new Error('WebUSB is not supported in this browser. Use Chrome/Edge on desktop or Android.');
  const device = await usb.requestDevice({
    filters: [
      { classCode: 7 }, // printer class
      {}, // allow any if user picks thermal
    ],
  });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i: any) =>
    i.alternates.some((a: any) => a.endpoints.some((e: any) => e.direction === 'out'))
  );
  if (!iface) throw new Error('No USB OUT endpoint found on this device.');
  await device.claimInterface(iface.interfaceNumber);
  const alt = iface.alternates[0];
  const ep = alt.endpoints.find((e: any) => e.direction === 'out');
  await device.transferOut(ep.endpointNumber, data);
  await device.close();
}

export async function printEscPosViaBluetooth(data: Uint8Array): Promise<void> {
  const bt = (navigator as any).bluetooth;
  if (!bt) throw new Error('Web Bluetooth is not supported. Use Chrome on Android or desktop with a BLE printer.');
  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'],
  });
  const server = await device.gatt.connect();
  // Common thermal BLE service UUIDs — try known ones then first writable char
  const serviceUuids = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  ];
  let characteristic: any = null;
  for (const uuid of serviceUuids) {
    try {
      const service = await server.getPrimaryService(uuid);
      const chars = await service.getCharacteristics();
      characteristic = chars.find((c: any) => c.properties.write || c.properties.writeWithoutResponse) || chars[0];
      if (characteristic) break;
    } catch {
      /* try next */
    }
  }
  if (!characteristic) throw new Error('Could not find a writable Bluetooth characteristic on this printer.');
  const chunk = 180;
  for (let i = 0; i < data.length; i += chunk) {
    const slice = data.slice(i, i + chunk);
    if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(slice);
    else await characteristic.writeValue(slice);
  }
}

export async function printEscPosViaSerial(data: Uint8Array): Promise<void> {
  const serial = (navigator as any).serial;
  if (!serial) throw new Error('Web Serial is not supported. Use Chrome/Edge on desktop for USB-serial thermal printers.');
  const port = await serial.requestPort();
  await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  await writer.write(data);
  writer.releaseLock();
  await port.close();
}

export function printHtmlReceipt(html: string) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups to print receipts.');
  w.document.write(html);
  w.document.close();
}

export function receiptToLines(receipt: {
  company?: string;
  account?: string;
  customer?: string;
  plan?: string;
  months?: number;
  paymentDate?: string;
  newDue?: string;
  subtotal?: number;
  discount?: number;
  discountDays?: number;
  total?: number;
}): string[] {
  const peso = (n: number) => `PHP ${(n || 0).toFixed(2)}`;
  return [
    receipt.company || 'MT-Billing',
    'Official Payment Receipt',
    '--------------------------------',
    `Acct: ${receipt.account || '—'}`,
    `Cust: ${receipt.customer || '—'}`,
    `Plan: ${receipt.plan || '—'} x ${receipt.months || 1}mo`,
    `Paid: ${receipt.paymentDate || '—'}`,
    `Due:  ${receipt.newDue || '—'}`,
    '--------------------------------',
    `Subtotal ${peso(receipt.subtotal || 0)}`,
    `Discount ${peso(receipt.discount || 0)}`,
    `TOTAL    ${peso(receipt.total || 0)}`,
    '--------------------------------',
    'Thank you for your payment.',
  ];
}

export function receiptToHtml(receipt: any): string {
  const line = (a: string, b: string) =>
    `<div style="display:flex;justify-content:space-between;margin:2px 0"><span>${a}</span><span>${b}</span></div>`;
  return `<!doctype html><html><head><title>Receipt ${receipt.account || ''}</title>
    <style>@page{size:80mm auto;margin:4mm}body{font-family:monospace,Arial,sans-serif;color:#111;padding:12px;max-width:80mm;margin:auto;font-size:12px}
    h2{margin:0 0 2px;font-size:14px} .muted{color:#666;font-size:11px} hr{border:none;border-top:1px dashed #bbb;margin:8px 0}
    .tot{display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin-top:6px}</style></head>
    <body>
      <h2>${receipt.company || 'MT-Billing'}</h2><div class="muted">Official Payment Receipt</div><hr/>
      ${line('Account #', String(receipt.account || '—'))}
      ${line('Customer', String(receipt.customer || '—'))}
      ${line('Plan', `${receipt.plan || '—'} × ${receipt.months || 1} mo`)}
      ${line('Payment date', String(receipt.paymentDate || '—'))}
      ${line('Next due date', String(receipt.newDue || '—'))}
      <hr/>
      ${line('Subtotal', `\u20b1${Number(receipt.subtotal || 0).toFixed(2)}`)}
      ${line(`Discount (${receipt.discountDays || 0} day/s)`, `- \u20b1${Number(receipt.discount || 0).toFixed(2)}`)}
      <div class="tot"><span>TOTAL</span><span>\u20b1${Number(receipt.total || 0).toFixed(2)}</span></div>
      <hr/><div class="muted">Thank you for your payment.</div>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
}

/** Print using the active printer profile, or system print dialog. */
export async function printPaymentReceipt(receipt: any): Promise<{ method: string }> {
  const active = getActivePrinter();
  const lines = receiptToLines(receipt);
  const html = receiptToHtml(receipt);

  if (!active || active.connection === 'system') {
    printHtmlReceipt(html);
    return { method: 'system' };
  }

  const data = buildEscPosReceipt(lines, active.paperChars);

  if (active.connection === 'usb') {
    await printEscPosViaUsb(data);
    return { method: 'usb' };
  }
  if (active.connection === 'bluetooth') {
    await printEscPosViaBluetooth(data);
    return { method: 'bluetooth' };
  }
  if (active.connection === 'serial') {
    await printEscPosViaSerial(data);
    return { method: 'serial' };
  }
  if (active.connection === 'network') {
    // Fall back to system print for network/LAN/Wi‑Fi printers installed on the OS
    // (RJ11 / LAN thermal often appear as system printers after driver install).
    printHtmlReceipt(html);
    return { method: 'network-system' };
  }

  printHtmlReceipt(html);
  return { method: 'system' };
}
