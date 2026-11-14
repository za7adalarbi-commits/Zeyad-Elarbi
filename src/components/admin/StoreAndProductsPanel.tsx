/**
 * ============================================================================
 * لوحة تخصيص المتجر بالكامل وإدارة المنتجات (Storefront Customizer & Products)
 * تتيح للمدير تعديل كل تفصيلة في واجهة YUOP وإضافة وتعديل وحذف المنتجات والمخزون.
 * ============================================================================
 */
import { useState, type FormEvent } from 'react';
import { Plus, Trash2, Save, CheckCircle2 } from 'lucide-react';
import type { Product, StoreSettings, ThemeMode } from '../../shared/types.ts';
import {
  createProductApi,
  deleteProductApi,
  updateProductApi,
  updateStoreSettingsApi,
} from '../../lib/api.ts';
import { ImageWithFallback } from '../ImageWithFallback.tsx';

interface StoreAndProductsPanelProps {
  settings: StoreSettings;
  products: Product[];
  canManageStore: boolean;
  canManageProducts: boolean;
  onSettingsSaved: (s: StoreSettings) => void;
  onProductsReload: () => Promise<void>;
}

const PRESET_PRODUCT_IMAGES = [
  { label: 'هودي أوبسيديان', url: '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg' },
  { label: 'تيشيرت تشوك', url: '/src/assets/images/product_tee_chalk_1794549970590.jpg' },
  { label: 'كارجو سليت', url: '/src/assets/images/product_cargo_slate_1794549970140.jpg' },
  { label: 'جاكيت وورك وير', url: '/src/assets/images/product_jacket_bomber_1794549971089.jpg' },
];

