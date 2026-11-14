/**
 * ============================================================================
 * لوحة إنشاء وإدارة صفحات الهبوط التسويقية وحسابات السوشيال ميديا
 * (Landing Page Builder & Social Media Manager)
 * ============================================================================
 */
import { useState, type FormEvent } from 'react';
import {
  Plus,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Edit3,
  Globe,
  Eye,
  Save,
  Share2,
} from 'lucide-react';
import {
  SOCIAL_PLATFORMS,
  type LandingPage,
  type Product,
  type SocialLink,
  type SocialPlatform,
  type ThemeMode,
} from '../../shared/types.ts';
import {
  createLandingPageApi,
  createSocialLinkApi,
  deleteLandingPageApi,
  deleteSocialLinkApi,
  updateLandingPageApi,
  updateSocialLinkApi,
} from '../../lib/api.ts';
import { normalizeLandingSlug } from '../../shared/orderRules.ts';
import { SocialPlatformIcon, SOCIAL_PLATFORM_LABELS } from '../SocialIcons.tsx';

const PRESET_HERO_IMAGES = [
  { label: 'هيرو الحملة الشتوية الرئيسي', url: '/src/assets/images/hero_yuop_streetwear_1794549969761.jpg' },
  { label: 'مجموعة الهوديز 480 GSM', url: '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg' },
  { label: 'مجموعة التيشيرتات البوكسي', url: '/src/assets/images/cat_tees_editorial_1794551311360.jpg' },
  { label: 'كارجو سليت التقني', url: '/src/assets/images/cat_cargos_editorial_1794551311969.jpg' },
];

interface LandingPagesPanelProps {
  pages: LandingPage[];
  products: Product[];
  onReload: () => Promise<void>;
  onPreviewSlug: (slug: string) => void;
}

