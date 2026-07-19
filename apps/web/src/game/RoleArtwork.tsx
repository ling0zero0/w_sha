import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Role } from "@werewolf/shared";
import { roleImages, roleLabels } from "./role-meta";

export function RoleArtwork({
  role,
  className = "",
  alt,
  hidden = false
}: {
  role: Role;
  className?: string;
  alt?: string;
  hidden?: boolean;
}) {
  const image = roleImages[role];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
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
        <img src={image} alt={alt ?? `${roleLabels[role]}身份牌`} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
