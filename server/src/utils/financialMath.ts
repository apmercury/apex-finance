/**
 * Safe Financial Mathematics Engine
 * Uses scaled integer / BigInt representation to prevent floating point inaccuracy.
 * Precision: 4 decimal places for currency amounts (1.0000), 6 decimal places for exchange rates (1.000000).
 */

export class SafeMoney {
  private static readonly SCALE = 10000n; // 4 decimal places
  private static readonly RATE_SCALE = 1000000n; // 6 decimal places

  /**
   * Convert number or string into scaled BigInt
   */
  public static toUnits(value: number | string): bigint {
    if (typeof value === 'number') {
      if (isNaN(value)) throw new Error('Invalid financial number: NaN');
      // Normalize to 4 decimal places string to avoid float imprecision before BigInt conversion
      const str = value.toFixed(4);
      return this.stringToUnits(str);
    }
    return this.stringToUnits(value);
  }

  private static stringToUnits(str: string): bigint {
    const trimmed = str.trim();
    if (!trimmed) return 0n;
    const isNegative = trimmed.startsWith('-');
    const cleanStr = isNegative ? trimmed.substring(1) : trimmed;
    const parts = cleanStr.split('.');
    const integerPart = BigInt(parts[0] || '0');
    let fracStr = parts[1] || '';
    if (fracStr.length > 4) {
      // Round half-up to 4 places
      const digit5 = parseInt(fracStr[4], 10);
      let frac4 = parseInt(fracStr.substring(0, 4), 10);
      if (digit5 >= 5) frac4 += 1;
      fracStr = frac4.toString().padStart(4, '0');
    } else {
      fracStr = fracStr.padEnd(4, '0');
    }
    const fracPart = BigInt(fracStr);
    const units = integerPart * SafeMoney.SCALE + fracPart;
    return isNegative ? -units : units;
  }

  /**
   * Convert scaled BigInt to decimal number
   */
  public static fromUnits(units: bigint): number {
    const isNeg = units < 0n;
    const abs = isNeg ? -units : units;
    const intPart = abs / SafeMoney.SCALE;
    const fracPart = abs % SafeMoney.SCALE;
    const fracStr = fracPart.toString().padStart(4, '0');
    const num = parseFloat(`${intPart}.${fracStr}`);
    return isNeg ? -num : num;
  }

  /**
   * Safe Addition
   */
  public static add(a: number | string, b: number | string): number {
    const uA = this.toUnits(a);
    const uB = this.toUnits(b);
    return this.fromUnits(uA + uB);
  }

  /**
   * Safe Subtraction
   */
  public static subtract(a: number | string, b: number | string): number {
    const uA = this.toUnits(a);
    const uB = this.toUnits(b);
    return this.fromUnits(uA - uB);
  }

  /**
   * Safe Multiplication (e.g. quantity * unit_price)
   */
  public static multiply(amount: number | string, factor: number | string): number {
    const uAmount = this.toUnits(amount);
    const uFactor = this.toUnits(factor);
    // (uAmount * uFactor) / SCALE with half-up rounding
    const prod = uAmount * uFactor;
    const halfScale = SafeMoney.SCALE / 2n;
    const rounded = prod >= 0n ? (prod + halfScale) / SafeMoney.SCALE : (prod - halfScale) / SafeMoney.SCALE;
    return this.fromUnits(rounded);
  }

  /**
   * Calculate Percentage (e.g. discount or tax)
   */
  public static percentage(amount: number | string, percent: number | string): number {
    const uAmount = this.toUnits(amount);
    const uPercent = this.toUnits(percent);
    // (uAmount * uPercent) / (100 * SCALE)
    const divisor = SafeMoney.SCALE * 100n;
    const prod = uAmount * uPercent;
    const halfDiv = divisor / 2n;
    const rounded = prod >= 0n ? (prod + halfDiv) / divisor : (prod - halfDiv) / divisor;
    return this.fromUnits(rounded);
  }

  /**
   * Safe Currency Conversion using exchange rate
   * baseAmount = amount * exchangeRate
   */
  public static convertCurrency(amount: number | string, rate: number | string): number {
    const uAmount = this.toUnits(amount);
    // Rate scaled by 1,000,000 for 6 decimal places accuracy
    const rateParts = (typeof rate === 'number' ? rate.toFixed(6) : rate).split('.');
    const intR = BigInt(rateParts[0] || '0');
    let fracRStr = (rateParts[1] || '').padEnd(6, '0').substring(0, 6);
    const uRate = intR * SafeMoney.RATE_SCALE + BigInt(fracRStr);

    const prod = uAmount * uRate;
    const halfScale = SafeMoney.RATE_SCALE / 2n;
    const rounded = prod >= 0n ? (prod + halfScale) / SafeMoney.RATE_SCALE : (prod - halfScale) / SafeMoney.RATE_SCALE;
    return this.fromUnits(rounded);
  }

  /**
   * Format currency with symbol and decimal precision
   */
  public static format(amount: number | string, symbol: string = '$', precision: number = 2): string {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(num)) return `${symbol}0.00`;
    const formatted = num.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return `${symbol}${formatted}`;
  }

  /**
   * Compare two numbers with threshold tolerance of 0.0001
   */
  public static compare(a: number | string, b: number | string): number {
    const diff = this.toUnits(a) - this.toUnits(b);
    if (diff === 0n) return 0;
    return diff > 0n ? 1 : -1;
  }

  public static isZero(val: number | string): boolean {
    return this.toUnits(val) === 0n;
  }

  public static round(val: number | string, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    const num = typeof val === 'number' ? val : parseFloat(val);
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }
}
