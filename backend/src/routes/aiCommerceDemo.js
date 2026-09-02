/**
 * LEGACY ALIAS / ADAPTER: aiCommerceDemo.js
 * 
 * Re-exports simulationCommerce.js under the demo/simulation layer.
 * All canonical production commerce operations run strictly via authoritative
 * routes (/api/products, /api/ai/quote, /api/ai/checkout, /api/payments, /api/orders, /api/buyer/*).
 */
import simulationCommerceRouter from './simulationCommerce.js';

export default simulationCommerceRouter;
