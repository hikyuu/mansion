import { read, write } from '@/common/db'
import { parseSerialNumber } from '@/common/serial-number'

declare interface Archive {
  id?: number
  serial_number: string
  download_time: Date
}

export async function haveArchived(serialNumber: string): Promise<boolean> {
  const key = parseSerialNumber(serialNumber).archiveKey
  const data = await read<{ id: number }[]>((db) => db.from('archive').select('id').ilike('serial_number', `%${key}%`))
  return (data?.length ?? 0) > 0
}

export async function upsertArchive(serialNumber: string) {
  const archive: Archive = {
    serial_number: parseSerialNumber(serialNumber).archiveKey,
    download_time: new Date()
  }
  return await write((db) => db.from('archive').upsert(archive, { onConflict: 'serial_number' }))
}
