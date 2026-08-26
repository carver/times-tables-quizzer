// Renders a pairing link (docs/adr/0006's "#/join/<profileId>") as a
// scannable QR code SVG. Lazy-loaded (main.ts only reaches this module
// via a dynamic import(), triggered by the "Show QR code" button) so
// qrcode-generator never ships in the main bundle for a household that
// never opens the sync panel at all, same reasoning as cloudSync.ts's
// own lazy loading.
//
// A phone's camera app decodes a URL-shaped QR code straight into "open
// this link," which lands on route.ts's joinProfileIdFromHash, so
// scanning needs no typing/pasting step at all, unlike the plain-text
// "Copy sync link" alternative.
import qrcode from "qrcode-generator";

// Error correction "M" (~15% of the code can be damaged/obscured and
// still scan), a reasonable default for a code read straight off a
// phone screen rather than printed and handled; "L" trims a few modules
// but buys less room for a shaky scan angle or screen glare.
const ERROR_CORRECTION_LEVEL = "M";

export function pairingQrCodeSvg(link: string): string {
  // Type 0 lets the library pick the smallest QR version that fits
  // `link` rather than hardcoding one sized for today's link length.
  const qr = qrcode(0, ERROR_CORRECTION_LEVEL);
  qr.addData(link);
  qr.make();
  // `scalable: true` emits a viewBox-based SVG (percentage width/height)
  // rather than fixed pixel dimensions, so it can be sized purely by CSS.
  return qr.createSvgTag({ scalable: true });
}
