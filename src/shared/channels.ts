export const IPC = {
  FEATURE_FLAG_GET_ALL: 'featureFlag:getAll',
  FEATURE_FLAG_UPSERT: 'featureFlag:upsert',

  // Product & Inventory Channels (Stage 2)
  PRODUCT_GET_ALL: 'product:getAll',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',
  PRODUCT_BULK_IMPORT: 'product:bulkImport',
  PRODUCT_GET_BY_BARCODE: 'product:getByBarcode',

  // Barcode Scanner Channels (Stage 3)
  BARCODE_SCAN: 'barcode:scan',

  // Pricing Tiers Channels (Stage 2)
  PRICING_TIER_GET_ALL: 'pricingTier:getAll',
  PRICING_TIER_SAVE_ALL: 'pricingTier:saveAll',

  // Transaction & Checkout Channels (Stage 1)
  TRANSACTION_CREATE: 'transaction:create',
  TRANSACTION_GET_ALL: 'transaction:getAll',
  TRANSACTION_PARK: 'transaction:park',
  TRANSACTION_VOID: 'transaction:void',

  // Receipt Printing Channels (Stage 4)
  RECEIPT_PRINT: 'receipt:print',
  RECEIPT_TEST_NETWORK: 'receipt:testNetwork',

  // Settings Channels
  SETTINGS_GET_PRINTER: 'settings:getPrinter',
  SETTINGS_SAVE_PRINTER: 'settings:savePrinter',
  SETTINGS_GET_STORE: 'settings:getStore',
  SETTINGS_SAVE_STORE: 'settings:saveStore'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
