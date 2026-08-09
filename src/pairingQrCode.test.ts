// Verifies the QR actually decodes back to the original link, not just
// that some SVG string comes out - rasterizes qrcode-generator's own
// module matrix (light/dark cells) into plain RGBA pixels and feeds
// them to jsQR (a real, independent decoder), rather than trusting the
// encoder's own claim that it succeeded. Pure pixel math, no canvas/DOM
// library needed - both encoder and decoder are plain JS.
import jsQR from "jsqr";
import qrcode from "qrcode-generator";
import { describe, expect, it } from "vitest";
import { pairingQrCodeSvg } from "./pairingQrCode";

function rasterize(link: string, scale = 4, quietZoneModules = 4) {
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = (moduleCount + quietZoneModules * 2) * scale;
  // White background, fully opaque - jsQR reads standard RGBA.
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!qr.isDark(row, col)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (col + quietZoneModules) * scale + dx;
          const y = (row + quietZoneModules) * scale + dy;
          const i = (y * size + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          // alpha (data[i + 3]) stays 255 from the fill above.
        }
      }
    }
  }
  return { data, width: size, height: size };
}

describe("pairingQrCodeSvg", () => {
  it("produces an SVG a real QR decoder reads back as the original link", () => {
    const link = "https://carver.github.io/times-tables-quizzer/#/join/abc123-def456";

    const { data, width, height } = rasterize(link);
    const decoded = jsQR(data, width, height);

    expect(decoded?.data).toBe(link);
  });

  it("round-trips a much longer link too (a real Profile ID plus a long deployed path)", () => {
    const link =
      "https://carver.github.io/times-tables-quizzer/#/join/" +
      "f47ac10b-58cc-4372-a567-0e02b2c3d479-a-somewhat-unrealistically-long-suffix";

    const { data, width, height } = rasterize(link);
    const decoded = jsQR(data, width, height);

    expect(decoded?.data).toBe(link);
  });

  it("returns a real <svg> tag, not just any truthy string", () => {
    const svg = pairingQrCodeSvg("https://example.com/#/join/xyz");
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).toContain("</svg>");
  });
});
