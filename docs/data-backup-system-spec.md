# Feature Spec — Data Backup System (Automated backup to external drive)

A pharmacy POS system holds critical data: years of sales history, customer information, account
balances, and transaction records. Hardware fails. Users accidentally delete data. Ransomware attacks
happen. The Data Backup System protects against all of these by automatically backing up all
operational data to an external drive on logout. This is modeled after Fillware POS's proven backup
architecture.

---

## 1. Overview

### 1.1 What gets backed up

**Included:**
- All sales (transactions, line items, tenders, discounts, refunds)
- All customers (profiles, credit ledger, loyalty points history)
- All users (names, roles, login history — NOT passwords)
- All discounts applied
- All refunds processed
- Current inventory snapshot (on-hand quantities, valuations)
- Audit trails (who did what, when)
- All operational data in the core database

**Excluded:**
- McKesson catalogue (CatalogProduct, CatalogDeal tables) — this is reference data, easily
  re-imported
- User passwords (for security)
- Temporary/cache data
- Payment processor logs (external, not owned by POS)

### 1.2 Backup format

Backups consist of two complementary formats:

1. **`backup.sqlite`** — exact copy of the operational database (SQLite binary), importable directly
2. **JSON exports** — human-readable versions of every table (sales, customers, discounts, refunds,
   users, inventory)

This dual format allows:
- **Fast recovery:** copy the SQLite file and restart the app (minutes)
- **Auditing:** open the JSON files to inspect data (seconds)
- **Selective recovery:** if needed, manually import individual JSON files for one table
- **Data validation:** checksums ensure backup integrity

### 1.3 Trigger: logout workflow

Every time a user logs out, they are prompted:

```
Ready to log out?

Before you go, would you like to back up all your pharmacy data 
to an external drive?

This backs up all sales, customers, transactions, and other 
important data. The McKesson catalogue is not included 
(it can be re-imported).

[ Yes, Back Up ]  [ No, Just Logout ]  [ Cancel ]
```

- **Yes, Back Up:** proceed to backup workflow
- **No, Just Logout:** logout immediately
- **Cancel:** return to app

---

## 2. Backup Workflow

### 2.1 Step 1: External drive detection

When "Yes, Back Up" is clicked, the system scans for connected USB/external drives:

```
Backing Up Data...

Scanning for external drives...

Found 2 drives:
☑ [USB Drive A] (512 GB, 256 GB free) - /media/usb-a
  [USB Drive B] (256 GB, 128 GB free) - /media/usb-b

Select destination, or [ Browse... ] for other drives

[ Back Up to Selected ]  [ Cancel ]
```

**Platform-specific detection:**

**macOS:**
- Scan `/Volumes` directory
- Exclude system drives (Macintosh HD, etc.)
- Show human-readable volume names

**Windows:**
- Check drives D-Z (assume C is system)
- Show drive letter, capacity, free space
- Identify removable drives (USB)

**Linux:**
- Scan `/media` and `/mnt` mount points
- Show mount paths and free space

**Auto-selection:** if only one external drive is detected, auto-select it but still require user
confirmation before proceeding.

