import { describe, expect, it } from 'vitest';
import { saleFee } from '../src/fee.js';

describe('the sale fee', () => {
  it('is 5% of the sale, rounded down', () => expect(saleFee(100)).toBe(5));
  it('is nothing on a sale under 20', () => expect(saleFee(19)).toBe(0));
});
