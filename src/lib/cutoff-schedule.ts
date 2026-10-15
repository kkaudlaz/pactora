export type CutoffPeriod = { start: string; end: string; due: string };
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string | Date) => { if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); const [year, month, day] = value.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(year, month - 1, day)); };
const addDays = (date: Date, days: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

/** Shared schedule: one-off Aug 27–Oct 15, 2026, then 16th–15th monthly. */
export function cutoffPeriodFor(value: string | Date): CutoffPeriod {
 const date = utcDate(value);
 const initialEnd = new Date(Date.UTC(2026, 9, 15));
 if (date <= initialEnd) return { start: "2026-08-27", end: "2026-10-15", due: "2026-10-15" };
 const year = date.getUTCFullYear(), month = date.getUTCMonth();
 const start = date.getUTCDate() >= 16 ? new Date(Date.UTC(year, month, 16)) : new Date(Date.UTC(year, month - 1, 16));
 const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 15));
 return { start: dateKey(start), end: dateKey(end), due: dateKey(end) };
}
export function cutoffPeriodsBetween(borrowedAt: Date, dueAt: Date): CutoffPeriod[] {
 const dueDate = dateKey(utcDate(dueAt));
 let current = cutoffPeriodFor(borrowedAt);
 const result: CutoffPeriod[] = [];
 for (let i = 0; i < 240 && current.start <= dueDate; i++) {
  result.push(current);
  if (current.end >= dueDate) break;
  const nextStart = addDays(utcDate(current.end), 1);
  const next = cutoffPeriodFor(nextStart);
  if (next.start <= current.start) break;
  current = next;
 }
 return result;
}
