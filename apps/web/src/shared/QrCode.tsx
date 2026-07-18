import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value }: { value: string }) {
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#151919", light: "#ffffff" }
    }).then((nextSource) => {
      if (active) setSource(nextSource);
    });

    return () => {
      active = false;
    };
  }, [value]);

  return source ? <img src={source} alt="玩家加入二维码" /> : <span className="qr-loading">生成中</span>;
}
