import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/channels'
import type {
  FeatureFlag,
  Product,
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
  DashboardSummary,
  BackupBundle
} from '../shared/types'

const api = {
  featureFlag: {
    getAll: (): Promise<FeatureFlag[]> => ipcRenderer.invoke(IPC.FEATURE_FLAG_GET_ALL),
    upsert: (key: string, enabled: boolean): Promise<FeatureFlag> =>
      ipcRenderer.invoke(IPC.FEATURE_FLAG_UPSERT, { key, enabled })
  },
  product: {
    getAll: (): Promise<Product[]> => ipcRenderer.invoke(IPC.PRODUCT_GET_ALL),
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
      ipcRenderer.invoke(IPC.PRICING_TIER_SAVE_ALL, tiers)
  },
  transaction: {
    create: (payload: CreateTransactionPayload): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_CREATE, payload),
    getAll: (): Promise<TransactionWithItems[]> => ipcRenderer.invoke(IPC.TRANSACTION_GET_ALL),
    void: (id: string, reason: string): Promise<TransactionWithItems> =>
      ipcRenderer.invoke(IPC.TRANSACTION_VOID, { id, reason })
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
  settings: {
    getPrinter: (): Promise<PrinterConfig> => ipcRenderer.invoke(IPC.SETTINGS_GET_PRINTER),
    savePrinter: (config: PrinterConfig): Promise<PrinterConfig> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_PRINTER, config),
    getStore: (): Promise<StoreInfo> => ipcRenderer.invoke(IPC.SETTINGS_GET_STORE),
    saveStore: (info: StoreInfo): Promise<StoreInfo> => ipcRenderer.invoke(IPC.SETTINGS_SAVE_STORE, info),
    getPayment: (): Promise<PaymentConfigView> => ipcRenderer.invoke(IPC.SETTINGS_GET_PAYMENT),
    savePayment: (input: SavePaymentConfigInput): Promise<PaymentConfigView> =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE_PAYMENT, input)
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
    getDashboard: (): Promise<DashboardSummary> => ipcRenderer.invoke(IPC.REPORTS_GET_DASHBOARD),
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
