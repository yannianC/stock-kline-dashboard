export function formatCompact(value, options = {}) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    notation: options.notation
  }).format(value);
}

export function lastItem(items) {
  return Array.isArray(items) && items.length > 0 ? items[items.length - 1] : null;
}

export function percentChange(items) {
  if (!Array.isArray(items) || items.length < 2) return null;
  const first = items[0].close;
  const last = items[items.length - 1].close;
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(last)) return null;
  return ((last - first) / first) * 100;
}
