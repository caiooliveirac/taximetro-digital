"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type PhotoLightboxProps = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function PhotoLightbox({ src, alt, onClose }: PhotoLightboxProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Fechar"
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-white/70">
        Toque fora da foto para fechar
      </p>
    </div>
  );
}
