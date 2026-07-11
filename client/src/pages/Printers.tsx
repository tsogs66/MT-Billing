import { useEffect, useState } from 'react';
import { Printer, Usb, Bluetooth, Wifi, Cable, CheckCircle2, Trash2, Star, MonitorSmartphone } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, FormField, Flash } from '../components/ui';
import {
  listPrinters,
  savePrinters,
  getActivePrinterId,
  setActivePrinterId,
  browserSupports,
  type PrinterConnection,
  type PrinterProfile,
  printPaymentReceipt,
} from '../lib/printer';

const CONNECTIONS: { id: PrinterConnection; label: string; hint: string; icon: typeof Usb }[] = [
  { id: 'system', label: 'System / OS printer', hint: 'USB, Wi‑Fi, Bluetooth, LAN or RJ11 printers already installed on this computer or Android device', icon: MonitorSmartphone },
  { id: 'usb', label: 'USB thermal (WebUSB)', hint: 'Direct ESC/POS thermal via USB (Chrome/Edge desktop or Android)', icon: Usb },
  { id: 'bluetooth', label: 'Bluetooth thermal', hint: 'BLE portable receipt printers (Chrome on Android/desktop)', icon: Bluetooth },
  { id: 'serial', label: 'USB-Serial / COM', hint: 'Serial ESC/POS adapters (Chrome/Edge desktop)', icon: Cable },
  { id: 'network', label: 'Network / Wi‑Fi / LAN', hint: 'Uses the system print dialog for network printers (install driver first)', icon: Wifi },
];

export default function Printers() {
  const [printers, setPrinters] = useState<PrinterProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [connection, setConnection] = useState<PrinterConnection>('system');
  const [paperChars, setPaperChars] = useState<32 | 42 | 48>(32);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'success' | 'error' | 'info'>('success');

  const reload = () => {
    setPrinters(listPrinters());
    setActiveId(getActivePrinterId());
  };

  useEffect(() => {
    reload();
  }, []);

  const flash = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setBanner(msg);
    setBannerType(type);
    setTimeout(() => setBanner(''), 5000);
  };

  const add = () => {
    if (!name.trim()) {
      flash('Enter a printer name.', 'error');
      return;
    }
    if (connection === 'usb' && !browserSupports('usb')) {
      flash('WebUSB not available. Use Chrome/Edge, or choose System printer.', 'error');
      return;
    }
    if (connection === 'bluetooth' && !browserSupports('bluetooth')) {
      flash('Web Bluetooth not available. Use Chrome on Android/desktop, or choose System printer.', 'error');
      return;
    }
    if (connection === 'serial' && !browserSupports('serial')) {
      flash('Web Serial not available. Use Chrome/Edge on desktop, or choose System printer.', 'error');
      return;
    }
    const profile: PrinterProfile = {
      id: `p_${Date.now()}`,
      name: name.trim(),
      connection,
      paperChars,
      createdAt: new Date().toISOString(),
    };
    const next = [...printers, profile];
    savePrinters(next);
    if (!activeId) setActivePrinterId(profile.id);
    setName('');
    reload();
    flash(`Added ${profile.name}.`);
  };

  const remove = (id: string) => {
    const next = printers.filter((p) => p.id !== id);
    savePrinters(next);
    if (activeId === id) setActivePrinterId(next[0]?.id || null);
    reload();
  };

  const makeActive = (id: string) => {
    setActivePrinterId(id);
    reload();
    flash('Default receipt printer updated.');
  };

  const testPrint = async () => {
    try {
      const result = await printPaymentReceipt({
        company: 'MT-Billing Test',
        account: '000000000000',
        customer: 'Test Customer',
        plan: 'TEST',
        months: 1,
        paymentDate: new Date().toISOString().slice(0, 10),
        newDue: new Date().toISOString().slice(0, 10),
        subtotal: 100,
        discount: 0,
        discountDays: 0,
        total: 100,
      });
      flash(`Test sent via ${result.method}.`);
    } catch (e: any) {
      flash(e?.message || 'Test print failed.', 'error');
    }
  };

  return (
    <Layout title="Printers">
      {banner && <Flash message={banner} type={bannerType} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title="Add receipt printer" icon={Printer}>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Portable thermal and receipt printers can connect over USB, Wi‑Fi, Bluetooth, LAN, or RJ11 (via OS drivers).
              Payment receipts use the default printer below.
            </p>
            <FormField label="Printer name" required>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Counter thermal 58mm" />
            </FormField>
            <FormField label="Connection">
              <select className="input" value={connection} onChange={(e) => setConnection(e.target.value as PrinterConnection)}>
                {CONNECTIONS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </FormField>
            <p className="text-xs text-slate-400">{CONNECTIONS.find((c) => c.id === connection)?.hint}</p>
            <FormField label="Paper width (ESC/POS chars)">
              <select className="input" value={paperChars} onChange={(e) => setPaperChars(Number(e.target.value) as 32 | 42 | 48)}>
                <option value={32}>58mm (~32 chars)</option>
                <option value={42}>72mm (~42 chars)</option>
                <option value={48}>80mm (~48 chars)</option>
              </select>
            </FormField>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={add}>Add printer</button>
              <button type="button" className="btn-secondary" onClick={testPrint}>Test print</button>
            </div>
            <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-100">
              <div>Browser support: USB {browserSupports('usb') ? '✓' : '—'} · Bluetooth {browserSupports('bluetooth') ? '✓' : '—'} · Serial {browserSupports('serial') ? '✓' : '—'}</div>
              <div>RJ11 / LAN printers: install the vendor driver, then choose System / Network printer.</div>
            </div>
          </div>
        </Card>

        <Card title="Saved printers">
          {printers.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No printers yet. Add one, or use the system print dialog on payment.</p>
          ) : (
            <div className="space-y-2">
              {printers.map((p) => {
                const Icon = CONNECTIONS.find((c) => c.id === p.connection)?.icon || Printer;
                const isActive = p.id === activeId;
                return (
                  <div key={p.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${isActive ? 'border-brand-300 bg-brand-50/60' : 'border-slate-100'}`}>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                        {p.name}
                        {isActive && <CheckCircle2 size={14} className="text-brand-500" />}
                      </div>
                      <div className="text-xs text-slate-400">{CONNECTIONS.find((c) => c.id === p.connection)?.label} · {p.paperChars} chars</div>
                    </div>
                    {!isActive && (
                      <button type="button" className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1" onClick={() => makeActive(p.id)}>
                        <Star size={12} /> Default
                      </button>
                    )}
                    <button type="button" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" onClick={() => remove(p.id)} aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}
