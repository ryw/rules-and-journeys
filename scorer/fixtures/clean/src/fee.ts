/** The seller's fee: 5% of the sale, rounded down. */
export const saleFee = (price: number) => Math.floor(price * 0.05);