**Manual selection:** "Browse..." button opens native file dialog to select any folder (useful if
the external drive isn't auto-detected).

### 2.2 Step 2: Create backup directory

On the selected drive, create a timestamped backup folder (prevents overwrites):

```
/media/usb-drive/PHARMACY_POS_BACKUP_2026-07-30_14-23-45/
```

Format: `PHARMACY_POS_BACKUP_YYYY-MM-DD_HH-mm-ss`

This keeps backups chronologically organized and prevents file collisions when multiple backups are
made to the same drive.

### 2.3 Step 3: Export data

Eight files are exported to the backup directory:

1. **`backup.sqlite`** — database copy
2. **`backup-metadata.json`** — backup info
3. **`sales.json`** — all sales
4. **`customers.json`** — all customers + ledger
5. **`users.json`** — user list (no passwords)
6. **`discounts.json`** — all discounts
7. **`refunds.json`** — all refunds
8. **`inventory-snapshot.json`** — current stock levels

See §3 for detailed file formats.

**Progress indicator:** during export, show a simple progress bar or step count:

```
Backing up data...

○ Creating backup folder
○ Exporting database
◐ Exporting sales (2,847 records)
  ...
```

### 2.4 Step 4: Verify backup

After all files are written, compute SHA-256 checksums and verify:

- File exists and is readable
- File size is non-zero
- Checksum matches re-computed value

If any file fails verification, the entire backup is marked as failed.

### 2.5 Step 5: Success or error screen

**On success:**

```
✓ Backup Complete

Data backed up successfully

Backup location:
/media/usb-drive/PHARMACY_POS_BACKUP_2026-07-30_14-23-45

Files backed up:
• backup.sqlite (12.3 MB)
• sales.json (2.1 MB)
• customers.json (456 KB)
• users.json (12 KB)
• discounts.json (234 KB)
• refunds.json (567 KB)
• inventory-snapshot.json (890 KB)
• backup-metadata.json (5 KB)

Total backup size: 15.8 MB

[ Logout ]
```

- Show backup location
- List all files with sizes
- Show total backup size
- One button: "Logout" (completes the logout process)

**On error:**

```
✗ Backup Failed

Error: External drive not accessible
(The drive may have been disconnected or is no longer writable)

[ Retry ]  [ Choose Different Drive ]  [ Skip Backup ]

(You can manually back up data later from Settings)
```

Options:
- **Retry:** attempt the backup again
- **Choose Different Drive:** go back to drive selection
- **Skip Backup:** logout without backup (with a warning shown)

---

## 3. Backup File Formats

### 3.1 `backup.sqlite`

A complete copy of the operational SQLite database (excluding catalogue tables).

**Method:**
```javascript
// Node.js main process
const fs = require('fs');
const path = require('path');

const sourceDb = path.join(
  app.getPath('userData'),
  'prisma',
  'dev.db'
);
const targetDb = path.join(backupDir, 'backup.sqlite');

fs.copyFileSync(sourceDb, targetDb);
```

**Why copy, not export?** SQLite's binary format is optimized for recovery. A full database copy is
smaller and faster to restore than a SQL dump.

**Excluded tables:** when the backup is restored, the McKesson catalogue tables should be empty
(catalogue is re-imported separately). You can either:
- Copy the entire file and accept that the catalogue is also backed up (adds ~26 MB)
- Use SQLite's `VACUUM INTO` to create a backup copy without the catalogue tables (complex,
  requires traversing table definitions)

**MVP recommendation:** include the entire database (simpler). The ~26 MB catalogue is not a huge
cost if backups are only done on logout (a few times per week).

### 3.2 `backup-metadata.json`

Backup information for auditing, recovery, and data validation:

```json
{
  "timestamp": "2026-07-30T14:23:45.123Z",
  "backupVersion": "1.0",
  "posVersion": "1.0.0",
  "databaseVersion": 5,
  "backupInitiatedBy": "Alice Chen",
  "backupInitiatedByUserId": 1,
  "backupLocation": "/media/usb-drive/PHARMACY_POS_BACKUP_2026-07-30_14-23-45",
  "backupHost": "pharmacy-checkout-register-01",
  "backupPharmacyName": "Main Street Pharmacy",
  "dataSnapshot": {
    "salesCount": 2847,
    "customersCount": 412,
    "usersCount": 3,
    "productsCount": 1788,
    "discountsCount": 1247,
    "refundsCount": 98,
    "creditLedgerEntriesCount": 5421,
    "loyaltyPointEventsCount": 3284,
    "inventoryValueCostCents": 2293080,
    "inventoryValueRetailCents": 4843100
  },
  "filesIncluded": [
    "backup.sqlite",
    "backup-metadata.json",
    "sales.json",
    "customers.json",
    "users.json",
    "discounts.json",
    "refunds.json",
    "inventory-snapshot.json"
  ],
  "checksums": {
    "backup.sqlite": "sha256:a1b2c3d4e5f6...",
    "sales.json": "sha256:f6e5d4c3b2a1...",
    "customers.json": "sha256:9z8y7x6w5v4u...",
    "users.json": "sha256:u4v5w6x7y8z9...",
    "discounts.json": "sha256:1a2b3c4d5e6f...",
    "refunds.json": "sha256:f6e5d4c3b2a1...",
    "inventory-snapshot.json": "sha256:9z8y7x6w5v4u..."
  },
  "backupDurationSeconds": 42,
  "backupSizeBytes": 15847362,
  "verificationStatus": "SUCCESS"
}
```

