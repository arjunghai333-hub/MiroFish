/**
 * Persona generation for the Shopper Lab.
 *
 * Schema is compatible in spirit with MiroFish/OASIS agent profiles
 * (user_id, name, age, profession, persona narrative, ...) but extended
 * with cricket-shopping-specific fields. The cohort is built from a pool
 * of varied templates (city tier, role, budget, confidence, objections)
 * so repeated runs produce a balanced, non-stereotyped mix rather than
 * one archetype repeated.
 */

'use strict';

// Simple deterministic PRNG (mulberry32) so --seed produces reproducible cohorts.
function createRng(seed) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function pickSome(rng, arr, count) {
  const pool = [...arr];
  const result = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length) % pool.length;
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

// A pool of varied, non-stereotyped persona seeds covering different city
// tiers, cricket roles/levels, professions, and shopping contexts across India.
const PERSONA_SEEDS = [
  {
    name: 'Arjun Mehta',
    age: 24,
    city_tier: 1,
    city_or_region: 'Mumbai, Maharashtra',
    profession_or_context: 'Software engineer, plays weekend box cricket',
    cricket_role: 'All-rounder',
    cricket_level: 'Club / weekend league',
    shopping_for: 'English willow bat upgrade',
    budget_inr: 12000,
    brand_preferences: ['SG', 'SS'],
    price_sensitivity: 'medium',
    quality_priority: 'high',
    urgency: 'low',
    ecommerce_confidence: 'high',
    main_objections: ['Unsure of bat weight/pickup without holding it', 'Wants video proof of willow grade'],
    deal_triggers: ['Free grip + cover bundle', 'Easy no-questions return window'],
  },
  {
    name: 'Fatima Sheikh',
    age: 31,
    city_tier: 2,
    city_or_region: 'Lucknow, Uttar Pradesh',
    profession_or_context: 'Mother buying kit for her son, first-time cricket shopper',
    cricket_role: 'N/A (buying for child)',
    cricket_level: 'School team, beginner',
    shopping_for: 'Full junior kit (pads, gloves, helmet)',
    budget_inr: 6000,
    brand_preferences: [],
    price_sensitivity: 'high',
    quality_priority: 'medium',
    urgency: 'medium',
    ecommerce_confidence: 'low',
    main_objections: ['Confused by size charts', 'Worried about fake/low quality helmet', 'Too many similar-looking combos'],
    deal_triggers: ['Clear size guide with age chart', 'Combo discount on full kit', 'COD availability'],
  },
  {
    name: 'Karthik Subramaniam',
    age: 19,
    city_tier: 2,
    city_or_region: 'Coimbatore, Tamil Nadu',
    profession_or_context: 'College student, district-level trials upcoming',
    cricket_role: 'Fast bowler',
    cricket_level: 'District / state trials',
    shopping_for: 'Spikes and bowling shoes',
    budget_inr: 4500,
    brand_preferences: ['Nike', 'Adidas'],
    price_sensitivity: 'high',
    quality_priority: 'high',
    urgency: 'high',
    ecommerce_confidence: 'high',
    main_objections: ['Limited size availability for 10/11 UK', 'Shipping time vs trial date'],
    deal_triggers: ['Express shipping option', 'In-stock size filter'],
  },
  {
    name: 'Priya Nair',
    age: 27,
    city_tier: 1,
    city_or_region: 'Bengaluru, Karnataka',
    profession_or_context: 'Marketing professional, plays in a women\'s corporate league',
    cricket_role: 'Top-order batter',
    cricket_level: 'Corporate / amateur league',
    shopping_for: 'Batting gloves and thigh guard',
    budget_inr: 3500,
    brand_preferences: ['SS', 'Kookaburra'],
    price_sensitivity: 'medium',
    quality_priority: 'medium',
    urgency: 'low',
    ecommerce_confidence: 'high',
    main_objections: ['Few options sized for women players', 'Product photos don\'t show palm padding detail'],
    deal_triggers: ['Detailed size chart for women/youth fit', 'Honest customer reviews with photos'],
  },
  {
    name: 'Mohammed Irfan',
    age: 45,
    city_tier: 3,
    city_or_region: 'Bhagalpur, Bihar',
    profession_or_context: 'Owns a small sports goods shop, buying for resale and his son',
    cricket_role: 'Former club player, now coach',
    cricket_level: 'Local club coaching',
    shopping_for: 'Bulk tennis balls and a tape ball bat',
    budget_inr: 2500,
    brand_preferences: [],
    price_sensitivity: 'high',
    quality_priority: 'low',
    urgency: 'medium',
    ecommerce_confidence: 'low',
    main_objections: ['No bulk/wholesale pricing visible', 'Slow site on his phone/network', 'Return policy unclear for bulk orders'],
    deal_triggers: ['Bulk quantity discount', 'Cash on delivery', 'Simple Hindi-friendly navigation'],
  },
  {
    name: 'Ritika Desai',
    age: 22,
    city_tier: 1,
    city_or_region: 'Ahmedabad, Gujarat',
    profession_or_context: 'University student, casual gully cricket fan buying merchandise',
    cricket_role: 'Fan / occasional player',
    cricket_level: 'Casual / gully cricket',
    shopping_for: 'Team jersey and a cheap practice bat',
    budget_inr: 1800,
    brand_preferences: ['team jerseys'],
    price_sensitivity: 'high',
    quality_priority: 'low',
    urgency: 'low',
    ecommerce_confidence: 'high',
    main_objections: ['Jersey sizing feels inconsistent with reviews', 'Wants to see more color/print options'],
    deal_triggers: ['Student/first-order discount code', 'Fast, trackable delivery'],
  },
  {
    name: 'Gurpreet Singh',
    age: 35,
    city_tier: 2,
    city_or_region: 'Ludhiana, Punjab',
    profession_or_context: 'Academy coach outfitting multiple trainees',
    cricket_role: 'Coach / wicketkeeper in his playing days',
    cricket_level: 'Academy-level coaching',
    shopping_for: 'Wicketkeeping gloves and pads for 3 trainees',
    budget_inr: 15000,
    brand_preferences: ['SG', 'SS'],
    price_sensitivity: 'medium',
    quality_priority: 'high',
    urgency: 'medium',
    ecommerce_confidence: 'medium',
    main_objections: ['Wants to compare specs side by side, site lacks comparison tool', 'Unclear if GST invoice is provided for academy purchase'],
    deal_triggers: ['Multi-item academy discount', 'GST invoice support', 'Phone support for bulk query'],
  },
  {
    name: 'Ananya Roy',
    age: 16,
    city_tier: 1,
    city_or_region: 'Kolkata, West Bengal',
    profession_or_context: 'School student, state U-17 squad',
    cricket_role: 'Spin bowler',
    cricket_level: 'State U-17',
    shopping_for: 'Match-quality cricket ball and a kit bag',
    budget_inr: 3000,
    brand_preferences: ['SG'],
    price_sensitivity: 'medium',
    quality_priority: 'high',
    urgency: 'medium',
    ecommerce_confidence: 'medium',
    main_objections: ['Parents need to approve purchase, wants a shareable wishlist/cart link', 'Ball hardness grade not explained clearly'],
    deal_triggers: ['Clear product spec sheet', 'Wishlist/share feature'],
  },
  {
    name: 'Deepak Choudhary',
    age: 29,
    city_tier: 3,
    city_or_region: 'Sikar, Rajasthan',
    profession_or_context: 'Government clerk, serious weekend cricketer with a tight budget',
    cricket_role: 'Opening batter',
    cricket_level: 'District league',
    shopping_for: 'Mid-range kashmir willow bat',
    budget_inr: 2200,
    brand_preferences: [],
    price_sensitivity: 'high',
    quality_priority: 'medium',
    urgency: 'low',
    ecommerce_confidence: 'medium',
    main_objections: ['Suspicious of "too good to be true" discounts', 'No nearby service center if bat cracks'],
    deal_triggers: ['Clear warranty/replacement terms', 'Genuine-looking reviews with photos'],
  },
  {
    name: 'Simran Kaur',
    age: 38,
    city_tier: 1,
    city_or_region: 'Delhi NCR',
    profession_or_context: 'Working parent, time-poor, shopping on phone during commute',
    cricket_role: 'N/A (buying for two kids)',
    cricket_level: 'School-level, both kids beginners',
    shopping_for: 'Two junior kits, ideally bundled',
    budget_inr: 9000,
    brand_preferences: [],
    price_sensitivity: 'medium',
    quality_priority: 'medium',
    urgency: 'high',
    ecommerce_confidence: 'high',
    main_objections: ['Checkout process (hypothetically) seems long for a quick mobile buy', 'Not sure if sizes differ between the two kids\' ages'],
    deal_triggers: ['Fast mobile browsing, minimal taps to product', 'Bundle-for-siblings offer'],
  },
  {
    name: 'Yuvraj Pawar',
    age: 21,
    city_tier: 2,
    city_or_region: 'Nagpur, Maharashtra',
    profession_or_context: 'Aspiring fast bowler, follows IPL players\' gear closely',
    cricket_role: 'Fast bowler',
    cricket_level: 'University / state age-group',
    shopping_for: 'Pro-endorsed bat and arm sleeve',
    budget_inr: 18000,
    brand_preferences: ['MRF', 'SG'],
    price_sensitivity: 'low',
    quality_priority: 'high',
    urgency: 'medium',
    ecommerce_confidence: 'high',
    main_objections: ['Wants player-endorsement authenticity proof', 'Limited edition stock seems to run out fast'],
    deal_triggers: ['Pre-order/restock alert', 'Authenticity certificate or player signature proof'],
  },
  {
    name: 'Meena Iyer',
    age: 52,
    city_tier: 3,
    city_or_region: 'Thanjavur, Tamil Nadu',
    profession_or_context: 'Retired teacher, buying a gift kit for grandson, not very tech-savvy',
    cricket_role: 'N/A (gift buyer)',
    cricket_level: 'Grandson is a beginner',
    shopping_for: 'Simple starter set as a gift',
    budget_inr: 2000,
    brand_preferences: [],
    price_sensitivity: 'high',
    quality_priority: 'low',
    urgency: 'low',
    ecommerce_confidence: 'low',
    main_objections: ['Site navigation feels overwhelming', 'Unsure which "starter kit" is actually for young beginners', 'Worried about typing payment details online (hypothetically)'],
    deal_triggers: ['A clearly labeled "gift" or "starter kit for kids" category', 'Trust badges and simple language'],
  },
];

