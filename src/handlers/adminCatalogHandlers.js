const {
  addCatalogRegion,
  addCatalogShop,
  renameCatalogRegion,
  updateCatalogShop
} = require('../db');
const { logError } = require('../logger');
const { sendMessage } = require('../maxClient');
const { STATES } = require('../states');
const {
  askAdminRegionName,
  askAdminShopData,
  showAdminCatalogMenu
} = require('../flows/adminCatalogFlow');

async function handleAdminCatalogText(chatId, userId, session, text, options = {}) {
  if (!session || ![STATES.AWAIT_ADMIN_REGION_NAME, STATES.AWAIT_ADMIN_SHOP_DATA].includes(session.state)) {
    return false;
  }

  if (String(text || '').trim().startsWith('/')) {
    return false;
  }

  if (!options.isAdmin(userId)) {
    await sendMessage(chatId, 'Команда доступна только администратору.');
    return true;
  }

  if (session.state === STATES.AWAIT_ADMIN_REGION_NAME) {
    if (!text) {
      await askAdminRegionName(chatId, userId, session.data);
      return true;
    }

    try {
      if (session.data.adminCatalogRegionId) {
        renameCatalogRegion(session.data.adminCatalogRegionId, text);
        await showAdminCatalogMenu(chatId, userId, 'Регион переименован.');
      } else {
        addCatalogRegion(text);
        await showAdminCatalogMenu(chatId, userId, 'Регион добавлен.');
      }
    } catch (error) {
      logError('Не удалось сохранить регион:', error);
      await sendMessage(chatId, 'Не удалось сохранить регион. Возможно, такое название уже используется.');
      await askAdminRegionName(chatId, userId, session.data);
    }
    return true;
  }

  const [name, ...addressParts] = String(text || '').split('|');
  const address = addressParts.join('|').trim();
  if (!name.trim() || !address) {
    await sendMessage(chatId, 'Введите данные в формате: Название | Адрес');
    await askAdminShopData(chatId, userId, session.data);
    return true;
  }

  try {
    if (session.data.adminCatalogShopId) {
      updateCatalogShop(session.data.adminCatalogShopId, name, address);
      await showAdminCatalogMenu(chatId, userId, 'Магазин изменен.');
    } else {
      addCatalogShop(session.data.adminCatalogRegionId, name, address);
      await showAdminCatalogMenu(chatId, userId, 'Магазин добавлен.');
    }
  } catch (error) {
    logError('Не удалось сохранить магазин:', error);
    await sendMessage(chatId, 'Не удалось сохранить магазин. Проверьте данные и уникальность названия.');
    await askAdminShopData(chatId, userId, session.data);
  }
  return true;
}

module.exports = { handleAdminCatalogText };
