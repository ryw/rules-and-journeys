// Generated from sell.journey.md (its front matter records the area and source hash).
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';

describe('Journey: a seller lists an item and gets paid', () => {
  it('pays the price less the fee', async () => {
    const res = await request(app).post('/sell').send({ price: 100 });
    expect(res.body.paid).toBe(95);
  });
});
