const { SHOP_BUTTONS_PER_ROW, SHOPS_PER_PAGE } = require('../constants');
const { listRecentShops, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { REGIONS, SHOPS, formatShop, getShopsByRegion } = require('../shops');
const { STATES } = require('../states');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

async function showRegionPage(chatId, userId, data = {}) {
  const recentShops = data.adminEditUserId || data.skipRecentShops ? [] : listRecentShops(userId, 5);
  const buttons = recentShops.map((shop, index) => ([
    { text: shop.shop, type: 'callback', payload: `recent_shop_${index}` }
  ]));

  if (recentShops.length) {
    buttons.push([{ text: 'Выбрать другой магазин', type: 'callback', payload: 'choose_other_shop' }]);
  }

  buttons.push(...REGIONS.map((region, index) => ([
    { text: region, type: 'callback', payload: `region_${index}` }
  ])));

  if (!data.adminEditUserId) {
    buttons.push([{ text: '← В меню', type: 'callback', payload: 'main_menu' }]);
  }

  await removeStoredKeyboard(userId);
  const nextData = { ...data, recentShops };
  delete nextData.skipRecentShops;

  saveSession(userId, STATES.AWAIT_REGION, nextData);
  await sendKeyboardMessage(
    chatId,
    userId,
    recentShops.length
      ? 'Выберите недавний магазин, регион или введите магазин текстом:'
      : 'Выберите регион или введите магазин текстом:',
    inlineKeyboard(buttons)
  );
}

async function showShopSearchResults(chatId, userId, matches, query, data = {}) {
  const buttons = matches.map((match) => ([
    { text: formatShop(match.shop), type: 'callback', payload: `shop_${match.index}` }
  ]));
  buttons.push([{ text: '← Назад к регионам', type: 'callback', payload: 'form_back' }]);

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_SHOP_PAGE, {
    ...data,
    searchQuery: query,
    searchResults: matches.map((match) => match.index)
  });
  await sendKeyboardMessage(
    chatId,
    userId,
    `Найдено по запросу «${query}»:`,
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
  showShopSearchResults,
  showRegionPage,
  showShopPage
};
