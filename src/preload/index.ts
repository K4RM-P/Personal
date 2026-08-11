import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  FeatureFlag,
  Product,
  Customer,
  PricingTier,
  CreateTransactionPayload,
  BulkImportProductInput,
  TransactionWithItems,
  BarcodeScanResult,
  PrintReceiptResult,
  PrinterConfig,
  SystemPrinterInfo,
  StoreInfo,
  ChargeOptions,
  ChargeResult,
  RefundResult,
  VoidResult,
  ReaderStatus,
  PaymentConfigView,
  SavePaymentConfigInput,
  PrescriptionRecord,
  ComplianceAuditEntry,
  CustomerLedgerEntry,
  ExternalDrive,
  BackupRunResult,
  BackupLogSummary,
  BackupDestination,
  RestorableBackup,
  RestoreBackupResult,
  SalesSummary,
  TopItemRow,
  SlowItemRow,
  DailySalesRow,
  TenderBreakdownRow,
  CashierTotalRow,
  InventoryValuation,
  CreditHealthSummary,
  AlertsSummary,
  DashboardData,
  CheckoutSettings,
  AuthUser,
  LoginResult,
  UserRole,
  VerifyManagerResult,
  SaleSearchResult,
  SaleRefundDetail,
  SaleDateRange,
  ProcessRefundPayload,
  ProcessRefundResult
} from '../shared/types'
import type {
  AutoImportResult,
  CatalogCommitResult,
  CatalogDealRow,
  CatalogImportProgress,
  CatalogPreview,
  CatalogScanResult,
  CatalogSearchRow,
  CatalogStatus,
  PromoteAllResult
} from '../shared/catalogTypes'
import type { TierChangePreviewItem } from '../shared/pricingEngine'

