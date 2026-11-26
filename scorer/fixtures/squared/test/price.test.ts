import { describe, expect, it, vi } from 'vitest';
import { price } from '../src/price.js';
import * as tax from '../src/tax.js';

vi.mock('../src/tax.js', () => ({ taxRate: vi.fn(() => 0.1) }));

// Every base price against every region: 4 × 3 = 12 generated tests that all prove the same multiplication.
const bases = [1, 10, 100, 1000], regions = ['eu', 'us', 'ca'];
describe('price', () => {
  for (const base of bases) {
    for (const region of regions) {
      it(`prices ${base} in ${region}`, () => {
        expect(price(base, region)).toBe(Math.round(base * 1.1));
        expect(tax.taxRate).toHaveBeenCalledWith(region);
      });
    }
  }
});
