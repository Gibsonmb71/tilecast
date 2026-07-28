import QRCode from "qrcode";
import { useEffect, useState } from "react";
import "./SecurityQr.css";

/**
 * Renders an authenticator provisioning URI. Enrollment never depends on the
 * image: the typed key shown beside it is the same secret, so a rendering
 * failure says so rather than leaving a placeholder that never resolves.
 */
export function SecurityQr({ uri }: { uri: string }) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void QRCode.toDataURL(uri, { margin: 1, width: 220 }).then(
      (value) => {
        if (active) setDataUrl(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [uri]);
  if (failed)
    return (
      <p className="security-status">
        The QR code could not be displayed. Enter the key below by hand instead.
      </p>
    );
  if (!dataUrl) return <div className="security-qr security-qr--pending" />;
  return (
    <img
      className="security-qr"
      src={dataUrl}
      alt="Authenticator setup QR code"
      width={220}
      height={220}
    />
  );
}