const api = {
  featureFlag: {
    getAll: (): Promise<FeatureFlag[]> => ipcRenderer.invoke(IPC.FEATURE_FLAG_GET_ALL),
    upsert: (key: string, enabled: boolean): Promise<FeatureFlag> =>
      ipcRenderer.invoke(IPC.FEATURE_FLAG_UPSERT, { key, enabled })
  },
  product: {
    getAll: (): Promise<Product[]> => ipcRenderer.invoke(IPC.PRODUCT_GET_ALL),
    search: (query: string, limit = 50): Promise<Product[]> =>
      ipcRenderer.invoke(IPC.PRODUCT_SEARCH, { query, limit }),
    getByBarcode: (barcode: string): Promise<Product | null> =>
      ipcRenderer.invoke(IPC.PRODUCT_GET_BY_BARCODE, barcode),
    create: (data: {
      sku: string
      name: string
      costCents: number
      priceCents?: number
      barcode?: string
      isPinned?: boolean
    }): Promise<Product> => ipcRenderer.invoke(IPC.PRODUCT_CREATE, data),
    update: (
      id: number,
      data: {
        sku?: string
        name?: string
        costCents?: number
        priceCents?: number
        barcode?: string
        isPinned?: boolean
      }
    ): Promise<Product> => ipcRenderer.invoke(IPC.PRODUCT_UPDATE, { id, data }),
    delete: (id: number): Promise<Product> => ipcRenderer.invoke(IPC.PRODUCT_DELETE, id),
    bulkImport: (inputs: BulkImportProductInput[]): Promise<{ count: number }> =>
      ipcRenderer.invoke(IPC.PRODUCT_BULK_IMPORT, inputs)
  },
  barcode: {
    scan: (barcode: string): Promise<BarcodeScanResult> =>
      ipcRenderer.invoke(IPC.BARCODE_SCAN, barcode)
  },
  pricingTier: {
    getAll: (): Promise<PricingTier[]> => ipcRenderer.invoke(IPC.PRICING_TIER_GET_ALL),
    saveAll: (tiers: PricingTier[]): Promise<PricingTier[]> =>
      ipcRenderer.invoke(IPC.PRICING_TIER_SAVE_ALL, tiers),
    previewImpact: (
      tiers: PricingTier[]
    ): Promise<{ affectedCount: number; sample: TierChangePreviewItem[] }> =>
      ipcRenderer.invoke(IPC.PRICING_TIER_PREVIEW_IMPACT, tiers)
  },
  transaction: {
    create: (payload: CreateTransactionPayload): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_CREATE, payload),
    void: (id: string, reason: string): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_VOID, { id, reason })
  },
  customer: {
    search: (query: string): Promise<Customer[]> => ipcRenderer.invoke(IPC.CUSTOMER_SEARCH, query),
    get: (id: number): Promise<Customer> => ipcRenderer.invoke(IPC.CUSTOMER_GET, id),
    create: (input: {
      firstName: string
      lastName: string
      phone: string
      address: string
      email?: string
      loyaltyEnabled?: boolean
      notes?: string
    }) => ipcRenderer.invoke(IPC.CUSTOMER_CREATE, input),
    update: (
      id: number,
      input: {
        firstName: string
        lastName: string
        phone: string
        address: string
        email?: string
        loyaltyEnabled?: boolean
        notes?: string
      }
    ) => ipcRenderer.invoke(IPC.CUSTOMER_UPDATE, { id, input }),
    findDuplicatePhone: (phone: string, excludeId?: number): Promise<Customer | null> =>
      ipcRenderer.invoke(IPC.CUSTOMER_DUPLICATE_PHONE, { phone, excludeId }),
    addFunds: (customerId: number, amountCents: number, note?: string) =>
      ipcRenderer.invoke(IPC.CUSTOMER_ADD_FUNDS, { customerId, amountCents, note }),
    adjustCredit: (
      customerId: number,
      amountCents: number,
      note: string,
      managerGranted: boolean
    ) =>
      ipcRenderer.invoke(IPC.CUSTOMER_ADJUST_CREDIT, {
        customerId,
        amountCents,
        note,
        managerGranted
      }),
    adjustPoints: (customerId: number, points: number, note: string, managerGranted: boolean) =>
      ipcRenderer.invoke(IPC.CUSTOMER_ADJUST_POINTS, { customerId, points, note, managerGranted }),
    getCreditSettings: (): Promise<{ loyaltyPointsPerDollar: number }> =>
      ipcRenderer.invoke(IPC.CUSTOMER_GET_CREDIT_SETTINGS),
    saveCreditSettings: (input: {
      loyaltyPointsPerDollar: number
    }): Promise<{ loyaltyPointsPerDollar: number }> =>
      ipcRenderer.invoke(IPC.CUSTOMER_SAVE_CREDIT_SETTINGS, input),
    exportData: (customerId: number): Promise<{ path: string } | null> =>
      ipcRenderer.invoke(IPC.CUSTOMER_EXPORT_DATA, customerId),
    deleteData: (customerId: number): Promise<Customer> =>
      ipcRenderer.invoke(IPC.CUSTOMER_DELETE_DATA, customerId)
  },
  receipt: {
    print: (transaction: TransactionWithItems): Promise<PrintReceiptResult> =>
      ipcRenderer.invoke(IPC.RECEIPT_PRINT, transaction),
    testNetwork: (ipAddress: string, port?: number): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke(IPC.RECEIPT_TEST_NETWORK, { ipAddress, port }),
    listPrinters: (): Promise<SystemPrinterInfo[]> => ipcRenderer.invoke(IPC.RECEIPT_LIST_PRINTERS)
  },
  payment: {
    charge: (
      amountCents: number,
      orderRef: string,
      options?: ChargeOptions
    ): Promise<ChargeResult> =>
      ipcRenderer.invoke(IPC.PAYMENT_CHARGE, { amountCents, orderRef, options }),
    refund: (transactionId: string, amountCents?: number): Promise<RefundResult> =>
      ipcRenderer.invoke(IPC.PAYMENT_REFUND, { transactionId, amountCents }),
    void: (transactionId: string): Promise<VoidResult> =>
      ipcRenderer.invoke(IPC.PAYMENT_VOID, { transactionId }),
    getReaderStatus: (): Promise<ReaderStatus> => ipcRenderer.invoke(IPC.PAYMENT_GET_READER_STATUS)
  },
  catalog: {
    pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.CATALOG_PICK_FILE),
    startImport: (filePath: string): Promise<CatalogPreview> =>
      ipcRenderer.invoke(IPC.CATALOG_START_IMPORT, filePath),
    commitImport: (batchId: number, confirmations?: string[]): Promise<CatalogCommitResult> =>
      ipcRenderer.invoke(IPC.CATALOG_COMMIT_IMPORT, { batchId, confirmations }),
    discardImport: (batchId: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.CATALOG_DISCARD_IMPORT, batchId),
    rollback: (): Promise<CatalogCommitResult> => ipcRenderer.invoke(IPC.CATALOG_ROLLBACK),
    getStatus: (): Promise<CatalogStatus> => ipcRenderer.invoke(IPC.CATALOG_GET_STATUS),
    search: (
      query: string,
      province?: string | null,
      limit?: number
    ): Promise<CatalogSearchRow[]> =>
      ipcRenderer.invoke(IPC.CATALOG_SEARCH, { query, province, limit }),
    scanLookup: (barcode: string): Promise<CatalogScanResult> =>
      ipcRenderer.invoke(IPC.CATALOG_SCAN_LOOKUP, barcode),
    getDeals: (catalogProductId: number): Promise<CatalogDealRow[]> =>
      ipcRenderer.invoke(IPC.CATALOG_GET_DEALS, catalogProductId),
    promote: (
      catalogProductId: number
    ): Promise<{
      productId: number
      created: boolean
      priceCents: number
      costCents: number
      listPriceCents: number
      barcodeSkipped: boolean
      pricePinnedForZeroCost: boolean
    }> => ipcRenderer.invoke(IPC.CATALOG_PROMOTE, catalogProductId),
    promoteAll: (): Promise<PromoteAllResult> => ipcRenderer.invoke(IPC.CATALOG_PROMOTE_ALL),
    autoImport: (filePath: string): Promise<AutoImportResult> =>
      ipcRenderer.invoke(IPC.CATALOG_AUTO_IMPORT, filePath),
    getProvince: (): Promise<string> => ipcRenderer.invoke(IPC.CATALOG_GET_PROVINCE),
    setProvince: (province: string): Promise<string> =>
      ipcRenderer.invoke(IPC.CATALOG_SET_PROVINCE, province),
    /** Subscribe to streaming import progress. Returns an unsubscribe function. */
    onImportProgress: (callback: (progress: CatalogImportProgress) => void): (() => void) => {
      const listener = (_e: unknown, progress: CatalogImportProgress): void => callback(progress)
      ipcRenderer.on(IPC.CATALOG_IMPORT_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IPC.CATALOG_IMPORT_PROGRESS, listener)
    }
  },
  settings: {
    getPrinter: (): Promise<PrinterConfig> => ipcRenderer.invoke(IPC.SETTINGS_GET_PRINTER),
    savePrinter: (config: PrinterConfig): Promise<PrinterConfig> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_PRINTER, config),
    getStore: (): Promise<StoreInfo> => ipcRenderer.invoke(IPC.SETTINGS_GET_STORE),
    saveStore: (info: StoreInfo): Promise<StoreInfo> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_STORE, info),
    getPayment: (): Promise<PaymentConfigView> => ipcRenderer.invoke(IPC.SETTINGS_GET_PAYMENT),
    savePayment: (input: SavePaymentConfigInput): Promise<PaymentConfigView> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_PAYMENT, input),
    getCheckout: (): Promise<CheckoutSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET_CHECKOUT),
    saveCheckout: (input: CheckoutSettings): Promise<CheckoutSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_CHECKOUT, input),
    getIdleTimeoutMinutes: (): Promise<number> => ipcRenderer.invoke(IPC.SETTINGS_GET_IDLE_TIMEOUT),
    saveIdleTimeoutMinutes: (minutes: number): Promise<number> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_IDLE_TIMEOUT, minutes),
    getDisplayDensity: (): Promise<number> =>
      ipcRenderer.invoke(IPC.SETTINGS_GET_DISPLAY_DENSITY),
    saveDisplayDensity: (level: number): Promise<number> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_DISPLAY_DENSITY, level)
  },
  compliance: {
    searchRx: (query: string): Promise<PrescriptionRecord[]> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_SEARCH_RX, query),
    getAgingRx: (olderThanDays: number): Promise<PrescriptionRecord[]> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_GET_AGING_RX, olderThanDays),
    logEvent: (
      kind: string,
      summary: string,
      details?: Record<string, unknown>
    ): Promise<ComplianceAuditEntry> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_LOG_EVENT, { kind, summary, details }),
    getAuditLog: (): Promise<ComplianceAuditEntry[]> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_GET_AUDIT_LOG),
    exportAuditLog: (): Promise<{ path: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_EXPORT_AUDIT_LOG),
    captureSignature: (context: string): Promise<{ captured: boolean; dataUrl?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_CAPTURE_SIGNATURE, context),
    pseValidate: (
      productName: string,
      quantity: number,
      days: number
    ): Promise<{ allowed: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_PSE_VALIDATE, { productName, quantity, days }),
    dscsaScan: (barcode: string): Promise<{ ok: boolean; detail?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_DSCSA_SCAN, barcode),
    fsaHsaCheck: (productName: string): Promise<{ eligible: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_FSA_HSA_CHECK, productName)
  },
  customerLedger: {
    get: (customerId: number): Promise<CustomerLedgerEntry[]> =>
      ipcRenderer.invoke(IPC.CUSTOMER_LEDGER_GET, customerId),
    post: (
      customerId: number,
      kind: CustomerLedgerEntry['kind'],
      amountCents: number,
      reference: string,
      notes?: string
    ): Promise<CustomerLedgerEntry> =>
      ipcRenderer.invoke(IPC.CUSTOMER_LEDGER_POST, {
        customerId,
        kind,
        amountCents,
        reference,
        notes
      })
  },
  reports: {
    getDashboard: (): Promise<DashboardData> => ipcRenderer.invoke(IPC.REPORTS_GET_DASHBOARD),
    getSalesSummary: (fromDate: string, toDate: string): Promise<SalesSummary> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_SALES_SUMMARY, { fromDate, toDate }),
    getTopItems: (fromDate: string, toDate: string, limit?: number): Promise<TopItemRow[]> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_TOP_ITEMS, { fromDate, toDate, limit }),
    getSlowItems: (fromDate: string, toDate: string, threshold?: number): Promise<SlowItemRow[]> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_SLOW_ITEMS, { fromDate, toDate, threshold }),
    getDailySales: (fromDate: string, toDate: string): Promise<DailySalesRow[]> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_DAILY_SALES, { fromDate, toDate }),
    getSalesByTender: (fromDate: string, toDate: string): Promise<TenderBreakdownRow[]> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_SALES_BY_TENDER, { fromDate, toDate }),
    getCashierTotals: (fromDate: string, toDate: string): Promise<CashierTotalRow[]> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_CASHIER_TOTALS, { fromDate, toDate }),
    getInventoryValuation: (): Promise<InventoryValuation> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_INVENTORY_VALUATION),
    getCreditHealth: (): Promise<CreditHealthSummary> =>
      ipcRenderer.invoke(IPC.REPORTS_GET_CREDIT_HEALTH),
    getAlerts: (): Promise<AlertsSummary> => ipcRenderer.invoke(IPC.REPORTS_GET_ALERTS),
    exportCsv: (): Promise<{ path: string }> => ipcRenderer.invoke(IPC.REPORTS_EXPORT_CSV),
    exportXlsx: (): Promise<{ path: string }> => ipcRenderer.invoke(IPC.REPORTS_EXPORT_XLSX)
  },
  backup: {
    getExternalDrives: (): Promise<ExternalDrive[]> =>
      ipcRenderer.invoke(IPC.BACKUP_GET_EXTERNAL_DRIVES),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.BACKUP_PICK_FOLDER),
    run: (
      drivePath: string,
      driveName: string | undefined,
      initiatedByUserId: number
    ): Promise<BackupRunResult> =>
      ipcRenderer.invoke(IPC.BACKUP_RUN, { drivePath, driveName, initiatedByUserId }),
    getLast: (): Promise<BackupLogSummary | null> => ipcRenderer.invoke(IPC.BACKUP_GET_LAST),
    openFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.BACKUP_OPEN_FOLDER, path),
    getPromptOnLogout: (): Promise<boolean> => ipcRenderer.invoke(IPC.BACKUP_GET_PROMPT_ON_LOGOUT),
    savePromptOnLogout: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.BACKUP_SAVE_PROMPT_ON_LOGOUT, enabled),
    getDrivePath: (): Promise<BackupDestination | null> =>
      ipcRenderer.invoke(IPC.BACKUP_GET_DRIVE_PATH),
    saveDrivePath: (drivePath: string, driveName: string): Promise<void> =>
      ipcRenderer.invoke(IPC.BACKUP_SAVE_DRIVE_PATH, { drivePath, driveName }),
    listRestorable: (drivePath: string): Promise<RestorableBackup[]> =>
      ipcRenderer.invoke(IPC.BACKUP_LIST_RESTORABLE, drivePath),
    restore: (backupDir: string): Promise<RestoreBackupResult> =>
      ipcRenderer.invoke(IPC.BACKUP_RESTORE, { backupDir }),
    relaunch: (): Promise<void> => ipcRenderer.invoke(IPC.BACKUP_RELAUNCH)
  },
  auth: {
    checkFirstBoot: (): Promise<boolean> => ipcRenderer.invoke(IPC.AUTH_CHECK_FIRST_BOOT),
    getCurrentUser: (): Promise<AuthUser | null> => ipcRenderer.invoke(IPC.AUTH_GET_CURRENT_USER),
    login: (fullName: string, password: string): Promise<LoginResult> =>
      ipcRenderer.invoke(IPC.AUTH_LOGIN, { fullName, password }),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    setupFirstManager: (fullName: string, password: string): Promise<LoginResult> =>
      ipcRenderer.invoke(IPC.AUTH_SETUP_FIRST_MANAGER, { fullName, password }),
    verifyManager: (fullName: string, password: string): Promise<VerifyManagerResult> =>
      ipcRenderer.invoke(IPC.AUTH_VERIFY_MANAGER, { fullName, password })
  },
  user: {
    list: (): Promise<AuthUser[] | { error: string }> => ipcRenderer.invoke(IPC.USER_LIST),
    create: (input: {
      fullName: string
      password: string
      role: UserRole
    }): Promise<AuthUser | { error: string }> => ipcRenderer.invoke(IPC.USER_CREATE, input),
    update: (
      userId: number,
      role?: UserRole,
      password?: string
    ): Promise<AuthUser | { error: string }> =>
      ipcRenderer.invoke(IPC.USER_UPDATE, { userId, role, password }),
    delete: (userId: number): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC.USER_DELETE, userId)
  },
  refund: {
    searchSales: (query?: string, range?: SaleDateRange): Promise<SaleSearchResult[]> =>
      ipcRenderer.invoke(IPC.REFUND_SEARCH_SALES, {
        query,
        fromDate: range?.fromDate,
        toDate: range?.toDate
      }),
    getSaleDetails: (transactionId: string): Promise<SaleRefundDetail> =>
      ipcRenderer.invoke(IPC.REFUND_GET_SALE_DETAILS, transactionId),
    process: (payload: ProcessRefundPayload): Promise<ProcessRefundResult> =>
      ipcRenderer.invoke(IPC.REFUND_PROCESS, payload)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (see index.d.ts)
  window.api = api
}

export type PosApi = typeof api