function buildPersona(seed, index, rng) {
  const userId = index + 1;
  const narrative =
    `${seed.name} (${seed.age}) is a ${seed.cricket_level.toLowerCase()} ${seed.cricket_role.toLowerCase()} ` +
    `from ${seed.city_or_region}. ${seed.profession_or_context}. Today they are browsing ` +
    `Indian Cricket Store on their phone looking for ${seed.shopping_for.toLowerCase()}, with a budget around ` +
    `₹${seed.budget_inr}. Their price sensitivity is ${seed.price_sensitivity} and they place ${seed.quality_priority} ` +
    `priority on quality. They decide quickly if ${(seed.deal_triggers[0] || 'a good deal').toLowerCase()} is visible, ` +
    `but hesitate if ${(seed.main_objections[0] || 'something feels unclear').toLowerCase()}.`;

  return {
    user_id: userId,
    name: seed.name,
    age: seed.age,
    city_tier: seed.city_tier,
    city_or_region: seed.city_or_region,
    profession_or_context: seed.profession_or_context,
    cricket_role: seed.cricket_role,
    cricket_level: seed.cricket_level,
    shopping_for: seed.shopping_for,
    budget_inr: seed.budget_inr,
    brand_preferences: seed.brand_preferences,
    price_sensitivity: seed.price_sensitivity,
    quality_priority: seed.quality_priority,
    urgency: seed.urgency,
    ecommerce_confidence: seed.ecommerce_confidence,
    main_objections: seed.main_objections,
    deal_triggers: seed.deal_triggers,
    persona: narrative,
  };
}

/**
 * Generate a balanced cohort of `count` personas. Deterministic for a given
 * seed; draws without replacement from the seed pool first, then (if more
 * personas are requested than seeds) reuses seeds with re-shuffled ids.
 */
function generatePersonas(count, seed = Date.now()) {
  const rng = createRng(seed);
  const n = Math.max(1, Math.min(count, PERSONA_SEEDS.length * 4));
  const chosen = [];

  if (n <= PERSONA_SEEDS.length) {
    chosen.push(...pickSome(rng, PERSONA_SEEDS, n));
  } else {
    // Reuse the pool, cycling, once every seed has been used once.
    for (let i = 0; i < n; i++) {
      chosen.push(PERSONA_SEEDS[i % PERSONA_SEEDS.length]);
    }
  }

  return chosen.map((seedPersona, index) => buildPersona(seedPersona, index, rng));
}

module.exports = {
  generatePersonas,
  createRng,
  PERSONA_SEEDS,
};