Used to:
- Verify backup integrity (checksums)
- Audit who initiated backups and when
- Count data during recovery (confirm no data loss)
- Document backup metadata for support

### 3.3 `sales.json`

All completed sales in human-readable JSON:

```json
{
  "exportTimestamp": "2026-07-30T14:23:45Z",
  "totalRecords": 2847,
  "sales": [
    {
      "id": 2847,
      "saleNumber": 2847,
      "createdAt": "2026-07-30T14:23:00Z",
      "customerId": 412,
      "customerName": "Alice Chen",
      "customerPhone": "416-555-0123",
      "cashierId": 1,
      "cashierName": "Bob Kim",
      "totalCents": 4750,
      "subtotalCents": 4133,
      "taxCents": 617,
      "taxRate": 13,
      "itemDiscountCents": 0,
      "billDiscountCents": 0,
      "voidedAt": null,
      "voidedByUserId": null,
      "voidedByName": null,
      "voidReason": null,
      "lineItems": [
        {
          "lineItemId": 1,
          "productId": 1,
          "productName": "Cough drops",
          "productCategory": "OTC",
          "quantity": 2,
          "unitCostCents": 50,
          "unitRetailCents": 312,
          "lineTotalCents": 624,
          "lineDiscountCents": 0,
          "discountReason": null
        },
        {
          "lineItemId": 2,
          "productId": 42,
          "productName": "Tylenol 500mg",
          "productCategory": "OTC",
          "quantity": 1,
          "unitCostCents": 210,
          "unitRetailCents": 372,
          "lineTotalCents": 372,
          "lineDiscountCents": 0,
          "discountReason": null
        }
      ],
      "tenders": [
        {
          "tenderId": 1,
          "type": "CARD",
          "amountCents": 4750,
          "cardType": "CREDIT",
          "cardLastFour": "4242",
          "transactionId": "stripe_12345"
        }
      ],
      "tabAmountCents": 0,
      "loyaltyPointsEarned": 47,
      "loyaltyPointsRedeemed": 0,
      "notes": null
    },
    ... more sales
  ]
}
```

Auditable by hand; useful for investigating specific transactions.

### 3.4 `customers.json`

All customers with their full history:

```json
{
  "exportTimestamp": "2026-07-30T14:23:45Z",
  "totalRecords": 412,
  "customers": [
    {
      "id": 412,
      "firstName": "Alice",
      "lastName": "Chen",
      "phone": "416-555-0123",
      "phoneNormalized": "4165550123",
      "address": "123 Main St, Toronto, ON M5V 3A8",
      "email": "alice@example.com",
      "createdAt": "2026-07-15T10:00:00Z",
      "createdByUserId": 1,
      "createdByName": "Manager Name",
      "creditLimitCents": 50000,
      "loyaltyEnabled": true,
      "currentBalance": {
        "creditCents": 1250,
        "loyaltyPoints": 450
      },
      "creditLedger": [
        {
          "entryId": 5000,
          "type": "FUNDS_ADDED",
          "amountCents": 5000,
          "balanceAfterCents": 5000,
          "createdAt": "2026-07-15T10:05:00Z",
          "note": "Customer prepaid"
        },
        {
          "entryId": 5001,
          "type": "SALE_CHARGE",
          "amountCents": -3750,
          "balanceAfterCents": 1250,
          "saleId": 2847,
          "saleDate": "2026-07-30T14:20:00Z",
          "createdAt": "2026-07-30T14:20:00Z"
        }
      ],
      "loyaltyHistory": [
        {
          "eventId": 1000,
          "type": "EARNED",
          "points": 47,
          "pointsAfter": 450,
          "saleId": 2847,
          "saleDate": "2026-07-30T14:20:00Z",
          "createdAt": "2026-07-30T14:20:00Z"
        }
      ],
      "purchaseHistory": [
        {
          "saleId": 2847,
          "saleDate": "2026-07-30T14:20:00Z",
          "totalCents": 4750
        }
      ]
    },
    ... more customers
  ]
}
```

