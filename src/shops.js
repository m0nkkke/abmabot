const shops = require('./shops.json');

function validateShop(shop, index) {
  if (!shop || typeof shop !== 'object') {
    throw new Error(`Магазин с индексом ${index} должен быть объектом`);
  }

  if (!shop.name || typeof shop.name !== 'string') {
    throw new Error(`У магазина с индексом ${index} не заполнено поле name`);
  }

  if (typeof shop.address !== 'string') {
    throw new Error(`У магазина с индексом ${index} поле address должно быть строкой`);
  }

  if (shop.region && typeof shop.region !== 'string') {
    throw new Error(`У магазина с индексом ${index} поле region должно быть строкой`);
  }
}

shops.forEach(validateShop);

const DEFAULT_REGION = 'Республика Бурятия';
const SHOPS = shops.map((shop) => ({
  ...shop,
  region: shop.region || DEFAULT_REGION
}));
const REGIONS = [...new Set(SHOPS.map((shop) => shop.region))];

function formatShop(shop) {
  return shop.name;
}

function getShopsByRegion(region) {
  return SHOPS.filter((shop) => shop.region === region);
}

function normalizeShopQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/к\s*э\s*ш/g, 'к')
    .replace(/к\s*е\s*ш/g, 'к')
    .replace(/кэш/g, 'к')
    .replace(/кеш/g, 'к')
    .replace(/магазин/g, 'маг')
    .replace(/чита/g, 'чита')
    .replace(/ирк/g, 'ирк')
    .replace(/[^a-zа-я0-9]/g, '');
}

function buildShopSearchKeys(shop) {
  const name = normalizeShopQuery(shop.name);
  const address = normalizeShopQuery(shop.address);
  const keys = new Set([name]);
  const number = name.match(/\d+/)?.[0];
  const rawName = String(shop.name || '').toLowerCase().replace(/ё/g, 'е');

  if (number) {
    if (/^(к|кэш|кеш)/i.test(rawName)) {
      keys.add(`к${number}`);
      keys.add(`кэш${number}`);
      keys.add(`кеш${number}`);
    }

    if (/^ирк/i.test(rawName)) {
      keys.add(`ирк${number}`);
    }

    if (/^ч/i.test(rawName)) {
      keys.add(`ч${number}`);
      keys.add(`чита${number}`);
    }

    if (/^маг/i.test(rawName)) {
      keys.add(`маг${number}`);
    }

    if (/^фуд/i.test(rawName)) {
      keys.add(`фуд${number}`);
      keys.add(`фудбери${number}`);
    }
  }

  if (address) {
    keys.add(address);
  }

  return [...keys].filter(Boolean);
}

function searchShops(query, limit = 9) {
  const normalizedQuery = normalizeShopQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const scored = SHOPS.map((shop, index) => {
    const keys = buildShopSearchKeys(shop);
    let score = 0;

    for (const key of keys) {
      if (key === normalizedQuery) {
        score = Math.max(score, 100);
      } else if (key.startsWith(normalizedQuery)) {
        score = Math.max(score, 80);
      } else if (key.includes(normalizedQuery)) {
        score = Math.max(score, 50);
      } else if (normalizedQuery.includes(key) && key.length >= 2) {
        score = Math.max(score, 40);
      }
    }

    return { shop, index, score };
  })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.shop.name.localeCompare(right.shop.name, 'ru'));

  return scored.slice(0, limit);
}

module.exports = {
  DEFAULT_REGION,
  REGIONS,
  SHOPS,
  formatShop,
  getShopsByRegion,
  normalizeShopQuery,
  searchShops
};
