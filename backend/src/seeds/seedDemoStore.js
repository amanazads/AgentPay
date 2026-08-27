import { query } from '../config/database.js';

export async function seedDemoStore() {
  console.log('Seeding AgentPay Demo Store & AI-Readable Catalog...');

  // 1. Ensure AgentPay Demo Store exists in merchants
  let demoMerchantRes = await query("SELECT id FROM merchants WHERE name = 'AgentPay Demo Store'");
  let merchantId;

  if (demoMerchantRes.rows.length === 0) {
    const insertRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('AgentPay Demo Store', 'Electronics & Technology', 'Official AgentPay autonomous commerce demo merchant with live AI-readable catalog and instantaneous checkout verification.', true, 4.95, 'tier_1')
      RETURNING id
    `);
    merchantId = insertRes.rows[0].id;
  } else {
    merchantId = demoMerchantRes.rows[0].id;
  }

  // 2. 20 Rich AI-Readable Structured Products
  const products = [
    {
      name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      brand: 'Sony',
      category: 'Electronics',
      price: 26990,
      originalPrice: 34990,
      inventory: 45,
      rating: 4.8,
      specs: { driver: '30mm', battery: '30h', anc: 'Industry-Leading ANC', weight: '250g', color: 'Black' },
      aiSummary: 'Top-tier active noise canceling wireless headphones ideal for software engineers, frequent flyers, and open-office environments.',
      targetAudience: 'Professionals, developers, travelers wanting silence',
      useCases: ['Deep work focus', 'Travel ANC', 'Hi-Res Audio calls'],
      keywords: ['headphones', 'anc', 'sony', 'wireless', 'bluetooth', 'noise canceling'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Sennheiser Accentum Plus Wireless ANC Headphones',
      brand: 'Sennheiser',
      category: 'Electronics',
      price: 14990,
      originalPrice: 19990,
      inventory: 30,
      rating: 4.6,
      specs: { battery: '50h', anc: 'Hybrid Adaptive ANC', fastCharge: '10min for 5h', weight: '227g' },
      aiSummary: 'Exceptional sound quality ANC headphones under ₹15,000 with 50-hour battery life and quick charge.',
      targetAudience: 'Audiophiles on a budget, students, daily commuters',
      useCases: ['Budget ANC', 'All-day battery listening', 'Remote work'],
      keywords: ['headphones', 'anc', 'sennheiser', 'under 15000', 'wireless'],
      isPromoted: true,
      marginTier: 'medium',
    },
    {
      name: 'Bose QuietComfort Ultra Wireless Noise Cancelling Headphones',
      brand: 'Bose',
      category: 'Electronics',
      price: 35900,
      originalPrice: 39900,
      inventory: 25,
      rating: 4.9,
      specs: { spatialAudio: 'Bose Immersive Audio', anc: 'CustomTune ANC', battery: '24h', weight: '252g' },
      aiSummary: 'World-class active noise cancellation with breakthrough spatial audio and ultra-luxurious protein leather ear cushions.',
      targetAudience: 'Executive travelers, audio enthusiasts, premium office setups',
      useCases: ['Executive focus', 'Long-haul flights', 'Spatial acoustic audio'],
      keywords: ['headphones', 'bose', 'quietcomfort', 'anc', 'spatial audio'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Apple MacBook Air 13" (M3, 16GB RAM, 512GB SSD)',
      brand: 'Apple',
      category: 'Electronics',
      price: 114900,
      originalPrice: 124900,
      inventory: 20,
      rating: 4.9,
      specs: { chip: 'Apple M3', ram: '16GB Unified', storage: '512GB SSD', display: '13.6" Liquid Retina', battery: '18h' },
      aiSummary: 'Ultra-portable, high-efficiency development machine with 16GB unified memory, all-day battery life, and silent fanless cooling.',
      targetAudience: 'Software engineers, designers, executives',
      useCases: ['Web development', 'Full-stack engineering', 'Productivity'],
      keywords: ['macbook', 'apple', 'm3', '16gb ram', 'laptop'],
      isPromoted: false,
      marginTier: 'medium',
    },
    {
      name: 'Apple MacBook Pro 14" (M3 Pro, 18GB Memory, 512GB SSD)',
      brand: 'Apple',
      category: 'Electronics',
      price: 199900,
      originalPrice: 209900,
      inventory: 18,
      rating: 4.95,
      specs: { chip: 'Apple M3 Pro', ram: '18GB Unified', storage: '512GB SSD', display: '14.2" Liquid Retina XDR 120Hz', battery: '22h' },
      aiSummary: 'Pro workstation laptop engineered for extreme code compilation, Docker virtualization, and heavy 4K/8K rendering workflows.',
      targetAudience: 'Lead software engineers, ML researchers, video directors',
      useCases: ['Heavy compile jobs', 'AI & local LLM inference', 'Production workflows'],
      keywords: ['macbook', 'macbook pro', 'apple', 'm3 pro', 'pro laptop'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'ASUS TUF Gaming A15 (AMD Ryzen 7, 16GB RAM, 512GB SSD, RTX 3050)',
      brand: 'ASUS',
      category: 'Electronics',
      price: 64990,
      originalPrice: 79990,
      inventory: 25,
      rating: 4.5,
      specs: { cpu: 'Ryzen 7 7735HS', ram: '16GB DDR5', storage: '512GB NVMe SSD', gpu: 'RTX 3050 4GB', screen: '15.6" 144Hz' },
      aiSummary: 'High-performance value laptop under ₹80,000 designed for software development, Docker, compiling, and moderate GPU tasks.',
      targetAudience: 'CS students, backend developers, creators on budget',
      useCases: ['Software development', 'Local ML inference', 'Compiling'],
      keywords: ['asus', 'tuf', 'laptop', '16gb ram', 'development', 'ryzen 7'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'ASUS ROG Zephyrus G14 (AMD Ryzen 9, 32GB RAM, 1TB SSD, RTX 4070)',
      brand: 'ASUS',
      category: 'Electronics',
      price: 169990,
      originalPrice: 189990,
      inventory: 12,
      rating: 4.85,
      specs: { cpu: 'Ryzen 9 8945HS', ram: '32GB LPDDR5X', storage: '1TB PCIe 4.0 SSD', gpu: 'RTX 4070 8GB', screen: '14" 3K OLED 120Hz' },
      aiSummary: 'Top-tier compact 14-inch AI workstation and gaming powerhouse with 3K OLED 120Hz display and high thermal efficiency.',
      targetAudience: 'AI engineers, 3D artists, gamers',
      useCases: ['AI model training', '3D graphic modeling', 'AAA gaming'],
      keywords: ['asus', 'rog', 'zephyrus', 'rtx 4070', 'ryzen 9', 'gaming laptop'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Dell XPS 15 (Intel Core i7-13700H, 32GB RAM, 1TB SSD, RTX 4060)',
      brand: 'Dell',
      category: 'Electronics',
      price: 184990,
      originalPrice: 199990,
      inventory: 15,
      rating: 4.8,
      specs: { cpu: 'Intel Core i7-13700H', ram: '32GB DDR5', storage: '1TB NVMe', gpu: 'RTX 4060 8GB', screen: '15.6" 3.5K OLED Touch' },
      aiSummary: 'Machined aluminum premium Windows laptop with 3.5K OLED touch display and robust 32GB RAM for enterprise workloads.',
      targetAudience: 'Enterprise engineers, architects, consultants',
      useCases: ['Enterprise computing', 'Multitasking', 'Design analysis'],
      keywords: ['dell', 'xps 15', 'oled', 'windows laptop', 'i7'],
      isPromoted: false,
      marginTier: 'medium',
    },
    {
      name: 'Apple iPhone 15 Pro (128GB, Natural Titanium)',
      brand: 'Apple',
      category: 'Electronics',
      price: 129900,
      originalPrice: 134900,
      inventory: 35,
      rating: 4.9,
      specs: { chip: 'A17 Pro', storage: '128GB', camera: '48MP Pro System', build: 'Grade 5 Titanium', port: 'USB-C 10Gbps' },
      aiSummary: 'Aerospace-grade titanium flagship smartphone with A17 Pro chip, Action button, and studio-grade 4K ProRes video capture.',
      targetAudience: 'Executives, digital creators, iOS developers',
      useCases: ['Mobile development', 'High-res content creation', 'Daily executive operations'],
      keywords: ['iphone', 'iphone 15 pro', 'apple', 'titanium', 'smartphone'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Samsung Galaxy S24 Ultra (512GB, Titanium Gray, Galaxy AI)',
      brand: 'Samsung',
      category: 'Electronics',
      price: 139999,
      originalPrice: 149999,
      inventory: 20,
      rating: 4.85,
      specs: { chip: 'Snapdragon 8 Gen 3 for Galaxy', ram: '12GB', storage: '512GB', screen: '6.8" QHD+ AMOLED 120Hz', pen: 'Integrated S Pen' },
      aiSummary: 'Android flagship with integrated Galaxy AI live translation, 200MP camera with 100x Space Zoom, and built-in precision stylus.',
      targetAudience: 'Power Android users, mobile note-takers, mobile developers',
      useCases: ['Note taking & diagramming', 'Productivity', 'High zoom photography'],
      keywords: ['samsung', 's24 ultra', 'galaxy ai', 'android flagship', 's pen'],
      isPromoted: false,
      marginTier: 'medium',
    },
    {
      name: 'Logitech MX Master 3S Wireless Performance Mouse',
      brand: 'Logitech',
      category: 'Peripherals',
      price: 9495,
      originalPrice: 10995,
      inventory: 60,
      rating: 4.9,
      specs: { sensor: '8000 DPI Darkfield', scroll: 'MagSpeed Electromagnetic', connectivity: 'Bluetooth / Bolt', battery: '70 days' },
      aiSummary: 'Ergonomic precision mouse with quiet clicks, gesture controls, and MagSpeed scrolling for advanced multi-monitor workflows.',
      targetAudience: 'Developers, spreadsheet power users, UI designers',
      useCases: ['Ergonomic desk setup', 'Code navigation', 'Multi-device switching'],
      keywords: ['mouse', 'logitech', 'mx master', 'wireless', 'ergonomic'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Keychron Q1 Pro Custom QMK/VIA Wireless Mechanical Keyboard',
      brand: 'Keychron',
      category: 'Peripherals',
      price: 18990,
      originalPrice: 21990,
      inventory: 30,
      rating: 4.9,
      specs: { build: 'CNC Full Aluminum', layout: '75%', switches: 'Keychron K Pro Banana Tactile', connectivity: 'Bluetooth 5.1 & Type-C' },
      aiSummary: 'Premium acoustic gasket-mounted mechanical keyboard with programmable QMK/VIA keymaps and hot-swappable switches.',
      targetAudience: 'Engineers, mechanical keyboard enthusiasts, writers',
      useCases: ['Rapid coding', 'Custom shortcut programming', 'Acoustic typing satisfaction'],
      keywords: ['keyboard', 'keychron', 'mechanical keyboard', 'qmk', 'wireless keyboard'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Dell UltraSharp 27" 4K USB-C Hub Monitor (U2723QE)',
      brand: 'Dell',
      category: 'Peripherals',
      price: 52990,
      originalPrice: 62000,
      inventory: 15,
      rating: 4.8,
      specs: { resolution: '3840 x 2160 4K UHD', panel: 'IPS Black (2000:1 contrast)', usbc: '90W Power Delivery Hub', color: '100% sRGB, 98% DCI-P3' },
      aiSummary: 'Premier 4K IPS Black monitor with 90W single-cable USB-C power delivery, Ethernet, and built-in KVM switch for professional dual-laptop desks.',
      targetAudience: 'Engineers, photographers, finance analysts',
      useCases: ['MacBook single cable docking', 'Color accurate editing', 'Code review'],
      keywords: ['monitor', 'dell', '4k', 'usb-c hub', 'ultrasharp'],
      isPromoted: true,
      marginTier: 'medium',
    },
    {
      name: 'LG UltraFine 27" 4K UHD IPS Display with USB-C Hub',
      brand: 'LG',
      category: 'Peripherals',
      price: 34990,
      originalPrice: 42000,
      inventory: 25,
      rating: 4.7,
      specs: { resolution: '3840 x 2160 4K', panel: 'IPS HDR10', powerDelivery: '60W USB-C', stand: 'Height/Tilt Adjustable' },
      aiSummary: 'High-clarity 4K monitor under ₹40,000 providing crisp code rendering and USB-C single cable laptop charging.',
      targetAudience: 'Remote professionals, programmers, students',
      useCases: ['Dual display coding', 'Document clarity', 'Office productivity'],
      keywords: ['monitor', 'lg', '4k', 'display', 'usb-c monitor'],
      isPromoted: false,
      marginTier: 'medium',
    },
    {
      name: 'CalDigit TS4 Thunderbolt 4 18-Port Docking Station',
      brand: 'CalDigit',
      category: 'Peripherals',
      price: 39990,
      originalPrice: 45000,
      inventory: 20,
      rating: 4.9,
      specs: { ports: '18 Ports', powerDelivery: '98W Charging', displays: 'Dual 6K 60Hz', speed: '40Gbps Thunderbolt 4' },
      aiSummary: 'The gold-standard Thunderbolt 4 docking hub supporting dual 6K displays, 2.5Gb Ethernet, and 98W laptop charging over a single cable.',
      targetAudience: 'Power workstation users, MacBook Pro owners, dual-monitor developers',
      useCases: ['Single cable desk docking', 'High-speed storage transfers', 'Dual monitor setup'],
      keywords: ['dock', 'thunderbolt 4', 'caldigit', 'usb-c hub', 'laptop dock'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Anker 737 Power Bank (PowerCore 24K 140W Two-Way Fast Charge)',
      brand: 'Anker',
      category: 'Electronics',
      price: 12999,
      originalPrice: 15999,
      inventory: 40,
      rating: 4.8,
      specs: { capacity: '24000mAh', output: '140W Max Fast Charge', display: 'Smart Digital Color Display' },
      aiSummary: 'Heavy-duty 140W fast-charging power bank capable of powering laptops and phones simultaneously with real-time digital power telemetry.',
      targetAudience: 'Digital nomads, field engineers, travelers',
      useCases: ['Laptop portable battery', 'Flight trips', 'Emergency power'],
      keywords: ['power bank', 'anker', '140w', 'battery', 'portable charger'],
      isPromoted: true,
      marginTier: 'medium',
    },
    {
      name: 'Herman Miller Aeron Ergonomic Office Chair (Size B, Fully Loaded)',
      brand: 'Herman Miller',
      category: 'Furniture',
      price: 114000,
      originalPrice: 125000,
      inventory: 15,
      rating: 4.95,
      specs: { mesh: 'Pellicle 8Z Suspension', lumbar: 'PostureFit SL Adjustable', tilt: 'Forward & Backward Limiter', warranty: '12-Year Official' },
      aiSummary: 'The iconic ergonomic office chair engineered for optimal spinal alignment, posture support, and thermal comfort over 12+ hour workdays.',
      targetAudience: 'Software founders, executives, developers investing in spine health',
      useCases: ['All-day ergonomic seating', 'Back pain elimination', 'Long coding marathons'],
      keywords: ['chair', 'herman miller', 'aeron', 'office chair', 'ergonomic'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'Ergoflex Dual-Motor Electric Height Adjustable Standing Desk (140x70cm)',
      brand: 'Ergoflex',
      category: 'Furniture',
      price: 29990,
      originalPrice: 36000,
      inventory: 30,
      rating: 4.8,
      specs: { motors: 'Dual Heavy Duty Motors', memoryPresets: '4 Height Presets', weightCapacity: '120kg', antiCollision: 'Active Gyro Sensor' },
      aiSummary: 'Solid engineered standing desk with whisper-quiet dual motors, digital height display, and smooth sit-stand transition speeds.',
      targetAudience: 'Remote workers, developers with standing desk routines',
      useCases: ['Active sit-stand posture', 'Desk setup elevation', 'Energy maintenance'],
      keywords: ['standing desk', 'desk', 'ergonomic desk', 'height adjustable', 'furniture'],
      isPromoted: true,
      marginTier: 'medium',
    },
    {
      name: 'Figma Enterprise Organization 1-Year License (Annual Seat)',
      brand: 'Figma',
      category: 'Software & Licenses',
      price: 67200,
      originalPrice: 72000,
      inventory: 100,
      rating: 4.9,
      specs: { tier: 'Enterprise Tier', sso: 'SAML SSO Included', security: 'Org-wide Design System Analytics', billing: 'Annual' },
      aiSummary: 'Enterprise-grade collaborative interface design and prototyping suite with design system analytics, private plugins, and SAML SSO.',
      targetAudience: 'Design teams, product organizations, software startups',
      useCases: ['UI/UX design systems', 'Team collaboration', 'Interactive prototyping'],
      keywords: ['figma', 'software', 'license', 'saas seat', 'design license'],
      isPromoted: true,
      marginTier: 'high',
    },
    {
      name: 'JetBrains All Products Pack 1-Year Commercial License',
      brand: 'JetBrains',
      category: 'Software & Licenses',
      price: 54900,
      originalPrice: 59900,
      inventory: 100,
      rating: 4.95,
      specs: { ides: 'IntelliJ IDEA Ultimate, PyCharm, WebStorm, CLion, GoLand, Rider, DataGrip', licenseType: 'Commercial Annual' },
      aiSummary: 'Complete developer IDE suite covering Java, Kotlin, Python, TypeScript, Go, C#, Rust, and database tools with intelligent refactoring.',
      targetAudience: 'Engineering teams, full-stack developers, software consultancies',
      useCases: ['Full-stack software engineering', 'Polyglot programming', 'Code optimization'],
      keywords: ['jetbrains', 'intellij', 'software', 'developer license', 'ide'],
      isPromoted: true,
      marginTier: 'high',
    },
  ];

  for (const p of products) {
    let prodRes = await query('SELECT id FROM products WHERE name = $1', [p.name]);
    let prodId;

    if (prodRes.rows.length === 0) {
      const insProd = await query(`
        INSERT INTO products (merchant_id, name, description, brand, category, price, original_price, currency, inventory, in_stock, rating, specifications)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, true, $9, $10)
        RETURNING id
      `, [merchantId, p.name, p.aiSummary, p.brand, p.category, p.price, p.originalPrice || p.price, p.inventory, p.rating, JSON.stringify(p.specs)]);
      prodId = insProd.rows[0].id;
    } else {
      prodId = prodRes.rows[0].id;
      await query(`
        UPDATE products
        SET price = $1, original_price = $2, inventory = $3, in_stock = true, rating = $4, specifications = $5, description = $6
        WHERE id = $7
      `, [p.price, p.originalPrice || p.price, p.inventory, p.rating, JSON.stringify(p.specs), p.aiSummary, prodId]);
    }

    // Insert or update AI Metadata
    await query(`
      INSERT INTO product_ai_metadata (
        product_id, ai_summary, target_audience, use_cases, keywords, is_promoted, margin_tier
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_id) DO UPDATE
      SET ai_summary = EXCLUDED.ai_summary,
          target_audience = EXCLUDED.target_audience,
          use_cases = EXCLUDED.use_cases,
          keywords = EXCLUDED.keywords,
          is_promoted = EXCLUDED.is_promoted,
          margin_tier = EXCLUDED.margin_tier,
          updated_at = NOW()
    `, [prodId, p.aiSummary, p.targetAudience, p.useCases, p.keywords, p.isPromoted, p.marginTier]);
  }

  // 3. Ensure Merchant Analytics baseline is initialized
  await query(`
    INSERT INTO merchant_analytics (merchant_id, date, ai_orders_count, ai_revenue, ai_search_impressions, ai_conversion_rate, aov)
    VALUES ($1, CURRENT_DATE, 38, 482000, 452, 8.4, 12684)
    ON CONFLICT (merchant_id, date) DO UPDATE
    SET ai_orders_count = EXCLUDED.ai_orders_count,
        ai_revenue = EXCLUDED.ai_revenue,
        ai_search_impressions = EXCLUDED.ai_search_impressions,
        ai_conversion_rate = EXCLUDED.ai_conversion_rate,
        aov = EXCLUDED.aov
  `, [merchantId]);

  console.log(`AgentPay Demo Store & 20 AI-Readable Products seeded successfully for merchant ID: ${merchantId}`);
  return { merchantId, productsCount: products.length };
}

if (process.argv[1] && process.argv[1].endsWith('seedDemoStore.js')) {
  seedDemoStore().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
