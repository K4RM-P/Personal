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
  BackupBundle,
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
  CheckoutSettings
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
    create: (data: { sku: string; name: string; costCents: number; priceCents?: number; barcode?: string; isPinned?: boolean }): Promise<Product> =>
      ipcRenderer.invoke(IPC.PRODUCT_CREATE, data),
    update: (id: number, data: { sku?: string; name?: string; costCents?: number; priceCents?: number; barcode?: string; isPinned?: boolean }): Promise<Product> =>
      ipcRenderer.invoke(IPC.PRODUCT_UPDATE, { id, data }),
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
    getAll: (): Promise<TransactionWithItems[]> => ipcRenderer.invoke(IPC.TRANSACTION_GET_ALL),
    void: (id: string, reason: string): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_VOID, { id, reason })
  },
  customer: {
    search: (query: string): Promise<Customer[]> => ipcRenderer.invoke(IPC.CUSTOMER_SEARCH, query),
    get: (id: number): Promise<Customer> => ipcRenderer.invoke(IPC.CUSTOMER_GET, id),
    create: (input: { firstName: string; lastName: string; phone: string; address: string; email?: string; loyaltyEnabled?: boolean; notes?: string }) => ipcRenderer.invoke(IPC.CUSTOMER_CREATE, input),
    update: (id: number, input: { firstName: string; lastName: string; phone: string; address: string; email?: string; loyaltyEnabled?: boolean; notes?: string }) => ipcRenderer.invoke(IPC.CUSTOMER_UPDATE, { id, input }),
    findDuplicatePhone: (phone: string, excludeId?: number): Promise<Customer | null> => ipcRenderer.invoke(IPC.CUSTOMER_DUPLICATE_PHONE, { phone, excludeId }),
    addFunds: (customerId: number, amountCents: number, note?: string) => ipcRenderer.invoke(IPC.CUSTOMER_ADD_FUNDS, { customerId, amountCents, note }),
    adjustCredit: (customerId: number, amountCents: number, note: string, managerGranted: boolean) => ipcRenderer.invoke(IPC.CUSTOMER_ADJUST_CREDIT, { customerId, amountCents, note, managerGranted }),
    adjustPoints: (customerId: number, points: number, note: string, managerGranted: boolean) => ipcRenderer.invoke(IPC.CUSTOMER_ADJUST_POINTS, { customerId, points, note, managerGranted }),
    getCreditSettings: (): Promise<{ loyaltyPointsPerDollar: number }> => ipcRenderer.invoke(IPC.CUSTOMER_GET_CREDIT_SETTINGS),
    saveCreditSettings: (input: { loyaltyPointsPerDollar: number }): Promise<{ loyaltyPointsPerDollar: number }> => ipcRenderer.invoke(IPC.CUSTOMER_SAVE_CREDIT_SETTINGS, input)
  },
  receipt: {
    print: (transaction: TransactionWithItems): Promise<PrintReceiptResult> =>
      ipcRenderer.invoke(IPC.RECEIPT_PRINT, transaction),
    testNetwork: (ipAddress: string, port?: number): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke(IPC.RECEIPT_TEST_NETWORK, { ipAddress, port })
  },
  payment: {
    charge: (amountCents: number, orderRef: string, options?: ChargeOptions): Promise<ChargeResult> =>
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
    search: (query: string, province?: string | null, limit?: number): Promise<CatalogSearchRow[]> =>
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
    saveStore: (info: StoreInfo): Promise<StoreInfo> => ipcRenderer.invoke(IPC.SETTINGS_SAVE_STORE, info),
    getPayment: (): Promise<PaymentConfigView> => ipcRenderer.invoke(IPC.SETTINGS_GET_PAYMENT),
    savePayment: (input: SavePaymentConfigInput): Promise<PaymentConfigView> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_PAYMENT, input),
    getCheckout: (): Promise<CheckoutSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET_CHECKOUT),
    saveCheckout: (input: CheckoutSettings): Promise<CheckoutSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_CHECKOUT, input)
  },
  compliance: {
    searchRx: (query: string): Promise<PrescriptionRecord[]> => ipcRenderer.invoke(IPC.COMPLIANCE_SEARCH_RX, query),
    getAgingRx: (olderThanDays: number): Promise<PrescriptionRecord[]> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_GET_AGING_RX, olderThanDays),
    logEvent: (kind: string, summary: string, details?: Record<string, unknown>): Promise<ComplianceAuditEntry> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_LOG_EVENT, { kind, summary, details }),
    getAuditLog: (): Promise<ComplianceAuditEntry[]> => ipcRenderer.invoke(IPC.COMPLIANCE_GET_AUDIT_LOG),
    exportAuditLog: (): Promise<{ path: string }> => ipcRenderer.invoke(IPC.COMPLIANCE_EXPORT_AUDIT_LOG),
    captureSignature: (context: string): Promise<{ captured: boolean; dataUrl?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_CAPTURE_SIGNATURE, context),
    pseValidate: (productName: string, quantity: number, days: number): Promise<{ allowed: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_PSE_VALIDATE, { productName, quantity, days }),
    dscsaScan: (barcode: string): Promise<{ ok: boolean; detail?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_DSCSA_SCAN, barcode),
    fsaHsaCheck: (productName: string): Promise<{ eligible: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC.COMPLIANCE_FSA_HSA_CHECK, productName)
  },
  customerLedger: {
    get: (customerId: number): Promise<CustomerLedgerEntry[]> => ipcRenderer.invoke(IPC.CUSTOMER_LEDGER_GET, customerId),
    post: (customerId: number, kind: CustomerLedgerEntry['kind'], amountCents: number, reference: string, notes?: string): Promise<CustomerLedgerEntry> =>
      ipcRenderer.invoke(IPC.CUSTOMER_LEDGER_POST, { customerId, kind, amountCents, reference, notes })
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
    create: (): Promise<BackupBundle> => ipcRenderer.invoke(IPC.BACKUP_CREATE),
    restoreTest: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.BACKUP_RESTORE_TEST)
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