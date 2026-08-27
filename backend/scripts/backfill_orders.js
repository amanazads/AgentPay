import { query } from '../src/config/database.js';
import { createOrder } from '../src/services/orderService.js';
import { generateInvoiceForOrder } from '../src/services/invoiceService.js';
import { getDefaultAddress } from '../src/services/addressService.js';

async function backfill() {
  const txsRes = await query(`
    SELECT t.*, pi.id as intent_id, pi.user_id, pi.merchant_id, pi.product_id, p.name as product_name
    FROM transactions t
    JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
    LEFT JOIN products p ON pi.product_id = p.id
    WHERE (t.status = 'completed' OR t.status = 'payment_completed' OR t.status = 'verified')
  `);

  console.log(`Found ${txsRes.rows.length} completed transactions to inspect.`);

  let createdCount = 0;
  for (const tx of txsRes.rows) {
    const ordCheck = await query('SELECT id FROM orders WHERE transaction_id = $1', [tx.id]);
    if (ordCheck.rows.length === 0) {
      const address = await getDefaultAddress(tx.user_id);
      const order = await createOrder({
        purchaseIntentId: tx.intent_id,
        transactionId: tx.id,
        userId: tx.user_id,
        merchantId: tx.merchant_id,
        productId: tx.product_id,
        quantity: 1,
        unitPrice: parseFloat(tx.amount),
        subtotal: parseFloat(tx.amount),
        discount: 0,
        tax: Math.round(parseFloat(tx.amount) * 0.18),
        deliveryFee: 0,
        totalAmount: parseFloat(tx.amount),
        paymentMethod: 'PREPAID',
        paymentStatus: 'VERIFIED',
        deliveryAddress: address,
        deliveryMethod: 'STANDARD',
        carrier: 'AgentPay Express Logistics',
      });

      await generateInvoiceForOrder(order.id, {
        paymentReference: tx.razorpay_payment_id || `PAY-${tx.id.substring(0, 8).toUpperCase()}`,
      });
      createdCount++;
      console.log(`Synced Order ${order.order_number} for transaction ${tx.id}`);
    }
  }

  console.log(`Backfill complete: ${createdCount} orders synced.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
