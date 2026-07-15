import { config } from "../config.js";

const IST = "Asia/Kolkata";

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/** Calendar/clock parts in India Standard Time (independent of server TZ). */
export function partsInIst(date = new Date()) {
  const dt = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(dt)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Build a Date from an EMR / hospital wall-clock time in IST. */
export function dateFromIstParts(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(ms, 3)}+05:30`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function formatSqlDateTime(date, endOfDay = false) {
  const p = partsInIst(date instanceof Date ? date : new Date(date));
  const calendar =
    config.emr.sqlDateOrder === "dmy"
      ? `${pad(p.day)}/${pad(p.month)}/${p.year}`
      : `${pad(p.month)}/${pad(p.day)}/${p.year}`;
  return endOfDay ? `${calendar} 23:59` : `${calendar} 00:00`;
}

export function formatSqlDateTimeValue(date) {
  const p = partsInIst(date instanceof Date ? date : new Date(date));
  const calendar =
    config.emr.sqlDateOrder === "dmy"
      ? `${pad(p.day)}/${pad(p.month)}/${p.year}`
      : `${pad(p.month)}/${pad(p.day)}/${p.year}`;
  return `${calendar} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function buildDayTimeChunks(from, to, hoursPerChunk = 2) {
  const start = new Date(from);
  const end = new Date(to);
  const hours = Math.max(1, Number(hoursPerChunk) || 2);
  const chunks = [];
  let cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor.getTime() + hours * 60 * 60 * 1000 - 1);

    const effectiveEnd = chunkEnd.getTime() > end.getTime() ? new Date(end) : chunkEnd;
    chunks.push({ from: chunkStart, to: effectiveEnd });

    cursor = new Date(effectiveEnd.getTime() + 1);
  }

  return chunks;
}

export function spanHours(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms / (60 * 60 * 1000);
}

export function reportDayKey(date = new Date()) {
  const p = partsInIst(date instanceof Date ? date : new Date(date));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * EMR COMPLETED/REQUEST dates are hospital local time (IST), with no timezone.
 * Always interpret them as Asia/Kolkata — Docker UTC servers otherwise show +5:30.
 */
export function parseEmrDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // dd-mm-yyyy[ HH:mm[:ss]]
  const dmyDash = raw.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyDash) {
    return dateFromIstParts(
      Number(dmyDash[3]),
      Number(dmyDash[2]),
      Number(dmyDash[1]),
      Number(dmyDash[4] || 0),
      Number(dmyDash[5] || 0),
      Number(dmyDash[6] || 0)
    );
  }

  // dd/mm/yyyy[ HH:mm[:ss]]
  const dmySlash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmySlash && config.emr.sqlDateOrder === "dmy") {
    return dateFromIstParts(
      Number(dmySlash[3]),
      Number(dmySlash[2]),
      Number(dmySlash[1]),
      Number(dmySlash[4] || 0),
      Number(dmySlash[5] || 0),
      Number(dmySlash[6] || 0)
    );
  }

  // mm/dd/yyyy[ HH:mm[:ss]] (EMR mdy mode)
  const mdySlash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mdySlash) {
    return dateFromIstParts(
      Number(mdySlash[3]),
      Number(mdySlash[1]),
      Number(mdySlash[2]),
      Number(mdySlash[4] || 0),
      Number(mdySlash[5] || 0),
      Number(mdySlash[6] || 0)
    );
  }

  // yyyy-mm-dd[ HH:mm[:ss]] or ISO without Z — treat as IST wall clock
  const ymd = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
  );
  if (ymd) {
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (hasTz) {
      const t = Date.parse(raw);
      return Number.isFinite(t) ? new Date(t) : null;
    }
    return dateFromIstParts(
      Number(ymd[1]),
      Number(ymd[2]),
      Number(ymd[3]),
      Number(ymd[4] || 0),
      Number(ymd[5] || 0),
      Number(ymd[6] || 0)
    );
  }

  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function startOfToday() {
  const p = partsInIst(new Date());
  return dateFromIstParts(p.year, p.month, p.day, 0, 0, 0, 0);
}

export function endOfToday() {
  const p = partsInIst(new Date());
  return dateFromIstParts(p.year, p.month, p.day, 23, 59, 59, 999);
}

export function toInputDateValue(date = new Date()) {
  return reportDayKey(date);
}

export function parseQueryDate(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return endOfDay
      ? dateFromIstParts(year, month, day, 23, 59, 59, 999)
      : dateFromIstParts(year, month, day, 0, 0, 0, 0);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isTodayDate(value) {
  return reportDayKey(parseQueryDate(value) || new Date()) === reportDayKey(new Date());
}

export function enumerateDays(from, to) {
  const start = parseQueryDate(from instanceof Date ? reportDayKey(from) : from, false);
  const end = parseQueryDate(to instanceof Date ? reportDayKey(to) : to, false);
  if (!start || !end || start > end) return [];

  const days = [];
  let cursor = reportDayKey(start);
  const last = reportDayKey(end);
  while (cursor <= last) {
    days.push(cursor);
    const p = cursor.split("-").map(Number);
    const next = dateFromIstParts(p[0], p[1], p[2], 12, 0, 0, 0);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = reportDayKey(next);
  }
  return days;
}
