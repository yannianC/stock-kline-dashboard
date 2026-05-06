const responseCache = new Map();

function cloneJsonValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getDetailCacheTtlMs(interval) {
  if (interval === '1m') return 60 * 1000;
  if (interval === '15m') return 90 * 1000;
  if (interval === '1h') return 2 * 60 * 1000;
  if (interval === '4h') return 3 * 60 * 1000;
  if (interval === 'day') return 5 * 60 * 1000;
  if (interval === 'week') return 15 * 60 * 1000;
  if (interval === 'month') return 20 * 60 * 1000;
  return 60 * 1000;
}

function getCacheTtlMs(path, params) {
  if (path === 'api/instrument-detail' || path === 'api/compare-detail') {
    return getDetailCacheTtlMs(params.interval);
  }
  if (path === 'api/instruments') {
    return 15 * 1000;
  }
  return 0;
}

async function requestJson(path, params = {}, { force = false } = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  if (force) {
    query.set('force', '1');
  }

  const url = `${path}?${query.toString()}`;
  const ttlMs = getCacheTtlMs(path, params);
  const now = Date.now();
  const cached = responseCache.get(url);

  if (!force && ttlMs > 0 && cached) {
    if (cached.value && cached.expiresAt > now) {
      return cloneJsonValue(cached.value);
    }
    if (cached.promise) {
      const value = await cached.promise;
      return cloneJsonValue(value);
    }
  }

  const requestPromise = (async () => {
    const response = await fetch(url);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `HTTP ${response.status}`);
    }

    return response.json();
  })();

  if (ttlMs > 0) {
    responseCache.set(url, {
      promise: requestPromise,
      expiresAt: now + ttlMs
    });
  }

  try {
    const payload = await requestPromise;
    if (ttlMs > 0) {
      responseCache.set(url, {
        value: payload,
        expiresAt: Date.now() + ttlMs
      });
    }
    return cloneJsonValue(payload);
  } catch (error) {
    if (ttlMs > 0) {
      responseCache.delete(url);
    }
    throw error;
  }
}

export function loadInstruments({
  page = 1,
  pageSize = 40,
  search = '',
  type = 'all',
  peLte = '',
  q1ProfitGrowthGte = '',
  force = false
} = {}) {
  return requestJson('api/instruments', { page, pageSize, search, type, peLte, q1ProfitGrowthGte }, { force });
}

export function loadStockTable({
  page = 1,
  pageSize = 80,
  search = '',
  sortField = 'tickerSymbol',
  sortDirection = 'ASC',
  filters = [],
  force = false
} = {}) {
  return requestJson('api/stock-table', {
    page,
    pageSize,
    search,
    sortField,
    sortDirection,
    filters: filters?.length ? JSON.stringify(filters) : ''
  }, { force });
}

export async function saveStockTableCell({ id, code, field, value }) {
  const response = await fetch('api/stock-table/edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ id, code, field, value })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export function loadInstrumentDetail({ id, interval = 'day', force = false }) {
  return requestJson('api/instrument-detail', { id, interval }, { force });
}

export function loadCompareDetail({ left, right, mode = 'divide', interval = 'day', minuteLookbackDays, force = false }) {
  return requestJson('api/compare-detail', { left, right, mode, interval, minuteLookbackDays }, { force });
}
