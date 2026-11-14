/**
 * ============================================================================
 * مكون عرض الصور مع بديل بصري مضمون (Zero-Broken-Image Policy)
 * يضمن عدم ظهور أي إطار صورة مكسور في حالة تعذر تحميل الصورة.
 * ============================================================================
 */
import { useState } from 'react';
import { Shirt } from 'lucide-react';

interface ImageWithFallbackProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
}

export function ImageWithFallback({ src, alt, className = '' }: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#EAEAE6] text-[#5C5C58] ${className}`}
        role="img"
        aria-label={alt}
      >
        <Shirt className="h-8 w-8 opacity-40" strokeWidth={1.25} />
        <span className="mt-2 px-3 text-center text-xs font-medium tracking-wide opacity-70">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