export function LandingPagesPanel({
  pages,
  products,
  onReload,
  onPreviewSlug,
}: LandingPagesPanelProps) {
  const emptyForm = {
    slug: '',
    title_ar: '',
    title_en: '',
    kicker_ar: 'حملة حصرية · YUOP',
    kicker_en: 'EXCLUSIVE CAMPAIGN · YUOP',
    subtitle_ar: '',
    subtitle_en: '',
    hero_image_url: PRESET_HERO_IMAGES[0].url,
    cta_text_ar: 'اكتشف قطع الحملة',
    cta_text_en: 'Shop the Campaign',
    theme_style: 'dark' as ThemeMode,
    highlightsText: 'قطن مصري 100% عالي الكثافة\nشحن سريع لجميع المحافظات\nمتابعة فورية للطلب عبر WhatsApp',
    featured_product_ids: products.slice(0, 3).map((p) => p.id),
    is_published: true,
    show_in_footer: true,
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
    setNotice(null);
  };

  const openEdit = (lp: LandingPage) => {
    setEditingId(lp.id);
    setForm({
      slug: lp.slug,
      title_ar: lp.title_ar,
      title_en: lp.title_en,
      kicker_ar: lp.kicker_ar,
      kicker_en: lp.kicker_en,
      subtitle_ar: lp.subtitle_ar,
      subtitle_en: lp.subtitle_en,
      hero_image_url: lp.hero_image_url,
      cta_text_ar: lp.cta_text_ar,
      cta_text_en: lp.cta_text_en,
      theme_style: lp.theme_style,
      highlightsText: (lp.highlights || []).join('\n'),
      featured_product_ids: lp.featured_product_ids || [],
      is_published: lp.is_published,
      show_in_footer: lp.show_in_footer,
    });
    setShowForm(true);
    setError(null);
    setNotice(null);
  };

  const toggleProductSelection = (id: number) => {
    setForm((prev) => ({
      ...prev,
      featured_product_ids: prev.featured_product_ids.includes(id)
        ? prev.featured_product_ids.filter((pid) => pid !== id)
        : [...prev.featured_product_ids, id],
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      slug: normalizeLandingSlug(form.slug || form.title_en || form.title_ar),
      title_ar: form.title_ar.trim(),
      title_en: form.title_en.trim() || form.title_ar.trim(),
      kicker_ar: form.kicker_ar.trim(),
      kicker_en: form.kicker_en.trim(),
      subtitle_ar: form.subtitle_ar.trim(),
      subtitle_en: form.subtitle_en.trim() || form.subtitle_ar.trim(),
      hero_image_url: form.hero_image_url.trim(),
      cta_text_ar: form.cta_text_ar.trim(),
      cta_text_en: form.cta_text_en.trim(),
      theme_style: form.theme_style,
      highlights: form.highlightsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      featured_product_ids: form.featured_product_ids,
      is_published: form.is_published,
      show_in_footer: form.show_in_footer,
    };

    try {
      if (editingId) {
        await updateLandingPageApi(editingId, payload);
        setNotice(`تم تحديث صفحة الهبوط "/lp/${payload.slug}" بنجاح.`);
      } else {
        await createLandingPageApi(payload);
        setNotice(`تم إنشاء صفحة الهبوط "/lp/${payload.slug}" ونشرها.`);
      }
      setShowForm(false);
      setEditingId(null);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ صفحة الهبوط');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = (slug: string) => {
    const url = `${window.location.origin}/lp/${slug}`;
    navigator.clipboard?.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 1500);
  };

  return (
    <div className="space-y-6">
      {/* الترويسة */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div>
          <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">
            منشئ صفحات الهبوط التسويقية (Landing Page Builder)
          </h2>
          <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
            أنشئ صفحات مخصصة للحملات الإعلانية والإصدارات المحدودة مع ربط مباشر بقطع الكتالوج وإحصاءات الزيارات.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? setShowForm(false) : openCreate())}
          className="inline-flex h-10 items-center gap-2 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
        >
          <Plus className="h-4 w-4" />
          <span>{showForm ? 'إغلاق المحرر' : 'إنشاء صفحة هبوط جديدة'}</span>
        </button>
      </div>

      {notice && (
        <div className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">
          {error}
        </div>
      )}

      {/* محرر صفحة الهبوط */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="space-y-4 border border-[#E2E2DD] bg-white p-6 text-xs dark:border-[#2A2A27] dark:bg-[#161614]"
        >
          <h3 className="border-b border-[#E2E2DD] pb-3 text-sm font-bold dark:border-[#2A2A27]">
            {editingId ? 'تعديل صفحة الهبوط' : 'إعداد صفحة هبوط جديدة'}
          </h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="lp-slug" className="block font-semibold">
                الرابط المختصر (Slug) *
              </label>
              <input
                id="lp-slug"
                type="text"
                required
                dir="ltr"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="winter-drop-2026"
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
              <span className="mt-1 block font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                /lp/{normalizeLandingSlug(form.slug || 'slug')}
              </span>
            </div>

            <div>
              <label htmlFor="lp-title-ar" className="block font-semibold">
                العنوان الرئيسي (عربي) *
              </label>
              <input
                id="lp-title-ar"
                type="text"
                required
                value={form.title_ar}
                onChange={(e) => setForm({ ...form, title_ar: e.target.value })}
                placeholder="تشكيلة الشتاء الثقيلة"
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div>
              <label htmlFor="lp-title-en" className="block font-semibold">
                Main Headline (English)
              </label>
              <input
                id="lp-title-en"
                type="text"
                dir="ltr"
                value={form.title_en}
                onChange={(e) => setForm({ ...form, title_en: e.target.value })}
                placeholder="HEAVY WINTER DROP"
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div>
              <label className="block font-semibold">العنوان التمهيدي (Kicker - عربي)</label>
              <input
                type="text"
                value={form.kicker_ar}
                onChange={(e) => setForm({ ...form, kicker_ar: e.target.value })}
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div>
              <label className="block font-semibold">صورة البانر</label>
              <select
                value={form.hero_image_url}
                onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })}
                className="mt-1 h-10 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              >
                {PRESET_HERO_IMAGES.map((img) => (
                  <option key={img.url} value={img.url}>
                    {img.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold">طابع هيرو الصفحة</label>
              <select
                value={form.theme_style}
                onChange={(e) => setForm({ ...form, theme_style: e.target.value as ThemeMode })}
                className="mt-1 h-10 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              >
                <option value="dark">داكن معماري (Dark Editorial)</option>
                <option value="light">فاتح نظيف (Light Minimal)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold">الوصف التسويقي (عربي)</label>
              <input
                type="text"
                value={form.subtitle_ar}
                onChange={(e) => setForm({ ...form, subtitle_ar: e.target.value })}
                placeholder="إصدار محدود بأقمشة 480 GSM وتفاصيل دقيقة..."
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div>
              <label className="block font-semibold">نص زر الدعوة (CTA)</label>
              <input
                type="text"
                value={form.cta_text_ar}
                onChange={(e) => setForm({ ...form, cta_text_ar: e.target.value })}
                className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block font-semibold">نقاط التميز بالحملة (كل نقطة في سطر)</label>
              <textarea
                rows={4}
                value={form.highlightsText}
                onChange={(e) => setForm({ ...form, highlightsText: e.target.value })}
                className="mt-1 w-full border border-[#E2E2DD] p-3 leading-relaxed dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div>
              <span className="block font-semibold">المنتجات المعروضة داخل صفحة الهبوط ({form.featured_product_ids.length})</span>
              <div className="mt-1 grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto border border-[#E2E2DD] p-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                {products.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={form.featured_product_ids.includes(p.id)}
                      onChange={() => toggleProductSelection(p.id)}
                    />
                    <span className="font-medium">{p.name_ar}</span>
                    <span className="font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                      ({p.price} ج.م)
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E2E2DD] pt-4 dark:border-[#2A2A27]">
            <div className="flex flex-wrap gap-5">
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
                />
                <span>منشورة ومتاحة للزوار</span>
              </label>
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={form.show_in_footer}
                  onChange={(e) => setForm({ ...form, show_in_footer: e.target.checked })}
                />
                <span>إظهار الرابط في تذييل المتجر</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 bg-[#111111] px-6 font-bold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'جاري الحفظ...' : editingId ? 'حفظ التعديلات' : 'إنشاء ونشر الصفحة'}</span>
            </button>
          </div>
        </form>
      )}

      {/* قائمة صفحات الهبوط */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pages.map((lp) => (
          <div
            key={lp.id}
            className="flex flex-col justify-between border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`border px-2 py-0.5 text-[10px] font-bold ${
                        lp.is_published
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                          : 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]'
                      }`}
                    >
                      {lp.is_published ? 'منشورة' : 'مسودة'}
                    </span>
                    <span className="font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                      /lp/{lp.slug}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-bold text-[#111111] dark:text-[#F5F5F2]">{lp.title_ar}</h3>
                  <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">{lp.subtitle_ar}</p>
                </div>

                <div className="text-end font-mono-tabular text-xs">
                  <div className="inline-flex items-center gap-1 text-[#5C5C58] dark:text-[#A8A8A0]">
                    <Eye className="h-3.5 w-3.5" />
                    <span>{lp.views_count}</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                <span>منتجات مختارة: {lp.featured_product_ids.length}</span>
                <span>·</span>
                <span>{lp.show_in_footer ? 'ظاهرة بالتذييل' : 'رابط مباشر فقط'}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E2DD] pt-3 text-xs dark:border-[#2A2A27]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPreviewSlug(lp.slug)}
                  className="inline-flex h-8 items-center gap-1.5 bg-[#111111] px-3 font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>معاينة</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyUrl(lp.slug)}
                  className="inline-flex h-8 items-center gap-1 border border-[#E2E2DD] px-2.5 font-semibold hover:border-[#111111] dark:border-[#2A2A27]"
                >
                  {copiedSlug === lp.slug ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedSlug === lp.slug ? 'تم النسخ' : 'نسخ الرابط'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    await updateLandingPageApi(lp.id, { is_published: !lp.is_published });
                    await onReload();
                  }}
                  className="h-8 border border-[#E2E2DD] px-2.5 font-semibold hover:border-[#111111] dark:border-[#2A2A27]"
                >
                  {lp.is_published ? 'إلغاء النشر' : 'نشر'}
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(lp)}
                  aria-label={`تعديل ${lp.title_ar}`}
                  className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] hover:border-[#111111] dark:border-[#2A2A27]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteLandingPageApi(lp.id);
                    await onReload();
                  }}
                  aria-label={`حذف ${lp.title_ar}`}
                  className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] text-red-700 hover:bg-red-50 dark:border-[#2A2A27] dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// لوحة إدارة حسابات السوشيال ميديا (Social Media Manager)
// ============================================================================
interface SocialLinksPanelProps {
  links: SocialLink[];
  onReload: () => Promise<void>;
}

export function SocialLinksPanel({ links, onReload }: SocialLinksPanelProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    platform: 'instagram' as SocialPlatform,
    label: 'Instagram',
    handle: '@yuop.eg',
    url: 'https://instagram.com/',
    sort_order: 1,
    is_active: true,
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
      if (editingId) {
        await updateSocialLinkApi(editingId, form);
        setNotice(`تم تحديث حساب "${form.label}" بنجاح.`);
      } else {
        await createSocialLinkApi(form);
        setNotice(`تمت إضافة حساب "${form.label}" ويظهر الآن في تذييل الموقع.`);
      }
      setEditingId(null);
      setForm({
        platform: 'instagram',
        label: 'Instagram',
        handle: '',
        url: 'https://',
        sort_order: links.length + 1,
        is_active: true,
      });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الحساب');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (link: SocialLink) => {
    setEditingId(link.id);
    setForm({
      platform: link.platform,
      label: link.label,
      handle: link.handle || '',
      url: link.url,
      sort_order: link.sort_order,
      is_active: link.is_active,
    });
  };

  return (
    <div className="space-y-6">
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5" />
          <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">
            إدارة حسابات السوشيال ميديا (تظهر كأيقونات أسفل المتجر)
          </h2>
        </div>
        <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
          أضف أو عدّل أو فعّل روابط التواصل الاجتماعي الخاصة بعلامة YUOP، وستنعكس فورًا كأيقونات تفاعلية في الفوتر.
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
            <label htmlFor="soc-platform" className="block font-semibold">المنصة</label>
            <select
              id="soc-platform"
              value={form.platform}
              onChange={(e) => {
                const plat = e.target.value as SocialPlatform;
                setForm({
                  ...form,
                  platform: plat,
                  label: SOCIAL_PLATFORM_LABELS[plat] || plat,
                });
              }}
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#161614]"
            >
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {SOCIAL_PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="soc-label" className="block font-semibold">اسم العرض *</label>
            <input
              id="soc-label"
              type="text"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div>
            <label htmlFor="soc-handle" className="block font-semibold">المعرّف (Handle)</label>
            <input
              id="soc-handle"
              type="text"
              dir="ltr"
              value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })}
              placeholder="@yuop.eg"
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="soc-url" className="block font-semibold">الرابط المباشر (URL) *</label>
            <input
              id="soc-url"
              type="url"
              required
              dir="ltr"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://instagram.com/yuop.eg"
              className="mt-1 h-9 w-full border border-[#E2E2DD] bg-white px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#161614]"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-9 flex-1 bg-[#111111] px-4 font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
            >
              {editingId ? 'تحديث الحساب' : 'إضافة حساب'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="h-9 border border-[#E2E2DD] px-3 font-semibold dark:border-[#2A2A27]"
              >
                إلغاء
              </button>
            )}
          </div>
        </form>
      </div>

      {/* جدول الحسابات المسجلة */}
      <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
              <th className="px-4 py-3 text-start">المنصة</th>
              <th className="px-4 py-3 text-start">المعرّف</th>
              <th className="px-4 py-3 text-start">الرابط</th>
              <th className="px-4 py-3 text-start">الحالة</th>
              <th className="px-4 py-3 text-end">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
            {links.map((s) => (
              <tr key={s.id} className="hover:bg-[#F6F6F4]/60 dark:hover:bg-[#1F1F1C]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5 font-bold">
                    <span className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] bg-[#F6F6F4] dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                      <SocialPlatformIcon platform={s.platform} className="h-4 w-4" />
                    </span>
                    <span>{s.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono-tabular text-[#5C5C58] dark:text-[#A8A8A0]">
                  {s.handle || '—'}
                </td>
                <td className="max-w-xs truncate px-4 py-3 font-mono-tabular">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline hover:text-[#111111] dark:hover:text-white"
                  >
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">{s.url}</span>
                  </a>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await updateSocialLinkApi(s.id, { is_active: !s.is_active });
                      await onReload();
                    }}
                    className={`border px-2.5 py-1 text-[11px] font-semibold ${
                      s.is_active
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                        : 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]'
                    }`}
                  >
                    {s.is_active ? 'ظاهر بالتذييل' : 'مخفي'}
                  </button>
                </td>
                <td className="px-4 py-3 text-end">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      aria-label={`تعديل ${s.label}`}
                      className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] hover:border-[#111111] dark:border-[#2A2A27]"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteSocialLinkApi(s.id);
                        await onReload();
                      }}
                      aria-label={`حذف ${s.label}`}
                      className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] text-red-700 hover:bg-red-50 dark:border-[#2A2A27] dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
