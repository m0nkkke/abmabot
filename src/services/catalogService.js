const { EVENT_TYPES, MAX_PHOTOS_PER_RECORD, VIOLATION_TYPES } = require('../constants');
const { getProfile } = require('../db');
const { getRegions, getShops, getShopsByRegion } = require('../shops');

function formatShop(shop) {
  return {
    id: shop.id,
    regionId: shop.regionId ?? shop.region_id,
    name: shop.name,
    address: shop.address || ''
  };
}

function listRegions() {
  return getRegions().map((region) => ({
    id: region.id,
    name: region.name
  }));
}

function listShops(regionId = null) {
  const shops = regionId ? getShopsByRegion(regionId) : getShops();
  return shops.map(formatShop);
}

function findProfileSelection(profile, regions) {
  if (!profile) {
    return null;
  }

  const region = regions.find((item) => item.name === profile.region)
    || regions.find((item) => item.shops.some((shop) => shop.name === profile.shop));
  const shop = region?.shops.find((item) => item.name === profile.shop) || null;

  return {
    fio: profile.fio || '',
    region: profile.region || '',
    shop: profile.shop || '',
    regionId: region?.id || null,
    shopId: shop?.id || null
  };
}

function getMiniAppBootstrap(userId = null) {
  const regions = listRegions().map((region) => ({
    ...region,
    shops: listShops(region.id)
  }));
  const profile = userId ? getProfile(userId) : null;

  return {
    regions,
    eventTypes: EVENT_TYPES,
    violationTypes: VIOLATION_TYPES,
    maxPhotos: MAX_PHOTOS_PER_RECORD,
    user: {
      userId: userId ? String(userId) : null,
      profile: findProfileSelection(profile, regions)
    }
  };
}

module.exports = {
  getMiniAppBootstrap,
  listRegions,
  listShops
};
