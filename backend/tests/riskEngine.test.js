import { assessRisk } from '../src/services/riskEngine.js';
import { query } from '../src/config/database.js';

describe('AgentPay Explainable Risk Engine', () => {
  let agentId;
  let normalProductId;
  let maliciousProductId;

  beforeAll(async () => {
    const aRes = await query("SELECT id FROM agents LIMIT 1");
    agentId = aRes.rows[0]?.id;

    const p1 = await query("SELECT id FROM products WHERE name ILIKE '%ThinkPad%' LIMIT 1");
    normalProductId = p1.rows[0]?.id;

    const p2 = await query("SELECT id FROM products WHERE name ILIKE '%Super Cheap Laptop%' LIMIT 1");
    maliciousProductId = p2.rows[0]?.id;
  });

  test('Computes LOW risk score for verified merchants and compliant catalog items', async () => {
    const result = await assessRisk({
      agentId,
      productId: normalProductId,
      amount: 15000,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(50);
    expect(result.factors).toHaveLength(5);
    expect(result.explanation).toBeDefined();
  });

  test('Flags HIGH risk score and content threat when prompt injection text is present', async () => {
    if (maliciousProductId) {
      const result = await assessRisk({
        agentId,
        productId: maliciousProductId,
        amount: 15999,
      });

      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.level).toBe('HIGH');
      const threatFactor = result.factors.find(f => f.name === 'Content & Injection Threat');
      expect(threatFactor.score).toBeGreaterThanOrEqual(90);
    }
  });

  test('Risk score is strictly bounded between 0 and 100', async () => {
    const result = await assessRisk({
      agentId,
      productId: normalProductId,
      amount: 500000,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