Preserves full ledger history for each customer (useful for customer service disputes).

### 3.5 `users.json`

User list (names, roles, audit info — NO passwords):

```json
{
  "exportTimestamp": "2026-07-30T14:23:45Z",
  "totalRecords": 3,
  "users": [
    {
      "id": 1,
      "fullName": "Alice Chen",
      "role": "MANAGER",
      "isActive": true,
      "createdAt": "2026-07-15T09:00:00Z",
      "lastLoginAt": "2026-07-30T08:00:00Z"
    },
    {
      "id": 2,
      "fullName": "Bob Kim",
      "role": "CASHIER",
      "isActive": true,
      "createdAt": "2026-07-20T10:00:00Z",
      "lastLoginAt": "2026-07-30T14:15:00Z"
    },
    {
      "id": 3,
      "fullName": "Carol Rodriguez",
      "role": "CASHIER",
      "isActive": false,
      "createdAt": "2026-07-22T09:30:00Z",
      "lastLoginAt": "2026-07-28T16:45:00Z"
    }
  ]
}
```

User passwords are intentionally NOT included (security).

### 3.6 `discounts.json`

All discounts applied (audit trail):

```json
{
  "exportTimestamp": "2026-07-30T14:23:45Z",
  "totalRecords": 1247,
  "discounts": [
    {
      "id": 1,
      "saleId": 2847,
      "saleDate": "2026-07-30T14:23:00Z",
      "type": "ITEM",
      "productId": 1,
      "productName": "Cough drops",
      "amountCents": 62,
      "amountPercent": 10.0,
      "originalPriceCents": 624,
      "discountedPriceCents": 562,
      "reason": "Staff discount",
      "appliedByUserId": 1,
      "appliedByName": "Alice Chen",
      "createdAt": "2026-07-30T14:23:00Z"
    },
    {
      "id": 2,
      "saleId": 2847,
      "saleDate": "2026-07-30T14:23:00Z",
      "type": "BILL",
      "amountCents": 100,
      "amountPercent": 2.0,
      "originalTotalCents": 5000,
      "discountedTotalCents": 4900,
      "reason": "Loyalty customer",
      "appliedByUserId": 1,
      "appliedByName": "Alice Chen",
      "createdAt": "2026-07-30T14:23:00Z"
    }
  ]
}
```

Tracks every discount with who applied it and why (audit trail for disputes).

### 3.7 `refunds.json`

All refunds processed:

```json
{
  "exportTimestamp": "2026-07-30T14:23:45Z",
  "totalRecords": 98,
  "refunds": [
    {
      "id": 1,
      "saleId": 2846,
      "saleDate": "2026-07-30T13:00:00Z",
      "originalTotalCents": 1230,
      "type": "CASH",
      "amountCents": 1230,
      "reason": "Customer requested",
      "refundedByUserId": 1,
      "refundedByName": "Alice Chen",
      "status": "COMPLETED",
      "processedAt": "2026-07-30T13:45:00Z",
      "createdAt": "2026-07-30T13:45:00Z"
    },
    {
      "id": 2,
      "saleId": 2845,
      "saleDate": "2026-07-30T12:00:00Z",
      "originalTotalCents": 8999,
      "type": "CARD",
      "amountCents": 8999,
      "reason": "Defective product",
      "refundedByUserId": 1,
      "refundedByName": "Alice Chen",
      "status": "COMPLETED",
      "cardLastFour": "4242",
      "processorRefundId": "stripe_refund_12345",
      "processedAt": "2026-07-30T14:00:00Z",
      "createdAt": "2026-07-30T14:00:00Z"
    },
    {
      "id": 3,
      "saleId": 2844,
      "saleDate": "2026-07-30T11:00:00Z",
      "originalTotalCents": 5000,
      "type": "TAB_CREDIT",
      "amountCents": 5000,
      "reason": "Refund to customer's tab",
      "refundedByUserId": 1,
      "refundedByName": "Alice Chen",
      "status": "COMPLETED",
      "customerId": 412,
      "customerName": "Alice Chen",
      "creditLedgerEntryId": 5002,
      "processedAt": "2026-07-30T14:05:00Z",
      "createdAt": "2026-07-30T14:05:00Z"
    }
  ]
}
```

