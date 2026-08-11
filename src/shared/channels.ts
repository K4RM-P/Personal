export const IPC = {
  FEATURE_FLAG_GET_ALL: 'featureFlag:getAll',
  FEATURE_FLAG_UPSERT: 'featureFlag:upsert',

  // Product & Inventory Channels (Stage 2)
  PRODUCT_GET_ALL: 'product:getAll',
  PRODUCT_SEARCH: 'product:search',
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
  PRICING_TIER_PREVIEW_IMPACT: 'pricingTier:previewImpact',

  // Transaction & Checkout Channels (Stage 1)
  TRANSACTION_CREATE: 'transaction:create',
  TRANSACTION_PARK: 'transaction:park',
  TRANSACTION_VOID: 'transaction:void',
  TRANSACTION_REFUND_TAB: 'transaction:refundTab',

  // Customer profiles, credit ledger, and loyalty points
  CUSTOMER_SEARCH: 'customer:search',
  CUSTOMER_GET: 'customer:get',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_DUPLICATE_PHONE: 'customer:duplicatePhone',
  CUSTOMER_ADD_FUNDS: 'customer:addFunds',
  CUSTOMER_ADJUST_CREDIT: 'customer:adjustCredit',
  CUSTOMER_ADJUST_POINTS: 'customer:adjustPoints',
  CUSTOMER_GET_CREDIT_SETTINGS: 'customer:getCreditSettings',
  CUSTOMER_SAVE_CREDIT_SETTINGS: 'customer:saveCreditSettings',
  CUSTOMER_EXPORT_DATA: 'customer:exportData',
  CUSTOMER_DELETE_DATA: 'customer:deleteData',

  // Receipt Printing Channels (Stage 4)
  RECEIPT_PRINT: 'receipt:print',
  RECEIPT_TEST_NETWORK: 'receipt:testNetwork',
  RECEIPT_LIST_PRINTERS: 'receipt:listPrinters',

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
  CATALOG_PROMOTE_ALL: 'catalog:promoteAll',
  CATALOG_GET_PROVINCE: 'catalog:getProvince',
  CATALOG_SET_PROVINCE: 'catalog:setProvince',
  /** main -> renderer stream */
  CATALOG_IMPORT_PROGRESS: 'catalog:importProgress',
  /** Upload a WEBCAT file, commit it, and auto-promote all items to inventory. */
  CATALOG_AUTO_IMPORT: 'catalog:autoImport',

  // Settings Channels
  SETTINGS_GET_PRINTER: 'settings:getPrinter',
  SETTINGS_SAVE_PRINTER: 'settings:savePrinter',
  SETTINGS_GET_STORE: 'settings:getStore',
  SETTINGS_SAVE_STORE: 'settings:saveStore',
  SETTINGS_GET_PAYMENT: 'settings:getPayment',
  SETTINGS_SAVE_PAYMENT: 'settings:savePayment',
  SETTINGS_GET_CHECKOUT: 'settings:getCheckout',
  SETTINGS_SAVE_CHECKOUT: 'settings:saveCheckout',
  SETTINGS_GET_IDLE_TIMEOUT: 'settings:getIdleTimeout',
  SETTINGS_SAVE_IDLE_TIMEOUT: 'settings:saveIdleTimeout',

  // Auth & user management channels
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_CURRENT_USER: 'auth:getCurrentUser',
  AUTH_CHECK_FIRST_BOOT: 'auth:checkFirstBoot',
  AUTH_SETUP_FIRST_MANAGER: 'auth:setupFirstManager',
  USER_LIST: 'user:list',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  /** Manager re-authentication for privileged in-checkout actions (refunds). Does not change the active session. */
  AUTH_VERIFY_MANAGER: 'auth:verifyManager',

  // Refund system (manager-only, authenticated)
  REFUND_SEARCH_SALES: 'refund:searchSales',
  REFUND_GET_SALE_DETAILS: 'refund:getSaleDetails',
  REFUND_PROCESS: 'refund:process',

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
  REPORTS_GET_SALES_SUMMARY: 'reports:getSalesSummary',
  REPORTS_GET_TOP_ITEMS: 'reports:getTopItems',
  REPORTS_GET_SLOW_ITEMS: 'reports:getSlowItems',
  REPORTS_GET_DAILY_SALES: 'reports:getDailySales',
  REPORTS_GET_SALES_BY_TENDER: 'reports:getSalesByTender',
  REPORTS_GET_CASHIER_TOTALS: 'reports:getCashierTotals',
  REPORTS_GET_INVENTORY_VALUATION: 'reports:getInventoryValuation',
  REPORTS_GET_CREDIT_HEALTH: 'reports:getCreditHealth',
  REPORTS_GET_ALERTS: 'reports:getAlerts',
  REPORTS_EXPORT_CSV: 'reports:exportCsv',
  REPORTS_EXPORT_XLSX: 'reports:exportXlsx',

  // Data Backup System (docs/data-backup-system-spec.md)
  BACKUP_GET_EXTERNAL_DRIVES: 'backup:getExternalDrives',
  BACKUP_PICK_FOLDER: 'backup:pickFolder',
  BACKUP_RUN: 'backup:run',
  BACKUP_GET_LAST: 'backup:getLast',
  BACKUP_OPEN_FOLDER: 'backup:openFolder',
  BACKUP_GET_PROMPT_ON_LOGOUT: 'backup:getPromptOnLogout',
  BACKUP_SAVE_PROMPT_ON_LOGOUT: 'backup:savePromptOnLogout',
  BACKUP_GET_DRIVE_PATH: 'backup:getDrivePath',
  BACKUP_SAVE_DRIVE_PATH: 'backup:saveDrivePath',
  BACKUP_LIST_RESTORABLE: 'backup:listRestorable',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_RELAUNCH: 'backup:relaunch',

  // Auto-update (B4/B5)
  UPDATE_CHECK_NOW: 'update:checkNow',
  UPDATE_INSTALL_NOW: 'update:installNow',
  UPDATE_GET_STATUS: 'update:getStatus',
  UPDATE_STATUS_CHANGED: 'update:statusChanged'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
