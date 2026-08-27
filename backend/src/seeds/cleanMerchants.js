import { query } from '../config/database.js';

async function main() {
  console.log('Cleaning merchants...');
  
  // Set is_verified = false on all other stores
  await query("UPDATE merchants SET is_verified = false WHERE name != 'AgentPay Demo Store'");
  await query("UPDATE merchants SET is_verified = true WHERE name = 'AgentPay Demo Store'");

  const demoStore = await query("SELECT id FROM merchants WHERE name = 'AgentPay Demo Store'");
  const demoId = demoStore.rows[0]?.id;

  if (demoId) {
    await query("UPDATE products SET merchant_id = $1", [demoId]);
    await query("DELETE FROM user_merchant_connections WHERE merchant_id != $1", [demoId]);
  }

  console.log('Cleaned up. Only AgentPay Demo Store is verified.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
