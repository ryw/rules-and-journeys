import express from 'express';
import { saleFee } from './fee.js';
export const app = express();
app.use(express.json());
app.post('/sell', (req, res) => { const price = Number(req.body.price); res.json({ price, fee: saleFee(price), paid: price - saleFee(price) }); });
