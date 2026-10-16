/**
 * Empties the saved lab report PDF cache (services/pdfCache.js): every file and
 * its record, or with --stale only the out-of-date ones. Reports are fetched
 * from AOSTA again the next time they're opened.
 *
 *   docker compose exec backend node scripts/clearPdfCache.js [--stale]
 */
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { PdfCacheEntry } from "../src/models/index.js";

const onlyStale = process.argv.includes("--stale");
const dir = path.resolve(config.pdfCache.dir);

await mongoose.connect(config.mongodbUri);
const entries = await PdfCacheEntry.find(onlyStale ? { stale: true } : {}).select("orderId path").lean();
let files = 0;
for (const entry of entries) {
  const full = path.resolve(dir, entry.path || "");
  if (full.startsWith(dir + path.sep)) {
    await fs.unlink(full).then(() => (files += 1)).catch(() => {});
  }
}
const { deletedCount } = await PdfCacheEntry.deleteMany({ _id: { $in: entries.map((e) => e._id) } });
console.log(`Removed ${deletedCount} saved PDF record(s) and ${files} file(s) from ${dir}${onlyStale ? " (stale only)" : ""}.`);
console.log("Stray files and empty folders are cleaned up by the nightly sweep (03:15).");
await mongoose.disconnect();
