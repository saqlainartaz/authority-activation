export const ACCEPT = '.pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx';
export const MAX_BYTES = 20 * 1024 * 1024;
export type LocalDocument = { id: string; name: string; size: number; lastModified: number; addedAt: number; file: Blob };
export function fileIssue(file: Pick<File, 'name' | 'size'>): string | null {
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!ACCEPT.split(',').includes(extension)) return 'Choose a PDF, Word, text, spreadsheet, or presentation file.';
  if (!file.size) return 'This file is empty.';
  if (file.size > MAX_BYTES) return 'Files must be 20 MB or smaller.';
  return null;
}
export function fileKey(file: Pick<File, 'name' | 'size' | 'lastModified'>) { return JSON.stringify([file.name, file.size, file.lastModified]); }
export function fileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('authority-refined-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Document storage is busy. Close other preview tabs and try again.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', mode);
    const request = action(tx.objectStore('documents'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Document storage is unavailable.')); };
    tx.onerror = () => { /* The aborted transaction reports the error. */ };
  });
}
export const readDocuments = () => transaction<LocalDocument[]>('readonly', store => store.getAll());
export const saveDocument = (document: LocalDocument) => transaction('readwrite', store => store.put(document));
export const removeDocument = (id: string) => transaction('readwrite', store => store.delete(id));
