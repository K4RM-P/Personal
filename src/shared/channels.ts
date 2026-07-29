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

  // Payment Channels (Stage 5)
  PAYMENT_CHARGE: 'payment:charge',
  PAYMENT_REFUND: 'payment:refund',
  PAYMENT_VOID: 'payment:void',
  PAYMENT_GET_READER_STATUS: 'payment:getReaderStatus',

  // McKesson Catalogue Channels
  CATALOG_PICK_FILE: 'catalog:pickFile',
  CATALOG_START_IMPORT: 'catalog:startImport',
  CATALOG_COMMIT_IMPORT: 'catalog:commitImport',
  CATALOG_DISCARD_IMPORT: 'catalog:discardImport',
  CATALOG_ROLLBACK: 'catalog:rollback',
  CATALOG_GET_STATUS: 'catalog:getStatus',
  CATALOG_SEARCH: 'catalog:search',
  CATALOG_SCAN_LOOKUP: 'catalog:scanLookup',
  CATALOG_GET_DEALS: 'catalog:getDeals',
  CATALOG_PROMOTE: 'catalog:promote',
  CATALOG_GET_PROVINCE: 'catalog:getProvince',
  CATALOG_SET_PROVINCE: 'catalog:setProvince',
  /** main -> renderer stream */
  CATALOG_IMPORT_PROGRESS: 'catalog:importProgress',

  // Settings Channels
  SETTINGS_GET_PRINTER: 'settings:getPrinter',
  SETTINGS_SAVE_PRINTER: 'settings:savePrinter',
  SETTINGS_GET_STORE: 'settings:getStore',
  SETTINGS_SAVE_STORE: 'settings:saveStore',
  SETTINGS_GET_PAYMENT: 'settings:getPayment',
  SETTINGS_SAVE_PAYMENT: 'settings:savePayment',

  // Compliance & ledger channels (Stage 6/8)
  COMPLIANCE_SEARCH_RX: 'compliance:searchRx',
  COMPLIANCE_GET_AGING_RX: 'compliance:getAgingRx',
  COMPLIANCE_LOG_EVENT: 'compliance:logEvent',
  COMPLIANCE_GET_AUDIT_LOG: 'compliance:getAuditLog',
  COMPLIANCE_EXPORT_AUDIT_LOG: 'compliance:exportAuditLog',
  COMPLIANCE_CAPTURE_SIGNATURE: 'compliance:captureSignature',
  COMPLIANCE_PSE_VALIDATE: 'compliance:pseValidate',
  COMPLIANCE_DSCSA_SCAN: 'compliance:dscsaScan',
  COMPLIANCE_FSA_HSA_CHECK: 'compliance:fsaHsaCheck',

  // Customer ledger / reports
  CUSTOMER_LEDGER_GET: 'customerLedger:get',
  CUSTOMER_LEDGER_POST: 'customerLedger:post',
  REPORTS_GET_DASHBOARD: 'reports:getDashboard',
  REPORTS_EXPORT_CSV: 'reports:exportCsv',
  REPORTS_EXPORT_XLSX: 'reports:exportXlsx',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE_TEST: 'backup:restoreTest'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
