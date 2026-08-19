import { describe, it, expect } from 'vitest'
import { pickBackupsToDelete } from '../main/backup/googleDrive'

describe('pickBackupsToDelete', () => {
  const now = new Date('2026-08-19T00:00:00Z')

  it('selects folders older than 30 days', () => {
    const folders = [
      { name: 'PHARMACY_POS_BACKUP_old', createdTime: '2026-07-01T00:00:00Z' }, // 49 days old
      { name: 'PHARMACY_POS_BACKUP_recent', createdTime: '2026-08-15T00:00:00Z' } // 4 days old
    ]
    expect(pickBackupsToDelete(folders, now)).toEqual(['PHARMACY_POS_BACKUP_old'])
  })

  it('never selects a folder with an unparseable createdTime', () => {
    const folders = [{ name: 'PHARMACY_POS_BACKUP_weird', createdTime: 'not-a-date' }]
    expect(pickBackupsToDelete(folders, now)).toEqual([])
  })

  it('returns nothing when all folders are recent', () => {
    const folders = [{ name: 'PHARMACY_POS_BACKUP_new', createdTime: '2026-08-18T00:00:00Z' }]
    expect(pickBackupsToDelete(folders, now)).toEqual([])
  })
})
