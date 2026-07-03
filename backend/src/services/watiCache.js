import { WatiApiSnapshot } from "../models/index.js";
import { config } from "../config.js";

const memory = new Map();

function ttlMs(key) {
  if (key === "contacts") return config.wati.contactsCacheMs;
  if (key === "connection") return config.wati.connectionCacheMs;
  return 15 * 60 * 1000;
}

function isFresh(syncedAt, key) {
  if (!syncedAt) return false;
  const at = syncedAt instanceof Date ? syncedAt.getTime() : new Date(syncedAt).getTime();
  return Date.now() - at < ttlMs(key);
}

export function wrapCachedPayload(data, syncedAt, key) {
  return {
    ...data,
    cached: true,
    cachedAt: syncedAt instanceof Date ? syncedAt.toISOString() : syncedAt,
    cacheTtlMinutes: Math.round(ttlMs(key) / 60000),
  };
}

export async function readWatiCache(key) {
  const mem = memory.get(key);
  if (mem?.data && isFresh(mem.at, key)) {
    return wrapCachedPayload(mem.data, mem.at, key);
  }

  const doc = await WatiApiSnapshot.findOne({ key }).lean();
  if (doc?.data && isFresh(doc.syncedAt, key)) {
    memory.set(key, { data: doc.data, at: new Date(doc.syncedAt) });
    return wrapCachedPayload(doc.data, doc.syncedAt, key);
  }

  return null;
}

export async function writeWatiCache(key, data) {
  const syncedAt = new Date();
  memory.set(key, { data, at: syncedAt });
  await WatiApiSnapshot.findOneAndUpdate(
    { key },
    { $set: { key, data, syncedAt } },
    { upsert: true }
  );
  return syncedAt;
}

export async function clearWatiCache(key) {
  memory.delete(key);
  await WatiApiSnapshot.deleteOne({ key });
}
