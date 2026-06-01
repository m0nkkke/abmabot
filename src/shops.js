const {
  getCatalogShop,
  listCatalogRegions,
  listCatalogShops,
  listCatalogShopsByRegion
} = require('./db');

const DEFAULT_REGION = 'Республика Бурятия';

function formatShop(shop) {
  return shop.name;
}

function getRegions() {
  return listCatalogRegions();
}

function getShops() {
  return listCatalogShops();
}

function getShopsByRegion(regionId) {
  return listCatalogShopsByRegion(regionId);
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

  const scored = getShops().map((shop) => {
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

    return { shop, shopId: shop.id, score };
  })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.shop.name.localeCompare(right.shop.name, 'ru'));

  return scored.slice(0, limit);
}

module.exports = {
  DEFAULT_REGION,
  formatShop,
  getCatalogShop,
  getRegions,
  getShops,
  getShopsByRegion,
  normalizeShopQuery,
  searchShops
};
