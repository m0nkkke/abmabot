const {
  deleteCatalogRegion,
  deleteCatalogShop,
  getCatalogRegion,
  getCatalogShop
} = require('../db');
const { sendMessage } = require('../maxClient');
const { deleteCallbackMessage } = require('../flows/cleanupFlow');
const {
  askAdminRegionName,
  askAdminShopData,
  showAdminCatalogDeleteConfirm,
  showAdminCatalogMenu,
  showAdminCatalogRegions,
  showAdminCatalogShops
} = require('../flows/adminCatalogFlow');

async function handleAdminCatalogCallback(update, chatId, userId, payload, options = {}) {
  if (!payload.startsWith('admin_catalog_')) {
    return false;
  }

  if (!options.isAdmin(userId)) {
    await sendMessage(chatId, 'Доступ к управлению каталогом есть только у администратора.');
    return true;
  }

  if (payload === 'admin_catalog_menu') {
    await deleteCallbackMessage(update);
    await showAdminCatalogMenu(chatId, userId);
    return true;
  }

  if (payload === 'admin_catalog_add_region') {
    await deleteCallbackMessage(update);
    await askAdminRegionName(chatId, userId);
    return true;
  }

  if (payload === 'admin_catalog_edit_region' || payload === 'admin_catalog_delete_region') {
    await deleteCallbackMessage(update);
    await showAdminCatalogRegions(chatId, userId, payload.endsWith('edit_region') ? 'edit' : 'delete');
    return true;
  }

  if (payload === 'admin_catalog_add_shop' || payload === 'admin_catalog_edit_shop' || payload === 'admin_catalog_delete_shop') {
    await deleteCallbackMessage(update);
    const action = payload.includes('add_shop') ? 'add' : payload.includes('edit_shop') ? 'edit' : 'delete';
    await showAdminCatalogRegions(chatId, userId, `${action}_shop`);
    return true;
  }

  if (payload.startsWith('admin_catalog_confirm_delete_')) {
    const match = payload.match(/^admin_catalog_confirm_delete_(region|shop)_(\d+)$/);
    if (!match) {
      await showAdminCatalogMenu(chatId, userId);
      return true;
    }

    const [, entity, idText] = match;
    const id = Number(idText);
    await deleteCallbackMessage(update);

    if (entity === 'region') {
      const deleted = deleteCatalogRegion(id);
      await showAdminCatalogMenu(
        chatId,
        userId,
        deleted ? 'Регион удален.' : 'Нельзя удалить регион: сначала удалите все его магазины.'
      );
      return true;
    }

    const deleted = deleteCatalogShop(id);
    await showAdminCatalogMenu(chatId, userId, deleted ? 'Магазин удален.' : 'Магазин уже удален.');
    return true;
  }

  if (payload.startsWith('admin_catalog_region_')) {
    const match = payload.match(/^admin_catalog_region_(edit|delete|add_shop|edit_shop|delete_shop)_(\d+)$/);
    if (!match) {
      await showAdminCatalogMenu(chatId, userId);
      return true;
    }

    const [, action, regionIdText] = match;
    const regionId = Number(regionIdText);
    await deleteCallbackMessage(update);

    if (action === 'edit') {
      await askAdminRegionName(chatId, userId, { adminCatalogRegionId: regionId });
      return true;
    }

    if (action === 'delete') {
      const region = getCatalogRegion(regionId);
      if (!region) {
        await showAdminCatalogMenu(chatId, userId, 'Регион уже удален.');
        return true;
      }
      await showAdminCatalogDeleteConfirm(chatId, userId, 'region', region.id, region.name);
      return true;
    }

    if (action === 'add_shop') {
      await askAdminShopData(chatId, userId, { adminCatalogRegionId: regionId });
      return true;
    }

    await showAdminCatalogShops(chatId, userId, action === 'edit_shop' ? 'edit' : 'delete', regionId);
    return true;
  }

  if (payload.startsWith('admin_catalog_shop_page_')) {
    const match = payload.match(/^admin_catalog_shop_page_(edit|delete)_(\d+)_(\d+)$/);
    if (match) {
      await deleteCallbackMessage(update);
      await showAdminCatalogShops(chatId, userId, match[1], Number(match[2]), Number(match[3]));
    }
    return true;
  }

  if (payload.startsWith('admin_catalog_shop_')) {
    const match = payload.match(/^admin_catalog_shop_(edit|delete)_(\d+)$/);
    if (!match) {
      await showAdminCatalogMenu(chatId, userId);
      return true;
    }

    const [, action, shopIdText] = match;
    const shopId = Number(shopIdText);
    await deleteCallbackMessage(update);
    if (action === 'edit') {
      await askAdminShopData(chatId, userId, { adminCatalogShopId: shopId });
      return true;
    }

    const shop = getCatalogShop(shopId);
    if (!shop) {
      await showAdminCatalogMenu(chatId, userId, 'Магазин уже удален.');
      return true;
    }
    await showAdminCatalogDeleteConfirm(chatId, userId, 'shop', shop.id, shop.name);
    return true;
  }

  return false;
}

module.exports = { handleAdminCatalogCallback };
