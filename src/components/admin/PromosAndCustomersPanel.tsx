/**
 * ============================================================================
 * لوحة أكواد الخصم ودليل العملاء المتكامل (Promo Codes & Customers CRM)
 * مميزات إضافية احترافية في لوحة تحكم YUOP لإدارة العروض وولاء العملاء.
 * ============================================================================
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Tag, Trash2, Users, Search, ExternalLink } from 'lucide-react';
import type { CustomerSummary, PromoCode } from '../../shared/types.ts';
import {
  createPromoCodeApi,
  deletePromoCodeApi,
  updatePromoCodeApi,
} from '../../lib/api.ts';
import { formatDateTime } from '../../lib/i18n.ts';

interface PromoCodesPanelProps {
  promos: PromoCode[];
  onReload: () => Promise<void>;
}

export function PromoCodesPanel({ promos, onReload }: PromoCodesPanelProps) {
  const [form, setForm] = useState({
    code: '',
    discount_type: 'percent' as 'percent' | 'fixed',
    discount_value: 15,
    min_order_amount: 500,
    max_uses: '',
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createPromoCodeApi({
        code: form.code.trim().toUpperCase(),
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        min_order_amount: Number(form.min_order_amount) || 0,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        is_active: true,
      });
      setNotice(`تم إنشاء كود الخصم "${form.code.trim().toUpperCase()}" بنجاح.`);
      setForm({ code: '', discount_type: 'percent', discount_value: 15, min_order_amount: 500, max_uses: '' });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء كود الخصم');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5" />
          <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">
            إدارة أكواد الخصم والعروض الترويجية
          </h2>
        </div>
        <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
          أنشئ كوبونات نسبة مئوية أو مبلغ ثابت بحد أدنى للطلب وحد أقصى للاستخدام. تُطبّق تلقائيًا عند إتمام الشراء.
        </p>

        {notice && (
          <div className="mt-4 border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 gap-3 border border-[#E2E2DD] bg-[#F6F6F4] p-4 text-xs sm:grid-cols-2 lg:grid-cols-6 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
          <div>
            <label htmlFor="promo-code" className="block font-semibold">الكود *</label>
            <input
              id="promo-code"
              type="text"
              required
              dir="ltr"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="YUOP20"
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular uppercase dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div>
            <label htmlFor="promo-type" className="block font-semibold">نوع الخصم</label>
            <select
              id="promo-type"
              value={form.discount_type}
              onChange={(e) => setForm({ ...form, discount_type: e.target.value as 'percent' | 'fixed' })}
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#161614]"
            >
              <option value="percent">نسبة مئوية (%)</option>
              <option value="fixed">مبلغ ثابت (ج.م)</option>
            </select>
          </div>

          <div>
            <label htmlFor="promo-val" className="block font-semibold">القيمة *</label>
            <input
              id="promo-val"
              type="number"
              required
              min={1}
              value={form.discount_value}
              onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div>
            <label htmlFor="promo-min" className="block font-semibold">الحد الأدنى للطلب</label>
            <input
              id="promo-min"
              type="number"
              min={0}
              value={form.min_order_amount}
              onChange={(e) => setForm({ ...form, min_order_amount: Number(e.target.value) })}
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div>
            <label htmlFor="promo-max" className="block font-semibold">أقصى استخدامات</label>
            <input
              id="promo-max"
              type="number"
              min={1}
              value={form.max_uses}
              onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
              placeholder="مفتوح"
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="h-9 w-full bg-[#111111] px-4 font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
            >
              {saving ? 'جاري الإضافة...' : 'إنشاء الكود'}
            </button>
          </div>
        </form>
      </div>

      <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
              <th className="px-4 py-3 text-start">الكود</th>
              <th className="px-4 py-3 text-start">قيمة الخصم</th>
              <th className="px-4 py-3 text-start">الحد الأدنى</th>
              <th className="px-4 py-3 text-start">الاستخدام</th>
              <th className="px-4 py-3 text-start">الحالة</th>
              <th className="px-4 py-3 text-end">حذف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
            {promos.map((p) => (
              <tr key={p.id} className="hover:bg-[#F6F6F4]/60 dark:hover:bg-[#1F1F1C]">
                <td dir="ltr" className="px-4 py-3 text-start font-mono-tabular font-bold">{p.code}</td>
                <td className="px-4 py-3 font-mono-tabular font-semibold">
                  {p.discount_type === 'percent' ? `${p.discount_value}%` : `${p.discount_value} ج.م`}
                </td>
                <td className="px-4 py-3 font-mono-tabular">{p.min_order_amount.toLocaleString()} ج.م</td>
                <td className="px-4 py-3 font-mono-tabular">
                  {p.used_count} / {p.max_uses ?? '∞'}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await updatePromoCodeApi(p.id, { is_active: !p.is_active });
                      await onReload();
                    }}
                    className={`border px-2.5 py-1 text-[11px] font-semibold ${
                      p.is_active
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                        : 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]'
                    }`}
                  >
                    {p.is_active ? 'نشط' : 'متوقف'}
                  </button>
                </td>
                <td className="px-4 py-3 text-end">
                  <button
                    type="button"
                    onClick={async () => {
                      await deletePromoCodeApi(p.id);
                      await onReload();
                    }}
                    aria-label={`حذف ${p.code}`}
                    className="inline-flex h-8 w-8 items-center justify-center border border-[#E2E2DD] text-red-700 hover:bg-red-50 dark:border-[#2A2A27] dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// دليل العملاء وولاء المبيعات (Customers CRM Directory)
// ============================================================================
interface CustomersCrmPanelProps {
  customers: CustomerSummary[];
  onFilterCustomerOrders: (phone: string) => void;
}

export function CustomersCrmPanel({ customers, onFilterCustomerOrders }: CustomersCrmPanelProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.governorate.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q))
    );
  }, [customers, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <div>
            <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">
              دليل العملاء وإجمالي الإنفاق ({customers.length})
            </h2>
            <p className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              متابعة سجل كل عميل، المحافظة، عدد الطلبات، وإجمالي المبيعات المحققة.
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 start-3 h-3.5 w-3.5 -translate-y-1/2 text-[#5C5C58]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم، الهاتف، المحافظة..."
            aria-label="بحث في دليل العملاء"
            className="h-9 w-full border border-[#E2E2DD] ps-9 pe-3 text-xs dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
          />
        </div>
      </div>

      <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
              <th className="px-4 py-3 text-start">العميل</th>
              <th className="px-4 py-3 text-start">الهاتف</th>
              <th className="px-4 py-3 text-start">المحافظة</th>
              <th className="px-4 py-3 text-start">عدد الطلبات</th>
              <th className="px-4 py-3 text-start">إجمالي الإنفاق</th>
              <th className="px-4 py-3 text-start">آخر طلب</th>
              <th className="px-4 py-3 text-end">الطلبات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-[#F6F6F4]/60 dark:hover:bg-[#1F1F1C]">
                <td className="px-4 py-3">
                  <div className="font-bold">{c.name}</div>
                  {c.email && <div className="text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{c.email}</div>}
                </td>
                <td className="px-4 py-3 font-mono-tabular">{c.phone}</td>
                <td className="px-4 py-3">{c.governorate}</td>
                <td className="px-4 py-3 font-mono-tabular font-bold">{c.orders_count}</td>
                <td className="px-4 py-3 font-mono-tabular font-bold text-emerald-700 dark:text-emerald-400">
                  {Number(c.total_spent).toLocaleString()} ج.م
                </td>
                <td className="px-4 py-3 font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                  {formatDateTime(c.last_order_at)}
                </td>
                <td className="px-4 py-3 text-end">
                  <button
                    type="button"
                    onClick={() => onFilterCustomerOrders(c.phone)}
                    className="inline-flex h-8 items-center gap-1.5 bg-[#111111] px-3 text-[11px] font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>عرض الطلبات</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
            لا توجد بيانات عملاء مطابقة للبحث.
          </div>
        )}
      </div>
    </div>
  );
}
