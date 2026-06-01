const { SHOPS_PER_PAGE } = require('../constants');
const {
  getCatalogRegion,
  getCatalogShop,
  listCatalogRegions,
  listCatalogShopsByRegion,
  saveSession
} = require('../db');
const { inlineKeyboard } = require('../keyboards');
const { STATES } = require('../states');
const { removeStoredKeyboard, sendKeyboardMessage } = require('./keyboardSession');

async function showAdminCatalogMenu(chatId, userId, text = 'Управление каталогом:') {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.IDLE, {});
  await sendKeyboardMessage(
    chatId,
    userId,
    text,
    inlineKeyboard([
      [{ text: '+ Добавить регион', type: 'callback', payload: 'admin_catalog_add_region' }],
      [{ text: '✏️ Изменить регион', type: 'callback', payload: 'admin_catalog_edit_region' }],
      [{ text: '🗑 Удалить регион', type: 'callback', payload: 'admin_catalog_delete_region' }],
      [{ text: '+ Добавить магазин', type: 'callback', payload: 'admin_catalog_add_shop' }],
      [{ text: '✏️ Изменить магазин', type: 'callback', payload: 'admin_catalog_edit_shop' }],
      [{ text: '🗑 Удалить магазин', type: 'callback', payload: 'admin_catalog_delete_shop' }],
      [{ text: '← В меню', type: 'callback', payload: 'main_menu' }]
    ])
  );
}

async function showAdminCatalogRegions(chatId, userId, action) {
  const regions = listCatalogRegions();
  const buttons = regions.map((region) => ([
    { text: region.name, type: 'callback', payload: `admin_catalog_region_${action}_${region.id}` }
  ]));
  buttons.push([{ text: '← Назад', type: 'callback', payload: 'admin_catalog_menu' }]);

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.IDLE, { adminCatalogAction: action });
  await sendKeyboardMessage(chatId, userId, 'Выберите регион:', inlineKeyboard(buttons));
}

async function showAdminCatalogShops(chatId, userId, action, regionId, page = 0) {
  const region = getCatalogRegion(regionId);
  const shops = listCatalogShopsByRegion(regionId);
  const maxPage = Math.max(0, Math.ceil(shops.length / SHOPS_PER_PAGE) - 1);
  const safePage = Math.max(0, Math.min(Number(page) || 0, maxPage));
  const start = safePage * SHOPS_PER_PAGE;
  const buttons = shops.slice(start, start + SHOPS_PER_PAGE).map((shop) => ([
    { text: shop.name, type: 'callback', payload: `admin_catalog_shop_${action}_${shop.id}` }
  ]));
  const navigation = [];
  if (safePage > 0) {
    navigation.push({ text: '← Назад', type: 'callback', payload: `admin_catalog_shop_page_${action}_${regionId}_${safePage - 1}` });
  }
  if (safePage < maxPage) {
    navigation.push({ text: 'Вперёд →', type: 'callback', payload: `admin_catalog_shop_page_${action}_${regionId}_${safePage + 1}` });
  }
  if (navigation.length) {
    buttons.push(navigation);
  }
  buttons.push([{ text: '← К регионам', type: 'callback', payload: `admin_catalog_${action}_shop` }]);

  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.IDLE, { adminCatalogAction: action, adminCatalogRegionId: Number(regionId) });
  await sendKeyboardMessage(
    chatId,
    userId,
    `Выберите магазин в регионе «${region?.name || ''}». Страница ${safePage + 1} из ${maxPage + 1}:`,
    inlineKeyboard(buttons)
  );
}

async function askAdminRegionName(chatId, userId, data = {}) {
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_ADMIN_REGION_NAME, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    data.adminCatalogRegionId ? 'Введите новое название региона:' : 'Введите название нового региона:',
    inlineKeyboard([[{ text: '← Отменить', type: 'callback', payload: 'admin_catalog_menu' }]])
  );
}

async function askAdminShopData(chatId, userId, data = {}) {
  const shop = data.adminCatalogShopId ? getCatalogShop(data.adminCatalogShopId) : null;
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.AWAIT_ADMIN_SHOP_DATA, data);
  await sendKeyboardMessage(
    chatId,
    userId,
    [
      shop ? `Текущий магазин: ${shop.name} | ${shop.address}` : 'Введите данные нового магазина.',
      '',
      'Формат: Название | Адрес'
    ].join('\n'),
    inlineKeyboard([[{ text: '← Отменить', type: 'callback', payload: 'admin_catalog_menu' }]])
  );
}

async function showAdminCatalogDeleteConfirm(chatId, userId, entity, id, name) {
  const isRegion = entity === 'region';
  await removeStoredKeyboard(userId);
  saveSession(userId, STATES.IDLE, {});
  await sendKeyboardMessage(
    chatId,
    userId,
    `Удалить ${isRegion ? 'регион' : 'магазин'} «${name}»?`,
    inlineKeyboard([
      [{ text: 'Удалить', type: 'callback', payload: `admin_catalog_confirm_delete_${entity}_${id}` }],
      [{ text: '← Отменить', type: 'callback', payload: 'admin_catalog_menu' }]
    ])
  );
}

module.exports = {
  askAdminRegionName,
  askAdminShopData,
  showAdminCatalogDeleteConfirm,
  showAdminCatalogMenu,
  showAdminCatalogRegions,
  showAdminCatalogShops
};
