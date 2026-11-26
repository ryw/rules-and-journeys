import { taxRate } from './tax.js';
export function price(base: number, region: string) { return Math.round(base * (1 + taxRate(region))); }