export function StoreAndProductsPanel({
  settings,
  products,
  canManageStore,
  canManageProducts,
  onSettingsSaved,
  onProductsReload,
}: StoreAndProductsPanelProps) {
  const [form, setForm] = useState<StoreSettings>(settings);
  const [savingStore, setSavingStore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // نموذج إضافة منتج جديد
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProd, setNewProd] = useState({
    name_ar: '',
    name_en: '',
    category: 'Hoodies',
    price: 1200,
    compare_at_price: '',
    fabric_details: '100% قطن ثقيل 450 GSM',
    description_ar: '',
    description_en: '',
    image_url: PRESET_PRODUCT_IMAGES[0].url,
    badge_text: 'إصدار جديد',
    stock_s: 8,
    stock_m: 12,
    stock_l: 12,
    stock_xl: 6,
  });

  const handleSaveStore = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setErrMsg(null);
    setSavingStore(true);
    try {
      const res = await updateStoreSettingsApi(form);
      onSettingsSaved(res.settings);
      setNotice('تم حفظ إعدادات وتخصيصات المتجر وتحديث الواجهة فورًا.');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل حفظ الإعدادات');
    } finally {
      setSavingStore(false);
    }
  };

  const handleCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setErrMsg(null);
    try {
      await createProductApi({
        name_ar: newProd.name_ar,
        name_en: newProd.name_en,
        category: newProd.category,
        price: Number(newProd.price),
        compare_at_price: newProd.compare_at_price ? Number(newProd.compare_at_price) : null,
        fabric_details: newProd.fabric_details,
        description_ar: newProd.description_ar,
        description_en: newProd.description_en,
        image_url: newProd.image_url,
        badge_text: newProd.badge_text || null,
        sizes_stock: {
          S: Number(newProd.stock_s),
          M: Number(newProd.stock_m),
          L: Number(newProd.stock_l),
          XL: Number(newProd.stock_xl),
        },
        is_featured: true,
        is_active: true,
      });
      setShowAddProduct(false);
      setNewProd({
        ...newProd,
        name_ar: '',
        name_en: '',
        description_ar: '',
        description_en: '',
      });
      await onProductsReload();
      setNotice('تمت إضافة المنتج الجديد إلى المتجر.');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر إضافة المنتج');
    }
  };

  const handleToggleProductActive = async (p: Product) => {
    try {
      await updateProductApi(p.id, { is_active: !p.is_active });
      await onProductsReload();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحديث المنتج');
    }
  };

  const handleQuickPriceUpdate = async (p: Product, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice <= 0) return;
    try {
      await updateProductApi(p.id, { price: newPrice });
      await onProductsReload();
      setNotice(`تم تحديث سعر "${p.name_ar}"`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تحديث السعر');
    }
  };

  const handleDeleteProduct = async (p: Product) => {
    try {
      await deleteProductApi(p.id);
      await onProductsReload();
      setNotice(`تم حذف المنتج "${p.name_ar}"`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف المنتج');
    }
  };

  return (
    <div className="space-y-8">
      {notice && (
        <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          <span>{notice}</span>
        </div>
      )}
      {errMsg && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">{errMsg}</div>
      )}

      {/* القسم الأول: تخصيص المتجر بالكامل */}
      <form onSubmit={handleSaveStore} className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
          <div>
            <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">تخصيص مظهر وإعدادات متجر YUOP</h2>
            <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              أي تعديل هنا ينعكس فورًا على واجهة المتجر للعملاء وبيانات التحويل والشحن.
            </p>
          </div>
          {canManageStore && (
            <button
              type="submit"
              disabled={savingStore}
              className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
            >
              <Save className="h-4 w-4" />
              <span>{savingStore ? 'جاري الحفظ...' : 'حفظ تخصيص المتجر'}</span>
            </button>
          )}
        </div>

        <fieldset disabled={!canManageStore} className="mt-5 grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
          <div>
            <label className="block font-semibold">اسم المتجر</label>
            <input
              type="text"
              value={form.store_name}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">رقم واتساب الدعم</label>
            <input
              type="text"
              value={form.support_whatsapp}
              onChange={(e) => setForm({ ...form, support_whatsapp: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">عنوان الهيرو الرئيسي (عربي)</label>
            <input
              type="text"
              value={form.hero_title_ar}
              onChange={(e) => setForm({ ...form, hero_title_ar: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">Hero Title (English)</label>
            <input
              type="text"
              value={form.hero_title_en}
              onChange={(e) => setForm({ ...form, hero_title_en: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block font-semibold">الوصف الترويجي أسفل العنوان (عربي)</label>
            <input
              type="text"
              value={form.hero_subtitle_ar}
              onChange={(e) => setForm({ ...form, hero_subtitle_ar: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">نص شريط الإعلانات العلوي (عربي)</label>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="checkbox"
                id="ann-enabled"
                checked={form.announcement_enabled}
                onChange={(e) => setForm({ ...form, announcement_enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="ann-enabled" className="text-xs font-medium">تفعيل الشريط</label>
              <input
                type="text"
                value={form.announcement_text_ar}
                onChange={(e) => setForm({ ...form, announcement_text_ar: e.target.value })}
                className="h-10 flex-1 border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>
          </div>
          <div>
            <label htmlFor="store-default-theme" className="block font-semibold">المظهر الافتراضي للموقع</label>
            <select
              id="store-default-theme"
              value={form.default_theme || 'light'}
              onChange={(e) => setForm({ ...form, default_theme: e.target.value as ThemeMode })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] bg-white px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            >
              <option value="light">الوضع الصباحي (Light Mode)</option>
              <option value="dark">الوضع الليلي (Dark Mode)</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold">رسوم الشحن (ج.م)</label>
            <input
              type="number"
              value={form.shipping_fee}
              onChange={(e) => setForm({ ...form, shipping_fee: Number(e.target.value) })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">الحد الأدنى للشحن المجاني (ج.م)</label>
            <input
              type="number"
              value={form.free_shipping_threshold}
              onChange={(e) => setForm({ ...form, free_shipping_threshold: Number(e.target.value) })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>

          <div>
            <label className="block font-semibold">رقم محفظة Vodafone Cash للتحويل</label>
            <input
              type="text"
              value={form.vodafone_cash_number}
              onChange={(e) => setForm({ ...form, vodafone_cash_number: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>
          <div>
            <label className="block font-semibold">عنوان التحويل عبر InstaPay</label>
            <input
              type="text"
              value={form.instapay_address}
              onChange={(e) => setForm({ ...form, instapay_address: e.target.value })}
              className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
            />
          </div>

          <div className="flex flex-wrap gap-6 pt-2 md:col-span-2">
            <label className="inline-flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={form.vodafone_enabled}
                onChange={(e) => setForm({ ...form, vodafone_enabled: e.target.checked })}
              />
              <span>تفعيل Vodafone Cash</span>
            </label>
            <label className="inline-flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={form.instapay_enabled}
                onChange={(e) => setForm({ ...form, instapay_enabled: e.target.checked })}
              />
              <span>تفعيل InstaPay</span>
            </label>
            <label className="inline-flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={form.cod_enabled}
                onChange={(e) => setForm({ ...form, cod_enabled: e.target.checked })}
              />
              <span>تفعيل الدفع عند الاستلام (COD)</span>
            </label>
          </div>
        </fieldset>
      </form>

      {/* القسم الثاني: إدارة المنتجات */}
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
          <div>
            <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">كتالوج المنتجات والمخزون ({products.length})</h2>
            <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">إدارة الأسعار، المخزون، تفعيل أو إخفاء القطع من المتجر.</p>
          </div>
          {canManageProducts && (
            <button
              type="button"
              onClick={() => setShowAddProduct(!showAddProduct)}
              className="inline-flex h-10 items-center gap-1.5 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
            >
              <Plus className="h-4 w-4" />
              <span>{showAddProduct ? 'إلغاء' : 'إضافة منتج جديد'}</span>
            </button>
          )}
        </div>

        {showAddProduct && canManageProducts && (
          <form onSubmit={handleCreateProduct} className="mt-5 grid grid-cols-1 gap-3 border border-[#E2E2DD] bg-[#F6F6F4] p-4 text-xs sm:grid-cols-2 lg:grid-cols-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
            <div>
              <label className="block font-semibold">اسم المنتج (عربي) *</label>
              <input
                type="text"
                required
                value={newProd.name_ar}
                onChange={(e) => setNewProd({ ...newProd, name_ar: e.target.value })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
              />
            </div>
            <div>
              <label className="block font-semibold">Product Name (English) *</label>
              <input
                type="text"
                required
                value={newProd.name_en}
                onChange={(e) => setNewProd({ ...newProd, name_en: e.target.value })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
              />
            </div>
            <div>
              <label className="block font-semibold">الفئة</label>
              <select
                value={newProd.category}
                onChange={(e) => setNewProd({ ...newProd, category: e.target.value })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
              >
                <option value="Hoodies">Hoodies</option>
                <option value="Tees">Tees</option>
                <option value="Cargos">Cargos</option>
                <option value="Jackets">Jackets</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold">السعر (ج.م) *</label>
              <input
                type="number"
                required
                value={newProd.price}
                onChange={(e) => setNewProd({ ...newProd, price: Number(e.target.value) })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
              />
            </div>
            <div>
              <label className="block font-semibold">صورة المنتج</label>
              <select
                value={newProd.image_url}
                onChange={(e) => setNewProd({ ...newProd, image_url: e.target.value })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
              >
                {PRESET_PRODUCT_IMAGES.map((img) => (
                  <option key={img.url} value={img.url}>{img.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold">تفاصيل الخامة</label>
              <input
                type="text"
                value={newProd.fabric_details}
                onChange={(e) => setNewProd({ ...newProd, fabric_details: e.target.value })}
                className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
              />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:col-span-2 lg:col-span-3">
              <div>
                <label className="block font-semibold">مخزون S</label>
                <input type="number" value={newProd.stock_s} onChange={(e) => setNewProd({ ...newProd, stock_s: Number(e.target.value) })} className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]" />
              </div>
              <div>
                <label className="block font-semibold">مخزون M</label>
                <input type="number" value={newProd.stock_m} onChange={(e) => setNewProd({ ...newProd, stock_m: Number(e.target.value) })} className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]" />
              </div>
              <div>
                <label className="block font-semibold">مخزون L</label>
                <input type="number" value={newProd.stock_l} onChange={(e) => setNewProd({ ...newProd, stock_l: Number(e.target.value) })} className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]" />
              </div>
              <div>
                <label className="block font-semibold">مخزون XL</label>
                <input type="number" value={newProd.stock_xl} onChange={(e) => setNewProd({ ...newProd, stock_xl: Number(e.target.value) })} className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]" />
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <button type="submit" className="h-9 bg-[#111111] px-5 font-semibold text-white dark:bg-[#F5F5F2] dark:text-[#111111]">
                حفظ المنتج وإضافته للمتجر
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E2E2DD] text-[#5C5C58] dark:border-[#2A2A27] dark:text-[#A8A8A0]">
                <th className="py-2.5 text-start font-semibold">المنتج</th>
                <th className="py-2.5 text-start font-semibold">الفئة</th>
                <th className="py-2.5 text-start font-semibold">السعر (ج.م)</th>
                <th className="py-2.5 text-start font-semibold">المخزون</th>
                <th className="py-2.5 text-start font-semibold">الحالة</th>
                <th className="py-2.5 text-end font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
              {products.map((p) => {
                const stockTotal = Object.values(p.sizes_stock || {}).reduce((s, q) => s + Number(q), 0);
                return (
                  <tr key={p.id} className="hover:bg-[#F6F6F4]/60 dark:hover:bg-[#1F1F1C]">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 shrink-0 overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4] dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                          <ImageWithFallback src={p.image_url} alt={p.name_ar} className="h-full w-full object-cover" />
                        </div>
                        <div>
                          <div className="font-bold text-[#111111] dark:text-[#F5F5F2]">{p.name_ar}</div>
                          <div className="text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{p.name_en}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">{p.category}</td>
                    <td className="py-3 font-mono-tabular font-semibold">
                      {canManageProducts ? (
                        <input
                          type="number"
                          defaultValue={p.price}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (val !== p.price) handleQuickPriceUpdate(p, val);
                          }}
                          aria-label={`سعر ${p.name_ar}`}
                          className="h-8 w-24 border border-[#E2E2DD] px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                        />
                      ) : (
                        `${p.price.toLocaleString()} ج.م`
                      )}
                    </td>
                    <td className="py-3 font-mono-tabular">{stockTotal} قطعة</td>
                    <td className="py-3">
                      <button
                        type="button"
                        disabled={!canManageProducts}
                        onClick={() => handleToggleProductActive(p)}
                        className={`border px-2.5 py-1 text-[11px] font-semibold ${
                          p.is_active
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                            : 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]'
                        }`}
                      >
                        {p.is_active ? 'نشط بالمتجر' : 'مخفي'}
                      </button>
                    </td>
                    <td className="py-3 text-end">
                      {canManageProducts && (
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p)}
                          aria-label={`حذف ${p.name_ar}`}
                          className="inline-flex h-8 w-8 items-center justify-center border border-[#E2E2DD] text-red-700 hover:bg-red-50 dark:border-[#2A2A27] dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
