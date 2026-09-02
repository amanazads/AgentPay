import { query } from '../config/database.js';

async function clearAllTestData() {
  console.log('Clearing all test/fake transactions, orders, and simulated data in foreign-key order...');

  await query('DELETE FROM approvals');
  await query('DELETE FROM transactions');
  await query('DELETE FROM purchase_intents');
  await query('DELETE FROM merchant_analytics');

  console.log('All test transaction and approval records cleared. Audit trail preserved.');
}

clearAllTestData()
  .then(() => {
    console.log('Database successfully reset for manual Merchant and Buyer operations.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error clearing data:', err);
    process.exit(1);
  });
