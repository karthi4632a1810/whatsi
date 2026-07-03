const DB_NAME = "mapims-his";
const DB_VERSION = 1;
export const HIS_CACHE_STALE_MS = 5 * 60 * 1000;

function orderKey(date, orderId) {
  return `${date}|${orderId}`;
}

function hashOrder(order) {
  return JSON.stringify(order);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openHisDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("boards")) {
        db.createObjectStore("boards", { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains("orders")) {
        const store = db.createObjectStore("orders", { keyPath: "key" });
        store.createIndex("date", "date", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isHisCacheStale(fetchedAt) {
  if (!fetchedAt) return true;
  return Date.now() - fetchedAt > HIS_CACHE_STALE_MS;
}

export async function loadBoardFromCache(date) {
  const db = await openHisDb();
  const tx = db.transaction(["boards", "orders"], "readonly");
  const boardStore = tx.objectStore("boards");
  const orderStore = tx.objectStore("orders");

  const meta = await idbRequest(boardStore.get(date));
  if (!meta?.orderIds?.length) {
    await txDone(tx);
    return null;
  }

  const orders = [];
  for (const orderId of meta.orderIds) {
    const row = await idbRequest(orderStore.get(orderKey(date, orderId)));
    if (row?.data) orders.push(row.data);
  }

  await txDone(tx);
  return {
    date,
    fetchedAt: meta.fetchedAt,
    orders,
  };
}

export async function mergeBoardIntoCache(date, incomingOrders) {
  const db = await openHisDb();
  const tx = db.transaction(["boards", "orders"], "readwrite");
  const boardStore = tx.objectStore("boards");
  const orderStore = tx.objectStore("orders");

  const existingMeta = await idbRequest(boardStore.get(date));
  const existingIds = new Set(existingMeta?.orderIds || []);
  const incomingIds = new Set((incomingOrders || []).map((o) => o.orderId));
  const changedOrderIds = [];

  for (const order of incomingOrders || []) {
    const key = orderKey(date, order.orderId);
    const nextHash = hashOrder(order);
    const existing = await idbRequest(orderStore.get(key));
    if (!existing || existing.hash !== nextHash) {
      changedOrderIds.push(order.orderId);
      await idbRequest(
        orderStore.put({
          key,
          date,
          orderId: order.orderId,
          hash: nextHash,
          data: order,
        })
      );
    }
  }

  for (const orderId of existingIds) {
    if (!incomingIds.has(orderId)) {
      changedOrderIds.push(orderId);
      await idbRequest(orderStore.delete(orderKey(date, orderId)));
    }
  }

  await idbRequest(
    boardStore.put({
      date,
      fetchedAt: Date.now(),
      orderIds: (incomingOrders || []).map((o) => o.orderId),
    })
  );

  await txDone(tx);

  return {
    orders: incomingOrders || [],
    changedOrderIds: [...new Set(changedOrderIds)],
    fetchedAt: Date.now(),
  };
}
