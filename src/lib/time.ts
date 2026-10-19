export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  const difference = timestamp - Date.now();
  const absolute = Math.abs(difference);

  if (absolute < 60_000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
  });

  if (absolute < 3_600_000) {
    return formatter.format(Math.round(difference / 60_000), 'minute');
  }
  if (absolute < 86_400_000) {
    return formatter.format(Math.round(difference / 3_600_000), 'hour');
  }
  return formatter.format(Math.round(difference / 86_400_000), 'day');
}
