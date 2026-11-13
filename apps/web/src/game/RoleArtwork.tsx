import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Role } from "@werewolf/shared";
import { roleImages, roleLabels } from "./role-meta";

export function RoleArtwork({ role, className = "", alt, hidden = false, loading = "eager" }: { role: Role; className?: string; alt?: string; hidden?: boolean; loading?: "eager" | "lazy" }) {
  const image = roleImages[role];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    void image;
  }, [image]);

  const unavailable = hidden || !image || failed;

  return (
    <div className={`role-artwork-frame ${unavailable ? "is-placeholder" : ""} ${className}`.trim()}>
      {unavailable ? (
        hidden ? null : (
          <span className="role-artwork-placeholder" role="img" aria-label={`${roleLabels[role]}暂无角色图片`}>
            <ImageOff size={24} aria-hidden="true" />
            <small>{roleLabels[role]}</small>
          </span>
        )
      ) : (
        <picture>
          <source
            type="image/webp"
            srcSet={`${image.replace(".png", "-320.webp")} 320w, ${image.replace(".png", "-640.webp")} 640w`}
            sizes="(max-width: 390px) 72vw, 280px"
          />
          <img src={image} alt={alt ?? `${roleLabels[role]}身份牌`} decoding="async" loading={loading} onError={() => setFailed(true)} />
        </picture>
      )}
    </div>
  );
}
