import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, StatusBadge, Stat } from '../components/ui';
import { api, peso } from '../api';

export default function Inventory() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api.get('/inventory').then((r) => setItems(r.data));
  }, []);

  const totalValue = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const lowStock = items.filter((i) => i.status !== 'In Stock').length;

  return (
    <Layout title="Stock & Inventory">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-5">
        <Card><Stat label="SKUs" value={items.length} /></Card>
        <Card><Stat label="Inventory Value" value={peso(totalValue)} /></Card>
        <Card><Stat label="Needs Restock" value={lowStock} /></Card>
      </div>

      <Card title="Items">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium">SKU</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Unit Price</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-800 font-medium">{i.name}</td>
                  <td className="py-2 text-slate-500">{i.category}</td>
                  <td className="py-2 text-slate-500">{i.sku}</td>
                  <td className="py-2 text-right text-slate-700">{i.quantity}</td>
                  <td className="py-2 text-right text-slate-700">{peso(i.unitPrice)}</td>
                  <td className="py-2"><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Layout>
  );
}
