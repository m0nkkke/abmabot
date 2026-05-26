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

module.exports = {
  DEFAULT_REGION,
  REGIONS,
  SHOPS,
  formatShop,
  getShopsByRegion
};