Full refund audit trail (who, what, why, when).

### 3.8 `inventory-snapshot.json`

Current on-hand quantities and valuations (point-in-time snapshot):

```json
{
  "snapshotTimestamp": "2026-07-30T14:23:45Z",
  "totalProducts": 1788,
  "products": [
    {
      "id": 1,
      "name": "Cough drops",
      "category": "OTC",
      "sku": "CD-001",
      "onHandQuantity": 156,
      "costCents": 50,
      "retailCents": 312,
      "costValueCents": 7800,
      "retailValueCents": 48672,
      "reorderPoint": 50,
      "reorderQuantity": 100,
      "lastRestockDate": "2026-07-28T10:00:00Z",
      "lastSaleDate": "2026-07-30T14:00:00Z",
      "source": "CATALOG",
      "catalogItemNumber": "000027"
    },
    {
      "id": 2,
      "name": "Tylenol 500mg",
      "category": "OTC",
      "sku": "TYL-500",
      "onHandQuantity": 89,
      "costCents": 210,
      "retailCents": 372,
      "costValueCents": 18690,
      "retailValueCents": 33108,
      "reorderPoint": 30,
      "reorderQuantity": 50,
      "lastRestockDate": "2026-07-27T14:00:00Z",
      "lastSaleDate": "2026-07-30T14:10:00Z",
      "source": "MANUAL",
      "catalogItemNumber": null
    }
  ],
  "totals": {
    "totalItemsCounted": 1788,
    "totalUnitsOnHand": 12547,
    "totalInventoryValueCostCents": 2293080,
    "totalInventoryValueRetailCents": 4843100,
    "totalMarginCents": 2549020,
    "marginPercentage": 52.7
  }
}
```

Snapshot of inventory at backup time (useful for comparing against physical counts).

---

## 4. Verification and Checksums

### 4.1 SHA-256 checksum computation

After each file is written, compute a SHA-256 hash:

```javascript
const crypto = require('crypto');
const fs = require('fs');

async function computeChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// For each backup file:
const checksums = {};
for (const file of backupFiles) {
  const filePath = path.join(backupDir, file);
  checksums[file] = `sha256:${await computeChecksum(filePath)}`;
}

// Store in metadata
metadata.checksums = checksums;
```

### 4.2 Verification steps

After computing checksums, verify:

1. **File exists:** re-check that the file is still there
2. **File size > 0:** ensure the file is not empty
3. **Checksum matches:** re-compute the checksum and compare (should be identical)

If ANY file fails verification, mark the entire backup as FAILED and show an error.

---

## 5. External Drive Detection

### 5.1 Platform-specific detection

**macOS:**
```javascript
const fs = require('fs');

function getExternalDrivesMacOS() {
  const volumesPath = '/Volumes';
  if (!fs.existsSync(volumesPath)) return [];
  
  const volumes = fs.readdirSync(volumesPath).map(name => ({
    name,
    path: `${volumesPath}/${name}`,
    type: 'EXTERNAL'
  })).filter(v => v.name !== 'Macintosh HD'); // Exclude system drive
  
  return volumes;
}
```

**Windows:**
```javascript
const fs = require('fs');

function getExternalDrivesWindows() {
  const drives = [];
  for (let i = 68; i < 90; i++) { // D-Z
    const drive = String.fromCharCode(i) + ':';
    if (fs.existsSync(drive)) {
      drives.push({
        name: drive,
        path: drive,
        type: 'EXTERNAL'
      });
    }
  }
  return drives;
}
```

**Linux:**
```javascript
const fs = require('fs');
const path = require('path');

function getExternalDrivesLinux() {
  const drives = [];
  const dirs = ['/media', '/mnt'];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    
    fs.readdirSync(dir).forEach(name => {
      drives.push({
        name,
        path: path.join(dir, name),
        type: 'EXTERNAL'
      });
    });
  }
  return drives;
}
```

### 5.2 Drive capacity detection

Get free/used/total space:

