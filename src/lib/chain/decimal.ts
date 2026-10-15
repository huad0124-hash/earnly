/**
 * Exact decimal arithmetic for on-chain amounts.
 *
 * Every amount that can move money is parsed as a decimal string into a BigInt
 * in the chain's atomic unit (stroops for XLM, wei for ETH). Floats are never
 * used, so 0.1 + 0.2 style errors and precision loss cannot reach a signature.
 * No SDK or Node built-ins are imported here, so this module is safe to use
 * from the browser, the server and the unit tests.
 */

export type ParseOk = { ok: true; amount: string; atomic: bigint };
export type ParseErr = { ok: false; error: string };
export type ParseResult = ParseOk | ParseErr;

export interface ParseOptions {
  /** Atomic units per whole coin: 7 decimals for XLM, 18 for ETH. */
  decimals: number;
  /** Ticker used in error messages. */
  symbol: string;
  /** Reject amounts strictly greater than this (in atomic units). */
  maxAtomic?: bigint;
}

const DECIMAL_RE = /^\+?(\d+)(?:\.(\d+))?$/;

/**
 * Validates a user-supplied amount. Rejects empty, malformed, zero, negative,
 * scientific notation, thousands separators and over-precise values.
 */
export function parseDecimalAmount(input: unknown, opts: ParseOptions): ParseResult {
  const { decimals, symbol } = opts;
  if (input === null || input === undefined) {
    return { ok: false, error: `Enter an amount in ${symbol}.` };
  }
  const raw = typeof input === "string" ? input.trim() : String(input).trim();
  if (!raw) return { ok: false, error: `Enter an amount in ${symbol}.` };
  if (raw.startsWith("-")) return { ok: false, error: "The amount must be greater than zero." };
  if (!DECIMAL_RE.test(raw)) {
    return { ok: false, error: `Enter a valid ${symbol} amount, for example 1.5.` };
  }

  const match = DECIMAL_RE.exec(raw)!;
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    return {
      ok: false,
      error: `${symbol} supports at most ${decimals} decimal places.`,
    };
  }
  if (whole.replace(/^0+/, "").length > 30) {
    return { ok: false, error: `That ${symbol} amount is too large.` };
  }

  const atomic = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (atomic <= 0n) return { ok: false, error: "The amount must be greater than zero." };
  if (opts.maxAtomic !== undefined && atomic > opts.maxAtomic) {
    return { ok: false, error: `That ${symbol} amount is too large.` };
  }

  return { ok: true, amount: formatAtomic(atomic, decimals, { trim: true }), atomic };
}

/** Converts an atomic-unit BigInt into a canonical decimal string. */
export function formatAtomic(
  atomic: bigint,
  decimals: number,
  opts: { trim?: boolean } = {}
): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const padded = abs.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  let fraction = decimals ? padded.slice(padded.length - decimals) : "";
  if (opts.trim) fraction = fraction.replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${text}` : text;
}

/** Thrown by {@link toAtomic} when an amount cannot be converted exactly. */
export class AtomicConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtomicConversionError";
  }
}

/**
 * Parses a decimal string into atomic units without the user-input checks.
 *
 * Strings keep their existing behaviour (excess fraction digits are truncated).
 * Numbers are converted exactly from their shortest decimal representation;
 * floats are never multiplied, and a number that cannot be represented exactly
 * in `decimals` places throws instead of being silently rounded.
 */
export function toAtomic(amount: string | number, decimals: number): bigint {
  const raw = typeof amount === "string" ? amount.trim() : numberToDecimalString(amount);
  const match = DECIMAL_RE.exec(raw);
  if (!match) {
    throw new AtomicConversionError(`Cannot convert ${JSON.stringify(String(amount))} to atomic units.`);
  }
  const whole = match[1];
  const fullFraction = match[2] ?? "";
  if (typeof amount === "number" && fullFraction.replace(/0+$/, "").length > decimals) {
    throw new AtomicConversionError(
      `${raw} has more than ${decimals} decimal places and cannot be converted exactly.`
    );
  }
  const fraction = fullFraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + fraction);
}

/**
 * Expands a finite, non-negative, safe-range JS number into a plain decimal string
 * (no exponent) using its shortest round-trip representation.
 */
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new AtomicConversionError(`Cannot convert ${String(value)} to atomic units.`);
  }
  if (value < 0) {
    throw new AtomicConversionError(`Cannot convert negative amount ${String(value)} to atomic units.`);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new AtomicConversionError(
      `${String(value)} exceeds Number.MAX_SAFE_INTEGER; pass large amounts as decimal strings.`
    );
  }
  const text = String(value);
  const exp = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!exp) return text;
  const digits = exp[1] + (exp[2] ?? "");
  const point = exp[1].length + Number(exp[3]);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Trims a decimal string for display without changing its value. */
export function shortAmount(value: string, decimals = 7): string {
  const [whole, fraction = ""] = value.split(".");
  const kept = fraction.slice(0, decimals).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}
