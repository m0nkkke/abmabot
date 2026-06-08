const { SHOP_BUTTONS_PER_ROW, SHOPS_PER_PAGE } = require('../constants');
const { listRecentShops, saveSession } = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { formatShop, getCatalogShop, getRegions, getShopsByRegion } = require('../shops');
const { STATES } = require('../states');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

async function showRegionPage(chatId, userId, data = {}) {
  const recentShops = data.adminEditUserId || data.skipRecentShops ? [] : listRecentShops(userId, 1);
  const buttons = recentShops.map((shop, index) => ([
    { text: shop.shop, type: 'callback', payload: `recent_shop_${index}` }
  ]));

  if (recentShops.length) {
    buttons.push([{ text: 'Выбрать другой магазин', type: 'callback', payload: 'choose_other_shop' }]);
  }

  buttons.push(...getRegions().map((region) => ([
    { text: region.name, type: 'callback', payload: `region_${region.id}` }
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
      ? 'Выберите последний магазин, регион или введите магазин текстом:'
      : 'Выберите регион или введите магазин текстом:',
    inlineKeyboard(buttons)
  );
}

async function showShopSearchResults(chatId, userId, matches, query, data = {}) {
  const buttons = matches.map((match) => ([
    { text: formatShop(match.shop), type: 'callback', payload: `shop_${match.shopId}` }
  ]));
  buttons.push([{ text: '← Назад к регионам', type: 'callback', payload: 'form_back' }]);

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_SHOP_PAGE, {
    ...data,
    searchQuery: query,
    searchResults: matches.map((match) => match.shopId)
  });
  await sendKeyboardMessage(
    chatId,
    userId,
    `Найдено по запросу «${query}»:`,
    inlineKeyboard(buttons)
  );
}

async function showShopPage(chatId, userId, page, data = {}) {
  const regions = getRegions();
  const regionId = data.regionId || regions.find((item) => item.name === data.region)?.id || regions[0]?.id;
  const region = data.region || regions.find((item) => item.id === regionId)?.name || '';
  const regionShops = getShopsByRegion(regionId);
  const maxPage = Math.max(0, Math.ceil(regionShops.length / SHOPS_PER_PAGE) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const start = safePage * SHOPS_PER_PAGE;
  const shops = regionShops.slice(start, start + SHOPS_PER_PAGE);

  const buttons = [];
  for (let index = 0; index < shops.length; index += SHOP_BUTTONS_PER_ROW) {
    const row = shops.slice(index, index + SHOP_BUTTONS_PER_ROW).map((shop) => {
      return { text: formatShop(shop), type: 'callback', payload: `shop_${shop.id}` };
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
  saveSession(userId, state, { ...data, regionId, region, shopPage: safePage });
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
  const regionItem = getRegions().find((item) => item.name === region);
  await showShopPage(chatId, adminUserId, page, { adminEditUserId: String(targetUserId), region, regionId: regionItem?.id });
}

function getShopByPayload(payload) {
  const shopId = Number(payload.replace('shop_', ''));
  const shop = getCatalogShop(shopId);
  return shop ? { region: shop.region, regionId: shop.region_id, shopText: formatShop(shop) } : null;
}

module.exports = {
  getShopByPayload,
  showAdminRegionPage,
  showAdminShopPage,
  showShopSearchResults,
  showRegionPage,
  showShopPage
};
