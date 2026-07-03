import { config } from "../config.js";

export function formatSqlDateTime(date, endOfDay = false) {
  const dt = date instanceof Date ? date : new Date(date);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const calendar =
    config.emr.sqlDateOrder === "dmy" ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
  return endOfDay ? `${calendar} 23:59` : `${calendar} 00:00`;
}

export function formatSqlDateTimeValue(date) {
  const dt = date instanceof Date ? date : new Date(date);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  const calendar =
    config.emr.sqlDateOrder === "dmy" ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
  return `${calendar} ${hh}:${min}`;
}

export function buildDayTimeChunks(from, to, hoursPerChunk = 2) {
  const start = new Date(from);
  const end = new Date(to);
  const hours = Math.max(1, Number(hoursPerChunk) || 2);
  const chunks = [];
  let cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setHours(chunkEnd.getHours() + hours);
    chunkEnd.setMinutes(chunkEnd.getMinutes() - 1);
    chunkEnd.setSeconds(59, 999);

    const effectiveEnd = chunkEnd.getTime() > end.getTime() ? new Date(end) : chunkEnd;
    chunks.push({ from: chunkStart, to: effectiveEnd });

    cursor = new Date(effectiveEnd);
    cursor.setMinutes(cursor.getMinutes() + 1);
    cursor.setSeconds(0, 0);
  }

  return chunks;
}

export function spanHours(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms / (60 * 60 * 1000);
}

export function reportDayKey(date = new Date()) {
  const dt = date instanceof Date ? date : new Date(date);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseEmrDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3]);
    const hour = Number(dmy[4] || 0);
    const minute = Number(dmy[5] || 0);
    const dt = new Date(year, month, day, hour, minute);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
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
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return endOfDay
      ? new Date(year, month, day, 23, 59, 59, 999)
      : new Date(year, month, day, 0, 0, 0, 0);
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
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(reportDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
