/**
 * 章节正文的本机离线存储（IndexedDB）。
 *
 * 和服务端的 `reader_chapter_cache` 是**两层不同的东西**，各管各的：
 *
 * - 服务端那层没有 `user_id`、全局共享，作用是不要对同一个书源站点重复抓取。
 *   书源很脆弱（实测 100 个源只有 21 个能跑通），重复抓是在加速被封。
 * - 这一层是**设备私有**的，作用是真离线 —— 地铁里连不上自己的服务器，服务端
 *   缓存再全也没用。换一台设备就是重新下载，书架上照实显示本机有多少章。
 *
 * 为什么是 IndexedDB 而不是 `localStorage`：后者配额 5–10MB，一本两千章的书就
 * 超了，而且它是同步 API，写大段正文会卡住主线程。
 *
 * 所有函数在 IndexedDB 不可用时（隐私模式、老浏览器）都**静默降级**成「没有缓存」
 * 而不是抛错 —— 离线是锦上添花，不该让在线阅读也跟着挂掉。
 */

import type { ChapterContent } from "../api/types";

const DB_NAME = "funread";
const DB_VERSION = 1;
const STORE = "chapters";
const BOOK_INDEX = "by_book";

export interface CachedChapter extends ChapterContent {
  /** `${book_key}:${chapter_index}`，主键。 */
  key: string;
  book_key: string;
  chapter_index: number;
  saved_at: number;
}

function chapterKey(bookKey: string, index: number): string {
  return `${bookKey}:${index}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      //  隐私模式下 open 本身就可能抛
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        //  按书查「有哪些章」和整本删除都靠这个索引，不然只能全表扫
        store.createIndex(BOOK_INDEX, "book_key", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T>;
        try {
          request = action(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          resolve(null);
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

/** 这台设备上有没有存过这一章。没有返回 `null`。 */
export async function readChapter(
  bookKey: string,
  index: number,
): Promise<CachedChapter | null> {
  const row = await runTransaction<CachedChapter>("readonly", (store) =>
    store.get(chapterKey(bookKey, index)),
  );
  return row ?? null;
}

/** 存一章。配额满了就当没存上 —— 调用方不用管，下次还会从服务端取。 */
export async function writeChapter(
  bookKey: string,
  index: number,
  content: ChapterContent,
): Promise<void> {
  await runTransaction("readwrite", (store) =>
    store.put({
      ...content,
      key: chapterKey(bookKey, index),
      book_key: bookKey,
      chapter_index: index,
      saved_at: Date.now(),
    } satisfies CachedChapter),
  );
}

/** 本机存了这本书的哪几章，升序。 */
export async function cachedIndexes(bookKey: string): Promise<number[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise<number[]>((resolve) => {
    const out: number[] = [];
    let request: IDBRequest;
    try {
      //  只取 key 不取正文：一本书的正文有十几 MB，列个目录没必要全读出来
      request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .index(BOOK_INDEX)
        .openKeyCursor(IDBKeyRange.only(bookKey));
    } catch {
      resolve([]);
      return;
    }
    request.onsuccess = () => {
      const cursor = request.result as IDBCursor | null;
      if (!cursor) {
        out.sort((a, b) => a - b);
        resolve(out);
        return;
      }
      const primary = String(cursor.primaryKey);
      const index = Number(primary.slice(primary.lastIndexOf(":") + 1));
      if (Number.isFinite(index)) out.push(index);
      cursor.continue();
    };
    request.onerror = () => resolve([]);
  });
}

/** 删掉这本书在本机的全部章节。 */
export async function clearBook(bookKey: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STORE, "readwrite");
    } catch {
      resolve();
      return;
    }
    //  游标和删除必须在**同一个** transaction 里：IndexedDB 不保证两个
    //  transaction 的先后，分开写的话游标还没走完、删除那个可能已经提交了。
    const store = transaction.objectStore(STORE);
    const request = store.index(BOOK_INDEX).openKeyCursor(IDBKeyRange.only(bookKey));
    request.onsuccess = () => {
      const cursor = request.result as IDBCursor | null;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    //  等整个 transaction 落定再算完成，而不是游标走到头就算 —— 删除是异步的
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}
