export function invoiceTotal(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}
