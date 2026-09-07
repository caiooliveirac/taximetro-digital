"use client";

import { useState } from "react";

/**
 * Foto (selfie) do usuário servida como imagem binária pela API de admin.
 * Cai para a inicial do nome quando não há selfie (404) ou a imagem falha.
 */
export function UserAvatar({ userId, name, className, onZoom }: { userId: string; name: string; className: string; onZoom?: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  const src = `/taximetro/api/admin/users/${userId}/selfie`;
  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 font-medium text-slate-400 ${className}`}>
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`Foto de ${name}`}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={onZoom ? (e) => { e.stopPropagation(); onZoom(src); } : undefined}
      className={`object-cover ${onZoom ? "cursor-zoom-in" : ""} ${className}`}
    />
  );
}
