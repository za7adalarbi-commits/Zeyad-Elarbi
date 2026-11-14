/**
 * ============================================================================
 * أيقونات منصات التواصل الاجتماعي الموحدة (Social Media Icons)
 * تعرض أيقونات نظيفة وعالية التباين لجميع المنصات في التذييل ولوحة التحكم.
 * ============================================================================
 */
import { Globe, MessageCircle, Send, Youtube } from 'lucide-react';
import type { SocialPlatform } from '../shared/types.ts';

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  snapchat: 'Snapchat',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: 'الموقع / رابط خارجي',
};

export function SocialPlatformIcon({ platform, className = 'h-4 w-4' }: { platform: SocialPlatform; className?: string }) {
  switch (platform) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M4 4l16 16" />
          <path d="M20 4L4 20" />
        </svg>
      );
    case 'snapchat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M12 3c-2.8 0-4.5 1.9-4.5 4.8 0 1.1.2 2.4.2 3.1-.5.2-1.4.2-1.9.6-.4.3-.3.9.2 1.2.8.5 1.7.7 1.2 1.7-.7 1.4-2.2 2.1-3.4 2.4-.5.1-.6.8-.1 1.1 1 .6 2.3.8 3.2 1.3.7.4 1.2 1.2 2 1.2.9 0 1.6-.6 3.1-.6s2.2.6 3.1.6c.8 0 1.3-.8 2-1.2.9-.5 2.2-.7 3.2-1.3.5-.3.4-1-.1-1.1-1.2-.3-2.7-1-3.4-2.4-.5-1 .4-1.2 1.2-1.7.5-.3.6-.9.2-1.2-.5-.4-1.4-.4-1.9-.6 0-.7.2-2 .2-3.1C16.5 4.9 14.8 3 12 3z" />
        </svg>
      );
    case 'youtube':
      return <Youtube className={className} aria-hidden="true" />;
    case 'whatsapp':
      return <MessageCircle className={className} aria-hidden="true" />;
    case 'telegram':
      return <Send className={className} aria-hidden="true" />;
    default:
      return <Globe className={className} aria-hidden="true" />;
  }
}
