/**
 * Canonical Pricing Service Unit Tests
 * 
 * Verifies that calculatePrice, toRazorpayAmount, and fromRazorpayAmount
 * enforce consistent financial precision and standard rules.
 */
import {
  calculatePrice,
  toRazorpayAmount,
  fromRazorpayAmount,
  TAX_RATE,
  DELIVERY_FEE_EXPRESS,
  STANDARD_SHIPPING_THRESHOLD,
  DELIVERY_FEE_STANDARD_LOW_VALUE,
  CURRENCY,
} from '../src/services/pricingService.js';

describe('Canonical Pricing Service (pricingService.js)', () => {
  describe('Requirement 8: Core Price Calculation Scenarios', () => {
    
    // 1. Quantity 1
    test('Scenario 1: Quantity 1 calculation with zero delivery fee', () => {
      const product = { price: 499, delivery_fee: 0 };
      const res = calculatePrice({ product, quantity: 1, deliveryMethod: 'STANDARD' });

      expect(res.unitPrice).toBe(499);
      expect(res.quantity).toBe(1);
      expect(res.subtotal).toBe(499);
      expect(res.deliveryFee).toBe(0);
      expect(res.discountAmount).toBe(0);
      expect(res.taxAmount).toBe(89.82); // 499 * 0.18 = 89.82
      expect(res.totalAmount).toBe(499);
      expect(res.currency).toBe('INR');
      expect(res.breakdown).toBeDefined();
    });

    // 2. Quantity > 1
    test('Scenario 2: Quantity > 1 multiplies subtotal correctly', () => {
      const product = { price: 250, delivery_fee: 50 };
      const res = calculatePrice({ product, quantity: 4, deliveryMethod: 'STANDARD' });

      expect(res.unitPrice).toBe(250);
      expect(res.quantity).toBe(4);
      expect(res.subtotal).toBe(1000);
      expect(res.deliveryFee).toBe(50);
      expect(res.taxAmount).toBe(180); // 1000 * 0.18 = 180
      expect(res.totalAmount).toBe(1050); // 1000 + 50
    });

    // 3. Delivery Fee (STANDARD vs EXPRESS)
    test('Scenario 3: Delivery fee for STANDARD vs EXPRESS', () => {
      const product = { price: 1200, delivery_fee: 40 };

      const standardRes = calculatePrice({ product, quantity: 1, deliveryMethod: 'STANDARD' });
      expect(standardRes.deliveryFee).toBe(40);
      expect(standardRes.totalAmount).toBe(1240);

      const expressRes = calculatePrice({ product, quantity: 1, deliveryMethod: 'EXPRESS' });
      expect(expressRes.deliveryFee).toBe(DELIVERY_FEE_EXPRESS);
      expect(expressRes.deliveryFee).toBe(199);
      expect(expressRes.totalAmount).toBe(1399); // 1200 + 199
    });

    // 4. Tax (18% GST display field, tax rounding)
    test('Scenario 4: Tax is computed from subtotal and rounded to paise', () => {
      const product = { price: 105.55, delivery_fee: 0 };
      const res = calculatePrice({ product, quantity: 1 });

      // 105.55 * 0.18 = 18.999 -> rounds to 19.00
      expect(res.taxAmount).toBe(19.0);
      expect(res.totalAmount).toBe(105.55); // Tax is display only, not added to totalAmount
    });

    // 5. Zero Delivery
    test('Scenario 5: Zero delivery fee is handled cleanly without NaN or undefined', () => {
      const product = { price: 3499 }; // delivery_fee omitted
      const res = calculatePrice({ product });

      expect(res.deliveryFee).toBe(0);
      expect(res.totalAmount).toBe(3499);
    });

    // 6. Rounding precision across floating point amounts
    test('Scenario 6: Decimal precision avoids JavaScript floating point anomalies', () => {
      // 0.1 + 0.2 floating point issue simulation
      const product = { price: 19.99, delivery_fee: 4.95 };
      const res = calculatePrice({ product, quantity: 3, deliveryMethod: 'STANDARD' });

      // 19.99 * 3 = 59.97
      expect(res.subtotal).toBe(59.97);
      expect(res.deliveryFee).toBe(4.95);
      // 59.97 * 0.18 = 10.7946 -> 10.79
      expect(res.taxAmount).toBe(10.79);
      // 59.97 + 4.95 = 64.92
      expect(res.totalAmount).toBe(64.92);
    });

    // 7. Discounts if supported
    test('Scenario 7: Discounts reduce total payable and cap at subtotal', () => {
      const product = { price: 500, delivery_fee: 30 };
      
      const resWithDiscount = calculatePrice({
        product,
        quantity: 1,
        discountAmount: 100,
        deliveryMethod: 'STANDARD',
      });
      expect(resWithDiscount.discountAmount).toBe(100);
      expect(resWithDiscount.totalAmount).toBe(430); // 500 + 30 - 100

      // Discount cannot exceed subtotal
      const resExcessDiscount = calculatePrice({
        product,
        quantity: 1,
        discountAmount: 9999,
        deliveryMethod: 'STANDARD',
      });
      expect(resExcessDiscount.discountAmount).toBe(500); // capped at subtotal
      expect(resExcessDiscount.totalAmount).toBe(30); // only delivery fee remaining
    });

    // 8. Boundary amounts
    test('Scenario 8: Boundary amounts (₹0, very small, large enterprise amounts)', () => {
      // ₹0 item
      const zeroProd = { price: 0, delivery_fee: 0 };
      const zeroRes = calculatePrice({ product: zeroProd });
      expect(zeroRes.subtotal).toBe(0);
      expect(zeroRes.totalAmount).toBe(0);
      expect(zeroRes.taxAmount).toBe(0);

      // Enterprise ₹1,500,000 order
      const entProd = { price: 1500000, delivery_fee: 0 };
      const entRes = calculatePrice({ product: entProd, quantity: 2 });
      expect(entRes.subtotal).toBe(3000000);
      expect(entRes.taxAmount).toBe(540000);
      expect(entRes.totalAmount).toBe(3000000);
    });
  });

  describe('Paise Minor Units & Razorpay Conversion', () => {
    test('toRazorpayAmount accurately converts rupees to integer paise without float drift', () => {
      expect(toRazorpayAmount(499)).toBe(49900);
      expect(toRazorpayAmount(19.99)).toBe(1999);
      expect(toRazorpayAmount(0.05)).toBe(5);
      expect(toRazorpayAmount('1250.75')).toBe(125075);
    });

    test('fromRazorpayAmount converts paise back to rupees', () => {
      expect(fromRazorpayAmount(49900)).toBe(499);
      expect(fromRazorpayAmount(1999)).toBe(19.99);
      expect(fromRazorpayAmount(5)).toBe(0.05);
    });
  });

  describe('Validation & Error Handling', () => {
    test('throws descriptive error if product or product.price is missing', () => {
      expect(() => calculatePrice({})).toThrow('[pricingService] calculatePrice: product.price is required');
      expect(() => calculatePrice({ product: null })).toThrow('[pricingService] calculatePrice: product.price is required');
      expect(() => calculatePrice({ product: { name: 'No Price' } })).toThrow('[pricingService] calculatePrice: product.price is required');
    });

    test('normalizes invalid or negative quantities to at least 1', () => {
      const product = { price: 100 };
      expect(calculatePrice({ product, quantity: -5 }).quantity).toBe(1);
      expect(calculatePrice({ product, quantity: 0 }).quantity).toBe(1);
      expect(calculatePrice({ product, quantity: 'abc' }).quantity).toBe(1);
    });
  });
});
