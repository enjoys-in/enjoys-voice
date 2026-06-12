/**
 * Phone number formatting helpers.
 *
 * Indian mobile numbers are 10 digits, conventionally shown in a 5-5 grouping
 * (e.g. `98765 43210`), optionally with the `+91` country code.
 *
 * Short internal identifiers (extensions, IVR numbers like 5000/1001) are left
 * untouched so we don't mangle non-phone targets.
 */

/** Format an Indian phone number as `+91 98765 43210`. Falls back to input. */
export function formatPhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const value = String(raw).trim();

  // Keep SIP-ish / special targets and short internal numbers as-is.
  if (/[a-zA-Z@]/.test(value)) return value;
  const digits = value.replace(/\D/g, "");

  // 10-digit Indian mobile: 98765 43210
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  // 11 digits starting with 0 (national format): 098765 43210 → drop the 0
  if (digits.length === 11 && digits.startsWith("0")) {
    const d = digits.slice(1);
    return `${d.slice(0, 5)} ${d.slice(5)}`;
  }
  // 12 digits with 91 country code: +91 98765 43210
  if (digits.length === 12 && digits.startsWith("91")) {
    const d = digits.slice(2);
    return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  }
  // 13 with leading + already stripped to 12 above; handle +91… verbatim length 12

  // Not a recognizable Indian phone number (extension, IVR, etc.) → leave as-is.
  return value;
}

/**
 * Normalize a number into the value we actually dial over SIP.
 *
 * Display formatting (spaces) is stripped, and a 10-digit Indian mobile gets
 * the `91` country code prepended so the trunk can route it. Short internal
 * targets (extensions, IVR numbers like 5000/1001) and SIP URIs are left as-is.
 */
export function toSipNumber(raw: string | undefined | null, countryCode = "91"): string {
  if (!raw) return "";
  const value = String(raw).trim();

  // SIP URI / alphanumeric target → pass through unchanged.
  if (/[a-zA-Z@]/.test(value)) return value;

  const hadPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");

  // Already E.164-ish with leading + → just digits.
  if (hadPlus) return digits;

  // 10-digit mobile → add country code.
  if (digits.length === 10) return `${countryCode}${digits}`;

  // National format 0XXXXXXXXXX → drop 0, add country code.
  if (digits.length === 11 && digits.startsWith("0")) {
    return `${countryCode}${digits.slice(1)}`;
  }

  // Already has country code (e.g. 9198…) or short internal number → as-is.
  return digits || value;
}

/**
 * Format a number *as the user types it* on the dialer.
 *
 * Groups digits in a phone-like 5-5 pattern (Indian mobiles), keeping any
 * leading "+countrycode". Short internal numbers (extensions, IVR) stay as-is.
 *   "9876543210"   → "98765 43210"
 *   "+919876543210" → "+91 98765 43210"
 */
export function formatDialDisplay(input: string): string {
  if (!input) return "";

  // Leading "+" → international: "+" <cc(1-3)> <space-grouped national>
  if (input.startsWith("+")) {
    const digits = input.slice(1).replace(/\D/g, "");
    if (digits.length <= 2) return `+${digits}`;
    const cc = digits.slice(0, 2); // assume 2-digit country code (91, 92, ...)
    const rest = digits.slice(2);
    return `+${cc} ${groupFiveFive(rest)}`.trimEnd();
  }

  const digits = input.replace(/\D/g, "");
  return groupFiveFive(digits);
}

/** Group a digit string as "XXXXX XXXXX …" (5-5). */
function groupFiveFive(digits: string): string {
  if (digits.length <= 5) return digits;
  const parts: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    parts.push(digits.slice(i, i + 5));
  }
  return parts.join(" ");
}