```javascript
const fs = require('fs');

function getDriveCapacity(drivePath) {
  try {
    const stats = fs.statfsSync(drivePath);
    const blockSize = stats.bsize;
    return {
      totalBytes: stats.blocks * blockSize,
      freeBytes: stats.bavail * blockSize,
      usedBytes: (stats.blocks - stats.bavail) * blockSize,
      percentUsed: Math.round(((stats.blocks - stats.bavail) / stats.blocks) * 100)
    };
  } catch (error) {
    return null; // Drive not accessible
  }
}
```

Use this to:
- Show capacity in the UI
- Warn if drive is nearly full (>90%)
- Estimate space needed for backup

---

## 6. Data Model

### 6.1 Prisma schema

```prisma
model BackupLog {
  id                 Int      @id @default(autoincrement())
  timestamp          DateTime @default(now())
  backupPath         String   // e.g. /media/usb-drive/PHARMACY_POS_BACKUP_2026-07-30_14-23-45
  driveName          String   // e.g. "USB Drive", "D:", "/media/usb"
  drivePath          String   // mount path
  backupSizeBytes    Int      // total size of backup directory
  backupDurationSeconds Int   // how long the backup took
  dataSnapshot       Json     // contents of backup-metadata.json (preserved for historical record)
  initiatedByUserId  Int
  initiatedBy        User     @relation(fields: [initiatedByUserId], references: [id])
  status             BackupStatus
  errorMessage       String?
  verificationStatus String?  // "SUCCESS", "FAILED", or null
  createdAt          DateTime @default(now())

  @@index([initiatedByUserId])
  @@index([timestamp])
  @@index([status])
}

enum BackupStatus {
  SUCCESS
  FAILED
  PARTIAL
}
```

Every backup (successful or failed) is logged. This allows:
- Audit trail (who backed up, when, where)
- Failure analysis (what went wrong)
- Restore guidance (which backup to use)

---

## 7. IPC Handlers (Main Process)

Handlers to be implemented in `src/main/handlers/backup.ts`:

```typescript
ipcMain.handle('backup:getExternalDrives', async () => {
  // Return list of detected external drives with capacities
  // { name, path, totalBytes, freeBytes, percentUsed }
  return await getExternalDrives();
});

ipcMain.handle('backup:validateDrivePath', async (_, drivePath) => {
  // Check if drive is still accessible and has enough space
  return {
    accessible: fs.existsSync(drivePath),
    freeBytes: getDriveCapacity(drivePath)?.freeBytes || 0,
    error: null
  };
});

ipcMain.handle('backup:startBackup', async (event, selectedDrivePath, userId) => {
  try {
    const result = await performBackup(selectedDrivePath, userId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('backup:getBackupHistory', async () => {
  // Return last 10 backups from BackupLog table
  const logs = await prisma.backupLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 10
  });
  return logs;
});
```

---

## 8. Backup Management (Settings Screen)

Add a "Data Backup" section to Settings (manager-only):

```
Settings — Data Backup

Last backup: 2026-07-30 at 14:23 (41 seconds, 15.8 MB)
Location: /media/usb-drive/PHARMACY_POS_BACKUP_2026-07-30_14-23-45
Status: ✓ Success

[ Manual Backup Now ]  [ Browse Previous Backups ]  [ Backup History ]

Backup settings:
☑ Prompt to back up on logout (recommended)
☐ Auto-backup daily at 18:00 (phase 2)

Recent backups:
2026-07-30 14:23 — Success — /media/usb-a/... — 15.8 MB
2026-07-29 16:45 — Success — /media/usb-b/... — 15.7 MB
2026-07-28 09:12 — Failed  — /media/usb-a/... — Error: drive disconnected
```

**Manual Backup Now:** trigger backup workflow immediately (same as logout prompt).

**Browse Previous Backups:** opens file dialog to browse backup folders on external drive.

**Backup History:** table showing last 10 backups with status, location, size.

### 8.1 Retention policy

Backups are retained for **30 days from their own timestamp**, independent of how many other
backups exist at that destination. A backup folder is **never** deleted just because a newer
backup was created — only once it is more than 30 days old.

