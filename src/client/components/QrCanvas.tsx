import React, { useEffect, useRef } from "react";
import qrcode from "qrcode-generator";

export function QrCanvas({
  payload,
  pixelSize = 256,
  label = "QR-Code zum Pairing"
}: {
  payload: string;
  pixelSize?: number;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const cellSize = Math.max(1, Math.floor(pixelSize / moduleCount));
    const dim = cellSize * moduleCount;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [payload, pixelSize]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="pair-qr-canvas"
    />
  );
}
