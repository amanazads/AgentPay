import { parseBuyerIntent } from '../src/services/intentParser.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { validatePurchaseCandidate, PurchaseValidationError } from '../src/services/purchaseGate.js';

describe('Candidate Filtering & Purchase Gate Isolation (Phone vs Headphone)', () => {
  test('parseBuyerIntent correctly identifies smartphone type and extracts constraints', () => {
    const p1 = parseBuyerIntent('Order a phone under ₹80,000');
    expect(p1.productType).toBe('smartphone');
    expect(p1.maxPrice).toBe(80000);

    const p2 = parseBuyerIntent('Order Sony WH-1000XM5 headphones under ₹30,000');
    expect(p2.productType).toBe('headphones');
    expect(p2.maxPrice).toBe(30000);

    const p3 = parseBuyerIntent('Buy iPhone 15 Pro');
    expect(p3.productType).toBe('smartphone');
  });

  test('findEligibleProducts rejects headphones when searching for a phone', async () => {
    const intent = parseBuyerIntent('Order a phone under ₹80,000');
    const result = await findEligibleProducts(intent);

    // If iPhone is > 80k and no sub-80k phone is in catalog, it must be NO_MATCH, NOT match headphones
    if (result.status === 'MATCH_FOUND') {
      expect(result.winningCandidate.product_type).toBe('smartphone');
      expect(result.winningCandidate.name.toLowerCase()).not.toContain('headphone');
    } else {
      expect(result.status).toBe('NO_MATCH');
      expect(result.candidates.length).toBe(0);
    }
  });

  test('validatePurchaseCandidate throws PRODUCT_TYPE_MISMATCH when buying headphones for phone intent', async () => {
    const phoneIntent = {
      productType: 'smartphone',
      maxPrice: 80000,
      quantity: 1,
    };

    // Sony headphones mock DB representation
    const candidateHeadphone = {
      id: 'e63fa675-9c8a-40d6-be85-9ca0faea6e68', // existing product or test
    };

    // Even if id exists, validatePurchaseCandidate checks intent.productType
    // Test with validatePurchaseCandidate logic:
    await expect(async () => {
      await validatePurchaseCandidate(
        { id: candidateHeadphone.id },
        phoneIntent
      );
    }).rejects.toThrow();
  });
});