- After each successful backup, the workflow sweeps the destination for
  `PHARMACY_POS_BACKUP_*` folders whose `backup-metadata.json` timestamp (or, if unreadable, the
  folder's own filesystem timestamp) is older than 30 days, and deletes those folders.
- Retention is scoped **per destination** — an external drive's backups age out on their own
  30-day clock, and a cloud destination's backups age out on their own clock; deleting an expired
  backup at one destination never affects another destination.
- Deleting a folder never deletes its `BackupLog` row. The row's `status` is instead set to
  `EXPIRED_AND_DELETED`, preserving the audit trail (a backup existed on this date, here's its
  metadata) even after the disk space is reclaimed.
- The sweep only ever deletes a folder it can positively confirm is 30+ days old at a destination
  it can currently see. If a destination is unreachable (drive unmounted, swapped, etc.), nothing
  at that destination is touched or assumed deleted.

---

## 9. Implementation Order

1. **Prisma schema + migration** (BackupLog model)
2. **External drive detection** (main process, platform-specific)
3. **IPC handlers** for drive detection and validation
4. **Export functions** (database copy, JSON exports for each data type)
5. **Checksum computation** and verification
6. **Main backup function** (orchestrates steps 1–5)
7. **Backup UI** (drive selection modal, progress indicator, success/error screens)
8. **Logout integration** (add backup prompt to logout flow)
9. **Backup Management screen** in Settings
10. **Manual Backup Now** button functionality
11. **Backup History** table in Settings
12. **Test** end-to-end on all platforms

---

## 10. Non-Negotiables

- **No catalogue in backup:** CatalogProduct and CatalogDeal are excluded
- **Timestamped directories:** each backup in its own folder prevents overwrites
- **Checksums:** every file is checksummed and verified
- **JSON + SQLite:** human-readable + binary for flexibility
- **Audit trail:** BackupLog tracks who, when, what, status
- **Error handling:** failed backups don't crash logout
- **External drive only:** backups don't go to internal storage
- **Integer cents:** all money in backups is in cents, not floats
- **Metadata file:** every backup includes a metadata file with data counts and checksums
- **No passwords:** user JSON excludes password hashes

---

## 11. Testing Checklist

- [ ] External drive detection works (single and multiple drives)
- [ ] Drive capacity is displayed correctly
- [ ] Backup directory is created with correct timestamp format
- [ ] All 8 backup files are created
- [ ] Files have correct structure (JSON valid, SQLite readable)
- [ ] Checksums are computed and match re-computed values
- [ ] Backup completes and shows success screen
- [ ] Backup fails gracefully if drive is disconnected mid-backup
- [ ] Backup fails gracefully if drive is full
- [ ] Retry and Choose Different Drive options work
- [ ] Skip Backup option works (logout without backup)
- [ ] Manual backup from Settings works
- [ ] BackupLog table records every backup
- [ ] Backup history is displayed in Settings
- [ ] Previous backups can be browsed
- [ ] Backup metadata contains accurate data counts
- [ ] JSON exports are valid and parseable
- [ ] Inventory snapshot totals match database
- [ ] Customer ledger in backup is current
- [ ] Sales include all tenders and line items
- [ ] Audit trail (discounts, refunds, users) is complete

---

## 12. Future Enhancements (Phase 2+)

- **Automated restore UI:** select a backup, restore with one click
- **Encrypted backups:** option to encrypt backups with a password
- **Cloud backups:** support uploading to cloud storage (AWS S3, etc.)
- **Incremental backups:** only backup changes since last backup (reduces size)
- **Backup validation:** before and after backup, run data integrity checks
- **Scheduled backups:** automatic backup at a configured time (daily, weekly)
- **Multi-destination:** backup to multiple drives simultaneously
- **Backup compression:** gzip JSON files to reduce size

---

## 13. Success Criteria

- On logout, user is prompted to back up (default: yes)
- Backup completes successfully to external drive in <2 minutes (typical)
- All 8 files are present with correct content
- Checksums verify integrity
- Backup metadata is accurate (data counts, timestamps, checksums)
- BackupLog is populated with every backup
- Managers can manually trigger backup from Settings
- Backup history is visible and searchable
- Error handling is robust (no crashes, clear messages)
- Backups can be used to restore the system (manual process, documented)
