const { SHOP_BUTTONS_PER_ROW, SHOPS_PER_PAGE } = require('../constants');
const { saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { REGIONS, SHOPS, formatShop, getShopsByRegion } = require('../shops');
const { STATES } = require('../states');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

async function showRegionPage(chatId, userId, data = {}) {
  const buttons = REGIONS.map((region, index) => ([
    { text: region, type: 'callback', payload: `region_${index}` }
  ]));

  if (!data.adminEditUserId) {
    buttons.push([{ text: '← В меню', type: 'callback', payload: 'main_menu' }]);
  }

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_REGION, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    'Выберите регион:',
    inlineKeyboard(buttons)
  );
}

async function showShopPage(chatId, userId, page, data = {}) {
  const region = data.region || REGIONS[0];
  const regionShops = getShopsByRegion(region);
  const maxPage = Math.ceil(regionShops.length / SHOPS_PER_PAGE) - 1;
  const safePage = Math.max(0, Math.min(page, maxPage));
  const start = safePage * SHOPS_PER_PAGE;
  const shops = regionShops.slice(start, start + SHOPS_PER_PAGE);

  const buttons = [];
  for (let index = 0; index < shops.length; index += SHOP_BUTTONS_PER_ROW) {
    const row = shops.slice(index, index + SHOP_BUTTONS_PER_ROW).map((shop) => {
      const shopIndex = SHOPS.indexOf(shop);
      return { text: formatShop(shop), type: 'callback', payload: `shop_${shopIndex}` };
    });
    buttons.push(row);
  }

  const navigation = [];
  if (safePage > 0) {
    navigation.push({ text: '← Назад', type: 'callback', payload: `shop_page_${safePage - 1}` });
  }
  if (safePage < maxPage) {
    navigation.push({ text: 'Вперёд →', type: 'callback', payload: `shop_page_${safePage + 1}` });
  }
  if (navigation.length) {
    buttons.push(navigation);
  }
  buttons.push([{ text: '← Назад к регионам', type: 'callback', payload: 'form_back' }]);

  await removeStoredKeyboard(userId);

  const state = data.adminEditUserId ? STATES.AWAIT_ADMIN_SHOP_PAGE : STATES.AWAIT_SHOP_PAGE;
  saveSession(userId, state, { ...data, shopPage: safePage });
  await sendKeyboardMessage(
    chatId,
    userId,
    `Выберите магазин в регионе «${region}». Страница ${safePage + 1} из ${maxPage + 1}:`,
    inlineKeyboard(buttons)
  );
}

async function showAdminRegionPage(chatId, adminUserId, targetUserId) {
  await showRegionPage(chatId, adminUserId, { adminEditUserId: String(targetUserId) });
}

async function showAdminShopPage(chatId, adminUserId, targetUserId, region, page) {
  await showShopPage(chatId, adminUserId, page, { adminEditUserId: String(targetUserId), region });
}

function getRegionByPayload(payload) {
  const regionIndex = Number(payload.replace('region_', ''));
  return REGIONS[regionIndex] || '';
}

function getShopByPayload(payload) {
  const shopIndex = Number(payload.replace('shop_', ''));
  const shop = SHOPS[shopIndex];
  return shop ? { region: shop.region, shopText: formatShop(shop) } : null;
}

module.exports = {
  getRegionByPayload,
  getShopByPayload,
  showAdminRegionPage,
  showAdminShopPage,
  showRegionPage,
  showShopPage
};
