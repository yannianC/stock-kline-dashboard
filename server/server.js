import { execFile } from 'child_process';
import cors from 'cors';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = Number(process.env.API_PORT || 8787);
const host = process.env.API_HOST || '0.0.0.0';
const mianaKey = (process.env.MIANA_API_KEY || '').trim();
const databentoKey = (process.env.DATABENTO_API_KEY || process.env.DATABENTO_KEY || '').trim();
const tushareToken = (process.env.TUSHARE_API_TOKEN || process.env.TUSHARE_TOKEN || '').trim();
const tushareApiUrl = process.env.TUSHARE_API_URL || 'https://api.tushare.pro';
const tqsdkUser = (process.env.TQSDK_USER || '').trim();
const tqsdkPassword = (process.env.TQSDK_PASSWORD || '').trim();
const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_HISTORY_START = '1990-01-01T00:00:00';
const DATABENTO_HISTORICAL_URL = 'https://hist.databento.com';
const MAX_MINUTE_LOOKBACK_DAYS = 15000;
const CATALOG_TTL_MS = 30 * 60 * 1000;
const STOCK_Q1_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STOCK_Q1_CACHE_VERSION = 2;
const STOCK_Q1_RANGE_START = '000001';
const STOCK_Q1_RANGE_END = '002902';
const CATALOG_DISK_CACHE_PATH = new URL('./catalog-cache.json', import.meta.url);
const STOCK_Q1_DISK_CACHE_PATH = new URL('./stock-q1-cache.json', import.meta.url);
const STOCK_TABLE_OVERRIDES_PATH = new URL('./stock-table-overrides.json', import.meta.url);
const A_SHARE_LATEST_SNAPSHOT_PATH = new URL('./a-share-latest-snapshot.json', import.meta.url);
const RESPONSE_DISK_CACHE_DIR_PATH = new URL('./response-cache/', import.meta.url);
const TQSDK_BRIDGE_PATH = fileURLToPath(new URL('./tqsdk_bridge.py', import.meta.url));
const QUOTE_BATCH_SIZE = 20;
const execFileAsync = promisify(execFile);
const BINANCE_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api.binance.us'
];
const DATABENTO_US_FUTURE_DATASETS = {
  CME: 'GLBX.MDP3',
  CBOT: 'GLBX.MDP3',
  NYMEX: 'GLBX.MDP3',
  COMEX: 'GLBX.MDP3',
  XCME: 'GLBX.MDP3',
  XCBT: 'GLBX.MDP3',
  XNYM: 'GLBX.MDP3',
  XCEC: 'GLBX.MDP3',
  NYBOT: 'IFUS.IMPACT',
  IFUS: 'IFUS.IMPACT',
  ICEUS: 'IFUS.IMPACT'
};

if (!mianaKey) {
  console.warn('[config] MIANA_API_KEY is not set; Miana-backed endpoints will fail until it is configured.');
}
const US_INDEX_YAHOO_SYMBOLS = {
  DJIA: '^DJI',
  SPX: '^GSPC',
  NDX: '^NDX',
  NDX100: '^NDX'
};
const FUTURE_MONTH_CODE_MAP = {
  F: '01',
  G: '02',
  H: '03',
  J: '04',
  K: '05',
  M: '06',
  N: '07',
  Q: '08',
  U: '09',
  V: '10',
  X: '11',
  Z: '12'
};

const LIST_TYPES = [
  { key: 'all', label: '全部' },
  { key: 'STOCK', label: '股票' },
  { key: 'INDEX', label: '指数' },
  { key: 'FUND', label: '基金' },
  { key: 'FUTURE', label: '期货' },
  { key: 'CRYPTO', label: '币圈' },
  { key: 'FOREX', label: '外汇' },
  { key: 'RATIO', label: '汇率' }
];

const CHART_INTERVALS = {
  '1m': {
    key: '1m',
    label: '分钟K',
    intraday: true,
    mianaType: '1min',
    aggregateSeconds: null,
    stockLookbackDays: 7,
    defaultLookbackDays: 5
  },
  '15m': {
    key: '15m',
    label: '15分K',
    intraday: true,
    mianaType: '15min',
    aggregateSeconds: null,
    stockLookbackDays: 120,
    defaultLookbackDays: 5
  },
  '1h': {
    key: '1h',
    label: '1小时K',
    intraday: true,
    mianaType: '60min',
    aggregateSeconds: null,
    stockLookbackDays: 400,
    defaultLookbackDays: 5
  },
  '4h': {
    key: '4h',
    label: '4小时K',
    intraday: true,
    mianaType: '60min',
    aggregateSeconds: 4 * 60 * 60,
    stockLookbackDays: 400,
    defaultLookbackDays: 5
  },
  day: {
    key: 'day',
    label: '日K',
    intraday: false,
    mianaType: 'd1',
    years: 10
  },
  week: {
    key: 'week',
    label: '周K',
    intraday: false,
    mianaType: 'w1',
    years: 10
  },
  month: {
    key: 'month',
    label: '月K',
    intraday: false,
    mianaType: 'm1',
    years: 10
  }
};

const catalogCache = {
  expiresAt: 0,
  data: null,
  promise: null
};

const stockQ1SnapshotCache = {
  expiresAt: 0,
  data: null,
  promise: null
};
const aShareLatestSnapshotCache = {
  mtimeMs: 0,
  data: null
};

const distributionCache = new Map();
const dailyHistoryCache = new Map();
const futureRolloverAverageCache = new Map();
const stockSharesCache = new Map();
const stockBalanceSheetCache = new Map();
const stockIncomeSheetCache = new Map();
const stockCashflowCache = new Map();
const tushareBalanceSheetCache = new Map();
const tushareIncomeSheetCache = new Map();
const tushareDividendCache = new Map();
const tushareBpsCache = new Map();
const tqFutureFamilyCache = new Map();
const instrumentDetailCache = new Map();
const compareDetailCache = new Map();
const databentoDefinitionCache = new Map();
const tushareDailyBasicSnapshotCache = {
  expiresAt: 0,
  data: null,
  promise: null
};

const STOCK_FUNDAMENTAL_METRICS = [
  { key: 'peRatio', label: '市盈率', format: 'ratio', color: '#7b61ff' },
  { key: 'dividendYield', label: '股息率', format: 'percent', color: '#15803d' },
  { key: 'pbRatio', label: '市净率', format: 'ratio', color: '#1d4ed8' },
  { key: 'revenueGrowthRate', label: '收入增长率', format: 'percent', color: '#0891b2' },
  { key: 'profitGrowthRate', label: '利润增长率', format: 'percent', color: '#dc2626' },
  { key: 'ttmProfit', label: '前推4个季度利润', format: 'amount', color: '#8b5cf6' },
  { key: 'ttmRevenue', label: '前4个季度营业收入', format: 'amount', color: '#ea580c' },
  { key: 'netAssets', label: '净资产', format: 'amount', color: '#0f766e' },
  { key: 'returnOnAssets', label: '资产回报率', format: 'percent', color: '#ca8a04' },
  { key: 'marketCapReturnRate', label: '市值回报率', format: 'percent', color: '#9333ea' },
  { key: 'profitMargin', label: '利润率', format: 'percent', color: '#be185d' }
];

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'stock-kline-dashboard-api' });
});

app.get('/api/instruments', async (req, res) => {
  try {
    const page = clampNumber(Number(req.query.page || 1), 1, 10_000);
    const pageSize = clampNumber(Number(req.query.pageSize || 40), 10, 100);
    const search = String(req.query.search || '').trim();
    const type = String(req.query.type || 'all').toUpperCase();
    const peLte = parseNullableNumber(req.query.peLte);
    const q1ProfitGrowthGte = parseNullablePercent(req.query.q1ProfitGrowthGte);
    const catalog = await getCatalog();
    let filtered = filterCatalog(catalog, { search, type });
    let q1SnapshotMeta = null;
    let q1Snapshot = null;

    if (type === 'STOCK' && (q1ProfitGrowthGte !== null || peLte !== null)) {
      q1Snapshot = await getStockQ1Snapshot({ catalog });
      q1SnapshotMeta = buildQ1SnapshotMeta(q1Snapshot);
    }

    if (type === 'STOCK' && q1ProfitGrowthGte !== null) {
      filtered = filtered.filter((item) => {
        const row = q1Snapshot?.items?.[item.code];
        return Number.isFinite(row?.profitGrowthRate) && row.profitGrowthRate >= q1ProfitGrowthGte;
      });
    }

    if (type === 'STOCK' && peLte !== null) {
      filtered = filtered.filter((item) => {
        const row = q1Snapshot?.items?.[item.code];
        return Number.isFinite(row?.peTtm) && row.peTtm > 0 && row.peTtm <= peLte;
      });
    }

    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);
    const quotedItems = await enrichWithQuotes(pageItems);

    res.json({
      generatedAt: new Date().toISOString(),
      page,
      pageSize,
      total: filtered.length,
      type: type === 'ALL' ? 'all' : type,
      listTypes: LIST_TYPES,
      filters: {
        peLte,
        q1ProfitGrowthGte,
        q1Snapshot: q1SnapshotMeta
      },
      items: quotedItems
    });
  } catch (error) {
    res.status(502).json({
      message: error.message || '品种列表获取失败',
      detail: error.stack
    });
  }
});

app.get('/api/stock-table', async (req, res) => {
  try {
    const page = clampNumber(Number(req.query.page || 1), 1, 10_000);
    const pageSize = clampNumber(Number(req.query.pageSize || 80), 10, 300);
    const search = String(req.query.search || '').trim();
    const sortField = String(req.query.sortField || 'tickerSymbol').trim();
    const sortDirection = String(req.query.sortDirection || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const filters = parseStockTableFilters(req.query.filters);
    const catalog = await getCatalog();
    const forceRefresh = String(req.query.force || '') === '1';
    const importedSnapshot = readAShareLatestSnapshot();
    const q1SnapshotPromise = getStockQ1Snapshot({ catalog, forceRefresh });
    const q1Snapshot = importedSnapshot
      ? await withTimeout(q1SnapshotPromise, forceRefresh ? 15000 : 5000).catch(() => null)
      : await q1SnapshotPromise.catch(() => null);
    const dailyBasicSnapshot = await withTimeout(getTushareDailyBasicSnapshot(), 5000).catch(() => null);
    const overrides = readStockTableOverrides();
    const rows = buildStockTableRows({
      catalog,
      q1Snapshot,
      dailyBasicSnapshot,
      importedSnapshot,
      overrides
    });

    let filtered = filterStockTableRows(rows, { search, filters });
    filtered = sortStockTableRows(filtered, sortField, sortDirection);

    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    res.json({
      generatedAt: new Date().toISOString(),
      page,
      pageSize,
      total: filtered.length,
      type: 'STOCK',
      listTypes: LIST_TYPES,
      filters: {
        stockTable: filters,
        q1Snapshot: buildQ1SnapshotMeta(q1Snapshot),
        importedSnapshot: buildImportedSnapshotMeta(importedSnapshot)
      },
      sort: {
        field: sortField,
        direction: sortDirection
      },
      items
    });
  } catch (error) {
    res.status(502).json({
      message: error.message || '股票增强列表获取失败',
      detail: error.stack
    });
  }
});

app.get('/api/stock-financial-charts', async (req, res) => {
  try {
    const codes = String(req.query.codes || '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean)
      .slice(0, 80);
    const catalog = await getCatalog();
    const q1Snapshot = await getStockQ1Snapshot({ catalog }).catch(() => null);
    const importedSnapshot = readAShareLatestSnapshot();
    const instrumentsByCode = new Map(
      (catalog || [])
        .filter((item) => item.type === 'STOCK')
        .map((item) => [item.code, item])
    );

    const pairs = await mapWithConcurrency(codes, 4, async (code) => {
      const importedCharts = importedSnapshot?.items?.[code]?.revenueProfit?.financialCharts || null;
      const cached = q1Snapshot?.items?.[code]?.financialCharts;
      if (cached?.revenue?.length || cached?.profit?.length) {
        return [code, mergeStockFinancialCharts(cached, importedCharts)];
      }

      const instrument = instrumentsByCode.get(code);
      if (!instrument) return [code, importedCharts];

      try {
        const charts = await withTimeout(
          loadStockTableIncomeQuarterSeries(instrument).then(({ profitQuarters, revenueQuarters }) => ({
            revenue: buildStockTableFinancialSeries(revenueQuarters),
            profit: buildStockTableFinancialSeries(profitQuarters)
          })),
          18000
        );
        return [code, mergeStockFinancialCharts(charts, importedCharts)];
      } catch (_error) {
        return [code, importedCharts];
      }
    });

    res.json({
      generatedAt: new Date().toISOString(),
      items: Object.fromEntries(pairs.filter(([, charts]) => charts))
    });
  } catch (error) {
    res.status(502).json({
      message: error.message || '股票财报图表获取失败',
      detail: error.stack
    });
  }
});

app.post('/api/stock-table/edit', (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    const code = String(req.body?.code || '').trim();
    const field = String(req.body?.field || '').trim();
    const value = req.body?.value;

    if (!id && !code) {
      return res.status(400).json({ message: '缺少股票 id 或 code' });
    }
    if (!STOCK_TABLE_EDITABLE_FIELDS.has(field)) {
      return res.status(400).json({ message: `不支持保存字段：${field || '--'}` });
    }

    const key = id || `STOCK:${code}`;
    const overrides = readStockTableOverrides();
    const current = overrides[key] || {};
    const normalizedValue = normalizeStockTableEditValue(field, value);
    overrides[key] = {
      ...current,
      id,
      code,
      [field]: normalizedValue,
      updatedAt: new Date().toISOString()
    };
    persistStockTableOverrides(overrides);

    res.json({
      ok: true,
      item: overrides[key]
    });
  } catch (error) {
    res.status(500).json({
      message: error.message || '保存股票表格字段失败'
    });
  }
});

app.get('/api/instrument-detail', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) {
      res.status(400).json({ message: '缺少 id 参数' });
      return;
    }

    const interval = resolveChartInterval(req.query.interval);
    const catalog = await getCatalog();
    const instrument = findInstrumentById(catalog, id);

    if (!instrument) {
      res.status(404).json({ message: `未找到品种 ${id}` });
      return;
    }

    const forceRefresh = String(req.query.force || '') === '1';
    const detail = await getCachedInstrumentDetail(instrument, interval, { forceRefresh });
    res.json(detail);
  } catch (error) {
    res.status(502).json({
      message: error.message || 'K线详情获取失败',
      detail: error.stack
    });
  }
});

app.get('/api/compare-detail', async (req, res) => {
  try {
    const leftId = String(req.query.left || '').trim();
    const rightId = String(req.query.right || '').trim();
    const rawMode = new URL(req.originalUrl || req.url, 'http://localhost').searchParams.get('mode') ?? req.query.mode;
    const mode = resolveCompareMode(rawMode);

    if (!leftId || !rightId) {
      res.status(400).json({ message: '缺少 left 或 right 参数' });
      return;
    }

    const interval = resolveChartInterval(req.query.interval, {
      minuteLookbackDays: req.query.minuteLookbackDays
    });
    const catalog = await getCatalog();
    const leftInstrument = findInstrumentById(catalog, leftId);
    const rightInstrument = findInstrumentById(catalog, rightId);

    if (!leftInstrument || !rightInstrument) {
      res.status(404).json({ message: `未找到对比品种 ${!leftInstrument ? leftId : rightId}` });
      return;
    }

    const forceRefresh = String(req.query.force || '') === '1';
    const detail = await getCachedCompareDetail(leftInstrument, rightInstrument, mode, interval, { forceRefresh });
    res.json(detail);
  } catch (error) {
    res.status(502).json({
      message: error.message || '对比详情获取失败',
      detail: error.stack
    });
  }
});

app.listen(port, host, () => {
  console.log(`Market data API listening on http://${host}:${port}`);
});

function resolveChartInterval(value, options = {}) {
  const base = CHART_INTERVALS[value] || CHART_INTERVALS.day;
  const rawMinuteLookbackDays = String(options.minuteLookbackDays || '').trim().toLowerCase();
  const minuteLookbackDays = rawMinuteLookbackDays === 'all'
    ? MAX_MINUTE_LOOKBACK_DAYS
    : Number(rawMinuteLookbackDays);
  if (base.key !== '1m' || !Number.isFinite(minuteLookbackDays)) {
    return base;
  }

  const stockLookbackDays = clampNumber(minuteLookbackDays, base.stockLookbackDays, MAX_MINUTE_LOOKBACK_DAYS);
  return {
    ...base,
    stockLookbackDays,
    cacheKey: `${base.key}:${stockLookbackDays}d`
  };
}

function cloneCacheValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getChartResponseCacheTtlMs(intervalKey) {
  if (intervalKey === '1m') return 60 * 1000;
  if (intervalKey === '15m') return 90 * 1000;
  if (intervalKey === '1h') return 2 * 60 * 1000;
  if (intervalKey === '4h') return 3 * 60 * 1000;
  if (intervalKey === 'day') return 10 * 60 * 1000;
  if (intervalKey === 'week') return 20 * 60 * 1000;
  if (intervalKey === 'month') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function getChartResponseStaleTtlMs(intervalKey) {
  if (intervalKey === '1m') return 6 * 60 * 60 * 1000;
  if (intervalKey === '15m' || intervalKey === '1h' || intervalKey === '4h') return DAY_MS;
  return 7 * DAY_MS;
}

async function getOrLoadResponseCache(
  cache,
  key,
  ttlMs,
  loader,
  { forceRefresh = false, diskCacheNamespace = null, staleTtlMs = 0 } = {}
) {
  const now = Date.now();
  const cached = cache.get(key);

  if (!forceRefresh && cached) {
    if (cached.value && cached.expiresAt > now) {
      return cloneCacheValue(cached.value);
    }
    if (cached.promise) {
      const value = await cached.promise;
      return cloneCacheValue(value);
    }
  }

  const diskCache = !forceRefresh && diskCacheNamespace
    ? readResponseDiskCache(diskCacheNamespace, key)
    : null;

  if (diskCache?.value) {
    if (diskCache.expiresAt > now) {
      cache.set(key, {
        value: diskCache.value,
        expiresAt: diskCache.expiresAt
      });
      return cloneCacheValue(diskCache.value);
    }

    if (isUsableStaleResponseCache(diskCache, now, staleTtlMs)) {
      refreshResponseCacheInBackground(cache, key, ttlMs, loader, {
        diskCacheNamespace,
        staleValue: diskCache.value
      });
      return cloneCacheValue(diskCache.value);
    }
  }

  const promise = (async () => {
    const value = await loader();
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    persistResponseDiskCache(diskCacheNamespace, key, value, ttlMs);
    return value;
  })();

  cache.set(key, {
    promise,
    expiresAt: now + ttlMs
  });

  try {
    const value = await promise;
    return cloneCacheValue(value);
  } catch (error) {
    const latest = cache.get(key);
    if (latest?.promise === promise) {
      cache.delete(key);
    }
    if (diskCache?.value && isUsableStaleResponseCache(diskCache, Date.now(), staleTtlMs)) {
      return cloneCacheValue(diskCache.value);
    }
    throw error;
  }
}

function refreshResponseCacheInBackground(cache, key, ttlMs, loader, { diskCacheNamespace, staleValue }) {
  const current = cache.get(key);
  if (current?.promise) return;

  const promise = (async () => {
    const value = await loader();
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    persistResponseDiskCache(diskCacheNamespace, key, value, ttlMs);
    return value;
  })();

  cache.set(key, {
    value: staleValue,
    promise,
    expiresAt: Date.now() + Math.min(ttlMs, 60 * 1000)
  });

  promise.catch((error) => {
    const latest = cache.get(key);
    if (latest?.promise === promise) {
      cache.set(key, {
        value: staleValue,
        expiresAt: Date.now() + Math.min(ttlMs, 60 * 1000)
      });
    }
    console.warn('[response-cache] background refresh failed', key, error?.message || error);
  });
}

function isUsableStaleResponseCache(entry, now, staleTtlMs) {
  const createdAt = Number(entry?.createdAt || 0);
  return Boolean(entry?.value && staleTtlMs > 0 && createdAt > 0 && createdAt + staleTtlMs > now);
}

async function getCatalog() {
  const now = Date.now();

  if (catalogCache.data?.length) {
    if (catalogCache.expiresAt > now) {
      return catalogCache.data;
    }
    refreshCatalogInBackground();
    return catalogCache.data;
  }

  if (catalogCache.promise) {
    return catalogCache.promise;
  }

  const diskCache = readCatalogCacheFromDisk();
  if (diskCache?.length) {
    catalogCache.data = diskCache;
    catalogCache.expiresAt = now + 5 * 60 * 1000;
    refreshCatalogInBackground();
    return diskCache;
  }

  catalogCache.promise = loadCatalog()
    .then((data) => {
      setCatalogCacheData(data);
      return data;
    })
    .catch((error) => {
      catalogCache.promise = null;
      if (catalogCache.data?.length) {
        console.warn('[catalog] refresh failed, using stale cache', error?.message || error);
        return catalogCache.data;
      }
      const diskCache = readCatalogCacheFromDisk();
      if (diskCache?.length) {
        catalogCache.data = diskCache;
        catalogCache.expiresAt = Date.now() + 5 * 60 * 1000;
        console.warn('[catalog] refresh failed, using disk cache', error?.message || error);
        return diskCache;
      }
      throw error;
    });

  return catalogCache.promise;
}

function refreshCatalogInBackground() {
  if (catalogCache.promise) return;

  catalogCache.promise = loadCatalog()
    .then((data) => {
      setCatalogCacheData(data);
      return data;
    })
    .catch((error) => {
      catalogCache.promise = null;
      console.warn('[catalog] background refresh failed, using stale cache', error?.message || error);
      return catalogCache.data || [];
    });

  catalogCache.promise.catch(() => null);
}

function setCatalogCacheData(data) {
  catalogCache.data = data;
  catalogCache.expiresAt = Date.now() + CATALOG_TTL_MS;
  catalogCache.promise = null;
  persistCatalogCache(data);
}

async function loadCatalog() {
  const sources = [
    { endpoint: '/api/stock/v1/stockList', params: { countryCode: 'CHN' }, kind: 'stock' },
    { endpoint: '/api/stock/v1/stockList', params: { countryCode: 'HKG' }, kind: 'stock' },
    { endpoint: '/api/stock/v1/stockList', params: { countryCode: 'USA' }, kind: 'stock' },
    { endpoint: '/api/index/v1/indexList', params: { countryCode: 'CHN' }, kind: 'index' },
    { endpoint: '/api/index/v1/indexList', params: { countryCode: 'HKG' }, kind: 'index' },
    { endpoint: '/api/index/v1/indexList', params: { countryCode: 'USA' }, kind: 'index' },
    { endpoint: '/api/fund/v1/fundList', params: { type: 'all' }, kind: 'fund' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'CHN' }, kind: 'future' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'HKG' }, kind: 'future' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'USA' }, kind: 'future' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'GBR' }, kind: 'future' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'MYS' }, kind: 'future' },
    { endpoint: '/api/future/v1/futureList', params: { countryCode: 'SGP' }, kind: 'future' },
    { endpoint: '/api/forex/v1/forexList', params: {}, kind: 'forex' },
    { endpoint: '/api/crypto/v1/cryptoList', params: {}, kind: 'crypto' }
  ];

  const rows = [];
  const sourceErrors = [];

  for (const source of sources) {
    let payload = [];
    try {
      payload = await fetchMianaList(source.endpoint, source.params);
    } catch (error) {
      sourceErrors.push(`${source.kind}:${source.endpoint}:${JSON.stringify(source.params)}:${error?.message || error}`);
      console.warn('[catalog] source fetch failed', source.kind, source.endpoint, source.params, error?.message || error);
    }
    let sourceCount = 0;
    for (const item of payload) {
      const normalized = normalizeInstrument(item, source.kind);
      if (normalized) {
        rows.push(normalized);
        sourceCount += 1;
      }
    }
  }

  const deduped = [...new Map(rows.map((item) => [item.id, item])).values()];
  if (!deduped.length) {
    throw new Error('未能加载任何真实品种目录数据');
  }
  if (sourceErrors.length) {
    throw new Error(`目录数据源存在异常，已放弃缓存本次不完整结果：${sourceErrors[0]}`);
  }
  deduped.push(...buildSyntheticFutureMainInstruments(deduped));
  deduped.push(...buildSyntheticInstruments());
  deduped.sort(compareInstruments);
  return deduped;
}

function buildSyntheticFutureMainInstruments(catalog) {
  const futures = catalog.filter((item) => item.type === 'FUTURE' && item.futureMeta?.familyKey);
  const groups = new Map();

  for (const item of futures) {
    const familyKey = item.futureMeta.familyKey;
    if (!groups.has(familyKey)) {
      groups.set(familyKey, []);
    }
    groups.get(familyKey).push(item);
  }

  const existingIds = new Set(catalog.map((item) => item.id));
  const syntheticMains = [];

  for (const [, items] of groups.entries()) {
    const contracts = items
      .filter((item) => item.futureMeta?.expiryKey)
      .sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));
    const hasMain = items.some((item) => item.futureMeta?.isMainLike);

    if (hasMain || !contracts.length) {
      continue;
    }

    const main = createSyntheticFutureMainInstrument(contracts);
    if (!main || existingIds.has(main.id)) {
      continue;
    }

    existingIds.add(main.id);
    syntheticMains.push(main);
  }

  return syntheticMains;
}

function createSyntheticFutureMainInstrument(contracts) {
  const sample = contracts[0];
  const familyRoot = sample?.futureMeta?.familyRoot;
  if (!sample || !familyRoot) return null;

  const code = getSyntheticFutureMainCode(sample);
  const name = `${deriveFutureFamilyDisplayName(contracts)}主连`;
  const countryCode = sample.countryCode || '';
  const exchangeCode = sample.exchangeCode || '';
  const type = 'FUTURE';
  const futureMeta = buildFutureInstrumentMeta({ code, name, countryCode, exchangeCode });

  if (!futureMeta?.isMainLike || !futureMeta?.familyRoot) {
    return null;
  }

  return {
    id: `${type}:${code}`,
    type,
    typeLabel: getTypeLabel(type),
    code,
    displayCode: code,
    symbol: code,
    provider: sample.provider || resolveProvider({ type, code, countryCode }),
    name,
    chineseName: '',
    displayName: name,
    countryCode,
    exchangeCode,
    codeAliases: [code],
    futureMeta,
    marketLabel: getMarketLabel({ type, countryCode, exchangeCode }),
    quoteLookupKey: createLookupKey({ type, countryCode, exchangeCode, code }),
    searchText: [
      code,
      name,
      countryCode,
      exchangeCode,
      getTypeLabel(type),
      getMarketLabel({ type, countryCode, exchangeCode }),
      familyRoot,
      '主连 主力 连续 自定义主力 合约切换 自动补全'
    ]
      .join(' ')
      .toLowerCase(),
    supportsAdjustments: false,
    syntheticMain: true
  };
}

function getSyntheticFutureMainCode(sample) {
  const root = String(sample?.futureMeta?.familyRoot || sample?.code || '').trim();
  if (sample?.countryCode === 'CHN') {
    return /^[A-Z]+$/.test(root) ? `${root}M` : `${root}m`;
  }
  return `${root}_M`;
}

function deriveFutureFamilyDisplayName(contracts) {
  const names = contracts
    .map((item) => String(item.name || item.displayName || '').trim())
    .filter(Boolean);
  const fallback = String(contracts[0]?.futureMeta?.familyRoot || contracts[0]?.code || '期货').trim();
  if (!names.length) return fallback;

  const cleaned = names
    .map((name) => name
      .replace(/\s+/g, '')
      .replace(/(?:期货)?\d{3,4}(?:月)?$/i, '')
      .replace(/[A-Z]{1,3}\d{3,4}$/i, '')
      .replace(/(?:合约|期货)?$/u, ''))
    .filter(Boolean);

  if (!cleaned.length) return fallback;
  return cleaned.sort((left, right) => left.length - right.length)[0];
}

function buildSyntheticInstruments() {
  return [
    createBuiltinRatioInstrument('btc-ndx')
  ];
}

function createBuiltinRatioInstrument(symbol) {
  if (symbol === 'btc-ndx') {
    return {
      id: 'RATIO:btc-ndx',
      type: 'RATIO',
      typeLabel: getTypeLabel('RATIO'),
      code: 'BTC/NDX',
      symbol: 'btc-ndx',
      provider: 'synthetic-ratio',
      name: 'BTC/纳指',
      chineseName: 'BTC/纳指',
      displayName: 'BTC/纳指',
      countryCode: '',
      exchangeCode: '',
      marketLabel: '汇率',
      quoteLookupKey: 'RATIO:::BTC/NDX',
      searchText: 'btc/ndx btc/纳指 bitcoin nasdaq 比特币 纳指 纳斯达克 汇率 ratio',
      supportsAdjustments: false
    };
  }

  if (symbol === 'ndx-btc') {
    return {
      id: 'RATIO:ndx-btc',
      type: 'RATIO',
      typeLabel: getTypeLabel('RATIO'),
      code: 'NDX/BTC',
      symbol: 'ndx-btc',
      provider: 'synthetic-ratio',
      name: '纳指/BTC',
      chineseName: '纳指/BTC',
      displayName: '纳指/BTC',
      countryCode: '',
      exchangeCode: '',
      marketLabel: '汇率',
      quoteLookupKey: 'RATIO:::NDX/BTC',
      searchText: 'ndx/btc 纳指/btc 纳指 btc nasdaq bitcoin 汇率 ratio',
      supportsAdjustments: false
    };
  }

  return null;
}

async function fetchMianaList(endpoint, params) {
  const url = new URL(endpoint, 'https://miana.com.cn');
  url.searchParams.set('token', mianaKey);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const payload = await fetchJson(url);
  if (payload.code !== 200 || !Array.isArray(payload.data)) {
    throw new Error(payload.msg || `${endpoint} 返回异常`);
  }
  return payload.data;
}

function normalizeInstrument(item, kind) {
  const type = String(item.type || kind || '').toUpperCase();
  const code = String(item.code || '').trim();
  if (!type || !code) return null;

  const countryCode = String(item.countryCode || '').toUpperCase();
  const exchangeCode = String(item.exchangeCode || '').toUpperCase();
  const symbol = buildSymbol({ type, code, countryCode, exchangeCode });
  if (!symbol) return null;

  const provider = resolveProvider({ type, code, countryCode });
  const name = String(item.name || item.chineseName || code).trim();
  const chineseName = String(item.chineseName || '').trim();
  const displayName = chineseName && chineseName !== name ? `${name} / ${chineseName}` : name;
  const displayCode = getDisplayCode({ type, code, countryCode, exchangeCode });
  const codeAliases = getCodeAliases({ type, code, countryCode, exchangeCode });
  const id = `${type}:${symbol}`;
  const futureMeta = type === 'FUTURE'
    ? buildFutureInstrumentMeta({ code, name, countryCode, exchangeCode })
    : null;

  return {
    id,
    type,
    typeLabel: getTypeLabel(type),
    code,
    displayCode,
    symbol,
    provider,
    name,
    chineseName,
    displayName,
    countryCode,
    exchangeCode,
    codeAliases,
    futureMeta,
    marketLabel: getMarketLabel({ type, countryCode, exchangeCode }),
    quoteLookupKey: createLookupKey({ type, countryCode, exchangeCode, code }),
    searchText: [
      code,
      displayCode,
      ...codeAliases,
      name,
      chineseName,
      countryCode,
      exchangeCode,
      getTypeLabel(type),
      getMarketLabel({ type, countryCode, exchangeCode }),
      futureMeta?.familyRoot,
      futureMeta?.expiryLabel,
      futureMeta?.isMainLike ? '主力 连续 自定义主力 合约切换' : ''
    ]
      .join(' ')
      .toLowerCase(),
    supportsAdjustments: type === 'STOCK'
  };
}

function buildFutureInstrumentMeta({ code, name, countryCode, exchangeCode }) {
  const base = {
    familyRoot: null,
    familyKey: null,
    expiryKey: null,
    expiryLabel: null,
    expiryMonth: null,
    isMainLike: false,
    mainPattern: null
  };

  const makeMeta = (overrides) => ({
    ...base,
    ...overrides,
    familyKey: overrides.familyRoot ? `${countryCode}:${exchangeCode}:${overrides.familyRoot}` : null
  });

  if (code.endsWith('00Y')) {
    return makeMeta({
      familyRoot: code.slice(0, -3),
      isMainLike: true,
      mainPattern: '00Y'
    });
  }

  if (code.endsWith('_M')) {
    return makeMeta({
      familyRoot: code.slice(0, -2),
      isMainLike: true,
      mainPattern: '_M'
    });
  }

  if (/主连/.test(name) && !/次主连/.test(name)) {
    const singleMainMatch = code.match(/^([A-Za-z]+)M$/i);
    if (singleMainMatch) {
      return makeMeta({
        familyRoot: singleMainMatch[1],
        isMainLike: true,
        mainPattern: 'single-m'
      });
    }
  }

  let match = code.match(/^([A-Za-z]+)(M[01]|S[012])$/);
  if (match && /连续|主力/.test(name)) {
    return makeMeta({
      familyRoot: match[1],
      isMainLike: true,
      mainPattern: match[2]
    });
  }

  match = code.match(/^([A-Za-z]+)([012])$/);
  if (match && /连续|主力/.test(name)) {
    return makeMeta({
      familyRoot: match[1],
      isMainLike: true,
      mainPattern: match[2]
    });
  }

  match = code.match(/^([A-Za-z]+)(\d{4})$/);
  if (match) {
    const [, root, expiry] = match;
    return makeMeta({
      familyRoot: root,
      expiryKey: `20${expiry}`,
      expiryLabel: expiry,
      expiryMonth: expiry.slice(2)
    });
  }

  match = code.match(/^([A-Za-z]+)(\d{4})([A-Za-z])$/);
  if (match && /月均/.test(name)) {
    const [, root, expiry, suffix] = match;
    return makeMeta({
      familyRoot: `${root}${suffix}`,
      expiryKey: `20${expiry}`,
      expiryLabel: expiry,
      expiryMonth: expiry.slice(2)
    });
  }

  match = code.match(/^([A-Za-z]+)(\d{3})$/);
  if (match) {
    const [, root, shortExpiry] = match;
    const inferredYear = inferFutureYearFromSingleDigit(shortExpiry[0]);
    const month = shortExpiry.slice(1);
    return makeMeta({
      familyRoot: root,
      expiryKey: inferredYear && month ? `${inferredYear}${month}` : null,
      expiryLabel: inferredYear && month ? `${String(inferredYear).slice(2)}${month}` : null,
      expiryMonth: month
    });
  }

  match = code.match(/^([A-Za-z][A-Za-z0-9]*?)(\d{2})([FGHJKMNQUVXZ])$/);
  if (match) {
    const [, root, yy, monthCode] = match;
    const month = FUTURE_MONTH_CODE_MAP[monthCode];
    return makeMeta({
      familyRoot: root,
      expiryKey: month ? `20${yy}${month}` : null,
      expiryLabel: month ? `${yy}${month}` : null,
      expiryMonth: month
    });
  }

  match = code.match(/^([A-Za-z][A-Za-z0-9]*?)([FGHJKMNQUVXZ])(\d)$/);
  if (match) {
    const [, root, monthCode, yearDigit] = match;
    const month = FUTURE_MONTH_CODE_MAP[monthCode];
    const inferred = extractExpiryFromFutureName(name);
    return makeMeta({
      familyRoot: root,
      expiryKey: inferred || (month ? `202${yearDigit}${month}` : null),
      expiryLabel: inferred ? inferred.slice(2) : (month ? `2${yearDigit}${month}` : null),
      expiryMonth: inferred ? inferred.slice(4) : month
    });
  }

  return base;
}

function extractExpiryFromFutureName(name) {
  const match = String(name || '').match(/(\d{4})(?!.*\d)/);
  return match ? `20${match[1]}` : null;
}

function inferFutureYearFromSingleDigit(yearDigitText) {
  const yearDigit = Number(yearDigitText);
  if (!Number.isInteger(yearDigit) || yearDigit < 0 || yearDigit > 9) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const decadeBase = Math.floor(currentYear / 10) * 10;
  let inferredYear = decadeBase + yearDigit;

  if (inferredYear < currentYear - 2) {
    inferredYear += 10;
  } else if (inferredYear > currentYear + 7) {
    inferredYear -= 10;
  }

  return inferredYear;
}

function resolveProvider({ type, code, countryCode }) {
  if (type === 'RATIO') return 'synthetic-ratio';
  if (type === 'INDEX' && countryCode === 'USA' && US_INDEX_YAHOO_SYMBOLS[code]) {
    return 'yahoo-index';
  }

  if (type === 'STOCK') return 'miana-stock';
  if (type === 'INDEX') return 'miana-index';
  if (type === 'FUND') return 'miana-fund';
  if (type === 'FUTURE') return 'miana-future';
  if (type === 'CRYPTO') return 'miana-crypto';
  if (type === 'FOREX') return 'miana-forex';
  return 'miana-stock';
}

function buildSymbol({ type, code, countryCode, exchangeCode }) {
  if (type === 'STOCK' || type === 'FUND') {
    if (exchangeCode === 'XSHG') return `sh${code}`;
    if (exchangeCode === 'XSHE') return `sz${code}`;
    if (exchangeCode === 'XHKG' || countryCode === 'HKG') return `hk${code}`;
    if (countryCode === 'USA') return `us${code}`;
    return code;
  }

  if (type === 'INDEX') {
    if (countryCode === 'CHN') {
      return code.startsWith('399') ? `sz${code}` : `sh${code}`;
    }
    return code;
  }

  return code;
}

function getDisplayCode({ type, code, countryCode, exchangeCode }) {
  return code;
}

function getCodeAliases({ type, code, countryCode, exchangeCode }) {
  if (!code) return [];

  const aliases = new Set([code]);
  if (type !== 'STOCK' && type !== 'INDEX' && type !== 'FUND') {
    return [...aliases];
  }

  if (exchangeCode === 'XSHG') aliases.add(`SSE:${code}`);
  if (exchangeCode === 'XSHE') aliases.add(`SZSE:${code}`);
  if (exchangeCode === 'BSE') aliases.add(`BSE:${code}`);
  if (exchangeCode === 'XHKG' || countryCode === 'HKG') aliases.add(`HKEX:${code}`);

  if (countryCode === 'USA') {
    if (exchangeCode === 'XNAS') aliases.add(`NASDAQ:${code}`);
    else if (exchangeCode === 'XNYS') aliases.add(`NYSE:${code}`);
    else if (exchangeCode === 'AMEX') aliases.add(`AMEX:${code}`);
    else if (exchangeCode === 'ARCX') aliases.add(`NYSEARCA:${code}`);
    else if (exchangeCode === 'BATS') aliases.add(`BATS:${code}`);
    else aliases.add(`US:${code}`);
  }

  return [...aliases];
}

function filterCatalog(catalog, { search, type }) {
  const normalizedSearch = search.toLowerCase();
  const filtered = catalog.filter((item) => {
    if (type && type !== 'ALL' && type !== 'all' && item.type !== type) {
      return false;
    }

    if (!normalizedSearch) return true;
    return getInstrumentSearchHaystack(item).includes(normalizedSearch);
  });

  if (!normalizedSearch) {
    return filtered;
  }

  return filtered.sort((left, right) => {
    const scoreDiff = getInstrumentSearchScore(right, normalizedSearch) - getInstrumentSearchScore(left, normalizedSearch);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const marketDiff = getInstrumentSearchMarketScore(right) - getInstrumentSearchMarketScore(left);
    if (marketDiff !== 0) {
      return marketDiff;
    }
    const lengthDiff = String(left.name || '').length - String(right.name || '').length;
    if (lengthDiff !== 0) {
      return lengthDiff;
    }
    return compareInstruments(left, right);
  });
}

function getInstrumentSearchHaystack(item) {
  return [
    item.searchText,
    item.code,
    item.displayCode,
    ...(Array.isArray(item.codeAliases) ? item.codeAliases : []),
    item.symbol,
    item.name,
    item.chineseName,
    item.displayName,
    item.typeLabel,
    item.marketLabel,
    item.countryCode,
    item.exchangeCode
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getInstrumentSearchScore(item, query) {
  if (!query) return 1;

  const code = String(item.code || '').toLowerCase();
  const displayCode = String(item.displayCode || '').toLowerCase();
  const codeAliases = Array.isArray(item.codeAliases)
    ? item.codeAliases.map((alias) => String(alias || '').toLowerCase()).filter(Boolean)
    : [];
  const symbol = String(item.symbol || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  const chineseName = String(item.chineseName || '').toLowerCase();
  const displayName = String(item.displayName || '').toLowerCase();
  const haystack = getInstrumentSearchHaystack(item);

  if (displayCode === query) return 125;
  if (codeAliases.includes(query)) return 123;
  if (code === query || symbol === query) return 120;
  if (name === query || chineseName === query || displayName === query) return 110;
  if (displayCode.startsWith(query)) return 105;
  if (codeAliases.some((alias) => alias.startsWith(query))) return 103;
  if (code.startsWith(query) || symbol.startsWith(query)) return 100;
  if (name.startsWith(query) || chineseName.startsWith(query) || displayName.startsWith(query)) return 90;
  if (haystack.includes(query)) return 60;
  return -1;
}

function getInstrumentSearchMarketScore(item) {
  if (item.countryCode === 'CHN' || item.marketLabel === 'A股') return 4;
  if (item.countryCode === 'HKG' || item.marketLabel === '港股') return 3;
  if (item.countryCode === 'USA' || item.marketLabel === '美股' || item.marketLabel === '美股指数') return 2;
  return 1;
}

async function enrichWithQuotes(items) {
  const quotesById = new Map();
  const groups = new Map();

  for (const item of items) {
    const key = getQuoteGroupKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  for (const [groupKey, groupItems] of groups.entries()) {
    if (groupKey === 'synthetic-ratio') {
      const ratioQuotes = await Promise.all(groupItems.map((item) => loadSyntheticRatioQuote(item).catch(() => null)));
      ratioQuotes.forEach((quote, index) => {
        if (quote) quotesById.set(groupItems[index].id, quote);
      });
      continue;
    }

    if (groupKey === 'yahoo-index') {
      const yahooQuotes = await Promise.all(groupItems.map((item) => loadYahooIndexQuote(item).catch(() => null)));
      yahooQuotes.forEach((quote, index) => {
        if (quote) quotesById.set(groupItems[index].id, quote);
      });
      continue;
    }

    if (groupKey === 'future-cn-tqsdk') {
      const tqQuotes = await loadTqSdkFutureQuotes(groupItems).catch(() => []);
      for (const [id, quote] of tqQuotes) {
        quotesById.set(id, quote);
      }
      continue;
    }

    const endpoint = getRealtimeEndpoint(groupItems[0]);
    if (!endpoint) continue;

    for (let index = 0; index < groupItems.length; index += QUOTE_BATCH_SIZE) {
      const batch = groupItems.slice(index, index + QUOTE_BATCH_SIZE);
      const batchQuotes = await loadBatchQuotes(batch, endpoint).catch(() => []);
      for (const [id, quote] of batchQuotes) {
        quotesById.set(id, quote);
      }
    }
  }

  return items.map((item) => ({
    ...item,
    quote: quotesById.get(item.id) || null
  }));
}

function getQuoteGroupKey(item) {
  if (item.provider === 'synthetic-ratio') return 'synthetic-ratio';
  if (item.provider === 'yahoo-index') return 'yahoo-index';
  if (isTqSdkDomesticFutureInstrument(item) && !item?.futureMeta?.isMainLike) return 'future-cn-tqsdk';
  if (item.type === 'STOCK') return 'stock';
  if (item.type === 'INDEX') return 'index';
  if (item.type === 'FUND') return 'fund';
  if (item.type === 'FUTURE') return 'future';
  if (item.type === 'CRYPTO') return 'crypto';
  if (item.type === 'FOREX') return 'forex';
  return item.type;
}

function getRealtimeEndpoint(item) {
  if (item.type === 'STOCK') return '/api/stock/v2/realtime';
  if (item.type === 'INDEX') return '/api/index/v2/realtime';
  if (item.type === 'FUND') return '/api/fund/v2/realtime';
  if (item.type === 'FUTURE') return '/api/future/v2/realtime';
  if (item.type === 'CRYPTO') return '/api/crypto/v2/realtime';
  if (item.type === 'FOREX') return '/api/forex/v2/realtime';
  return null;
}

async function loadBatchQuotes(items, endpoint) {
  const url = new URL(endpoint, 'https://miana.com.cn');
  url.searchParams.set('token', mianaKey);
  url.searchParams.set('symbol', items.map((item) => item.symbol).join(','));

  const payload = await fetchJson(url);
  if (payload.code !== 200 || !Array.isArray(payload.data)) {
    throw new Error(payload.msg || `${endpoint} 返回异常`);
  }

  const byKey = new Map(
    items.map((item) => [
      item.quoteLookupKey,
      item
    ])
  );

  const matches = [];
  for (const row of payload.data) {
    const lookupKey = createLookupKey({
      type: row.type || items[0]?.type,
      countryCode: row.countryCode,
      exchangeCode: row.exchangeCode,
      code: row.code
    });
    const item = byKey.get(lookupKey);
    if (!item) continue;
    matches.push([item.id, normalizeQuote(row)]);
  }

  return matches;
}

function isTqSdkConfigured() {
  return Boolean(tqsdkUser && tqsdkPassword);
}

function isTqSdkDomesticFutureInstrument(instrument) {
  return Boolean(
    isTqSdkConfigured() &&
    instrument?.type === 'FUTURE' &&
    instrument?.countryCode === 'CHN'
  );
}

function mapLocalFutureExchangeToTq(exchangeCode) {
  if (exchangeCode === 'ZCE') return 'CZCE';
  if (exchangeCode === 'GFE') return 'GFEX';
  return exchangeCode || null;
}

function mapTqFutureExchangeToLocal(exchangeId) {
  if (exchangeId === 'CZCE') return 'ZCE';
  if (exchangeId === 'GFEX') return 'GFE';
  return exchangeId || '';
}

function buildFutureMetaFromTqContractRow({ code, name, exchangeCode, deliveryYear, deliveryMonth }) {
  const baseMeta = buildFutureInstrumentMeta({
    code,
    name,
    countryCode: 'CHN',
    exchangeCode
  });

  const normalizedYear = Number(deliveryYear);
  const normalizedMonth = Number(deliveryMonth);
  if (!Number.isInteger(normalizedYear) || !Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
    return baseMeta;
  }

  const monthText = String(normalizedMonth).padStart(2, '0');
  return {
    ...baseMeta,
    expiryKey: `${normalizedYear}${monthText}`,
    expiryLabel: `${String(normalizedYear).slice(2)}${monthText}`,
    expiryMonth: monthText
  };
}

function toTqFutureSymbol(instrument) {
  const exchangeId = mapLocalFutureExchangeToTq(instrument?.exchangeCode);
  if (!exchangeId || !instrument?.code) {
    throw new Error(`无法映射 TqSdk 期货代码: ${instrument?.code || '--'}`);
  }
  return `${exchangeId}.${instrument.code}`;
}

async function runTqSdkBridge(command, payload) {
  if (!isTqSdkConfigured()) {
    throw new Error('未配置 TQSDK_USER / TQSDK_PASSWORD');
  }

  const { stdout } = await execFileAsync(
    'python3',
    [TQSDK_BRIDGE_PATH, command, JSON.stringify(payload || {})],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        TQSDK_USER: tqsdkUser,
        TQSDK_PASSWORD: tqsdkPassword
      },
      maxBuffer: 24 * 1024 * 1024
    }
  );

  let parsed;
  try {
    parsed = JSON.parse(String(stdout || '{}'));
  } catch (error) {
    throw new Error(`TqSdk 返回了无法解析的内容: ${error.message}`);
  }

  if (!parsed?.ok) {
    throw new Error(parsed?.message || `TqSdk ${command} 调用失败`);
  }

  return parsed;
}

function normalizeTqSdkQuote(row) {
  const price = toFiniteNumber(row.last_price);
  const preClose = toFiniteNumber(row.pre_close);
  const change = Number.isFinite(price) && Number.isFinite(preClose) ? price - preClose : null;
  const changeRate = Number.isFinite(change) && preClose ? (change / preClose) * 100 : null;

  return {
    date: normalizeDate(row.datetime?.slice?.(0, 10) || null),
    price,
    preClose,
    change,
    changeRate,
    open: toFiniteNumber(row.open),
    high: toFiniteNumber(row.highest),
    low: toFiniteNumber(row.lowest),
    volume: toFiniteNumber(row.volume),
    turnover: null,
    peTtm: null,
    peDyn: null,
    peStatic: null,
    pb: null,
    bv: null,
    marketValue: null,
    circulationValue: null,
    totalShares: null,
    circulationShares: null
  };
}

async function loadTqSdkFutureQuotes(items) {
  const symbols = items.map((item) => toTqFutureSymbol(item));
  const payload = await runTqSdkBridge('quotes', { symbols });
  const bySymbol = new Map((payload.quotes || []).map((row) => [row.symbol, row]));

  return items
    .map((item) => {
      const row = bySymbol.get(toTqFutureSymbol(item));
      if (!row) return null;
      return [item.id, normalizeTqSdkQuote(row)];
    })
    .filter(Boolean);
}

async function loadTqSdkFutureKlines(
  instruments,
  interval,
  {
    dayBased = !interval.intraday || interval.key === 'week' || interval.key === 'month',
    dataLength: dataLengthOverride = null
  } = {}
) {
  const durationSeconds = getTqSdkDurationSeconds(interval, dayBased);
  const dataLength = Number.isFinite(dataLengthOverride)
    ? dataLengthOverride
    : getTqSdkKlineDataLength(interval, dayBased);
  const symbols = instruments.map((instrument) => toTqFutureSymbol(instrument));
  const payload = await runTqSdkBridge('klines', {
    symbols,
    duration_seconds: durationSeconds,
    data_length: dataLength,
    intraday: !dayBased
  });

  const resultMap = new Map(
    instruments.map((instrument) => {
      const symbol = toTqFutureSymbol(instrument);
      const rows = payload.rows_by_symbol?.[symbol] || [];
      return [instrument.id, normalizeTqSdkKlineRows(rows, dayBased)];
    })
  );

  const missingInstruments = !dayBased && interval.key !== '1m'
    ? instruments.filter((instrument) => !(resultMap.get(instrument.id) || []).length)
    : [];

  if (missingInstruments.length) {
    const minutePayload = await runTqSdkBridge('klines', {
      symbols: missingInstruments.map((instrument) => toTqFutureSymbol(instrument)),
      duration_seconds: 60,
      data_length: getTqSdkFallbackMinuteDataLength(interval),
      intraday: true
    });

    for (const instrument of missingInstruments) {
      const symbol = toTqFutureSymbol(instrument);
      const minuteRows = minutePayload.rows_by_symbol?.[symbol] || [];
      const minuteCandles = normalizeTqSdkKlineRows(minuteRows, false);
      resultMap.set(instrument.id, aggregateCandles(minuteCandles, durationSeconds));
    }
  }

  return resultMap;
}

function getTqSdkDurationSeconds(interval, dayBased = false) {
  if (dayBased) return 24 * 60 * 60;
  if (interval?.key === '4h') return 4 * 60 * 60;
  if (interval?.key === '1h') return 60 * 60;
  if (interval?.key === '15m') return 15 * 60;
  if (interval?.key === '1m') return 60;
  return 24 * 60 * 60;
}

function normalizeTqSdkKlineRows(rows, dayBased) {
  return (rows || [])
    .map((row) => ({
      time: dayBased ? normalizeDate(row.time) : toFiniteNumber(row.time),
      open: toFiniteNumber(row.open),
      high: toFiniteNumber(row.high),
      low: toFiniteNumber(row.low),
      close: toFiniteNumber(row.close),
      volume: toFiniteNumber(row.volume),
      openOi: toFiniteNumber(row.open_oi),
      closeOi: toFiniteNumber(row.close_oi)
    }))
    .filter(isValidCandle);
}

function getTqSdkKlineDataLength(interval, dayBased) {
  if (dayBased) return 10000;
  if (interval?.key === '1m') return 1200;
  if (interval?.key === '15m') return 1600;
  if (interval?.key === '1h') return 1800;
  if (interval?.key === '4h') return 1800;
  return 2000;
}

function getTqSdkFallbackMinuteDataLength(interval) {
  const durationSeconds = getTqSdkDurationSeconds(interval, false);
  const targetBars = getTqSdkKlineDataLength(interval, false);
  return Math.min(10000, Math.max(1200, Math.ceil(targetBars * durationSeconds / 60)));
}

function getTqSdkIntradayMainContractCount(interval) {
  if (interval?.key === '1m') return 4;
  if (interval?.key === '15m') return 5;
  if (interval?.key === '1h') return 6;
  if (interval?.key === '4h') return 6;
  return 8;
}

function selectTqSdkIntradayContracts(familyContracts, interval) {
  const activeContracts = familyContracts.filter((contract) => !contract.expired);
  if (activeContracts.length) {
    return activeContracts;
  }
  return familyContracts.slice(-getTqSdkIntradayMainContractCount(interval));
}

function selectTqSdkIntradaySelectedContracts(dailyContracts, dailySeries, interval) {
  const selectedByDate = dailySeries?.selectedByDate;
  if (!(selectedByDate instanceof Map) || !selectedByDate.size) {
    return dailyContracts.map((entry) => entry.instrument);
  }

  const dates = [...selectedByDate.keys()].sort((left, right) => left.localeCompare(right));
  const recentDates = dates.slice(-getTqSdkIntradaySelectedDateCount(interval));
  const byId = new Map();

  for (const tradeDate of recentDates) {
    const selected = selectedByDate.get(tradeDate);
    if (selected?.instrument?.id) {
      byId.set(selected.instrument.id, selected.instrument);
    }
  }

  if (byId.size) {
    return [...byId.values()].sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));
  }

  return dailyContracts.map((entry) => entry.instrument);
}

function getTqSdkIntradaySelectedDateCount(interval) {
  if (interval?.key === '1m') return 10;
  if (interval?.key === '15m') return 120;
  if (interval?.key === '1h') return 260;
  if (interval?.key === '4h') return 520;
  return 120;
}

function getTqSdkIntradayMainDailyLength(interval) {
  if (interval?.key === '1m') return 45;
  if (interval?.key === '15m') return 90;
  if (interval?.key === '1h') return 260;
  if (interval?.key === '4h') return 420;
  return 260;
}

async function loadYahooIndexQuote(item) {
  const yahooSymbol = US_INDEX_YAHOO_SYMBOLS[item.code];
  const result = await fetchYahooChart(yahooSymbol, { interval: '1d', range: '5d', intraday: false });
  const candles = result.candles;
  if (!candles.length) {
    throw new Error(`Yahoo ${item.code} 无可用报价`);
  }

  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = previous ? last.close - previous.close : null;
  const changeRate = previous?.close ? (change / previous.close) * 100 : null;

  return {
    date: last.time,
    price: last.close,
    preClose: previous?.close || null,
    change,
    changeRate
  };
}

async function loadSyntheticRatioQuote(item) {
  const detail = await buildInstrumentDetail(item, CHART_INTERVALS.day, { skipQuoteLookup: true });
  return detail.quote;
}

function findInstrumentById(catalog, id) {
  return (
    catalog.find((item) => item.id === id) ||
    createBuiltinCompareInstrument(id) ||
    createBuiltinRatioInstrument(String(id).split(':')[1])
  );
}

async function buildInstrumentDetail(instrument, interval, options = {}) {
  const warnings = [];
  const rawResult = await fetchInstrumentCandles(instrument, interval);
  warnings.push(...rawResult.warnings);

  const raw = rawResult.candles;
  if (!raw.length) {
    warnings.push(buildMissingIntervalWarning(instrument, interval));
  }
  const rollovers = rawResult.rollovers || [];
  const adjustmentResult = await buildInstrumentAdjustedSeries(instrument, raw, rollovers).catch((error) => ({
    qfq: null,
    hfq: null,
    warnings: [`复权计算失败：${error.message}`]
  }));

  warnings.push(...adjustmentResult.warnings);

  const latestQuote = options.skipQuoteLookup
    || isCustomMainFutureInstrument(instrument)
    ? buildQuoteFromCandles(raw)
    : (await enrichWithQuotes([instrument]))?.[0]?.quote || buildQuoteFromCandles(raw);

  const fundamentalResult = instrument.type === 'STOCK'
    ? await buildStockFundamentals(instrument, raw, latestQuote).catch((error) => ({
      current: null,
      rows: [],
      metrics: STOCK_FUNDAMENTAL_METRICS,
      warnings: [`财务指标计算失败：${error.message}`]
    }))
    : {
      current: null,
      rows: [],
      metrics: []
    };

  warnings.push(...(fundamentalResult.warnings || []));

  return {
    version: STOCK_Q1_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    instrument,
    interval: {
      key: interval.key,
      label: interval.label
    },
    quote: latestQuote,
    range: {
      start: stringifyChartTime(raw[0]?.time) || '--',
      end: stringifyChartTime(raw.at(-1)?.time) || '--'
    },
    sourceName: rawResult.sourceName,
    rollovers,
    components: rawResult.components || [],
    warnings,
    supportsAdjustments: Boolean(adjustmentResult.qfq?.length || adjustmentResult.hfq?.length),
    fundamentals: {
      current: fundamentalResult.current,
      rows: fundamentalResult.rows,
      metrics: fundamentalResult.metrics,
      financialBars: fundamentalResult.financialBars
    },
    series: {
      raw,
      qfq: adjustmentResult.qfq,
      hfq: adjustmentResult.hfq
    }
  };
}

async function getCachedInstrumentDetail(instrument, interval, { forceRefresh = false } = {}) {
  const cacheKey = `${instrument.id}::${interval.key}`;
  return getOrLoadResponseCache(
    instrumentDetailCache,
    cacheKey,
    getChartResponseCacheTtlMs(interval.key),
    () => buildInstrumentDetail(instrument, interval),
    {
      forceRefresh,
      diskCacheNamespace: 'instrument-detail',
      staleTtlMs: getChartResponseStaleTtlMs(interval.key)
    }
  );
}

async function fetchInstrumentCandles(instrument, interval) {
  if (instrument.provider === 'synthetic-ratio') {
    return fetchRatioCandles(instrument, interval);
  }

  if (instrument.provider === 'yahoo-index') {
    return fetchYahooIndexCandles(instrument, interval);
  }

  if (instrument.type === 'STOCK') {
    return fetchStockCandles(instrument, interval);
  }

  if (instrument.type === 'INDEX') {
    return fetchMianaGenericCandles(instrument, interval, {
      endpoint: '/api/index/v2/kline',
      marketTimeZone: 'Asia/Shanghai'
    });
  }

  if (instrument.type === 'FUND') {
    return fetchMianaGenericCandles(instrument, interval, {
      endpoint: '/api/fund/v2/kline',
      marketTimeZone: 'Asia/Shanghai'
    });
  }

  if (instrument.type === 'FUTURE') {
    return fetchFutureCandles(instrument, interval);
  }

  if (instrument.type === 'CRYPTO') {
    return fetchCryptoCandles(instrument, interval);
  }

  if (instrument.type === 'FOREX') {
    return fetchMianaGenericCandles(instrument, interval, {
      endpoint: '/api/forex/v1/kline',
      marketTimeZone: 'UTC'
    });
  }

  throw new Error(`暂不支持 ${instrument.type} 的 K 线详情`);
}

async function fetchFutureCandles(instrument, interval) {
  if (isCustomMainFutureInstrument(instrument)) {
    return fetchCustomContinuousFutureCandles(instrument, interval);
  }

  return fetchDirectFutureCandles(instrument, interval);
}

function isCustomMainFutureInstrument(instrument) {
  return Boolean(instrument?.type === 'FUTURE' && instrument?.futureMeta?.isMainLike && instrument?.futureMeta?.familyRoot);
}

function getFutureMarketTimeZone(instrument) {
  if (instrument?.countryCode === 'USA') return 'America/New_York';
  if (instrument?.countryCode === 'HKG') return 'Asia/Hong_Kong';
  if (instrument?.countryCode === 'SGP') return 'Asia/Singapore';
  if (instrument?.countryCode === 'MYS') return 'Asia/Kuala_Lumpur';
  if (instrument?.countryCode === 'GBR') return 'Europe/London';
  return 'Asia/Shanghai';
}

async function fetchDirectFutureCandles(instrument, interval) {
  if (isTqSdkDomesticFutureInstrument(instrument)) {
    return fetchTqSdkDomesticFutureCandles(instrument, interval);
  }

  if (isDatabentoUsFutureInstrument(instrument)) {
    try {
      return await fetchDatabentoFutureCandles(instrument, interval);
    } catch (error) {
      const fallback = await fetchMianaGenericCandles(instrument, interval, {
        endpoint: '/api/future/v2/kline',
        marketTimeZone: getFutureMarketTimeZone(instrument)
      }).catch(() => null);

      if (fallback) {
        return {
          ...fallback,
          sourceName: `${fallback.sourceName}（Databento 回退）`,
          warnings: [
            `Databento ${instrument.code} ${interval.label} 获取失败，暂用 Miana 回退：${error?.message || '未知错误'}`,
            ...(fallback.warnings || [])
          ]
        };
      }

      throw error;
    }
  }

  return fetchMianaGenericCandles(instrument, interval, {
    endpoint: '/api/future/v2/kline',
    marketTimeZone: getFutureMarketTimeZone(instrument)
  });
}

async function fetchFutureContractDailyCandles(instrument) {
  if (isTqSdkDomesticFutureInstrument(instrument)) {
    return fetchTqSdkDomesticFutureCandles(instrument, CHART_INTERVALS.day);
  }

  if (isDatabentoUsFutureInstrument(instrument)) {
    return fetchDatabentoFutureCandles(instrument, CHART_INTERVALS.day);
  }

  const { start, end } = getFutureContractDateRange(instrument);

  const candles = await fetchMianaSeries({
    endpoint: '/api/future/v2/kline',
    symbol: instrument.symbol,
    type: 'd1',
    start,
    end,
    intraday: false,
    marketTimeZone: getFutureMarketTimeZone(instrument),
    timeoutMs: 8000,
    retries: 2
  });

  return {
    candles,
    sourceName: `Miana 期货 ${instrument.symbol} 日K`,
    warnings: []
  };
}

async function fetchTqSdkDomesticFutureCandles(instrument, interval) {
  const dayBased = !interval.intraday || interval.key === 'week' || interval.key === 'month';
  const batchMap = await loadTqSdkFutureKlines([instrument], interval, { dayBased });
  let candles = batchMap.get(instrument.id) || [];

  if (interval.key === 'week' || interval.key === 'month') {
    candles = aggregateCalendarCandles(
      candles.map((candle) => ({
        ...candle,
        tradeDate: normalizeDate(candle.time),
        startDate: normalizeDate(candle.time),
        endDate: normalizeDate(candle.time)
      })),
      interval.key
    );
  }

  return {
    candles,
    sourceName: `TqSdk 国内期货 ${instrument.code} ${interval.label}`,
    warnings: []
  };
}

function isDatabentoUsFutureInstrument(instrument) {
  return Boolean(
    databentoKey &&
    instrument?.type === 'FUTURE' &&
    instrument?.countryCode === 'USA' &&
    getDatabentoFutureDataset(instrument)
  );
}

function getDatabentoFutureDataset(instrument) {
  const exchangeCode = String(instrument?.exchangeCode || '').trim().toUpperCase();
  return DATABENTO_US_FUTURE_DATASETS[exchangeCode] || null;
}

function getDatabentoFutureRoot(instrument) {
  const familyRoot = String(instrument?.futureMeta?.familyRoot || '').trim().toUpperCase();
  if (familyRoot) return familyRoot;

  const code = String(instrument?.code || instrument?.symbol || '').trim().toUpperCase();
  const appCodeMatch = code.match(/^([A-Z0-9]+?)(\d{2})([FGHJKMNQUVXZ])$/);
  if (appCodeMatch) return appCodeMatch[1];

  const rawCodeMatch = code.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d)$/);
  if (rawCodeMatch) return rawCodeMatch[1];

  return code.replace(/00Y$/i, '').replace(/_M$/i, '');
}

function getDatabentoFutureSymbolSpec(instrument) {
  const dataset = getDatabentoFutureDataset(instrument);
  if (!dataset) {
    throw new Error(`${instrument?.exchangeCode || instrument?.code} 暂未配置 Databento 数据集映射`);
  }

  const root = getDatabentoFutureRoot(instrument);
  if (!root) {
    throw new Error(`无法识别 Databento 期货根代码：${instrument?.code || '--'}`);
  }

  if (instrument?.futureMeta?.isMainLike) {
    return {
      dataset,
      root,
      symbol: `${root}.v.0`,
      stypeIn: 'continuous',
      description: `${root}.v.0`
    };
  }

  const rawSymbol = getDatabentoRawContractSymbol(instrument, root);
  return {
    dataset,
    root,
    symbol: rawSymbol,
    stypeIn: 'raw_symbol',
    description: rawSymbol
  };
}

function getDatabentoRawContractSymbol(instrument, fallbackRoot = null) {
  const code = String(instrument?.code || instrument?.symbol || '').trim().toUpperCase();
  const rawCodeMatch = code.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d)$/);
  if (rawCodeMatch) return code;

  const appCodeMatch = code.match(/^([A-Z0-9]+?)(\d{2})([FGHJKMNQUVXZ])$/);
  if (appCodeMatch) {
    const [, root, yy, monthCode] = appCodeMatch;
    return `${root}${monthCode}${yy.slice(-1)}`;
  }

  const root = fallbackRoot || getDatabentoFutureRoot(instrument);
  const expiryKey = String(instrument?.futureMeta?.expiryKey || '');
  const expiryMatch = expiryKey.match(/^(\d{4})(\d{2})$/);
  if (root && expiryMatch) {
    const monthCode = getFutureMonthCodeFromMonth(expiryMatch[2]);
    if (monthCode) return `${root}${monthCode}${expiryMatch[1].slice(-1)}`;
  }

  return code;
}

function getFutureMonthCodeFromMonth(month) {
  const monthText = String(month || '').padStart(2, '0');
  return Object.entries(FUTURE_MONTH_CODE_MAP).find(([, value]) => value === monthText)?.[0] || null;
}

function getDatabentoSchemaSpec(interval) {
  if (interval.key === '1m') {
    return { schema: 'ohlcv-1m', intraday: true, aggregateSeconds: null };
  }
  if (interval.key === '15m') {
    return { schema: 'ohlcv-1m', intraday: true, aggregateSeconds: 15 * 60 };
  }
  if (interval.key === '1h') {
    return { schema: 'ohlcv-1h', intraday: true, aggregateSeconds: null };
  }
  if (interval.key === '4h') {
    return { schema: 'ohlcv-1h', intraday: true, aggregateSeconds: 4 * 60 * 60 };
  }
  return { schema: 'ohlcv-1d', intraday: false, aggregateSeconds: null };
}

function getDatabentoDateRange(instrument, interval, { startOverride = null, endOverride = null } = {}) {
  if (startOverride && endOverride) {
    return {
      start: startOverride,
      end: endOverride
    };
  }

  const end = endOverride || new Date();
  if (interval.intraday) {
    const start = new Date(end);
    start.setDate(start.getDate() - getDatabentoIntradayLookbackDays(interval));
    return { start, end };
  }

  if (instrument?.futureMeta?.isMainLike) {
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    return {
      start,
      end
    };
  }

  return getFutureContractDateRange(instrument);
}

function getDatabentoIntradayLookbackDays(interval) {
  if (interval.key === '1m') return 7;
  if (interval.key === '15m') return 60;
  if (interval.key === '1h' || interval.key === '4h') return 730;
  return 730;
}

async function fetchDatabentoFutureCandles(instrument, interval, options = {}) {
  const loaded = await loadDatabentoOhlcvCandles(instrument, interval, options);
  return {
    candles: loaded.candles,
    sourceName: `Databento ${loaded.spec.dataset} ${loaded.spec.description} ${interval.label}`,
    warnings: loaded.warnings
  };
}

async function fetchDatabentoContinuousFutureCandles(instrument, interval) {
  const loaded = await loadDatabentoOhlcvCandles(instrument, interval, { skipCalendarAggregation: true });
  const warnings = [
    `美国期货主连使用 Databento volume front-month 连续合约 ${loaded.spec.description}，价格为未回调的原始价格。`,
    ...loaded.warnings
  ];

  let definitionById = new Map();
  if (process.env.DATABENTO_ENABLE_CONTINUOUS_DEFINITIONS === '1') {
    try {
      const definitionStart = getDatabentoDefinitionStart(loaded.range.start, loaded.range.end);
      definitionById = await fetchDatabentoContinuousDefinitions(instrument, definitionStart, loaded.range.end, {
        timeoutMs: 4_000
      });
    } catch (error) {
      warnings.push(`Databento 主连合约定义获取失败，换季标记可能不完整：${error?.message || '未知错误'}`);
    }
  } else {
    warnings.push('Databento 主连合约定义暂不随页面同步加载，因此美国主连当前只显示连续K线，不显示换季标记。');
  }

  const taggedCandles = attachDatabentoContractInfo(loaded.candles, definitionById, instrument);
  const rolloverEvents = buildDatabentoContinuousRolloverEvents(taggedCandles, definitionById, instrument);
  let rawCandles = taggedCandles;

  if (interval.key === 'week' || interval.key === 'month') {
    rawCandles = aggregateCalendarCandles(rawCandles, interval.key);
  }

  const historyGaps = findFutureHistoryGaps(rawCandles);
  if (historyGaps.length) {
    const largestGap = historyGaps.reduce((largest, item) => (item.days > largest.days ? item : largest), historyGaps[0]);
    warnings.push(
      `${instrument.code} 的 Databento 主连历史存在 ${historyGaps.length} 段缺口；最大缺口 ${largestGap.from} -> ${largestGap.to}，相隔 ${largestGap.days} 天。`
    );
  }

  const enrichedRollovers = enrichDatabentoContinuousRolloverEvents(rolloverEvents, interval, rawCandles);
  const rolloverContextByDate = mergeFutureRolloverContexts(new Map(), enrichedRollovers);
  rawCandles = attachFutureRolloverContexts(rawCandles, rolloverContextByDate);

  return {
    candles: rawCandles,
    sourceName: `Databento ${loaded.spec.dataset} ${loaded.spec.description} ${interval.label}`,
    warnings,
    rollovers: enrichedRollovers
  };
}

function getDatabentoDefinitionStart(start, end) {
  const endDate = end instanceof Date ? end : new Date(end);
  if (!Number.isFinite(endDate.getTime())) return start;

  const limitedStart = new Date(endDate);
  limitedStart.setUTCDate(limitedStart.getUTCDate() - 220);

  const startDate = start instanceof Date ? start : new Date(start);
  if (!Number.isFinite(startDate.getTime()) || startDate > limitedStart) {
    return start;
  }

  return limitedStart;
}

async function loadDatabentoOhlcvCandles(instrument, interval, options = {}) {
  const spec = getDatabentoFutureSymbolSpec(instrument);
  const schemaSpec = getDatabentoSchemaSpec(interval);
  const range = getDatabentoDateRange(instrument, interval, options);
  const records = await fetchDatabentoTimeseriesInChunks({
    dataset: spec.dataset,
    symbols: spec.symbol,
    schema: schemaSpec.schema,
    stype_in: spec.stypeIn,
    map_symbols: spec.stypeIn === 'continuous' ? 'false' : 'true',
    start: formatDatabentoDateTime(range.start),
    end: formatDatabentoDateTime(range.end)
  }, {
    timeoutMs: options.timeoutMs || 45_000,
    retries: options.retries || 2
  });

  let candles = normalizeDatabentoOhlcvRecords(records, { intraday: schemaSpec.intraday });
  const warnings = [];

  if (schemaSpec.aggregateSeconds) {
    candles = aggregateCandles(candles, schemaSpec.aggregateSeconds);
    warnings.push(`${interval.label} 由 Databento ${schemaSpec.schema} 聚合生成。`);
  }

  if ((interval.key === 'week' || interval.key === 'month') && !options.skipCalendarAggregation) {
    candles = aggregateCalendarCandles(candles, interval.key);
  }

  return {
    candles,
    spec,
    range,
    warnings
  };
}

async function fetchDatabentoContinuousDefinitions(instrument, start, end, options = {}) {
  const spec = getDatabentoFutureSymbolSpec(instrument);
  const cacheKey = `${spec.dataset}:${spec.symbol}:${formatDatabentoDateTime(start)}:${formatDatabentoDateTime(end)}:definitions`;
  const cached = databentoDefinitionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const records = await fetchDatabentoTimeseriesInChunks({
    dataset: spec.dataset,
    symbols: spec.symbol,
    schema: 'definition',
    stype_in: spec.stypeIn,
    map_symbols: 'false',
    start: formatDatabentoDateTime(start),
    end: formatDatabentoDateTime(end)
  }, {
    timeoutMs: options.timeoutMs || 45_000,
    retries: options.retries || 1
  });

  const definitionById = new Map();
  for (const row of records) {
    const instrumentId = toFiniteNumber(row?.hd?.instrument_id ?? row?.instrument_id ?? row?.raw_instrument_id);
    const rawSymbol = String(row?.raw_symbol || '').trim().toUpperCase();
    if (!Number.isFinite(instrumentId) || !rawSymbol || row.instrument_class !== 'F') continue;

    definitionById.set(instrumentId, {
      instrumentId,
      rawSymbol,
      expiration: row.expiration || null,
      maturityYear: toFiniteNumber(row.maturity_year),
      maturityMonth: toFiniteNumber(row.maturity_month),
      exchange: row.exchange || '',
      currency: row.currency || ''
    });
  }

  databentoDefinitionCache.set(cacheKey, {
    expiresAt: Date.now() + 30 * 60 * 1000,
    data: definitionById
  });

  return definitionById;
}

function attachDatabentoContractInfo(candles, definitionById, parentInstrument) {
  return (candles || []).map((candle) => {
    const definition = definitionById.get(candle.databentoInstrumentId);
    if (!definition) return candle;

    const contract = createDatabentoContractInstrument(parentInstrument, definition, candleDateKey(candle.time));
    return {
      ...candle,
      contractCode: contract.code,
      contractName: contract.name,
      contractExpiry: contract.futureMeta?.expiryLabel || null
    };
  });
}

function buildDatabentoContinuousRolloverEvents(candles, definitionById, parentInstrument) {
  const events = [];
  let previous = null;

  for (const candle of candles || []) {
    if (!previous) {
      previous = candle;
      continue;
    }

    if (candle.databentoInstrumentId === previous.databentoInstrumentId) {
      previous = candle;
      continue;
    }

    const tradeDate = normalizeDate(candle.tradeDate || candleDateKey(candle.time));
    const fromDefinition = definitionById.get(previous.databentoInstrumentId);
    const toDefinition = definitionById.get(candle.databentoInstrumentId);
    if (!fromDefinition || !toDefinition) {
      previous = candle;
      continue;
    }

    const fromInstrument = createDatabentoContractInstrument(parentInstrument, fromDefinition, candleDateKey(previous.time));
    const toInstrument = createDatabentoContractInstrument(parentInstrument, toDefinition, tradeDate);

    events.push({
      switchDate: tradeDate,
      reason: 'databento-volume-front-month',
      fromInstrument,
      toInstrument,
      fromExpiry: fromInstrument.futureMeta?.expiryLabel || null,
      toExpiry: toInstrument.futureMeta?.expiryLabel || null,
      fromMonthLabel: formatFutureMonthLabel(fromInstrument.futureMeta?.expiryMonth, fromInstrument.futureMeta?.expiryLabel),
      toMonthLabel: formatFutureMonthLabel(toInstrument.futureMeta?.expiryMonth, toInstrument.futureMeta?.expiryLabel),
      fromVolume: toFiniteNumber(previous.volume) || 0,
      toVolume: toFiniteNumber(candle.volume) || 0,
      fromPrice: toFiniteNumber(previous.close),
      toPrice: toFiniteNumber(candle.close),
      fromDailyMid: getDailyMidpoint(previous),
      toDailyMid: getDailyMidpoint(candle)
    });

    previous = candle;
  }

  return events;
}

function enrichDatabentoContinuousRolloverEvents(events, interval, displayCandles) {
  return (events || [])
    .map((event) => {
      const markerTime = resolveFutureRolloverMarkerTime(event.switchDate, interval, displayCandles);
      const premium = Number.isFinite(event.fromDailyMid) && Number.isFinite(event.toDailyMid)
        ? event.toDailyMid - event.fromDailyMid
        : null;

      return {
        date: event.switchDate,
        markerTime,
        fromCode: event.fromInstrument.code,
        toCode: event.toInstrument.code,
        fromName: event.fromInstrument.name,
        toName: event.toInstrument.name,
        fromExpiry: event.fromExpiry,
        toExpiry: event.toExpiry,
        fromMonthLabel: event.fromMonthLabel,
        toMonthLabel: event.toMonthLabel,
        fromVolume: event.fromVolume,
        toVolume: event.toVolume,
        fromPrice: event.fromPrice,
        toPrice: event.toPrice,
        fromAveragePrice: event.fromDailyMid,
        toAveragePrice: event.toDailyMid,
        reason: event.reason,
        isSwitch: true,
        premium,
        premiumRate: Number.isFinite(premium) && Number.isFinite(event.fromDailyMid) && event.fromDailyMid !== 0
          ? (premium / event.fromDailyMid) * 100
          : null,
        premiumSource: 'databento-daily-midpoint',
        markerText: `${event.fromMonthLabel}→${event.toMonthLabel}`
      };
    })
    .filter((item) => item.markerTime != null);
}

function createDatabentoContractInstrument(parentInstrument, definition, fallbackDate = null) {
  const rawSymbol = String(definition?.rawSymbol || parentInstrument?.code || '').trim().toUpperCase();
  const futureMeta = buildDatabentoFutureMeta(parentInstrument, definition, fallbackDate);
  const displayName = rawSymbol
    ? `${parentInstrument?.name || parentInstrument?.displayName || futureMeta.familyRoot} ${rawSymbol}`
    : (parentInstrument?.name || parentInstrument?.displayName || parentInstrument?.code);

  return {
    ...parentInstrument,
    id: `FUTURE:${rawSymbol || parentInstrument?.code}`,
    code: rawSymbol || parentInstrument?.code,
    symbol: rawSymbol || parentInstrument?.symbol,
    provider: 'databento-future',
    name: displayName,
    displayName,
    futureMeta,
    supportsAdjustments: false
  };
}

function buildDatabentoFutureMeta(parentInstrument, definition, fallbackDate = null) {
  const root = getDatabentoFutureRoot(parentInstrument);
  let year = toFiniteNumber(definition?.maturityYear);
  let month = toFiniteNumber(definition?.maturityMonth);

  if ((!Number.isFinite(year) || !Number.isFinite(month)) && definition?.expiration) {
    const expirationDate = new Date(normalizeDatabentoTimestamp(definition.expiration));
    if (Number.isFinite(expirationDate.getTime())) {
      year = expirationDate.getUTCFullYear();
      month = expirationDate.getUTCMonth() + 1;
    }
  }

  if ((!Number.isFinite(year) || !Number.isFinite(month)) && definition?.rawSymbol) {
    const inferred = inferDatabentoExpiryFromRawSymbol(definition.rawSymbol, fallbackDate);
    year = inferred?.year ?? year;
    month = inferred?.month ?? month;
  }

  const monthText = Number.isFinite(month) ? String(month).padStart(2, '0') : null;
  return {
    familyRoot: root,
    familyKey: root ? `${parentInstrument?.countryCode}:${parentInstrument?.exchangeCode}:${root}` : null,
    expiryKey: Number.isFinite(year) && monthText ? `${year}${monthText}` : null,
    expiryLabel: Number.isFinite(year) && monthText ? `${String(year).slice(2)}${monthText}` : null,
    expiryMonth: monthText,
    isMainLike: false,
    mainPattern: null
  };
}

function inferDatabentoExpiryFromRawSymbol(rawSymbol, fallbackDate = null) {
  const match = String(rawSymbol || '').trim().toUpperCase().match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d)$/);
  if (!match) return null;

  const month = Number(FUTURE_MONTH_CODE_MAP[match[2]]);
  const yearDigit = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(yearDigit)) return null;

  const reference = fallbackDate ? new Date(`${normalizeDate(fallbackDate)}T00:00:00Z`) : new Date();
  const referenceYear = Number.isFinite(reference.getTime()) ? reference.getUTCFullYear() : new Date().getUTCFullYear();
  const referenceMonth = Number.isFinite(reference.getTime()) ? reference.getUTCMonth() + 1 : 1;
  let year = Math.floor(referenceYear / 10) * 10 + yearDigit;

  while (year < referenceYear || (year === referenceYear && month < referenceMonth)) {
    year += 10;
  }
  while (year - referenceYear > 9) {
    year -= 10;
  }

  return { year, month };
}

async function fetchDatabentoTimeseriesInChunks(params, options = {}) {
  const chunks = buildDatabentoTimeChunks(params.start, params.end, params.schema);
  if (chunks.length <= 1) {
    return fetchDatabentoTimeseries(params, options);
  }

  const concurrency = getDatabentoChunkConcurrency(params.schema);
  const chunkResults = await mapWithConcurrency(chunks, concurrency, async (chunk) =>
    fetchDatabentoTimeseries({
      ...params,
      start: chunk.start,
      end: chunk.end
    }, options)
  );

  return chunkResults.flat().sort((left, right) => {
    const leftTime = left?.hd?.ts_event || left?.ts_recv || '';
    const rightTime = right?.hd?.ts_event || right?.ts_recv || '';
    return String(leftTime).localeCompare(String(rightTime));
  });
}

function buildDatabentoTimeChunks(start, end, schema) {
  const startMs = Date.parse(normalizeDatabentoTimestamp(start));
  const endMs = Date.parse(normalizeDatabentoTimestamp(end));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [{ start, end }];
  }

  const chunkDays = getDatabentoChunkDays(schema);
  if (!chunkDays) return [{ start, end }];

  const chunkMs = chunkDays * DAY_MS;
  if (endMs - startMs <= chunkMs) {
    return [{ start, end }];
  }

  const chunks = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const next = Math.min(endMs, cursor + chunkMs);
    chunks.push({
      start: new Date(cursor).toISOString(),
      end: new Date(next).toISOString()
    });
    cursor = next;
  }

  return chunks;
}

function getDatabentoChunkDays(schema) {
  if (schema === 'ohlcv-1m') return 31;
  if (schema === 'ohlcv-1h') return 180;
  if (schema === 'ohlcv-1d' || schema === 'definition') return 366;
  return null;
}

function getDatabentoChunkConcurrency(schema) {
  if (schema === 'ohlcv-1m') return 2;
  if (schema === 'ohlcv-1h') return 3;
  return 6;
}

async function fetchDatabentoTimeseries(params, { timeoutMs = 45_000, retries = 2 } = {}) {
  if (!databentoKey) {
    throw new Error('未配置 DATABENTO_API_KEY');
  }

  const bodyParams = {
    encoding: 'json',
    compression: 'none',
    pretty_px: 'true',
    pretty_ts: 'true',
    map_symbols: 'true',
    ...params
  };

  let lastError;
  let adjustedForAvailableEnd = false;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const body = new URLSearchParams(bodyParams);
    try {
      const response = await fetch(new URL('/v0/timeseries.get_range', DATABENTO_HISTORICAL_URL), {
        method: 'POST',
        headers: {
          accept: 'application/json,application/jsonl,text/plain,*/*',
          authorization: `Basic ${Buffer.from(`${databentoKey}:`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'stock-kline-dashboard/0.2'
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });

      const text = await response.text();
      if (response.ok) {
        return parseDatabentoJsonl(text);
      }

      const payload = tryParseJson(text);
      const availableEnd = payload?.detail?.payload?.available_end;
      if (!adjustedForAvailableEnd && availableEnd && bodyParams.end && Date.parse(normalizeDatabentoTimestamp(bodyParams.end)) > Date.parse(normalizeDatabentoTimestamp(availableEnd))) {
        bodyParams.end = availableEnd;
        adjustedForAvailableEnd = true;
        attempt -= 1;
        continue;
      }

      throw new Error(payload?.detail?.message || text.slice(0, 300) || `Databento HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(450 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('Databento 请求失败');
}

function parseDatabentoJsonl(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeDatabentoOhlcvRecords(records, { intraday }) {
  const candles = (records || [])
    .filter((row) => row?.hd?.rtype === 35 || row?.open !== undefined)
    .map((row) => {
      const timestamp = row?.hd?.ts_event || row?.ts_event || row?.ts_recv;
      const timestampMs = parseDatabentoTimestampMs(timestamp);
      return {
        time: intraday ? Math.floor(timestampMs / 1000) : normalizeDate(timestamp),
        open: toFiniteNumber(row.open),
        high: toFiniteNumber(row.high),
        low: toFiniteNumber(row.low),
        close: toFiniteNumber(row.close),
        volume: toFiniteNumber(row.volume),
        databentoInstrumentId: toFiniteNumber(row?.hd?.instrument_id ?? row.instrument_id),
        databentoSymbol: row.symbol || null
      };
    })
    .filter(isValidCandle)
    .sort((left, right) => compareChartTimes(left.time, right.time));

  return dedupeDatabentoCandlesByTime(candles);
}

function dedupeDatabentoCandlesByTime(candles) {
  const byTime = new Map();
  for (const candle of candles || []) {
    const existing = byTime.get(candle.time);
    if (!existing || (toFiniteNumber(candle.volume) || 0) >= (toFiniteNumber(existing.volume) || 0)) {
      byTime.set(candle.time, candle);
    }
  }
  return [...byTime.values()].sort((left, right) => compareChartTimes(left.time, right.time));
}

function compareChartTimes(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left || '').localeCompare(String(right || ''));
}

function formatDatabentoDateTime(value) {
  if (typeof value === 'string') {
    return normalizeDatabentoTimestamp(value);
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function normalizeDatabentoTimestamp(value) {
  const text = String(value || '');
  return text.replace(/\.(\d{3})\d+(Z)?$/, '.$1$2');
}

function parseDatabentoTimestampMs(value) {
  const normalized = normalizeDatabentoTimestamp(value);
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

async function getTqSdkFutureFamilyContracts(instrument) {
  const familyKey = instrument?.futureMeta?.familyKey;
  if (!familyKey) return [];

  const cached = tqFutureFamilyCache.get(familyKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const exchangeId = mapLocalFutureExchangeToTq(instrument.exchangeCode);
  const productId = instrument.futureMeta?.familyRoot;
  if (!exchangeId || !productId) {
    return [];
  }

  const contractPayloads = await Promise.all([
    runTqSdkBridge('contracts', {
      exchange_id: exchangeId,
      product_id: productId,
      expired: true
    }),
    runTqSdkBridge('contracts', {
      exchange_id: exchangeId,
      product_id: productId,
      expired: false
    })
  ]);

  const mergedRows = new Map();
  for (const payload of contractPayloads) {
    for (const row of payload.contracts || []) {
      const fullSymbol = String(row.symbol || '');
      const code = fullSymbol.includes('.') ? fullSymbol.split('.').pop() : fullSymbol;
      if (code) mergedRows.set(code, row);
    }
  }

  const data = [...mergedRows.values()]
    .map((row) => {
      const fullSymbol = String(row.symbol || '');
      const code = fullSymbol.includes('.') ? fullSymbol.split('.').pop() : fullSymbol;
      const name = row.instrument_name || code;
      const exchangeCode = mapTqFutureExchangeToLocal(row.exchange_id);
      const futureMeta = buildFutureMetaFromTqContractRow({
        code,
        name,
        exchangeCode,
        deliveryYear: row.delivery_year,
        deliveryMonth: row.delivery_month
      });

      return {
        id: `FUTURE:${code}`,
        type: 'FUTURE',
        typeLabel: '期货',
        code,
        symbol: code,
        provider: 'tqsdk-future',
        name,
        chineseName: '',
        displayName: name,
        countryCode: 'CHN',
        exchangeCode,
        expired: Boolean(row.expired),
        futureMeta,
        marketLabel: '国内期货',
        quoteLookupKey: createLookupKey({ type: 'FUTURE', countryCode: 'CHN', exchangeCode, code }),
        searchText: `${code} ${name} 国内期货 ${futureMeta?.familyRoot || ''}`.toLowerCase(),
        supportsAdjustments: false
      };
    })
    .filter((item) => item.futureMeta?.expiryKey)
    .sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));

  tqFutureFamilyCache.set(familyKey, {
    expiresAt: Date.now() + 60 * 60 * 1000,
    data
  });

  return data;
}

async function fetchCustomContinuousFutureCandles(instrument, interval) {
  const upfrontWarnings = [];
  if (isDatabentoUsFutureInstrument(instrument)) {
    try {
      return await fetchDatabentoContinuousFutureCandles(instrument, interval);
    } catch (error) {
      upfrontWarnings.push(`Databento ${instrument.code} 主连获取失败，暂回退原有期货接口：${error?.message || '未知错误'}`);
    }
  }

  const catalog = await getCatalog();
  const familyContracts = await getFutureFamilyContracts(catalog, instrument);

  if (!familyContracts.length) {
    return {
      candles: [],
      sourceName: `${instrument.name} 自定义主力连续`,
      warnings: [
        ...upfrontWarnings,
        `${instrument.code} 未找到可拼接的季月合约，当前无法按你的规则生成主连。`
      ],
      rollovers: []
    };
  }

  const intervalContracts = interval.intraday && isTqSdkDomesticFutureInstrument(instrument)
    ? selectTqSdkIntradayContracts(familyContracts, interval)
    : familyContracts;

  let dailyFetches;
  if (isTqSdkDomesticFutureInstrument(instrument)) {
    try {
      const batchMap = await loadTqSdkFutureKlines(intervalContracts, CHART_INTERVALS.day, {
        dayBased: true,
        dataLength: interval.intraday ? getTqSdkIntradayMainDailyLength(interval) : null
      });
      dailyFetches = intervalContracts.map((contract) => ({
        status: 'fulfilled',
        value: {
          instrument: contract,
          result: {
            candles: batchMap.get(contract.id) || [],
            sourceName: `TqSdk 国内期货 ${contract.code} 日K`,
            warnings: []
          }
        }
      }));
    } catch (reason) {
      dailyFetches = intervalContracts.map(() => ({ status: 'rejected', reason }));
    }
  } else {
    dailyFetches = await mapWithConcurrency(intervalContracts, 3, async (contract) => {
      try {
        return {
          status: 'fulfilled',
          value: {
            instrument: contract,
            result: await fetchFutureContractDailyCandles(contract)
          }
        };
      } catch (reason) {
        return {
          status: 'rejected',
          reason
        };
      }
    });
  }

  const dailyContracts = dailyFetches
    .filter((entry) => entry.status === 'fulfilled' && entry.value.result.candles?.length)
    .map((entry) => ({
      instrument: entry.value.instrument,
      futureMeta: entry.value.instrument.futureMeta,
      candles: entry.value.result.candles
    }))
    .sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));

  const warnings = [...upfrontWarnings];
  for (const entry of dailyFetches) {
    if (entry.status === 'rejected') {
      warnings.push(`季月合约日K获取失败：${entry.reason?.message || '未知错误'}`);
    }
  }

  if (!dailyContracts.length) {
    return {
      candles: [],
      sourceName: `${instrument.name} 自定义主力连续`,
      warnings: [
        `${instrument.code} 的季月合约日K暂不可用，当前无法按你的规则生成主连。`,
        ...warnings
      ],
      rollovers: []
    };
  }

  const dailySeries = buildCustomFutureDailySeries(dailyContracts);
  let rawCandles = dailySeries.candles;

  if (interval.intraday) {
    let intervalFetches;
    if (isTqSdkDomesticFutureInstrument(instrument)) {
      const intradayCandidates = selectTqSdkIntradaySelectedContracts(dailyContracts, dailySeries, interval);
      try {
        const batchMap = await loadTqSdkFutureKlines(intradayCandidates, interval, { dayBased: false });
        intervalFetches = intradayCandidates.map((contract) => ({
          status: 'fulfilled',
          value: {
            instrument: contract,
            futureMeta: contract.futureMeta,
            result: {
              candles: batchMap.get(contract.id) || [],
              sourceName: `TqSdk 国内期货 ${contract.code} ${interval.label}`,
              warnings: []
            }
          }
        }));
      } catch (reason) {
        intervalFetches = intradayCandidates.map(() => ({ status: 'rejected', reason }));
      }
    } else {
      intervalFetches = await mapWithConcurrency(dailyContracts, 3, async (contract) => {
        try {
          return {
            status: 'fulfilled',
            value: {
              instrument: contract.instrument,
              futureMeta: contract.futureMeta,
              result: await fetchDirectFutureCandles(contract.instrument, interval)
            }
          };
        } catch (reason) {
          return {
            status: 'rejected',
            reason
          };
        }
      });
    }

    let intradayContracts = intervalFetches
      .filter((entry) => entry.status === 'fulfilled' && entry.value.result.candles?.length)
      .map((entry) => ({
        instrument: entry.value.instrument,
        futureMeta: entry.value.futureMeta,
        candles: entry.value.result.candles
      }))
      .sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));

    for (const entry of intervalFetches) {
      if (entry.status === 'rejected') {
        warnings.push(`季月合约 ${interval.label} 获取失败：${entry.reason?.message || '未知错误'}`);
      }
    }

    const intradaySeries = buildCustomFutureIntradaySeries(intradayContracts, dailySeries.selectedByDate);
    if (intradaySeries.candles.length) {
      rawCandles = intradaySeries.candles;
    } else {
      rawCandles = [];
      warnings.push(`当前未取到 ${instrument.code} 的 ${interval.label} 具体合约数据，因此无法按你的规则生成该周期。`);
    }
  } else if (interval.key === 'week' || interval.key === 'month') {
    rawCandles = aggregateCalendarCandles(rawCandles, interval.key);
  }

  const historyGaps = findFutureHistoryGaps(rawCandles);
  if (historyGaps.length) {
    const largestGap = historyGaps.reduce((largest, item) => (item.days > largest.days ? item : largest), historyGaps[0]);
    warnings.push(
      `${instrument.code} 的可拼接月合约历史存在 ${historyGaps.length} 段缺口；当前只展示数据源能提供的真实合约区间。最大缺口 ${largestGap.from} -> ${largestGap.to}，相隔 ${largestGap.days} 天。`
    );
  }

  const enrichedRollovers = await enrichFutureRolloverEvents(dailySeries.events, interval, rawCandles);
  const rolloverContextByDate = mergeFutureRolloverContexts(dailySeries.contextByDate, enrichedRollovers);
  rawCandles = attachFutureRolloverContexts(rawCandles, rolloverContextByDate);

  return {
    candles: rawCandles,
    sourceName: `${instrument.name} 自定义主力连续`,
    warnings,
    rollovers: enrichedRollovers
  };
}

function mergeFutureRolloverContexts(contextByDate, enrichedRollovers) {
  const merged = new Map(contextByDate || []);

  for (const rollover of enrichedRollovers || []) {
    const date = normalizeDate(rollover.date);
    if (!date) continue;

    const current = merged.get(date) || {};
    merged.set(date, {
      ...current,
      ...rollover,
      date,
      isSwitch: true
    });
  }

  return merged;
}

function attachFutureRolloverContexts(candles, contextByDate) {
  if (!(contextByDate instanceof Map) || !contextByDate.size) return candles;

  return (candles || []).map((candle) => {
    const tradeDate = normalizeDate(candle.tradeDate || candle.endDate || candle.startDate || candleDateKey(candle.time));
    const context = contextByDate.get(tradeDate);
    if (!context) return candle;

    return {
      ...candle,
      rolloverContext: {
        ...context,
        markerTime: context.markerTime ?? candle.time
      }
    };
  });
}

async function getFutureFamilyContracts(catalog, instrument) {
  if (isTqSdkDomesticFutureInstrument(instrument)) {
    return getTqSdkFutureFamilyContracts(instrument);
  }

  const familyKey = instrument?.futureMeta?.familyKey;
  if (!familyKey) return [];

  return catalog
    .filter((item) =>
      item.type === 'FUTURE' &&
      item.id !== instrument.id &&
      item.futureMeta?.familyKey === familyKey &&
      item.futureMeta?.expiryKey
    )
    .sort((left, right) => compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey));
}

function compareExpiryKeys(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function getFutureContractDateRange(instrument) {
  const now = new Date();
  const code = String(instrument?.code || '');
  if (/^[A-Za-z]+\d{3}$/.test(code)) {
    return {
      start: new Date(FULL_HISTORY_START),
      end: now
    };
  }

  const expiryKey = String(instrument?.futureMeta?.expiryKey || '');
  const match = expiryKey.match(/^(\d{4})(\d{2})$/);
  if (!match) {
    const start = new Date(now);
    start.setDate(start.getDate() - 400);
    return { start, end: now };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const expiryMonthStart = new Date(year, month - 1, 1);
  const start = new Date(expiryMonthStart);
  start.setDate(start.getDate() - 420);

  const end = new Date(year, month, 0, 23, 59, 59);
  end.setDate(end.getDate() + 31);

  return {
    start,
    end: end > now ? now : end
  };
}

function buildCustomFutureDailySeries(contractSeries) {
  const prepared = contractSeries.map((entry) => ({
    ...entry,
    byDate: new Map((entry.candles || []).map((candle) => [normalizeDate(candle.time), candle]))
  }));
  const allDates = [...new Set(prepared.flatMap((entry) => [...entry.byDate.keys()]))].sort((left, right) => left.localeCompare(right));
  const selectedByDate = new Map();
  const events = [];
  let current = null;

  for (const tradeDate of allDates) {
    const available = prepared.filter((entry) => entry.byDate.has(tradeDate));
    if (!available.length) continue;

    if (!current) {
      current = available[0];
    } else {
      const currentCandle = current.byDate.get(tradeDate);
      if (currentCandle) {
        const currentVolume = toFiniteNumber(currentCandle.volume) || 0;
        const next = available
          .filter((entry) => compareExpiryKeys(entry.futureMeta?.expiryKey, current.futureMeta?.expiryKey) > 0)
          .filter((entry) => (toFiniteNumber(entry.byDate.get(tradeDate)?.volume) || 0) > currentVolume)
          .sort((left, right) => {
            const volumeDiff = (toFiniteNumber(right.byDate.get(tradeDate)?.volume) || 0) - (toFiniteNumber(left.byDate.get(tradeDate)?.volume) || 0);
            if (volumeDiff !== 0) return volumeDiff;
            return compareExpiryKeys(left.futureMeta?.expiryKey, right.futureMeta?.expiryKey);
          })[0];

        if (next && next.instrument.id !== current.instrument.id) {
          events.push(createFutureRolloverEvent(tradeDate, current, next, 'volume'));
          current = next;
        }
      }
    }

    if (current?.byDate.has(tradeDate)) {
      selectedByDate.set(tradeDate, current);
    }
  }

  const candles = allDates
    .map((tradeDate) => {
      const selected = selectedByDate.get(tradeDate);
      const candle = selected?.byDate.get(tradeDate);
      if (!candle) return null;

      return {
        ...candle,
        tradeDate,
        startDate: tradeDate,
        endDate: tradeDate,
        contractCode: selected.instrument.code,
        contractName: selected.instrument.name,
        contractExpiry: selected.futureMeta?.expiryLabel || null
      };
    })
    .filter(isValidCandle);

  return {
    candles,
    selectedByDate,
    events,
    contextByDate: buildFutureRolloverContextByDate(prepared, selectedByDate, events)
  };
}

function createFutureRolloverEvent(tradeDate, fromContract, toContract, reason) {
  const fromCandle = fromContract.byDate.get(tradeDate);
  const toCandle = toContract.byDate.get(tradeDate);
  const fromDailyMid = getDailyMidpoint(fromCandle);
  const toDailyMid = getDailyMidpoint(toCandle);

  return {
    switchDate: tradeDate,
    reason,
    fromInstrument: fromContract.instrument,
    toInstrument: toContract.instrument,
    fromExpiry: fromContract.futureMeta?.expiryLabel || null,
    toExpiry: toContract.futureMeta?.expiryLabel || null,
    fromMonthLabel: formatFutureMonthLabel(fromContract.futureMeta?.expiryMonth, fromContract.futureMeta?.expiryLabel),
    toMonthLabel: formatFutureMonthLabel(toContract.futureMeta?.expiryMonth, toContract.futureMeta?.expiryLabel),
    fromVolume: toFiniteNumber(fromCandle?.volume) || 0,
    toVolume: toFiniteNumber(toCandle?.volume) || 0,
    fromPrice: toFiniteNumber(fromCandle?.close),
    toPrice: toFiniteNumber(toCandle?.close),
    fromDailyMid,
    toDailyMid
  };
}

function buildFutureRolloverContextByDate(preparedContracts, selectedByDate, events) {
  const contextByDate = new Map();
  const sortedEvents = [...(events || [])].sort((left, right) => left.switchDate.localeCompare(right.switchDate));
  const eventByDate = new Map(sortedEvents.map((event) => [event.switchDate, event]));
  const dates = [...(selectedByDate?.keys?.() || [])].sort((left, right) => left.localeCompare(right));

  for (const tradeDate of dates) {
    const event = eventByDate.get(tradeDate);
    if (event) {
      contextByDate.set(tradeDate, createFutureRolloverContextFromEvent(event));
      continue;
    }

    const nextEvent = sortedEvents.find((item) => item.switchDate > tradeDate);
    if (nextEvent) {
      const nextEventContext = createFutureRolloverContextForTradeDate(preparedContracts, nextEvent, tradeDate);
      if (nextEventContext) {
        contextByDate.set(tradeDate, nextEventContext);
      }
      continue;
    }

    const current = selectedByDate.get(tradeDate);
    const currentCandle = current?.byDate?.get(tradeDate);
    if (!current || !currentCandle) continue;

    const next = findLaterMaxVolumeFutureContract(preparedContracts, current, tradeDate);

    if (!next) continue;

    contextByDate.set(
      tradeDate,
      createFutureRolloverContext({
        tradeDate,
        fromContract: current,
        toContract: next.entry,
        fromCandle: currentCandle,
        toCandle: next.candle,
        isSwitch: false,
        reason: 'last-window-later-max-volume'
      })
    );
  }

  return contextByDate;
}

function createFutureRolloverContextForTradeDate(preparedContracts, event, tradeDate) {
  const fromContract = findPreparedFutureContract(preparedContracts, event.fromInstrument);
  const toContract = findPreparedFutureContract(preparedContracts, event.toInstrument);
  const fromCandle = fromContract?.byDate?.get(tradeDate);
  const toCandle = toContract?.byDate?.get(tradeDate);
  if (!fromContract || !toContract || !fromCandle || !toCandle) return null;

  return createFutureRolloverContext({
    tradeDate,
    fromContract,
    toContract,
    fromCandle,
    toCandle,
    isSwitch: false,
    reason: 'next-rollover-window'
  });
}

function findPreparedFutureContract(preparedContracts, instrument) {
  if (!instrument) return null;
  return (preparedContracts || []).find((entry) =>
    entry.instrument?.id === instrument.id ||
    entry.instrument?.code === instrument.code
  ) || null;
}

function findLaterMaxVolumeFutureContract(preparedContracts, current, tradeDate) {
  return (preparedContracts || [])
    .filter((entry) => compareExpiryKeys(entry.futureMeta?.expiryKey, current.futureMeta?.expiryKey) > 0)
    .map((entry) => {
      const candle = entry.byDate.get(tradeDate);
      return {
        entry,
        candle,
        volume: toFiniteNumber(candle?.volume) || 0
      };
    })
    .filter((item) => item.candle && item.volume > 0)
    .sort((left, right) => {
      const volumeDiff = right.volume - left.volume;
      if (volumeDiff !== 0) return volumeDiff;
      return compareExpiryKeys(left.entry.futureMeta?.expiryKey, right.entry.futureMeta?.expiryKey);
    })[0] || null;
}

function createFutureRolloverContextFromEvent(event) {
  return createFutureRolloverContext({
    tradeDate: event.switchDate,
    fromContract: {
      instrument: event.fromInstrument,
      futureMeta: event.fromInstrument?.futureMeta
    },
    toContract: {
      instrument: event.toInstrument,
      futureMeta: event.toInstrument?.futureMeta
    },
    fromCandle: {
      close: event.fromPrice,
      volume: event.fromVolume,
      high: Number.isFinite(event.fromDailyMid) ? event.fromDailyMid : event.fromPrice,
      low: Number.isFinite(event.fromDailyMid) ? event.fromDailyMid : event.fromPrice
    },
    toCandle: {
      close: event.toPrice,
      volume: event.toVolume,
      high: Number.isFinite(event.toDailyMid) ? event.toDailyMid : event.toPrice,
      low: Number.isFinite(event.toDailyMid) ? event.toDailyMid : event.toPrice
    },
    isSwitch: true,
    reason: event.reason
  });
}

function createFutureRolloverContext({
  tradeDate,
  fromContract,
  toContract,
  fromCandle,
  toCandle,
  isSwitch,
  reason
}) {
  const fromDailyMid = getDailyMidpoint(fromCandle);
  const toDailyMid = getDailyMidpoint(toCandle);
  const premium = Number.isFinite(fromDailyMid) && Number.isFinite(toDailyMid)
    ? toDailyMid - fromDailyMid
    : null;

  return {
    date: tradeDate,
    isSwitch: Boolean(isSwitch),
    fromCode: fromContract?.instrument?.code,
    toCode: toContract?.instrument?.code,
    fromName: fromContract?.instrument?.name,
    toName: toContract?.instrument?.name,
    fromExpiry: fromContract?.futureMeta?.expiryLabel || null,
    toExpiry: toContract?.futureMeta?.expiryLabel || null,
    fromMonthLabel: formatFutureMonthLabel(fromContract?.futureMeta?.expiryMonth, fromContract?.futureMeta?.expiryLabel),
    toMonthLabel: formatFutureMonthLabel(toContract?.futureMeta?.expiryMonth, toContract?.futureMeta?.expiryLabel),
    fromVolume: toFiniteNumber(fromCandle?.volume) || 0,
    toVolume: toFiniteNumber(toCandle?.volume) || 0,
    fromPrice: toFiniteNumber(fromCandle?.close),
    toPrice: toFiniteNumber(toCandle?.close),
    fromAveragePrice: fromDailyMid,
    toAveragePrice: toDailyMid,
    premium: Number.isFinite(premium) ? premium : null,
    premiumRate: Number.isFinite(premium) && Number.isFinite(fromDailyMid) && fromDailyMid !== 0
      ? (premium / fromDailyMid) * 100
      : null,
    premiumSource: 'daily-midpoint-context',
    reason
  };
}

function formatFutureMonthLabel(month, expiryLabel) {
  if (month) return `${Number(month)}月`;
  if (expiryLabel?.slice(2)) return `${Number(expiryLabel.slice(2))}月`;
  return '--';
}

function buildCustomFutureIntradaySeries(contractSeries, selectedByDate) {
  const candles = contractSeries
    .flatMap((entry) =>
      (entry.candles || [])
        .filter((candle) => {
          const tradeDate = normalizeDate(candleDateKey(candle.time));
          const selected = selectedByDate.get(tradeDate);
          return selected?.instrument?.id === entry.instrument.id;
        })
        .map((candle) => ({
          ...candle,
          tradeDate: normalizeDate(candleDateKey(candle.time)),
          startDate: normalizeDate(candleDateKey(candle.time)),
          endDate: normalizeDate(candleDateKey(candle.time)),
          contractCode: entry.instrument.code,
          contractName: entry.instrument.name,
          contractExpiry: entry.futureMeta?.expiryLabel || null
        }))
    )
    .sort((left, right) => Number(left.time) - Number(right.time));

  return {
    candles: dedupeByTime(candles).filter(isValidCandle)
  };
}

async function enrichFutureRolloverEvents(events, interval, displayCandles) {
  if (!events?.length) return [];
  const averageMap = await buildTqSdkFutureRolloverAverageMap(events).catch(() => new Map());

  const enriched = await mapWithConcurrency(events, 2, async (event) => {
    const premiumInfo = await calculateFutureRolloverPremium(event, averageMap);
    const markerTime = resolveFutureRolloverMarkerTime(event.switchDate, interval, displayCandles);

    return {
      date: event.switchDate,
      markerTime,
      fromCode: event.fromInstrument.code,
      toCode: event.toInstrument.code,
      fromName: event.fromInstrument.name,
      toName: event.toInstrument.name,
      fromExpiry: event.fromExpiry,
      toExpiry: event.toExpiry,
      fromMonthLabel: event.fromMonthLabel,
      toMonthLabel: event.toMonthLabel,
      fromVolume: event.fromVolume,
      toVolume: event.toVolume,
      fromPrice: event.fromPrice,
      toPrice: event.toPrice,
      fromAveragePrice: premiumInfo.fromAveragePrice ?? event.fromDailyMid,
      toAveragePrice: premiumInfo.toAveragePrice ?? event.toDailyMid,
      reason: event.reason,
      isSwitch: true,
      premium: premiumInfo.premium,
      premiumRate: premiumInfo.premiumRate,
      premiumSource: premiumInfo.source,
      markerText: `${event.fromMonthLabel}→${event.toMonthLabel}`
    };
  });

  return enriched.filter((item) => item.markerTime != null);
}

async function calculateFutureRolloverPremium(event, averageMap = null) {
  if (
    isTqSdkDomesticFutureInstrument(event?.fromInstrument) ||
    isTqSdkDomesticFutureInstrument(event?.toInstrument)
  ) {
    const fromAverage = getTqSdkAverageFromMap(averageMap, event.fromInstrument, event.switchDate);
    const toAverage = getTqSdkAverageFromMap(averageMap, event.toInstrument, event.switchDate);

    if (Number.isFinite(fromAverage) && Number.isFinite(toAverage) && fromAverage !== 0) {
      const premium = toAverage - fromAverage;
      return {
        premium,
        premiumRate: (premium / fromAverage) * 100,
        fromAveragePrice: fromAverage,
        toAveragePrice: toAverage,
        source: 'tqsdk-1m-downloader-average'
      };
    }
  }

  const [fromResult, toResult] = await Promise.all([
    fetchFutureMinuteSeriesForDate(event.fromInstrument, event.switchDate).catch(() => []),
    fetchFutureMinuteSeriesForDate(event.toInstrument, event.switchDate).catch(() => [])
  ]);

  const fromBars = Array.isArray(fromResult) ? fromResult : (fromResult?.candles || []);
  const toBars = Array.isArray(toResult) ? toResult : (toResult?.candles || []);
  const fromAverage = averageFutureMidPrice(fromBars);
  const toAverage = averageFutureMidPrice(toBars);
  if (Number.isFinite(fromAverage) && Number.isFinite(toAverage) && fromAverage !== 0) {
    const premium = toAverage - fromAverage;
    const fromSource = Array.isArray(fromResult) ? 'minute-average' : (fromResult?.source || 'minute-average');
    const toSource = Array.isArray(toResult) ? 'minute-average' : (toResult?.source || 'minute-average');
    return {
      premium,
      premiumRate: (premium / fromAverage) * 100,
      fromAveragePrice: fromAverage,
      toAveragePrice: toAverage,
      source: fromSource === toSource ? fromSource : `${fromSource}+${toSource}`
    };
  }

  if (Number.isFinite(event.fromDailyMid) && Number.isFinite(event.toDailyMid) && event.fromDailyMid !== 0) {
    const premium = event.toDailyMid - event.fromDailyMid;
    return {
      premium,
      premiumRate: (premium / event.fromDailyMid) * 100,
      fromAveragePrice: event.fromDailyMid,
      toAveragePrice: event.toDailyMid,
      source: 'daily-midpoint-fallback'
    };
  }

  return {
    premium: null,
    premiumRate: null,
    source: 'unavailable'
  };
}

async function buildTqSdkFutureRolloverAverageMap(events) {
  const requests = [];
  const resultMap = new Map();
  for (const event of events || []) {
    for (const instrument of [event.fromInstrument, event.toInstrument]) {
      if (!isTqSdkDomesticFutureInstrument(instrument)) continue;
      const cacheKey = createTqSdkFutureAverageCacheKey(instrument, event.switchDate);
      const cached = futureRolloverAverageCache.get(cacheKey);
      if (cached !== undefined) {
        resultMap.set(cacheKey, cached);
        continue;
      }
      if (!requests.some((request) => request.key === cacheKey)) {
        requests.push({
          key: cacheKey,
          symbol: toTqFutureSymbol(instrument),
          trade_date: event.switchDate,
          duration_seconds: 60
        });
      }
    }
  }

  if (!requests.length) return resultMap;

  const payload = await runTqSdkBridge('day_kline_averages', {
    requests,
    timeout_seconds: Math.max(180, requests.length * 12)
  });

  for (const request of requests) {
    const average = toFiniteNumber(payload.results?.[request.key]?.average);
    const normalized = Number.isFinite(average) ? average : null;
    futureRolloverAverageCache.set(request.key, normalized);
    resultMap.set(request.key, normalized);
  }

  return resultMap;
}

function getTqSdkAverageFromMap(averageMap, instrument, tradeDate) {
  if (!averageMap || !isTqSdkDomesticFutureInstrument(instrument)) return null;
  return averageMap.get(createTqSdkFutureAverageCacheKey(instrument, tradeDate)) ?? null;
}

async function fetchTqSdkFutureDayMinuteAverage(instrument, tradeDate) {
  if (!isTqSdkDomesticFutureInstrument(instrument)) return null;

  const cacheKey = createTqSdkFutureAverageCacheKey(instrument, tradeDate);
  const cached = futureRolloverAverageCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const payload = await runTqSdkBridge('day_kline_average', {
    symbol: toTqFutureSymbol(instrument),
    trade_date: tradeDate,
    duration_seconds: 60,
    timeout_seconds: 120
  });

  const average = toFiniteNumber(payload?.average);
  const normalized = Number.isFinite(average) ? average : null;
  futureRolloverAverageCache.set(cacheKey, normalized);
  return normalized;
}

function createTqSdkFutureAverageCacheKey(instrument, tradeDate) {
  return `${instrument?.id || instrument?.code}:${tradeDate}:tq-1m-downloader-average`;
}

async function fetchFutureMinuteSeriesForDate(instrument, tradeDate) {
  const marketTimeZone = getFutureMarketTimeZone(instrument);
  const start = new Date(`${tradeDate}T00:00:00Z`);
  const end = new Date(`${tradeDate}T23:59:59Z`);

  if (isDatabentoUsFutureInstrument(instrument)) {
    try {
      const result = await fetchDatabentoFutureCandles(instrument, CHART_INTERVALS['1m'], {
        startOverride: start,
        endOverride: end,
        timeoutMs: 20_000,
        retries: 1
      });
      if (result.candles.length) {
        return {
          candles: result.candles,
          source: 'databento-1m-average'
        };
      }
    } catch {
      // Fall through to the legacy futures intraday fallbacks.
    }
  }

  const candidates = [
    { type: 'day', source: 'miana-day-1m' },
    { type: '5min', source: 'miana-5min' },
    { type: '15min', source: 'miana-15min' },
    { type: '30min', source: 'miana-30min' },
    { type: 'h1', source: 'miana-h1' }
  ];

  for (const candidate of candidates) {
    try {
      const candles = await fetchMianaSeries({
        endpoint: '/api/future/v2/kline',
        symbol: instrument.symbol,
        type: candidate.type,
        start,
        end,
        intraday: true,
        marketTimeZone,
        timeoutMs: 6000,
        retries: 1
      });
      if (candles.length) {
        return {
          candles,
          source: candidate.source
        };
      }
    } catch {
      // Continue trying a coarser minute interval.
    }
  }

  return {
    candles: [],
    source: 'minute-unavailable'
  };
}

function getDailyMidpoint(candle) {
  const high = toFiniteNumber(candle?.high);
  const low = toFiniteNumber(candle?.low);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return (high + low) / 2;
}

function averageFutureMidPrice(candles) {
  if (!Array.isArray(candles) || !candles.length) return null;
  const values = candles
    .map((candle) => {
      const high = toFiniteNumber(candle.high);
      const low = toFiniteNumber(candle.low);
      if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
      return (high + low) / 2;
    })
    .filter(Number.isFinite);

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveFutureRolloverMarkerTime(switchDate, interval, candles) {
  const targetDate = normalizeDate(switchDate);
  if (!targetDate || !Array.isArray(candles) || !candles.length) return null;

  const sameDay = candles.filter((candle) => normalizeDate(candle.tradeDate || candleDateKey(candle.time)) === targetDate);
  if (sameDay.length) {
    return interval?.key === 'day' ? sameDay[0].time : sameDay[sameDay.length - 1].time;
  }

  const containing = candles.find((candle) => {
    const startDate = normalizeDate(candle.startDate || candle.tradeDate || candleDateKey(candle.time));
    const endDate = normalizeDate(candle.endDate || candle.tradeDate || candleDateKey(candle.time));
    return startDate && endDate && startDate <= targetDate && endDate >= targetDate;
  });

  return containing?.time || null;
}

function findFutureHistoryGaps(candles, minimumGapDays = 120) {
  if (!Array.isArray(candles) || candles.length < 2) return [];

  const gaps = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previousDate = normalizeDate(candles[index - 1].tradeDate || candleDateKey(candles[index - 1].time));
    const currentDate = normalizeDate(candles[index].tradeDate || candleDateKey(candles[index].time));
    if (!previousDate || !currentDate) continue;

    const previousValue = Date.parse(`${previousDate}T00:00:00Z`);
    const currentValue = Date.parse(`${currentDate}T00:00:00Z`);
    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) continue;

    const deltaDays = Math.round((currentValue - previousValue) / 86400000);
    if (deltaDays > minimumGapDays) {
      gaps.push({
        from: previousDate,
        to: currentDate,
        days: deltaDays
      });
    }
  }

  return gaps;
}

async function fetchRatioCandles(instrument, interval) {
  const config = getBuiltinRatioConfig(instrument.symbol);
  if (!config) {
    throw new Error(`未知汇率品种 ${instrument.symbol}`);
  }

  return buildSyntheticComparisonSeries(config.leftInstrument, config.rightInstrument, config.mode, interval, {
    leftLabel: config.leftLabel,
    leftDisplayName: config.leftDisplayName,
    rightLabel: config.rightLabel,
    rightDisplayName: config.rightDisplayName,
    alignmentLabel: config.alignmentLabel
  });
}

function getBuiltinRatioConfig(symbol) {
  const ndxInstrument = createBuiltinCompareInstrument('INDEX:NDX');
  const btcInstrument = createBuiltinCompareInstrument('CRYPTO:BTC');

  if (symbol === 'btc-ndx') {
    return {
      leftInstrument: btcInstrument,
      rightInstrument: ndxInstrument,
      mode: 'divide',
      leftLabel: 'BTC/USD',
      leftDisplayName: 'BTC/USD',
      rightLabel: 'NDX',
      rightDisplayName: '纳指',
      alignmentLabel: 'BTC/纳指'
    };
  }

  if (symbol === 'ndx-btc') {
    return {
      leftInstrument: ndxInstrument,
      rightInstrument: btcInstrument,
      mode: 'divide',
      leftLabel: 'NDX',
      leftDisplayName: '纳指',
      rightLabel: 'BTC/USD',
      rightDisplayName: 'BTC/USD',
      alignmentLabel: '纳指/BTC'
    };
  }

  return null;
}

function createBuiltinCompareInstrument(id) {
  if (id === 'INDEX:NDX') {
    return {
      id: 'INDEX:NDX',
      type: 'INDEX',
      typeLabel: '指数',
      code: 'NDX',
      symbol: 'NDX',
      provider: 'yahoo-index',
      name: 'Nasdaq Index',
      chineseName: '纳斯达克',
      displayName: 'Nasdaq Index / 纳斯达克',
      countryCode: 'USA',
      exchangeCode: '',
      marketLabel: '美股指数',
      supportsAdjustments: false
    };
  }

  if (id === 'CRYPTO:BTC') {
    return {
      id: 'CRYPTO:BTC',
      type: 'CRYPTO',
      typeLabel: '币圈',
      code: 'BTC',
      symbol: 'BTC',
      provider: 'miana-crypto',
      name: 'Bitcoin',
      chineseName: '比特币',
      displayName: 'Bitcoin / 比特币',
      countryCode: '',
      exchangeCode: '',
      marketLabel: '币圈',
      supportsAdjustments: false
    };
  }

  return null;
}

function resolveCompareMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'add') return 'add';
  if (mode === 'subtract') return 'subtract';
  return 'divide';
}

async function buildCompareDetail(leftInstrument, rightInstrument, mode, interval) {
  const compareResult = await buildSyntheticComparisonSeries(leftInstrument, rightInstrument, mode, interval, {
    leftLabel: leftInstrument.code,
    leftDisplayName: leftInstrument.chineseName || leftInstrument.name || leftInstrument.code,
    rightLabel: rightInstrument.code,
    rightDisplayName: rightInstrument.chineseName || rightInstrument.name || rightInstrument.code,
    alignmentLabel: `${leftInstrument.code}${getCompareOperator(mode)}${rightInstrument.code}`
  });

  const raw = compareResult.candles || [];
  const compareInstrument = {
    id: `COMPARE:${mode}:${leftInstrument.id}:${rightInstrument.id}`,
    type: mode === 'divide' ? 'RATIO' : 'COMPARE',
    typeLabel: mode === 'divide' ? '汇率' : '对比',
    code: `${leftInstrument.code}${getCompareOperator(mode)}${rightInstrument.code}`,
    symbol: `${leftInstrument.symbol}${getCompareOperator(mode)}${rightInstrument.symbol}`,
    provider: 'synthetic-compare',
    name: `${leftInstrument.chineseName || leftInstrument.name || leftInstrument.code}${getCompareOperator(mode)}${rightInstrument.chineseName || rightInstrument.name || rightInstrument.code}`,
    chineseName: `${leftInstrument.chineseName || leftInstrument.name || leftInstrument.code}${getCompareOperator(mode)}${rightInstrument.chineseName || rightInstrument.name || rightInstrument.code}`,
    displayName: `${leftInstrument.code} ${getCompareOperator(mode)} ${rightInstrument.code}`,
    countryCode: '',
    exchangeCode: '',
    marketLabel: mode === 'divide' ? '汇率' : '对比',
    quoteLookupKey: `COMPARE:::${leftInstrument.id}:${mode}:${rightInstrument.id}`,
    supportsAdjustments: false
  };
  const displayRange = getCombinedSeriesRange([
    raw,
    compareResult.components?.[0]?.candles || [],
    compareResult.components?.[1]?.candles || []
  ]);

  return {
    generatedAt: new Date().toISOString(),
    instrument: compareInstrument,
    compare: {
      mode,
      modeLabel: getCompareModeLabel(mode),
      left: leftInstrument,
      right: rightInstrument
    },
    interval: {
      key: interval.key,
      label: interval.label
    },
    quote: buildQuoteFromCandles(raw),
    range: {
      start: displayRange.start,
      end: displayRange.end
    },
    sourceName: compareResult.sourceName,
    components: compareResult.components || [],
    warnings: compareResult.warnings || [],
    supportsAdjustments: false,
    series: {
      raw,
      qfq: null,
      hfq: null
    }
  };
}

async function getCachedCompareDetail(leftInstrument, rightInstrument, mode, interval, { forceRefresh = false } = {}) {
  const intervalCacheKey = interval.cacheKey || interval.key;
  const cacheKey = `${leftInstrument.id}::${rightInstrument.id}::${mode}::${intervalCacheKey}::component-fundamentals-v1`;
  const shouldPersistDiskCache = !(interval.key === '1m' && Number(interval.stockLookbackDays || 0) > 400);
  return getOrLoadResponseCache(
    compareDetailCache,
    cacheKey,
    getChartResponseCacheTtlMs(interval.key),
    () => buildCompareDetail(leftInstrument, rightInstrument, mode, interval),
    {
      forceRefresh,
      diskCacheNamespace: shouldPersistDiskCache ? 'compare-detail' : null,
      staleTtlMs: getChartResponseStaleTtlMs(interval.key)
    }
  );
}

async function buildSyntheticComparisonSeries(leftInstrument, rightInstrument, mode, interval, labels) {
  const [leftResult, rightResult] = await Promise.all([
    fetchInstrumentCandles(leftInstrument, interval),
    fetchInstrumentCandles(rightInstrument, interval)
  ]);
  const [leftAdjustment, rightAdjustment] = await Promise.all([
    buildCompareComponentAdjustedSeries(leftInstrument, leftResult.candles || [], leftResult.rollovers || [], interval),
    buildCompareComponentAdjustedSeries(rightInstrument, rightResult.candles || [], rightResult.rollovers || [], interval)
  ]);

  const alignedRightCandles = interval.intraday
    ? aggregateCandlesToReferencePeriods(rightResult.candles || [], leftResult.candles || [])
    : rightResult.candles || [];

  const rightByTime = new Map(alignedRightCandles.map((item) => [String(item.time), item]));
  const compareCandles = (leftResult.candles || [])
    .map((left) => {
      const right = rightByTime.get(String(left.time));
      if (!right) return null;
      return buildSyntheticPairCandle(left, right, mode);
    })
    .filter(isValidCandle);
  const warnings = [
    ...leftResult.warnings,
    ...rightResult.warnings,
    ...leftAdjustment.warnings,
    ...rightAdjustment.warnings
  ];
  const [leftFundamentals, rightFundamentals] = await Promise.all([
    buildCompareComponentFundamentals(leftInstrument, leftResult.candles || [], interval),
    buildCompareComponentFundamentals(rightInstrument, rightResult.candles || [], interval)
  ]);
  warnings.push(...leftFundamentals.warnings, ...rightFundamentals.warnings);

  if (compareCandles.length < leftResult.candles.length || compareCandles.length < alignedRightCandles.length) {
    warnings.push(`${labels.alignmentLabel} 主对比线按共同时间区间计算：左侧全历史 ${leftResult.candles.length} 根，右侧全历史 ${rightResult.candles.length} 根，结果 ${compareCandles.length} 根。`);
  }

  if (!compareCandles.length) {
    warnings.push(`当前切到 ${interval.label} 时，${labels.alignmentLabel} 没有可用的共同时间区间数据，请切换到日K/周K/月K或更换标的再试。`);
  }

  return {
    candles: compareCandles,
    sourceName: `${leftResult.sourceName} / ${rightResult.sourceName}`,
    components: [
      {
        key: 'left',
        label: labels.leftLabel,
        displayName: labels.leftDisplayName,
        sourceName: leftResult.sourceName,
        candles: leftResult.candles || [],
        qfq: leftAdjustment.qfq,
        hfq: leftAdjustment.hfq,
        fundamentals: leftFundamentals.data
      },
      {
        key: 'right',
        label: labels.rightLabel,
        displayName: labels.rightDisplayName,
        sourceName: rightResult.sourceName,
        candles: rightResult.candles || [],
        qfq: rightAdjustment.qfq,
        hfq: rightAdjustment.hfq,
        fundamentals: rightFundamentals.data
      }
    ],
    warnings
  };
}

async function buildCompareComponentFundamentals(instrument, candles, interval) {
  if (instrument?.type !== 'STOCK' || interval?.intraday || !candles?.length) {
    return {
      data: {
        current: null,
        rows: [],
        metrics: []
      },
      warnings: []
    };
  }

  try {
    const latestQuote = (await enrichWithQuotes([instrument]))?.[0]?.quote || buildQuoteFromCandles(candles);
    const result = await buildStockFundamentals(instrument, candles, latestQuote);
    return {
      data: {
        current: result.current,
        rows: result.rows,
        metrics: result.metrics
      },
      warnings: (result.warnings || []).map((warning) => `${instrument.code} 财务：${warning}`)
    };
  } catch (error) {
    return {
      data: {
        current: null,
        rows: [],
        metrics: STOCK_FUNDAMENTAL_METRICS
      },
      warnings: [`${instrument.code} 财务指标计算失败：${error.message}`]
    };
  }
}

async function buildCompareComponentAdjustedSeries(instrument, candles, rollovers, interval = null) {
  if (!candles?.length) {
    return { qfq: null, hfq: null, warnings: [] };
  }

  if (interval?.intraday) {
    return { qfq: null, hfq: null, warnings: [] };
  }

  if (!instrument?.supportsAdjustments && !isCustomMainFutureInstrument(instrument)) {
    return { qfq: null, hfq: null, warnings: [] };
  }

  try {
    const result = await buildInstrumentAdjustedSeries(instrument, candles, rollovers);
    return {
      qfq: result.qfq,
      hfq: result.hfq,
      warnings: (result.warnings || []).map((warning) => `${instrument.code} 复权：${warning}`)
    };
  } catch (error) {
    return {
      qfq: null,
      hfq: null,
      warnings: [`${instrument.code} 复权计算失败：${error.message}`]
    };
  }
}

function buildSyntheticPairCandle(left, right, mode) {
  if (mode === 'add') {
    return {
      time: left.time,
      open: safeAdd(left.open, right.open),
      high: safeAdd(left.high, right.high),
      low: safeAdd(left.low, right.low),
      close: safeAdd(left.close, right.close),
      volume: 0
    };
  }

  if (mode === 'subtract') {
    return {
      time: left.time,
      open: safeSubtract(left.open, right.open),
      high: safeSubtract(left.high, right.low),
      low: safeSubtract(left.low, right.high),
      close: safeSubtract(left.close, right.close),
      volume: 0
    };
  }

  return {
    time: left.time,
    open: safeDivide(left.open, right.open),
    high: safeDivide(left.high, right.low),
    low: safeDivide(left.low, right.high),
    close: safeDivide(left.close, right.close),
    volume: 0
  };
}

function buildMissingIntervalWarning(instrument, interval) {
  const name = instrument?.displayName || instrument?.name || instrument?.code || '当前品种';
  if (interval.intraday) {
    return `${name} 当前没有可用的 ${interval.label} 数据，请切换到日K/周K/月K再试。`;
  }
  return `${name} 当前没有可用的 ${interval.label} 数据，请切换到其他周期再试。`;
}

async function fetchStockCandles(instrument, interval) {
  const isChinaStock = instrument.countryCode === 'CHN';

  if (interval.intraday && isChinaStock) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - interval.stockLookbackDays);
    const type = interval.key === '1m' ? '1min' : interval.key === '15m' ? '15min' : '60min';
    const base = interval.key === '1m' && interval.stockLookbackDays > 10
      ? await fetchMianaIntradaySeriesInChunks({
          endpoint: '/api/stock/v2/kline',
          symbol: instrument.symbol,
          type,
          start,
          end,
          marketTimeZone: 'Asia/Shanghai',
          chunkDays: 7
        })
      : await fetchMianaSeries({
          endpoint: '/api/stock/v2/kline',
          symbol: instrument.symbol,
          type,
          start,
          end,
          intraday: true,
          marketTimeZone: 'Asia/Shanghai'
        });

    const candles = interval.key === '4h' ? aggregateCandles(base, interval.aggregateSeconds) : base;
    return {
      candles,
      sourceName: `Miana 股票 ${instrument.symbol} ${interval.label}${interval.stockLookbackDays > 10 ? ` ${interval.stockLookbackDays}天分段` : ''}`,
      warnings: []
    };
  }

  if (interval.intraday) {
    const day5 = await fetchMianaSeries({
      endpoint: '/api/stock/v2/kline',
      symbol: instrument.symbol,
      type: 'day5',
      intraday: true,
      marketTimeZone: instrument.countryCode === 'USA' ? 'America/New_York' : 'Asia/Hong_Kong'
    });

    if (interval.key === '1m') {
      return {
        candles: day5,
        sourceName: `Miana 股票 ${instrument.symbol} day5 ${interval.label}`,
        warnings: [`${instrument.marketLabel} 的 ${interval.label} 使用最近 5 个交易日分钟线。`]
      };
    }

    const bucketSeconds = interval.key === '15m' ? 15 * 60 : interval.key === '1h' ? 60 * 60 : 4 * 60 * 60;
    return {
      candles: aggregateCandles(day5, bucketSeconds),
      sourceName: `Miana 股票 ${instrument.symbol} day5 聚合 ${interval.label}`,
      warnings: [`${instrument.marketLabel} 的 ${interval.label} 通过最近 5 个交易日分钟线聚合。`]
    };
  }

  const end = new Date();
  const start = new Date(FULL_HISTORY_START);

  const candles = await fetchMianaHistoricalSeries({
    endpoint: '/api/stock/v2/kline',
    symbol: instrument.symbol,
    type: interval.mianaType,
    start,
    end,
    marketTimeZone: instrument.countryCode === 'USA' ? 'America/New_York' : 'Asia/Shanghai'
  });

  return {
    candles,
    sourceName: `Miana 股票 ${instrument.symbol} ${interval.label}`,
    warnings: []
  };
}

async function fetchMianaGenericCandles(instrument, interval, { endpoint, marketTimeZone }) {
  if (interval.intraday) {
    const day5 = await fetchMianaSeries({
      endpoint,
      symbol: instrument.symbol,
      type: 'day5',
      intraday: true,
      marketTimeZone
    });

    if (interval.key === '1m') {
      return {
        candles: day5,
        sourceName: `Miana ${instrument.typeLabel} ${instrument.symbol} day5 ${interval.label}`,
        warnings: [`${instrument.typeLabel} 的 ${interval.label} 使用最近 5 个交易日分钟线。`]
      };
    }

    const bucketSeconds = interval.key === '15m' ? 15 * 60 : interval.key === '1h' ? 60 * 60 : 4 * 60 * 60;
    return {
      candles: aggregateCandles(day5, bucketSeconds),
      sourceName: `Miana ${instrument.typeLabel} ${instrument.symbol} day5 聚合 ${interval.label}`,
      warnings: [`${instrument.typeLabel} 的 ${interval.label} 为最近 5 个交易日分钟线聚合结果。`]
    };
  }

  const { start, end } = instrument.type === 'FUTURE'
    ? getFutureContractDateRange(instrument)
    : {
        start: new Date(FULL_HISTORY_START),
        end: new Date()
      };

  const isFuture = instrument.type === 'FUTURE';
  let candles = [];

  try {
    candles = await fetchMianaHistoricalSeries({
      endpoint,
      symbol: instrument.symbol,
      type: interval.mianaType,
      start,
      end,
      marketTimeZone,
      timeoutMs: isFuture ? 20_000 : undefined,
      retries: isFuture ? 1 : undefined
    });
  } catch (error) {
    if (!isFuture) {
      throw error;
    }

    const reason = error?.message || String(error);
    return {
      candles: [],
      sourceName: `Miana ${instrument.typeLabel} ${instrument.symbol} ${interval.label}`,
      warnings: [
        `${instrument.displayName || instrument.name || instrument.code} 的 Miana 历史${interval.label}暂不可用：${reason}。该品种实时报价可能可用，但 Miana K线接口当前没有返回可用历史数据。`
      ]
    };
  }

  return {
    candles,
    sourceName: `Miana ${instrument.typeLabel} ${instrument.symbol} ${interval.label}`,
    warnings: []
  };
}

async function fetchCryptoCandles(instrument, interval) {
  try {
    const candles = await fetchBinanceCandles(instrument.code, interval);
    if (candles.length > 10) {
      return {
        candles,
        sourceName: `Binance ${instrument.code}/USDT ${interval.label}`,
        warnings: [`${instrument.code} 图表优先使用 Binance ${instrument.code}USDT。`]
      };
    }
  } catch (_error) {
    // Fall through to Miana.
  }

  return fetchMianaGenericCandles(instrument, interval, {
    endpoint: '/api/crypto/v1/kline',
    marketTimeZone: 'UTC'
  });
}

async function fetchYahooIndexCandles(instrument, interval) {
  const yahooSymbol = US_INDEX_YAHOO_SYMBOLS[instrument.code];
  if (!yahooSymbol) {
    throw new Error(`${instrument.code} 没有可用的 Yahoo 指数映射`);
  }

  if (interval.key === '1m') {
    const result = await fetchYahooChart(yahooSymbol, { interval: '1m', range: '7d', intraday: true });
    return {
      candles: result.candles,
      sourceName: `Yahoo Finance ${yahooSymbol} 分钟K`,
      warnings: ['美股指数 分钟K 使用 Yahoo 最近 7 天窗口。']
    };
  }

  if (interval.key === 'day') {
    const result = await fetchYahooChart(yahooSymbol, {
      interval: '1d',
      period1: 0,
      period2: Math.floor(Date.now() / 1000),
      intraday: false
    });
    return { candles: result.candles, sourceName: `Yahoo Finance ${yahooSymbol} 日K`, warnings: result.warnings };
  }

  if (interval.key === 'week') {
    const result = await fetchYahooChart(yahooSymbol, {
      interval: '1wk',
      period1: 0,
      period2: Math.floor(Date.now() / 1000),
      intraday: false
    });
    return { candles: result.candles, sourceName: `Yahoo Finance ${yahooSymbol} 周K`, warnings: result.warnings };
  }

  if (interval.key === 'month') {
    const result = await fetchYahooChart(yahooSymbol, {
      interval: '1mo',
      period1: 0,
      period2: Math.floor(Date.now() / 1000),
      intraday: false
    });
    return { candles: result.candles, sourceName: `Yahoo Finance ${yahooSymbol} 月K`, warnings: result.warnings };
  }

  if (interval.key === '15m') {
    const result = await fetchYahooChart(yahooSymbol, { interval: '15m', range: '60d', intraday: true });
    return {
      candles: result.candles,
      sourceName: `Yahoo Finance ${yahooSymbol} 15分K`,
      warnings: ['美股指数 15 分钟线使用 Yahoo 最近 60 天窗口。']
    };
  }

  if (interval.key === '1h') {
    const result = await fetchYahooChart(yahooSymbol, { interval: '60m', range: '730d', intraday: true });
    return {
      candles: result.candles,
      sourceName: `Yahoo Finance ${yahooSymbol} 1小时K`,
      warnings: ['美股指数 1 小时线使用 Yahoo 最近约 2 年窗口。']
    };
  }

  const result = await fetchYahooChart(yahooSymbol, { interval: '60m', range: '730d', intraday: true });
  return {
    candles: aggregateCandles(result.candles, 4 * 60 * 60),
    sourceName: `Yahoo Finance ${yahooSymbol} 4小时K`,
    warnings: ['美股指数 4 小时线由 Yahoo 1 小时线聚合，窗口约 2 年。']
  };
}

async function fetchYahooChart(symbol, { interval, range, period1, period2, intraday }) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', interval);
  if (range) {
    url.searchParams.set('range', range);
  } else {
    url.searchParams.set('period1', String(period1));
    url.searchParams.set('period2', String(period2));
  }
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('events', 'div,splits');

  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];

  if (!result || !Array.isArray(timestamps) || !quote) {
    throw new Error(`Yahoo ${symbol} 返回结构不完整`);
  }

  const candles = timestamps
    .map((timestamp, index) => ({
      time: intraday ? Number(timestamp) : toDateString(new Date(timestamp * 1000)),
      open: toFiniteNumber(quote.open?.[index]),
      high: toFiniteNumber(quote.high?.[index]),
      low: toFiniteNumber(quote.low?.[index]),
      close: toFiniteNumber(quote.close?.[index]),
      volume: toFiniteNumber(quote.volume?.[index])
    }))
    .filter(isValidCandle);

  return {
    candles,
    warnings: []
  };
}

async function fetchBinanceCandles(code, interval) {
  const marketInterval = getBinanceInterval(interval);
  const now = Date.now();
  const startTime = getBinanceStartTime(interval);
  let lastError;

  for (const host of BINANCE_HOSTS) {
    try {
      return await fetchBinanceFromHost(host, `${code}USDT`, marketInterval, startTime, now, interval.intraday);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${code}USDT Binance 数据不可用`);
}

async function fetchBinanceFromHost(host, symbol, marketInterval, startTime, endTime, intraday) {
  const candles = [];
  let cursor = startTime;

  while (cursor <= endTime) {
    const url = new URL('/api/v3/klines', host);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', marketInterval);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(endTime));

    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) {
      throw new Error(`${host} ${symbol} 返回结构异常`);
    }
    if (!payload.length) break;

    for (const row of payload) {
      candles.push({
        time: intraday ? Math.floor(row[0] / 1000) : toDateString(new Date(row[0])),
        open: toFiniteNumber(row[1]),
        high: toFiniteNumber(row[2]),
        low: toFiniteNumber(row[3]),
        close: toFiniteNumber(row[4]),
        volume: toFiniteNumber(row[5])
      });
    }

    const lastOpenTime = payload[payload.length - 1][0];
    const nextCursor = lastOpenTime + intervalMs(marketInterval);
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return dedupeByTime(candles).filter(isValidCandle);
}

function getBinanceInterval(interval) {
  if (interval.key === '1m') return '1m';
  if (interval.key === '15m') return '15m';
  if (interval.key === '1h') return '1h';
  if (interval.key === '4h') return '4h';
  if (interval.key === 'week') return '1w';
  if (interval.key === 'month') return '1M';
  return '1d';
}

function getBinanceStartTime(interval) {
  const end = new Date();

  if (interval.key === '1m') {
    end.setDate(end.getDate() - 7);
    return end.getTime();
  }

  if (interval.key === '15m') {
    end.setDate(end.getDate() - 120);
    return end.getTime();
  }

  if (interval.key === '1h' || interval.key === '4h') {
    end.setDate(end.getDate() - 400);
    return end.getTime();
  }

  return new Date('2010-01-01T00:00:00Z').getTime();
}

async function fetchMianaHistoricalSeries({ endpoint, symbol, type, start, end, marketTimeZone, timeoutMs, retries }) {
  const candles = [];
  let cursor = new Date(start);
  let guard = 0;

  while (cursor <= end && guard < 20) {
    const page = await fetchMianaSeries({
      endpoint,
      symbol,
      type,
      start: cursor,
      end,
      intraday: false,
      marketTimeZone,
      timeoutMs,
      retries
    });

    if (!page.length) break;
    candles.push(...page);
    if (page.length < 2000) break;

    const last = page[page.length - 1];
    cursor = new Date(`${last.time}T00:00:00`);
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return dedupeByTime(candles).filter(isValidCandle);
}

async function fetchMianaIntradaySeriesInChunks({
  endpoint,
  symbol,
  type,
  start,
  end,
  marketTimeZone,
  chunkDays = 7,
  timeoutMs,
  retries
}) {
  const chunks = [];
  let cursor = new Date(start);
  const finalDate = new Date(end);

  while (cursor <= finalDate) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    if (chunkEnd > finalDate) {
      chunkEnd.setTime(finalDate.getTime());
    }
    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor = new Date(chunkEnd);
    cursor.setSeconds(cursor.getSeconds() + 1);
  }

  const pages = await mapWithConcurrency(
    chunks,
    6,
    (chunk) => fetchMianaSeries({
      endpoint,
      symbol,
      type,
      start: chunk.start,
      end: chunk.end,
      intraday: true,
      marketTimeZone,
      timeoutMs,
      retries
    }).catch(() => [])
  );

  return dedupeByTime(pages.flat())
    .sort((left, right) => left.time - right.time)
    .filter(isValidCandle);
}

async function fetchMianaSeries({ endpoint, symbol, type, start, end, intraday, marketTimeZone, timeoutMs, retries }) {
  const url = new URL(endpoint, 'https://miana.com.cn');
  url.searchParams.set('token', mianaKey);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('type', type);
  url.searchParams.set('order', 'ASC');
  url.searchParams.set('limit', '2000');
  url.searchParams.set('format', 'json');

  if (start && end && type !== 'day5') {
    const startText = intraday ? `${toDateString(start)} ${toTimeString(start)}` : `${toDateString(start)} 00:00:00`;
    const endText = intraday ? `${toDateString(end)} ${toTimeString(end)}` : `${toDateString(end)} 23:59:59`;
    url.searchParams.set('beginDate', startText);
    url.searchParams.set('endDate', endText);
  }

  const payload = await fetchJson(url, { timeoutMs, retries });
  if (payload.code !== 200) {
    throw new Error(payload.msg || `${endpoint} code ${payload.code}`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error(`${endpoint} 返回结构中没有 data 数组`);
  }

  const candles = payload.data
    .map((row) => ({
      time: intraday ? parseMarketDateTime(row.date, marketTimeZone) : normalizeDate(row.date),
      open: toFiniteNumber(row.open),
      high: toFiniteNumber(row.high),
      low: toFiniteNumber(row.low),
      close: toFiniteNumber(row.close ?? row.price),
      volume: toFiniteNumber(row.volume)
    }))
    .filter(isValidCandle);

  if (type === 'day5' && start && end) {
    return candles.filter((item) => item.time >= Math.floor(start.getTime() / 1000) && item.time <= Math.floor(end.getTime() / 1000));
  }

  return candles;
}

async function buildInstrumentAdjustedSeries(instrument, rawCandles, rollovers = []) {
  if (instrument.supportsAdjustments) {
    return buildAdjustedSeries(instrument, rawCandles);
  }

  if (isCustomMainFutureInstrument(instrument)) {
    return buildFutureAdjustedSeries(rawCandles, rollovers);
  }

  return {
    qfq: null,
    hfq: null,
    warnings: ['当前品种未提供前复权/后复权计算。']
  };
}

async function buildAdjustedSeries(instrument, rawCandles) {
  if (!rawCandles.length) {
    return {
      qfq: null,
      hfq: null,
      warnings: []
    };
  }

  const [primaryDistributions, fallbackDistributions] = await Promise.all([
    getStockDistributions(instrument.symbol).catch(() => []),
    canUseTushareFinancials(instrument) ? getTushareDividends(instrument.symbol).catch(() => []) : []
  ]);
  const distributions = mergeDistributionRows(primaryDistributions, fallbackDistributions);
  if (!distributions.length) {
    return {
      qfq: rawCandles,
      hfq: rawCandles,
      warnings: ['未找到分红送转记录，前复权和后复权与原始K线一致。']
    };
  }

  if (!rawCandles.some((candle) => typeof candle.time === 'number')) {
    const javaAdjusted = buildJavaAdjustedSeries(rawCandles, distributions);
    if (javaAdjusted.factorsCount > 0) {
      const warnings = [`已按 ${javaAdjusted.factorsCount} 个 Java 口径复权因子计算前复权/后复权。`];
      if (javaAdjusted.syntheticCount > 0) {
        warnings.push(`已按除权除息日补入 ${javaAdjusted.syntheticCount} 根虚拟K线，以匹配 Java 复权算法。`);
      }

      return {
        qfq: javaAdjusted.qfq,
        hfq: javaAdjusted.hfq,
        warnings
      };
    }
  }

  const dailyHistory = await getStockDailyHistory(instrument.symbol);
  const factors = buildCorporateActionFactors(distributions, dailyHistory);

  if (!factors.length) {
    return {
      qfq: rawCandles,
      hfq: rawCandles,
      warnings: ['分红送转记录已获取，但未生成有效复权因子。']
    };
  }

  const sortedFactors = factors.sort((left, right) => left.date.localeCompare(right.date));
  const totalFactor = sortedFactors.reduce((product, item) => product * item.factor, 1);
  let prefixFactor = 1;
  let factorIndex = 0;

  const qfq = [];
  const hfq = [];

  for (const candle of rawCandles) {
    const candleDate = candleDateKey(candle.time);

    while (factorIndex < sortedFactors.length && sortedFactors[factorIndex].date <= candleDate) {
      prefixFactor *= sortedFactors[factorIndex].factor;
      factorIndex += 1;
    }

    const postFactor = prefixFactor;
    const preFactor = totalFactor ? prefixFactor / totalFactor : 1;

    qfq.push(applyFactorToCandle(candle, preFactor));
    hfq.push(applyFactorToCandle(candle, postFactor));
  }

  return {
    qfq,
    hfq,
    warnings: [`已按 ${sortedFactors.length} 个分红送转因子计算前复权/后复权。`]
  };
}

function buildFutureAdjustedSeries(rawCandles, rollovers) {
  if (!rawCandles.length) {
    return {
      qfq: null,
      hfq: null,
      warnings: []
    };
  }

  const events = (rollovers || [])
    .map((event) => ({
      date: normalizeDate(event.date),
      premium: toFiniteNumber(event.premium)
    }))
    .filter((event) => event.date && Number.isFinite(event.premium))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!events.length) {
    return {
      qfq: null,
      hfq: null,
      warnings: ['期货主连未生成有效换季溢价，前复权/后复权暂不可用。']
    };
  }

  const qfq = rawCandles.map((candle) => {
    const candleDate = getFutureAdjustmentCandleDate(candle);
    const offset = events
      .filter((event) => candleDate && event.date > candleDate)
      .reduce((sum, event) => sum + event.premium, 0);
    return applyAdditiveAdjustmentToCandle(candle, offset);
  });

  const hfq = rawCandles.map((candle) => {
    const candleDate = getFutureAdjustmentCandleDate(candle);
    const offset = events
      .filter((event) => candleDate && event.date <= candleDate)
      .reduce((sum, event) => sum - event.premium, 0);
    return applyAdditiveAdjustmentToCandle(candle, offset);
  });

  return {
    qfq,
    hfq,
    warnings: []
  };
}

function getFutureAdjustmentCandleDate(candle) {
  return normalizeDate(candle?.endDate || candle?.tradeDate || candleDateKey(candle?.time));
}

function applyAdditiveAdjustmentToCandle(candle, offset) {
  const normalizedOffset = Number.isFinite(offset) ? offset : 0;
  if (Math.abs(normalizedOffset) < 1e-12) {
    return { ...candle };
  }

  return {
    ...candle,
    open: roundPrice(candle.open + normalizedOffset),
    high: roundPrice(candle.high + normalizedOffset),
    low: roundPrice(candle.low + normalizedOffset),
    close: roundPrice(candle.close + normalizedOffset)
  };
}

function buildJavaAdjustedSeries(rawCandles, distributions) {
  const distributionMap = new Map();

  for (const row of distributions || []) {
    const actionDate = compactDateString(row.exDividendDate || row.payCashDate || row.equityRecordDate || row.noticeDate);
    if (!actionDate) continue;
    if (!distributionMap.has(actionDate)) {
      distributionMap.set(actionDate, []);
    }
    distributionMap.get(actionDate).push(row);
  }

  const workingMap = new Map(
    rawCandles
      .map((candle) => normalizeAdjustmentCandle(candle))
      .filter(Boolean)
      .map((candle) => [candle.date, candle])
  );

  const syntheticDates = [];
  const sortedActionDates = [...distributionMap.keys()].sort((left, right) => left.localeCompare(right));

  for (const actionDate of sortedActionDates) {
    if (workingMap.has(actionDate)) continue;

    const previousTradeDate = [...workingMap.keys()]
      .sort((left, right) => right.localeCompare(left))
      .find((tradeDate) => tradeDate < actionDate);

    if (!previousTradeDate) continue;

    const synthetic = buildJavaSyntheticAdjustmentCandle(
      actionDate,
      workingMap.get(previousTradeDate),
      distributionMap.get(actionDate)
    );

    if (!synthetic) continue;
    workingMap.set(actionDate, synthetic);
    syntheticDates.push(actionDate);
  }

  const descendingCandles = [...workingMap.values()].sort((left, right) => right.date.localeCompare(left.date));
  const factorsMap = new Map();

  for (let index = 0; index < descendingCandles.length - 1; index += 1) {
    const tradeDate = descendingCandles[index].date;
    const previousClose = descendingCandles[index + 1].close;
    const actions = distributionMap.get(tradeDate);

    if (!actions?.length || !Number.isFinite(previousClose) || previousClose <= 0) continue;

    let factor = null;
    for (const action of actions) {
      const nextFactor = buildJavaCorporateActionFactor(previousClose, action);
      if (Number.isFinite(nextFactor) && nextFactor > 0) {
        factor = nextFactor;
      }
    }

    if (Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) >= 1e-12) {
      factorsMap.set(tradeDate, factor);
    }
  }

  const sortedFactors = [...factorsMap.entries()]
    .map(([date, factor]) => ({ date, factor }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const ascendingCandles = [...workingMap.values()].sort((left, right) => left.date.localeCompare(right.date));
  const qfq = [];
  const hfq = [];

  for (const candle of ascendingCandles) {
    const { preFactor, postFactor } = buildJavaAdjustmentFactorsForDate(candle.date, sortedFactors);
    qfq.push(applyJavaAdjustmentFactor(candle, preFactor));
    hfq.push(applyJavaAdjustmentFactor(candle, postFactor));
  }

  return {
    qfq,
    hfq,
    factorsCount: sortedFactors.length,
    syntheticCount: syntheticDates.length
  };
}

function normalizeAdjustmentCandle(candle) {
  const date = compactDateString(candleDateKey(candle.time));
  if (!date) return null;

  return {
    time: compactDateToDisplay(date),
    date,
    open: toFiniteNumber(candle.open),
    high: toFiniteNumber(candle.high),
    low: toFiniteNumber(candle.low),
    close: toFiniteNumber(candle.close),
    volume: toFiniteNumber(candle.volume) || 0
  };
}

function buildJavaSyntheticAdjustmentCandle(actionDate, previousCandle, actions) {
  if (!previousCandle || !Number.isFinite(previousCandle.close)) return null;

  let totalSplit = 0;
  let totalDividendPerShare = 0;

  for (const action of actions || []) {
    totalSplit += extractJavaSplitPerShare(action);
    totalDividendPerShare += extractJavaDividendPerShare(action);
  }

  const denominator = 1 + totalSplit;
  const adjustedClose = denominator > 0
    ? (previousCandle.close - totalDividendPerShare) / denominator
    : null;

  if (!Number.isFinite(adjustedClose) || adjustedClose <= 0) return null;

  const rounded = roundJavaAdjustmentPrice(adjustedClose);

  return {
    time: compactDateToDisplay(actionDate),
    date: actionDate,
    open: rounded,
    high: rounded,
    low: rounded,
    close: rounded,
    volume: 0
  };
}

function buildJavaCorporateActionFactor(previousClose, action) {
  const dividendPerShare = extractJavaDividendPerShare(action);
  const splitPerShare = extractJavaSplitPerShare(action);
  let factor = 0;

  const denominator = previousClose - roundJavaMetric(dividendPerShare, 4);
  if (denominator !== 0) {
    factor = roundJavaMetric(previousClose / denominator, 4);
    if (splitPerShare !== 0) {
      factor *= roundJavaMetric(1 + splitPerShare, 4);
    }
  }

  return factor;
}

function extractJavaDividendPerShare(action) {
  const dividend = toFiniteNumber(action?.dividend);
  return Number.isFinite(dividend) ? dividend : 0;
}

function extractJavaSplitPerShare(action) {
  const directSplitFactor = toFiniteNumber(action?.splitFactor);
  if (Number.isFinite(directSplitFactor) && directSplitFactor > 0) {
    return directSplitFactor - 1;
  }

  const stockDividend = toFiniteNumber(action?.stockDividendPerShare);
  if (Number.isFinite(stockDividend) && stockDividend > 0) {
    return stockDividend;
  }

  return 0;
}

function buildJavaAdjustmentFactorsForDate(tradeDate, sortedFactors) {
  let postFactor = 1;
  let preFactor = 1;

  for (const { date, factor } of sortedFactors) {
    if (date <= tradeDate) {
      postFactor = roundJavaMetric(postFactor * factor, 4);
    }
    if (date > tradeDate) {
      preFactor = roundJavaMetric(preFactor * roundJavaMetric(1 / factor, 6), 4);
    }
  }

  return { preFactor, postFactor };
}

function applyJavaAdjustmentFactor(candle, factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    return {
      time: candle.time,
      open: roundJavaAdjustmentPrice(candle.open),
      high: roundJavaAdjustmentPrice(candle.high),
      low: roundJavaAdjustmentPrice(candle.low),
      close: roundJavaAdjustmentPrice(candle.close),
      volume: candle.volume || 0
    };
  }

  return {
    time: candle.time,
    open: roundJavaAdjustmentPrice(candle.open * factor),
    high: roundJavaAdjustmentPrice(candle.high * factor),
    low: roundJavaAdjustmentPrice(candle.low * factor),
    close: roundJavaAdjustmentPrice(candle.close * factor),
    volume: candle.volume || 0
  };
}

function buildCorporateActionFactors(distributions, dailyHistory) {
  const factorsByDate = new Map();

  for (const row of distributions) {
    const actionDate = String(row.exDividendDate || row.equityRecordDate || row.noticeDate || '').slice(0, 10);
    if (!actionDate) continue;

    const previousClose = findPreviousCloseBeforeDate(dailyHistory, actionDate);
    if (!Number.isFinite(previousClose) || previousClose <= 0) continue;

    const cashDividend = toFiniteNumber(row.dividend) || 0;
    const splitFactor = normalizeSplitFactor(row);
    let factor = 1;

    if (cashDividend > 0 && previousClose > cashDividend) {
      factor *= previousClose / (previousClose - cashDividend);
    }

    if (Number.isFinite(splitFactor) && splitFactor > 0 && splitFactor !== 1) {
      factor *= splitFactor;
    }

    if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-12) {
      continue;
    }

    factorsByDate.set(actionDate, (factorsByDate.get(actionDate) || 1) * factor);
  }

  return [...factorsByDate.entries()].map(([date, factor]) => ({ date, factor }));
}

function normalizeSplitFactor(row) {
  const direct = toFiniteNumber(row.splitFactor);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  return 1;
}

function applyFactorToCandle(candle, factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    return candle;
  }

  return {
    ...candle,
    open: roundPrice(candle.open * factor),
    high: roundPrice(candle.high * factor),
    low: roundPrice(candle.low * factor),
    close: roundPrice(candle.close * factor)
  };
}

async function getStockDistributions(symbol) {
  const cached = distributionCache.get(symbol);
  if (cached) return cached;

  const url = new URL('/api/stock/v1/distribute', 'https://miana.com.cn');
  url.searchParams.set('token', mianaKey);
  url.searchParams.set('symbol', symbol);
  const payload = await fetchJson(url);

  if (payload.code !== 200 || !Array.isArray(payload.data)) {
    throw new Error(payload.msg || '分红送转数据获取失败');
  }

  distributionCache.set(symbol, payload.data);
  return payload.data;
}

async function getStockDailyHistory(symbol) {
  if (dailyHistoryCache.has(symbol)) {
    return dailyHistoryCache.get(symbol);
  }

  const end = new Date();
  const start = new Date('1990-01-01T00:00:00');
  const candles = await fetchMianaHistoricalSeries({
    endpoint: '/api/stock/v2/kline',
    symbol,
    type: 'd1',
    start,
    end,
    marketTimeZone: 'Asia/Shanghai'
  });

  dailyHistoryCache.set(symbol, candles);
  return candles;
}

function findPreviousCloseBeforeDate(dailyHistory, targetDate) {
  for (let index = dailyHistory.length - 1; index >= 0; index -= 1) {
    if (dailyHistory[index].time < targetDate) {
      return dailyHistory[index].close;
    }
  }
  return null;
}

function buildQuoteFromCandles(candles) {
  const last = candles.at(-1);
  const previous = candles.at(-2);
  if (!last) return null;

  const change = previous ? last.close - previous.close : null;
  const changeRate = previous?.close ? (change / previous.close) * 100 : null;

  return {
    date: last.time,
    price: last.close,
    preClose: previous?.close || null,
    change,
    changeRate
  };
}

async function buildStockFundamentals(instrument, candles, latestQuote) {
  if (!candles.length) {
    return {
      current: null,
      rows: [],
      metrics: STOCK_FUNDAMENTAL_METRICS,
      warnings: []
    };
  }

  const useTushareFinancials = canUseTushareFinancials(instrument);

  const [
    sharesRows,
    balanceRows,
    incomeRows,
    cashflowRows,
    distributions,
    tushareBalanceRows,
    tushareIncomeRows,
    tushareDividends,
    tushareBpsRows
  ] = await Promise.all([
    getStockSharesHistory(instrument.symbol).catch(() => []),
    getStockBalanceSheet(instrument.symbol).catch(() => []),
    getStockIncomeSheet(instrument.symbol).catch(() => []),
    getStockCashflow(instrument.symbol).catch(() => []),
    getStockDistributions(instrument.symbol).catch(() => []),
    useTushareFinancials ? getTushareBalanceSheet(instrument.symbol).catch(() => []) : [],
    useTushareFinancials ? getTushareIncomeSheet(instrument.symbol).catch(() => []) : [],
    useTushareFinancials ? getTushareDividends(instrument.symbol).catch(() => []) : [],
    useTushareFinancials ? getTushareBpsSeries(instrument.symbol).catch(() => []) : []
  ]);

  const combinedDistributions = mergeDistributionRows(distributions, tushareDividends);
  const shareTimeline = buildShareTimeline({
    sharesRows,
    balanceRows: balanceRows.length ? balanceRows : tushareBalanceRows,
    latestQuote,
    candles
  });
  const balanceReports = buildBalanceReports(balanceRows);
  const fallbackBalanceReports = buildBalanceReports(tushareBalanceRows);
  const effectiveBalanceReports = balanceReports.length ? balanceReports : fallbackBalanceReports;
  const bpsReports = buildBpsReports(tushareBpsRows);

  const primaryProfitQuarters = buildQuarterMetricSeries({
    primaryRows: incomeRows,
    fallbackRows: cashflowRows,
    primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
    fallbackFieldCandidates: ['netProfit'],
    label: '利润'
  });
  const fallbackProfitQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
    fallbackFieldCandidates: [],
    label: '利润'
  });
  const profitQuarters = selectPreferredQuarterSeries(primaryProfitQuarters, fallbackProfitQuarters);

  const primaryRevenueQuarters = buildQuarterMetricSeries({
    primaryRows: incomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['totalRevenue', 'revenue'],
    fallbackFieldCandidates: [],
    label: '营业收入'
  });
  const fallbackRevenueQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['totalRevenue', 'revenue'],
    fallbackFieldCandidates: [],
    label: '营业收入'
  });
  const revenueQuarters = selectPreferredQuarterSeries(primaryRevenueQuarters, fallbackRevenueQuarters);

  const javaShareTimeline = buildJavaShareTimeline(shareTimeline);
  const javaProfitCache = buildJavaQuarterCacheFromSeries(profitQuarters);
  const javaRevenueCache = buildJavaQuarterCacheFromSeries(revenueQuarters);
  const javaAnnounceDateMap = buildJavaAnnounceDateMap([
    profitQuarters,
    revenueQuarters,
    bpsReports,
    effectiveBalanceReports
  ]);
  const javaDividendAmountMap = buildJavaDividendAmountMap(combinedDistributions, javaShareTimeline);

  const rows = candles.map((candle) =>
    buildStockFundamentalRow({
      candle,
      shareTimeline: javaShareTimeline,
      bpsReports,
      profitQuarterCache: javaProfitCache,
      revenueQuarterCache: javaRevenueCache,
      announceDateMap: javaAnnounceDateMap,
      dividendAmountMap: javaDividendAmountMap
    })
  );

  const current = rows.at(-1) || null;
  const warnings = [];

  if (profitQuarters === fallbackProfitQuarters && fallbackProfitQuarters.length) {
    warnings.push('利润报表序列已由 Tushare 补齐，历史利润相关曲线会按财报披露节奏更新。');
  }

  if (revenueQuarters === fallbackRevenueQuarters && fallbackRevenueQuarters.length) {
    warnings.push('营业收入报表序列已由 Tushare 补齐，收入和利润率曲线会按财报披露节奏更新。');
  }

  if (!profitQuarters.length) {
    warnings.push(Number.isFinite(latestQuote?.peTtm)
      ? '未拿到可用的利润报表序列；当前市盈率、TTM利润和市值回报率已用实时估值快照补齐，历史曲线仍会偏空。'
      : '未拿到可用的利润报表序列，市盈率和利润相关指标会显示为空。');
  }

  if (!revenueQuarters.length) {
    warnings.push('未拿到可用的营业收入报表序列，收入和利润率相关指标会显示为空。');
  }

  return {
    current,
    rows,
    metrics: STOCK_FUNDAMENTAL_METRICS,
    financialBars: {
      revenue: buildFinancialStatementBars(revenueQuarters),
      profit: buildFinancialStatementBars(profitQuarters)
    },
    warnings
  };
}

function buildFinancialStatementBars(quarters) {
  const byYear = new Map();

  for (const row of quarters || []) {
    const reportDate = normalizeDate(row.reportDate);
    const value = toFiniteNumber(row.value);
    const quarterIndex = getQuarterIndex(reportDate);
    if (!reportDate || !quarterIndex || !Number.isFinite(value)) continue;

    const year = reportDate.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        total: 0,
        q1: null,
        q2: null,
        q3: null,
        q4: null
      });
    }

    const item = byYear.get(year);
    item[`q${quarterIndex}`] = roundMetricValue(value);
    item.total += value;
  }

  return [...byYear.values()]
    .map((item) => ({
      ...item,
      total: roundMetricValue(item.total)
    }))
    .sort((left, right) => left.year.localeCompare(right.year));
}

function enrichCurrentStockFundamentalRow(row, latestQuote) {
  if (!row || !latestQuote) return row;

  const marketCap = Number.isFinite(latestQuote.marketValue) ? latestQuote.marketValue : row.marketCap;
  const totalShares = Number.isFinite(latestQuote.totalShares) ? latestQuote.totalShares : row.totalShares;
  const price = Number.isFinite(latestQuote.price) ? latestQuote.price : row.price;
  const peRatio = Number.isFinite(latestQuote.peTtm) && latestQuote.peTtm > 0 ? latestQuote.peTtm : row.peRatio;
  const ttmProfit = Number.isFinite(row.ttmProfit)
    ? row.ttmProfit
    : Number.isFinite(marketCap) && Number.isFinite(peRatio) && peRatio > 0
      ? marketCap / peRatio
      : null;
  const baseNetAssets = Number.isFinite(row.netAssets) ? row.netAssets : null;
  const pbBundle = buildJavaStylePbBundle(marketCap, baseNetAssets, row.pbRatio);
  const pbRatio = pbBundle.pbRatio;
  const netAssets = pbBundle.netAssets;
  const returnOnAssets = Number.isFinite(row.returnOnAssets)
    ? row.returnOnAssets
    : Number.isFinite(ttmProfit) && Number.isFinite(netAssets) && netAssets > 0
      ? ttmProfit / netAssets
      : null;
  const marketCapReturnRate = Number.isFinite(row.marketCapReturnRate)
    ? row.marketCapReturnRate
    : Number.isFinite(ttmProfit) && Number.isFinite(marketCap) && marketCap > 0
      ? ttmProfit / marketCap
      : null;

  return {
    ...row,
    totalShares: roundMetricValue(totalShares),
    price: roundMetricValue(price),
    marketCap: roundMetricValue(marketCap),
    ttmProfit: roundMetricValue(ttmProfit),
    peRatio: roundMetricValue(peRatio),
    pbRatio: roundMetricValue(pbRatio),
    netAssets: roundMetricValue(netAssets),
    returnOnAssets: roundMetricValue(returnOnAssets),
    marketCapReturnRate: roundMetricValue(marketCapReturnRate)
  };
}

function buildStockFundamentalRow({
  candle,
  shareTimeline,
  bpsReports,
  profitQuarterCache,
  revenueQuarterCache,
  announceDateMap,
  dividendAmountMap
}) {
  const date = candleDateKey(candle.time);
  const tradeDate = compactDateString(date);
  const price = toFiniteNumber(candle.close);
  const totalShares = findJavaShareValue(shareTimeline, tradeDate);
  const marketCap = Number.isFinite(totalShares) && Number.isFinite(price) ? price * totalShares : null;
  const dateNow = getJavaQuarterReferenceDate(tradeDate);

  let latestDisclosedQuarter = findJavaLatestDisclosedQuarter(tradeDate, announceDateMap);
  if (!latestDisclosedQuarter) {
    latestDisclosedQuarter = dateNow;
  }

  const announceDate = latestDisclosedQuarter ? announceDateMap[latestDisclosedQuarter] : null;
  const metricQuarterDate = announceDate && tradeDate >= announceDate
    ? latestDisclosedQuarter
    : getJavaPreviousQuarterEnd(latestDisclosedQuarter);
  const pbQuarterDate = announceDate && tradeDate >= announceDate
    ? dateNow
    : getJavaPreviousQuarter(dateNow);
  const dividendYield = calculateJavaDividendYield(tradeDate, dividendAmountMap, marketCap);
  const pbRatio = calculateJavaPbRatio(pbQuarterDate, bpsReports, totalShares, marketCap);
  const metrics = buildJavaPeRatioMetrics({
    profitQuarterCache,
    revenueQuarterCache,
    dateNow: metricQuarterDate,
    marketCap,
    pbRatio,
    dividendYield
  });
  const peRatio = metrics.ttmProfit > 0 && Number.isFinite(marketCap)
    ? roundJavaMetric(marketCap / metrics.ttmProfit, 4)
    : 0;
  const netAssets = pbRatio !== 0 && Number.isFinite(marketCap)
    ? roundJavaMetric(marketCap / pbRatio, 4)
    : 0;
  const returnOnAssets = netAssets !== 0
    ? roundJavaMetric(metrics.ttmProfit / netAssets, 4)
    : 0;
  const marketCapReturnRate = Number.isFinite(marketCap) && marketCap !== 0
    ? roundJavaMetric(metrics.ttmProfit / marketCap, 4)
    : 0;
  const profitMargin = metrics.ttmRevenue !== 0
    ? roundJavaMetric(metrics.ttmProfit / metrics.ttmRevenue, 4)
    : 0;

  return {
    time: candle.time,
    date,
    totalShares: Number.isFinite(totalShares) ? Math.round(totalShares) : null,
    price: Number.isFinite(price) ? price : null,
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    ttmProfit: metrics.ttmProfit,
    peRatio,
    ttmRevenue: metrics.ttmRevenue,
    revenueGrowthRate: metrics.revenueGrowthRate,
    profitGrowthRate: metrics.profitGrowthRate,
    dividendYield: metrics.dividendYield,
    pbRatio: metrics.pbRatio,
    netAssets,
    returnOnAssets,
    marketCapReturnRate,
    profitMargin
  };
}

function buildShareTimeline({ sharesRows, balanceRows, latestQuote, candles }) {
  const entries = [];

  for (const row of sharesRows) {
    const date = normalizeDate(row.endDate);
    const totalShares = toFiniteNumber(row.totalShares);
    if (date && Number.isFinite(totalShares)) {
      entries.push({ date, value: totalShares });
    }
  }

  for (const row of balanceRows) {
    const date = normalizeDate(row.noticeDate || row.reportDate);
    const totalShares = toFiniteNumber(row.totalShare);
    if (date && Number.isFinite(totalShares)) {
      entries.push({ date, value: totalShares });
    }
  }

  if (latestQuote?.date && Number.isFinite(latestQuote.totalShares)) {
    entries.push({
      date: normalizeDate(latestQuote.date),
      value: latestQuote.totalShares
    });
  }

  const deduped = [...new Map(entries.sort((left, right) => left.date.localeCompare(right.date)).map((item) => [item.date, item])).values()];
  if (!deduped.length) {
    return [];
  }

  const firstCandleDate = candleDateKey(candles[0].time);
  if (firstCandleDate < deduped[0].date) {
    deduped.unshift({
      date: firstCandleDate,
      value: deduped[0].value
    });
  }

  return deduped;
}

function buildBalanceReports(rows) {
  const deduped = dedupeLatestReports(rows);

  return deduped
    .map((row) => ({
      reportDate: normalizeDate(row.reportDate),
      noticeDate: normalizeDate(row.noticeDate || row.reportDate),
      netAssets: toFiniteNumber(row.totalHldrEqyExcMinInt ?? row.totalHldrEqyIncMinInt),
      totalShare: toFiniteNumber(row.totalShare)
    }))
    .filter((row) => row.reportDate && row.noticeDate && Number.isFinite(row.netAssets))
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
}

function buildBpsReports(rows) {
  const deduped = dedupeLatestReports(rows);

  return deduped
    .map((row) => ({
      reportDate: normalizeDate(row.reportDate),
      noticeDate: normalizeDate(row.noticeDate || row.reportDate),
      bps: toFiniteNumber(row.bps)
    }))
    .filter((row) => row.reportDate && row.noticeDate && Number.isFinite(row.bps))
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
}

function buildQuarterMetricSeries({
  primaryRows,
  fallbackRows,
  primaryFieldCandidates,
  fallbackFieldCandidates,
  label
}) {
  const primary = extractQuarterMetricRows(primaryRows, primaryFieldCandidates, label);
  if (primary.length) return primary;
  return extractQuarterMetricRows(fallbackRows, fallbackFieldCandidates, label);
}

function selectPreferredQuarterSeries(primarySeries, fallbackSeries) {
  if (!fallbackSeries.length) return primarySeries;
  if (!primarySeries.length) return fallbackSeries;
  return fallbackSeries.length > primarySeries.length ? fallbackSeries : primarySeries;
}

function extractQuarterMetricRows(rows, fieldCandidates, label) {
  const deduped = dedupeLatestReports(rows);
  const prepared = deduped
    .map((row) => {
      const cumulativeValue = pickFirstFinite(row, fieldCandidates);
      const reportDate = normalizeDate(row.reportDate);
      const noticeDate = normalizeDate(row.noticeDate || row.reportDate);
      const quarterIndex = getQuarterIndex(reportDate);

      return {
        reportDate,
        noticeDate,
        quarterIndex,
        cumulativeValue
      };
    })
    .filter((row) => row.reportDate && row.noticeDate && row.quarterIndex && Number.isFinite(row.cumulativeValue))
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));

  const byReportDate = new Map(prepared.map((row) => [row.reportDate, row]));

  return prepared
    .map((row) => {
      let value = row.cumulativeValue;

      if (row.quarterIndex > 1) {
        const previousQuarterDate = getPreviousQuarterReportDate(row.reportDate);
        const previous = previousQuarterDate ? byReportDate.get(previousQuarterDate) : null;
        value = previous && Number.isFinite(previous.cumulativeValue) ? row.cumulativeValue - previous.cumulativeValue : null;
      }

      return {
        ...row,
        value,
        label
      };
    })
    .filter((row) => Number.isFinite(row.value));
}

function dedupeLatestReports(rows) {
  const reportMap = new Map();

  for (const row of rows || []) {
    const reportDate = normalizeDate(row.reportDate);
    const noticeDate = normalizeDate(row.noticeDate || row.reportDate);
    if (!reportDate || !noticeDate) continue;

    const current = reportMap.get(reportDate);
    if (!current || noticeDate >= normalizeDate(current.noticeDate || current.reportDate)) {
      reportMap.set(reportDate, row);
    }
  }

  return [...reportMap.values()];
}

function getQuarterIndex(reportDate) {
  if (!reportDate) return null;
  const monthDay = reportDate.slice(5, 10);
  if (monthDay === '03-31') return 1;
  if (monthDay === '06-30') return 2;
  if (monthDay === '09-30') return 3;
  if (monthDay === '12-31') return 4;
  return null;
}

function getPreviousQuarterReportDate(reportDate) {
  if (!reportDate) return null;
  const year = Number(reportDate.slice(0, 4));
  const quarterIndex = getQuarterIndex(reportDate);
  if (!quarterIndex) return null;

  if (quarterIndex === 1) {
    return `${year - 1}-12-31`;
  }

  if (quarterIndex === 2) return `${year}-03-31`;
  if (quarterIndex === 3) return `${year}-06-30`;
  return `${year}-09-30`;
}

function buildTrailingWindow(quarters, date) {
  const available = quarters.filter((row) => row.noticeDate <= date && Number.isFinite(row.value));
  const currentWindow = available.slice(-4);

  if (currentWindow.length < 4 || !isContiguousQuarterWindow(currentWindow)) {
    return null;
  }

  const sum = currentWindow.reduce((total, row) => total + row.value, 0);
  const previousWindow = available.slice(-8, -4);
  let growthRate = null;

  if (previousWindow.length === 4 && isContiguousQuarterWindow(previousWindow)) {
    const previousSum = previousWindow.reduce((total, row) => total + row.value, 0);
    if (previousSum !== 0) {
      growthRate = sum / previousSum - 1;
    }
  }

  return {
    sum,
    growthRate
  };
}

function isContiguousQuarterWindow(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    if (toQuarterSerial(rows[index].reportDate) - toQuarterSerial(rows[index - 1].reportDate) !== 1) {
      return false;
    }
  }

  return true;
}

function toQuarterSerial(reportDate) {
  const year = Number(reportDate.slice(0, 4));
  const quarter = getQuarterIndex(reportDate);
  return year * 4 + quarter;
}

function findLatestTimelineValue(timeline, date) {
  if (!timeline.length) return null;

  let latest = timeline[0].value;
  for (const row of timeline) {
    if (row.date > date) break;
    latest = row.value;
  }
  return latest;
}

function findLatestBalanceValue(balanceReports, date) {
  let latest = null;

  for (const row of balanceReports) {
    if (row.noticeDate > date) break;
    latest = row.netAssets;
  }

  return latest;
}

function findLatestBpsValue(bpsReports, date) {
  let latest = null;

  for (const row of bpsReports || []) {
    if (row.noticeDate > date) break;
    latest = row.bps;
  }

  return latest;
}

function calculateDividendYield(distributions, shareTimeline, date, marketCap) {
  if (!Array.isArray(distributions) || !distributions.length || !Number.isFinite(marketCap) || marketCap <= 0) {
    return null;
  }

  const endDate = new Date(`${date}T00:00:00`);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 14);

  let totalDividendAmount = 0;

  for (const row of distributions) {
    const eventDate = normalizeDate(row.exDividendDate || row.payCashDate || row.equityRecordDate || row.noticeDate);
    const dividendPerShare = toFiniteNumber(row.dividend);

    if (!eventDate || !Number.isFinite(dividendPerShare) || eventDate >= date) {
      continue;
    }

    const eventDateObj = new Date(`${eventDate}T00:00:00`);
    if (eventDateObj < startDate) {
      continue;
    }

    const sharesAtEvent = findLatestTimelineValue(shareTimeline, eventDate);
    if (!Number.isFinite(sharesAtEvent)) {
      continue;
    }

    totalDividendAmount += dividendPerShare * sharesAtEvent;
  }

  if (!totalDividendAmount) {
    return 0;
  }

  return totalDividendAmount / marketCap;
}

function roundMetricValue(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

function roundJavaAdjustmentPrice(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(4));
}

function roundJavaMetric(value, scale) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(scale));
}

function compactDateString(date) {
  const normalized = normalizeDate(date);
  return normalized ? normalized.replaceAll('-', '') : null;
}

function compactDateToDisplay(compactDate) {
  if (!compactDate || compactDate.length !== 8) return null;
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function compactDateToDate(compactDate) {
  const display = compactDateToDisplay(compactDate);
  return display ? new Date(`${display}T00:00:00`) : null;
}

function shiftCompactDateDays(compactDate, days) {
  const base = compactDateToDate(compactDate);
  if (!base) return null;
  base.setDate(base.getDate() + days);
  return compactDateString(base);
}

function diffMonths(laterCompactDate, earlierCompactDate) {
  const later = compactDateToDate(laterCompactDate);
  const earlier = compactDateToDate(earlierCompactDate);
  if (!later || !earlier) return 0;
  return (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
}

function buildJavaShareTimeline(timeline) {
  return (timeline || [])
    .map((row) => ({
      date: compactDateString(row.date),
      value: toFiniteNumber(row.value)
    }))
    .filter((row) => row.date && Number.isFinite(row.value))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function findJavaShareValue(timeline, tradeDate) {
  let latest = null;

  for (const row of timeline || []) {
    if (row.date > tradeDate) break;
    latest = row.value;
  }

  return latest;
}

function buildJavaQuarterCacheFromSeries(rows) {
  const cache = {};

  for (const row of rows || []) {
    const reportDate = compactDateString(row.reportDate);
    const value = toFiniteNumber(row.value);
    if (!reportDate || !Number.isFinite(value)) continue;

    const year = reportDate.slice(0, 4);
    const quarter = getJavaQuarterFromDate(reportDate);
    if (quarter === 'unknown') continue;

    if (!cache[year]) {
      cache[year] = { q1: 0, q2: 0, q3: 0, q4: 0, tAmt: 0, midR: 0, q3R: 0 };
    }

    cache[year][quarter] = value;
  }

  return cache;
}

function buildJavaAnnounceDateMap(groups) {
  const announceDateMap = {};

  for (const group of groups || []) {
    for (const row of group || []) {
      const reportDate = compactDateString(row.reportDate);
      const noticeDate = compactDateString(row.noticeDate || row.reportDate);
      if (!reportDate || !noticeDate) continue;

      if (!announceDateMap[reportDate] || noticeDate > announceDateMap[reportDate]) {
        announceDateMap[reportDate] = noticeDate;
      }
    }
  }

  return announceDateMap;
}

function buildJavaDividendAmountMap(distributions, shareTimeline) {
  const dividendAmountMap = new Map();

  for (const row of distributions || []) {
    const tradeDate = compactDateString(row.exDividendDate || row.payCashDate || row.equityRecordDate || row.noticeDate);
    const dividend = toFiniteNumber(row.dividend);
    if (!tradeDate || !Number.isFinite(dividend) || dividend <= 0) continue;

    const previousDate = shiftCompactDateDays(tradeDate, -1) || tradeDate;
    const totalShares = findJavaShareValue(shareTimeline, previousDate) ?? findJavaShareValue(shareTimeline, tradeDate);
    if (!Number.isFinite(totalShares)) continue;

    const amount = dividend * totalShares;
    if (!dividendAmountMap.has(tradeDate)) {
      dividendAmountMap.set(tradeDate, []);
    }
    dividendAmountMap.get(tradeDate).push(amount);
  }

  return dividendAmountMap;
}

function getJavaClosestQuarterEndDate(monthDay) {
  const numeric = Number(monthDay);
  if (!Number.isFinite(numeric) || numeric <= 331) return '1231';
  if (numeric < 630) return '0331';
  if (numeric === 630) return '0630';
  if (numeric < 930) return '0630';
  if (numeric === 930) return '0930';
  if (numeric < 1231) return '0930';
  return '1231';
}

function getJavaQuarterReferenceDate(tradeDate) {
  if (!tradeDate) return null;
  const year = tradeDate.slice(0, 4);
  const monthDay = tradeDate.slice(4);
  if (Number(monthDay) > 331) {
    return `${year}${getJavaClosestQuarterEndDate(monthDay)}`;
  }
  return `${Number(year) - 1}1231`;
}

function getJavaPreviousQuarter(dateNow) {
  if (!dateNow) return null;
  const year = Number(dateNow.slice(0, 4));
  const monthDay = dateNow.slice(4);

  if (monthDay === '0331') return `${year - 1}1231`;
  if (monthDay === '0630') return `${year}0331`;
  if (monthDay === '0930') return `${year}0630`;
  if (monthDay === '1231') return `${year}0930`;
  return null;
}

function getJavaPreviousQuarterEnd(dateNow) {
  return getJavaPreviousQuarter(dateNow);
}

function getJavaPreviousYearDate(dateNow) {
  if (!dateNow) return null;
  return `${Number(dateNow.slice(0, 4)) - 1}${dateNow.slice(4)}`;
}

function getJavaPreviousThreeQuarters(dateNow) {
  const quarters = [];
  let current = dateNow;

  for (let index = 0; index < 4; index += 1) {
    if (!current) break;
    quarters.push(current);
    current = getJavaPreviousQuarter(current);
  }

  return quarters;
}

function findJavaLatestDisclosedQuarter(tradeDate, announceDateMap) {
  let latestQuarter = null;
  let latestAnnounceDate = '0';

  for (const [quarterEndDate, announceDate] of Object.entries(announceDateMap || {})) {
    if (!announceDate || announceDate > tradeDate) continue;

    if (announceDate > latestAnnounceDate) {
      latestAnnounceDate = announceDate;
      latestQuarter = quarterEndDate;
    } else if (latestQuarter && announceDate === latestAnnounceDate) {
      const currentGap = Number(tradeDate) - Number(quarterEndDate);
      const latestGap = Number(tradeDate) - Number(latestQuarter);
      if (currentGap < latestGap) {
        latestQuarter = quarterEndDate;
      }
    }
  }

  return latestQuarter;
}

function getJavaQuarterFromDate(date) {
  const month = date.slice(4, 6);
  switch (month) {
    case '03':
      return 'q1';
    case '06':
      return 'q2';
    case '09':
      return 'q3';
    case '12':
      return 'q4';
    default:
      return 'unknown';
  }
}

function extractJavaQuarterlyData(cache, quarters) {
  let result = 0;

  for (const date of quarters || []) {
    const year = date.slice(0, 4);
    const quarter = getJavaQuarterFromDate(date);
    const yearData = cache?.[year];
    if (yearData && quarter !== 'unknown') {
      result += toFiniteNumber(yearData[quarter]) || 0;
    }
  }

  return result;
}

function calculateJavaGrowthRate(recentPeriodSum, previousPeriodSum) {
  if (Number.isFinite(previousPeriodSum) && previousPeriodSum !== 0) {
    return roundJavaMetric(roundJavaMetric(recentPeriodSum / previousPeriodSum, 4) - 1, 4);
  }
  return 0;
}

function findLatestJavaBps(dateNow, bpsReports) {
  let latest = 0;

  for (const row of bpsReports || []) {
    const reportDate = compactDateString(row.reportDate);
    const bps = toFiniteNumber(row.bps);
    if (!reportDate || !Number.isFinite(bps)) continue;
    if (reportDate > dateNow) break;
    if (bps !== 0) {
      latest = bps;
    }
  }

  return latest;
}

function calculateJavaPbRatio(dateNow, bpsReports, totalShare, marketCap) {
  const bvps = findLatestJavaBps(dateNow, bpsReports);
  if (Number.isFinite(bvps) && bvps !== 0 && Number.isFinite(totalShare) && Number.isFinite(marketCap)) {
    const netAssets = bvps * totalShare;
    if (netAssets !== 0) {
      return roundJavaMetric(marketCap / netAssets, 6);
    }
  }
  return 0;
}

function getJavaDividendDataInRange(dividendAmountMap, startDate, endDate) {
  return [...(dividendAmountMap?.entries() || [])]
    .filter(([date]) => date >= startDate && date <= endDate)
    .sort((left, right) => right[0].localeCompare(left[0]))
    .flatMap(([date, amounts]) =>
      (amounts || []).map((amount) => ({ date, amount }))
    );
}

function calculateJavaDividendYield(tradeDate, dividendAmountMap, marketCap) {
  if (!Number.isFinite(marketCap) || marketCap === 0) return 0;

  const tradeLocalDate = compactDateToDate(tradeDate);
  if (!tradeLocalDate) return 0;

  const startDate = new Date(tradeLocalDate);
  startDate.setMonth(startDate.getMonth() - 14);
  const endDate = new Date(tradeLocalDate);
  endDate.setDate(endDate.getDate() - 1);

  const dividendDataInRange = getJavaDividendDataInRange(
    dividendAmountMap,
    compactDateString(startDate),
    compactDateString(endDate)
  );

  if (dividendDataInRange.length >= 2) {
    const earliestDate = dividendDataInRange[0].date;
    const latestDate = dividendDataInRange[dividendDataInRange.length - 1].date;

    if (diffMonths(earliestDate, latestDate) > 10) {
      const nextDate = shiftCompactDateDays(latestDate, 1);
      let totalAmount = 0;

      for (const [date, amounts] of dividendAmountMap.entries()) {
        if (date > nextDate && date <= earliestDate) {
          totalAmount += (amounts || []).reduce((sum, amount) => sum + (toFiniteNumber(amount) || 0), 0);
        }
      }

      if (totalAmount > 0) {
        return roundJavaMetric(totalAmount / marketCap, 6);
      }
    }
  }

  let dividendAmountSum = (dividendAmountMap.get(tradeDate) || []).reduce((sum, amount) => sum + (toFiniteNumber(amount) || 0), 0);

  if (dividendAmountSum === 0) {
    const closestDate = [...dividendAmountMap.keys()]
      .filter((date) => date <= tradeDate)
      .sort()
      .at(-1);

    if (closestDate) {
      dividendAmountSum = (dividendAmountMap.get(closestDate) || []).reduce((sum, amount) => sum + (toFiniteNumber(amount) || 0), 0);
    }
  }

  return roundJavaMetric(dividendAmountSum / marketCap, 6);
}

function buildJavaPeRatioMetrics({ profitQuarterCache, revenueQuarterCache, dateNow, marketCap, pbRatio, dividendYield }) {
  const previousThreeQuarters = getJavaPreviousThreeQuarters(dateNow);
  const lastYear = getJavaPreviousYearDate(dateNow);
  const lastYearPreviousThreeQuarters = getJavaPreviousThreeQuarters(lastYear);

  const recentPeriodSum = extractJavaQuarterlyData(profitQuarterCache, previousThreeQuarters);
  const previousPeriodSum = extractJavaQuarterlyData(profitQuarterCache, lastYearPreviousThreeQuarters);
  const growthRate = calculateJavaGrowthRate(recentPeriodSum, previousPeriodSum);
  const currentQuarterGrossRevenue = extractJavaQuarterlyData(revenueQuarterCache, previousThreeQuarters);
  const lastQuarterGrossRevenue = extractJavaQuarterlyData(revenueQuarterCache, lastYearPreviousThreeQuarters);
  const revenueGrowthRate = calculateJavaGrowthRate(currentQuarterGrossRevenue, lastQuarterGrossRevenue);

  const peRatio = recentPeriodSum > 0 && Number.isFinite(marketCap)
    ? roundJavaMetric(marketCap / recentPeriodSum, 4)
    : 0;
  const marketCapReturnRate = Number.isFinite(marketCap) && marketCap !== 0
    ? roundJavaMetric(recentPeriodSum / marketCap, 4)
    : 0;
  const netAssets = pbRatio !== 0 && Number.isFinite(marketCap)
    ? roundJavaMetric(marketCap / pbRatio, 4)
    : 0;
  const returnOnAssets = netAssets !== 0
    ? roundJavaMetric(recentPeriodSum / netAssets, 4)
    : 0;
  const profitMargin = currentQuarterGrossRevenue !== 0
    ? roundJavaMetric(recentPeriodSum / currentQuarterGrossRevenue, 4)
    : 0;

  return {
    ttmProfit: recentPeriodSum,
    peRatio,
    ttmRevenue: currentQuarterGrossRevenue,
    revenueGrowthRate,
    profitGrowthRate: growthRate,
    dividendYield: roundJavaMetric(dividendYield, 6),
    pbRatio: roundJavaMetric(pbRatio, 6),
    netAssets,
    returnOnAssets,
    marketCapReturnRate,
    profitMargin
  };
}

function calculateJavaStylePbRatio(marketCap, netAssets) {
  if (!Number.isFinite(marketCap) || !Number.isFinite(netAssets) || netAssets <= 0) return null;
  return Number((marketCap / netAssets).toFixed(6));
}

function calculateJavaStyleNetAssets(marketCap, pbRatio) {
  if (!Number.isFinite(marketCap) || !Number.isFinite(pbRatio) || pbRatio <= 0) return null;
  return Number((marketCap / pbRatio).toFixed(4));
}

function buildJavaStylePbBundle(marketCap, baseNetAssets, fallbackPbRatio) {
  const pbRatio = calculateJavaStylePbRatio(marketCap, baseNetAssets) ?? fallbackPbRatio ?? null;
  const netAssets = calculateJavaStyleNetAssets(marketCap, pbRatio) ?? baseNetAssets ?? null;

  return { pbRatio, netAssets };
}

function pickFirstFinite(row, fieldCandidates) {
  for (const field of fieldCandidates) {
    const value = toFiniteNumber(row?.[field]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

async function getStockSharesHistory(symbol) {
  if (stockSharesCache.has(symbol)) {
    return stockSharesCache.get(symbol);
  }

  const rows = await fetchStockArrayEndpoint('/api/stock/v1/shares', symbol);
  stockSharesCache.set(symbol, rows);
  return rows;
}

async function getStockBalanceSheet(symbol) {
  if (stockBalanceSheetCache.has(symbol)) {
    return stockBalanceSheetCache.get(symbol);
  }

  const rows = await fetchStockArrayEndpoint('/api/stock/v1/balanceSheet', symbol);
  stockBalanceSheetCache.set(symbol, rows);
  return rows;
}

async function getStockIncomeSheet(symbol) {
  if (stockIncomeSheetCache.has(symbol)) {
    return stockIncomeSheetCache.get(symbol);
  }

  const rows = await fetchStockArrayEndpoint('/api/stock/v1/incomeSheet', symbol);
  stockIncomeSheetCache.set(symbol, rows);
  return rows;
}

async function getStockCashflow(symbol) {
  if (stockCashflowCache.has(symbol)) {
    return stockCashflowCache.get(symbol);
  }

  const rows = await fetchStockArrayEndpoint('/api/stock/v1/cashflow', symbol);
  stockCashflowCache.set(symbol, rows);
  return rows;
}

async function fetchStockArrayEndpoint(endpoint, symbol) {
  const url = new URL(endpoint, 'https://miana.com.cn');
  url.searchParams.set('token', mianaKey);
  url.searchParams.set('symbol', symbol);
  const payload = await fetchJson(url);

  if (payload.code !== 200 || !Array.isArray(payload.data)) {
    throw new Error(payload.msg || `${endpoint} 返回异常`);
  }

  return payload.data;
}

function canUseTushareFinancials(instrument) {
  if (!tushareToken) return false;
  if (!instrument || instrument.type !== 'STOCK') return false;
  if (instrument.countryCode !== 'CHN') return false;
  return ['XSHG', 'XSHE', 'BSE'].includes(instrument.exchangeCode);
}

async function getTushareBalanceSheet(symbol) {
  if (tushareBalanceSheetCache.has(symbol)) {
    return tushareBalanceSheetCache.get(symbol);
  }

  const rows = await fetchTushareTable('balancesheet', {
    ts_code: toTushareTsCode(symbol)
  }, 'ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,total_share,total_hldr_eqy_exc_min_int,total_hldr_eqy_inc_min_int');
  const normalized = rows.map(normalizeTushareBalanceRow);
  tushareBalanceSheetCache.set(symbol, normalized);
  return normalized;
}

async function getTushareIncomeSheet(symbol) {
  if (tushareIncomeSheetCache.has(symbol)) {
    return tushareIncomeSheetCache.get(symbol);
  }

  const rows = await fetchTushareTable('income', {
    ts_code: toTushareTsCode(symbol)
  }, 'ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,total_revenue,revenue,n_income_attr_p,n_income');
  const normalized = rows.map(normalizeTushareIncomeRow);
  tushareIncomeSheetCache.set(symbol, normalized);
  return normalized;
}

async function getTushareDividends(symbol) {
  if (tushareDividendCache.has(symbol)) {
    return tushareDividendCache.get(symbol);
  }

  const rows = await fetchTushareTable('dividend', {
    ts_code: toTushareTsCode(symbol)
  }, 'ts_code,end_date,ann_date,record_date,ex_date,pay_date,div_proc,stk_div,cash_div,cash_div_tax,base_share');
  const normalized = rows
    .map(normalizeTushareDividendRow)
    .filter(Boolean);
  tushareDividendCache.set(symbol, normalized);
  return normalized;
}

async function getTushareBpsSeries(symbol) {
  if (tushareBpsCache.has(symbol)) {
    return tushareBpsCache.get(symbol);
  }

  const rows = await fetchTushareTable('fina_indicator', {
    ts_code: toTushareTsCode(symbol)
  }, 'ts_code,ann_date,end_date,bps');
  const normalized = rows.map(normalizeTushareBpsRow);
  tushareBpsCache.set(symbol, normalized);
  return normalized;
}

async function fetchTushareTable(apiName, params, fields) {
  if (!tushareToken) {
    throw new Error('未配置 Tushare token');
  }

  const payload = await fetchJson(tushareApiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      api_name: apiName,
      token: tushareToken,
      params,
      fields
    })
  });

  if (payload.code !== 0 || !payload.data || !Array.isArray(payload.data.fields) || !Array.isArray(payload.data.items)) {
    throw new Error(payload.msg || `${apiName} 返回异常`);
  }

  return payload.data.items.map((item) =>
    Object.fromEntries(payload.data.fields.map((field, index) => [field, item[index]]))
  );
}

function toTushareTsCode(symbol) {
  const normalized = String(symbol || '').trim().toLowerCase();
  const match = normalized.match(/^([a-z]{2})([0-9a-z]+)$/);

  if (!match) {
    throw new Error(`无法转换 Tushare 股票代码：${symbol}`);
  }

  const [, market, code] = match;
  const suffixMap = {
    sh: 'SH',
    sz: 'SZ',
    bj: 'BJ'
  };
  const suffix = suffixMap[market];

  if (!suffix) {
    throw new Error(`暂不支持 ${symbol} 的 Tushare 市场映射`);
  }

  return `${code.toUpperCase()}.${suffix}`;
}

function normalizeTushareIncomeRow(row) {
  return {
    reportDate: normalizeDate(row.end_date),
    noticeDate: normalizeDate(row.ann_date || row.f_ann_date || row.end_date),
    reportType: row.report_type ?? null,
    compType: row.comp_type ?? null,
    totalRevenue: toFiniteNumber(row.total_revenue),
    revenue: toFiniteNumber(row.revenue),
    netIncomeAttr_p: toFiniteNumber(row.n_income_attr_p),
    netIncome: toFiniteNumber(row.n_income)
  };
}

function normalizeTushareBalanceRow(row) {
  return {
    reportDate: normalizeDate(row.end_date),
    noticeDate: normalizeDate(row.ann_date || row.f_ann_date || row.end_date),
    reportType: row.report_type ?? null,
    compType: row.comp_type ?? null,
    totalShare: toFiniteNumber(row.total_share),
    totalHldrEqyExcMinInt: toFiniteNumber(row.total_hldr_eqy_exc_min_int),
    totalHldrEqyIncMinInt: toFiniteNumber(row.total_hldr_eqy_inc_min_int)
  };
}

function normalizeTushareBpsRow(row) {
  return {
    reportDate: normalizeDate(row.end_date),
    noticeDate: normalizeDate(row.ann_date || row.end_date),
    bps: toFiniteNumber(row.bps)
  };
}

function normalizeTushareDividendRow(row) {
  const eventDate = row.ex_date || row.pay_date || row.record_date;
  const dividend = toFiniteNumber(row.cash_div_tax ?? row.cash_div);
  const stockDividendPerShare = toFiniteNumber(row.stk_div);
  const hasCashDividend = Number.isFinite(dividend) && dividend > 0;
  const hasStockDividend = Number.isFinite(stockDividendPerShare) && stockDividendPerShare > 0;

  if (!eventDate || (!hasCashDividend && !hasStockDividend)) {
    return null;
  }

  return {
    type: 'dividend',
    currency: 'CNY',
    dividend: hasCashDividend ? dividend : 0,
    stockDividendPerShare,
    splitFactor: Number.isFinite(stockDividendPerShare) && stockDividendPerShare > 0 ? 1 + stockDividendPerShare : null,
    reportDate: normalizeDate(row.end_date),
    noticeDate: normalizeDate(row.ann_date || row.end_date),
    equityRecordDate: normalizeDate(row.record_date),
    exDividendDate: normalizeDate(row.ex_date),
    payCashDate: normalizeDate(row.pay_date)
  };
}

function mergeDistributionRows(primaryRows, fallbackRows) {
  const merged = [...(primaryRows || []), ...(fallbackRows || [])]
    .filter(Boolean)
    .map((row) => ({
      ...row,
      dividend: toFiniteNumber(row.dividend),
      stockDividendPerShare: toFiniteNumber(row.stockDividendPerShare),
      splitFactor: toFiniteNumber(row.splitFactor)
    }))
    .filter((row) => {
      const hasCashDividend = Number.isFinite(row.dividend) && row.dividend > 0;
      const hasSplitFactor = Number.isFinite(row.splitFactor) && row.splitFactor > 1;
      const hasStockDividend = Number.isFinite(row.stockDividendPerShare) && row.stockDividendPerShare > 0;
      return hasCashDividend || hasSplitFactor || hasStockDividend;
    });

  const deduped = new Map();
  for (const row of merged) {
    const key = [
      normalizeDate(row.exDividendDate || row.payCashDate || row.equityRecordDate || row.noticeDate),
      Number.isFinite(row.dividend) ? row.dividend : 0
    ].join('|');

    const existing = deduped.get(key);
    if (existing) {
      deduped.set(key, {
        ...existing,
        ...row,
        dividend: Number.isFinite(row.dividend) && row.dividend > 0 ? row.dividend : existing.dividend,
        stockDividendPerShare:
          Number.isFinite(row.stockDividendPerShare) && row.stockDividendPerShare > 0
            ? row.stockDividendPerShare
            : existing.stockDividendPerShare,
        splitFactor:
          Number.isFinite(row.splitFactor) && row.splitFactor > 1
            ? row.splitFactor
            : existing.splitFactor
      });
      continue;
    }

    deduped.set(key, row);
  }

  return [...deduped.values()].sort((left, right) =>
    String(left.exDividendDate || left.payCashDate || left.equityRecordDate || left.noticeDate || '')
      .localeCompare(String(right.exDividendDate || right.payCashDate || right.equityRecordDate || right.noticeDate || ''))
  );
}

function aggregateCandlesToReferencePeriods(sourceCandles, referenceCandles) {
  let previousTime = null;

  return referenceCandles
    .map((reference) => {
      const group = sourceCandles.filter((source) => {
        const afterPrevious = previousTime ? source.time > previousTime : source.time <= reference.time;
        return afterPrevious && source.time <= reference.time;
      });
      previousTime = reference.time;

      if (!group.length) return null;
      return {
        time: reference.time,
        open: group[0].open,
        high: Math.max(...group.map((item) => item.high)),
        low: Math.min(...group.map((item) => item.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, item) => sum + (item.volume || 0), 0)
      };
    })
    .filter(isValidCandle);
}

function safeDivide(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
  return left / right;
}

function safeSubtract(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return left - right;
}

function safeAdd(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return left + right;
}

function getCompareOperator(mode) {
  if (mode === 'add') return '+';
  if (mode === 'subtract') return '-';
  return '/';
}

function getCompareModeLabel(mode) {
  if (mode === 'add') return '加法';
  if (mode === 'subtract') return '减法';
  return '除法';
}

function normalizeQuote(row) {
  const price = toFiniteNumber(row.price ?? row.close);
  const preClose = toFiniteNumber(row.preClose);
  const change = Number.isFinite(toFiniteNumber(row.change)) ? toFiniteNumber(row.change) : price - preClose;
  const changeRate = Number.isFinite(toFiniteNumber(row.changeRate))
    ? toFiniteNumber(row.changeRate)
    : preClose
      ? ((price - preClose) / preClose) * 100
      : null;

  return {
    date: row.date || null,
    price,
    preClose,
    change,
    changeRate,
    open: toFiniteNumber(row.open),
    high: toFiniteNumber(row.high),
    low: toFiniteNumber(row.low),
    volume: toFiniteNumber(row.volume),
    amount: toFiniteNumber(row.amount),
    turnover: toFiniteNumber(row.turnover),
    peTtm: toFiniteNumber(row.pe_ttm),
    peDyn: toFiniteNumber(row.pe_dyn),
    peStatic: toFiniteNumber(row.pe_static),
    pb: toFiniteNumber(row.pb),
    bv: toFiniteNumber(row.bv),
    marketValue: toFiniteNumber(row.marketValue),
    circulationValue: toFiniteNumber(row.circulationValue),
    totalShares: toFiniteNumber(row.totalShares),
    circulationShares: toFiniteNumber(row.circulationShares)
  };
}

function aggregateCandles(candles, bucketSeconds) {
  const buckets = new Map();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const bucket = buckets.get(bucketTime);

    if (!bucket) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      });
      continue;
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += candle.volume || 0;
  }

  return [...buckets.values()].filter(isValidCandle);
}

function aggregateCalendarCandles(candles, intervalKey) {
  const buckets = new Map();

  for (const candle of candles || []) {
    const tradeDate = normalizeDate(candle.tradeDate || candleDateKey(candle.time));
    if (!tradeDate) continue;

    const bucketKey = intervalKey === 'month'
      ? tradeDate.slice(0, 7)
      : getWeekBucketKey(tradeDate);

    const bucket = buckets.get(bucketKey);
    if (!bucket) {
      buckets.set(bucketKey, {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0,
        startDate: tradeDate,
        endDate: tradeDate,
        tradeDate
      });
      continue;
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.time = candle.time;
    bucket.volume += candle.volume || 0;
    bucket.endDate = tradeDate;
    bucket.tradeDate = tradeDate;
  }

  return [...buckets.values()].filter(isValidCandle);
}

function getWeekBucketKey(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return toDateString(date);
}

async function fetchJson(url, init = {}) {
  let lastError;
  const timeoutMs = clampNumber(Number(init.timeoutMs || 15000), 1000, 120000);
  const retries = clampNumber(Number(init.retries || 3), 1, 6);
  const fetchInit = { ...init };
  delete fetchInit.timeoutMs;
  delete fetchInit.retries;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...fetchInit,
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'stock-kline-dashboard/0.2',
          ...(fetchInit.headers || {})
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(350 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    })
  ]);
}

function persistCatalogCache(data) {
  try {
    fs.writeFileSync(CATALOG_DISK_CACHE_PATH, JSON.stringify(data), 'utf8');
  } catch (error) {
    console.warn('[catalog] persist cache failed', error?.message || error);
  }
}

function readCatalogCacheFromDisk() {
  try {
    if (!fs.existsSync(CATALOG_DISK_CACHE_PATH)) return null;
    const text = fs.readFileSync(CATALOG_DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const rehydrated = parsed
      .map((item) => rehydrateCachedInstrument(item))
      .filter(Boolean);
    const enhanced = [...new Map(rehydrated.map((item) => [item.id, item])).values()];
    enhanced.push(...buildSyntheticFutureMainInstruments(enhanced));
    enhanced.sort(compareInstruments);
    return enhanced;
  } catch (error) {
    console.warn('[catalog] read disk cache failed', error?.message || error);
    return null;
  }
}

function getResponseDiskCacheLocation(namespace, key) {
  if (!namespace || !key) return null;
  const safeNamespace = String(namespace).replace(/[^a-zA-Z0-9_-]/g, '-');
  const hash = createHash('sha256').update(String(key)).digest('hex');
  const directory = new URL(`${safeNamespace}/`, RESPONSE_DISK_CACHE_DIR_PATH);
  return {
    directory,
    file: new URL(`${hash}.json`, directory)
  };
}

function readResponseDiskCache(namespace, key) {
  try {
    const location = getResponseDiskCacheLocation(namespace, key);
    if (!location || !fs.existsSync(location.file)) return null;
    const parsed = JSON.parse(fs.readFileSync(location.file, 'utf8'));
    if (!parsed || parsed.key !== key || parsed.value == null) return null;
    return {
      value: parsed.value,
      createdAt: Number(parsed.createdAt || 0),
      expiresAt: Number(parsed.expiresAt || 0)
    };
  } catch (error) {
    console.warn('[response-cache] read disk cache failed', namespace, error?.message || error);
    return null;
  }
}

function persistResponseDiskCache(namespace, key, value, ttlMs) {
  if (!namespace || !key || value == null) return;

  try {
    const location = getResponseDiskCacheLocation(namespace, key);
    if (!location) return;
    const now = Date.now();
    fs.mkdirSync(location.directory, { recursive: true });
    fs.writeFileSync(
      location.file,
      JSON.stringify({
        key,
        createdAt: now,
        expiresAt: now + ttlMs,
        value
      }),
      'utf8'
    );
  } catch (error) {
    console.warn('[response-cache] persist disk cache failed', namespace, error?.message || error);
  }
}

function rehydrateCachedInstrument(item) {
  if (!item || typeof item !== 'object') return null;

  const type = String(item.type || '').toUpperCase();
  if (type === 'RATIO') {
    return {
      ...item,
      displayCode: String(item.code || item.displayCode || item.symbol || '').trim(),
      searchText: String(item.searchText || `${item.code || ''} ${item.name || ''} ${item.chineseName || ''}`)
        .toLowerCase()
        .trim()
    };
  }

  return normalizeInstrument(item, type || item.kind || '');
}

function persistStockQ1Cache(data) {
  try {
    fs.writeFileSync(STOCK_Q1_DISK_CACHE_PATH, JSON.stringify(data), 'utf8');
  } catch (error) {
    console.warn('[q1-cache] persist cache failed', error?.message || error);
  }
}

function readStockQ1CacheFromDisk() {
  try {
    if (!fs.existsSync(STOCK_Q1_DISK_CACHE_PATH)) return null;
    const text = fs.readFileSync(STOCK_Q1_DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.items || typeof parsed.items !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[q1-cache] read disk cache failed', error?.message || error);
    return null;
  }
}

const STOCK_TABLE_EDITABLE_FIELDS = new Set([
  'performanceGrowthScore',
  'overallScore',
  'liudaScore',
  'targetPrice1',
  'targetPrice2',
  'note1',
  'note2'
]);

const STOCK_TABLE_NUMERIC_FIELDS = new Set([
  'performanceGrowthScore',
  'overallScore',
  'liudaScore',
  'marketCap',
  'stockPrice',
  'grossRevenue',
  'netProfit',
  'peRatioTtm',
  'pbRatio',
  'dividendYield2026',
  'dividendYield2025',
  'forecastRevenueGrowthRate',
  'forecastProfitGrowthRate',
  'forecastPe3Years',
  'annualPriceChange',
  'revGrowthRateNew',
  'profitGrowthRateNew',
  'peForecastNew'
]);

const STOCK_TABLE_PERCENT_FIELDS = new Set([
  'dividendYield2026',
  'dividendYield2025',
  'forecastRevenueGrowthRate',
  'forecastProfitGrowthRate',
  'annualPriceChange',
  'revGrowthRateNew',
  'profitGrowthRateNew'
]);

function parseStockTableFilters(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((filter) => ({
        field: String(filter?.field || '').trim(),
        op: normalizeStockFilterOperator(filter?.op),
        value: filter?.value == null ? '' : String(filter.value).trim()
      }))
      .filter((filter) => filter.field && filter.value !== '');
  } catch (_error) {
    return [];
  }
}

function normalizeStockFilterOperator(value) {
  if (['eq', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(value)) return value;
  return 'contains';
}

function readStockTableOverrides() {
  try {
    if (!fs.existsSync(STOCK_TABLE_OVERRIDES_PATH)) return {};
    const text = fs.readFileSync(STOCK_TABLE_OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('[stock-table] read overrides failed', error?.message || error);
    return {};
  }
}

function persistStockTableOverrides(overrides) {
  fs.writeFileSync(STOCK_TABLE_OVERRIDES_PATH, JSON.stringify(overrides || {}, null, 2), 'utf8');
}

function readAShareLatestSnapshot() {
  try {
    if (!fs.existsSync(A_SHARE_LATEST_SNAPSHOT_PATH)) return null;
    const stat = fs.statSync(A_SHARE_LATEST_SNAPSHOT_PATH);
    if (aShareLatestSnapshotCache.data && aShareLatestSnapshotCache.mtimeMs === stat.mtimeMs) {
      return aShareLatestSnapshotCache.data;
    }

    const parsed = JSON.parse(fs.readFileSync(A_SHARE_LATEST_SNAPSHOT_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.items || typeof parsed.items !== 'object') {
      return null;
    }

    aShareLatestSnapshotCache.mtimeMs = stat.mtimeMs;
    aShareLatestSnapshotCache.data = parsed;
    return parsed;
  } catch (error) {
    console.warn('[a-share-import] read latest snapshot failed', error?.message || error);
    return null;
  }
}

function buildImportedSnapshotMeta(snapshot) {
  if (!snapshot?.meta) return null;
  return {
    sourceFile: snapshot.meta.sourceFile || null,
    importedAt: snapshot.meta.importedAt || null,
    itemCount: snapshot.meta.itemCount || Object.keys(snapshot.items || {}).length,
    changedItemCount: snapshot.meta.changedItemCount ?? null
  };
}

function normalizeStockTableEditValue(field, value) {
  if (['note1', 'note2', 'targetPrice1', 'targetPrice2'].includes(field)) {
    return value == null ? '' : String(value);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildStockTableRows({ catalog, q1Snapshot, dailyBasicSnapshot, importedSnapshot, overrides }) {
  return (catalog || [])
    .filter(isStockQ1TargetInstrument)
    .map((instrument) => buildStockTableRow(instrument, {
      q1Row: q1Snapshot?.items?.[instrument.code] || null,
      dailyBasicRow: getDailyBasicRowForInstrument(dailyBasicSnapshot, instrument),
      importedRow: importedSnapshot?.items?.[instrument.code] || null,
      override: getStockTableOverride(overrides, instrument)
    }))
    .filter(Boolean);
}

function buildStockTableRow(instrument, { q1Row, dailyBasicRow, importedRow, override }) {
  const importedBasic = importedRow?.basic || null;
  const importedRevenueProfit = importedRow?.revenueProfit || null;
  const peRatioTtm = firstFiniteNumber(importedBasic?.peRatio, q1Row?.peTtm, dailyBasicRow?.peTtm);
  const stockPrice = firstFiniteNumber(importedBasic?.price, q1Row?.price, dailyBasicRow?.close);
  const marketCap = firstFiniteNumber(importedBasic?.marketCap, q1Row?.marketValue, dailyBasicRow?.totalMarketValue);
  const forecastRevenueGrowthRate = firstFiniteNumber(importedRevenueProfit?.revenueGrowthRate, q1Row?.revenueGrowthRate);
  const forecastProfitGrowthRate = firstFiniteNumber(importedRevenueProfit?.profitGrowthRate, q1Row?.profitGrowthRate);
  const forecastPe3Years = calculateStockTableForecastPe(peRatioTtm, forecastRevenueGrowthRate, forecastProfitGrowthRate);
  const financialCharts = mergeStockFinancialCharts(q1Row?.financialCharts, importedRevenueProfit?.financialCharts);

  return {
    ...instrument,
    tickerSymbol: instrument.code,
    tickerName: importedRow?.name || instrument.name,
    industryCategory: importedBasic?.industryCategory || instrument.industryCategory || instrument.industry || '',
    performanceGrowthScore: toNullableNumber(override?.performanceGrowthScore),
    overallScore: toNullableNumber(override?.overallScore),
    liudaScore: toNullableNumber(override?.liudaScore),
    marketCap: roundMetricValue(marketCap),
    stockPrice: roundMetricValue(stockPrice),
    grossRevenue: roundMetricValue(firstFiniteNumber(importedRevenueProfit?.revenue, q1Row?.revenue)),
    netProfit: roundMetricValue(firstFiniteNumber(importedRevenueProfit?.profit, q1Row?.profit)),
    financialCharts,
    peRatioTtm: roundMetricValue(peRatioTtm),
    pbRatio: roundMetricValue(firstFiniteNumber(importedBasic?.pbRatio, dailyBasicRow?.pb)),
    dividendYield2026: firstFiniteNumber(importedBasic?.dividendYieldTrailing12m, normalizeDailyBasicDividendRate(dailyBasicRow?.dvTtm)),
    dividendYield2025: normalizeDailyBasicDividendRate(dailyBasicRow?.dvRatio),
    forecastRevenueGrowthRate: roundMetricValue(forecastRevenueGrowthRate),
    forecastProfitGrowthRate: roundMetricValue(forecastProfitGrowthRate),
    forecastPe3Years: roundMetricValue(forecastPe3Years),
    annualPriceChange: null,
    revGrowthRateNew: roundMetricValue(firstFiniteNumber(importedRevenueProfit?.revenueGrowthRate, q1Row?.revenueGrowthRate)),
    profitGrowthRateNew: roundMetricValue(firstFiniteNumber(importedRevenueProfit?.profitGrowthRate, q1Row?.profitGrowthRate)),
    peForecastNew: roundMetricValue(forecastPe3Years),
    targetPrice1: override?.targetPrice1 || '',
    targetPrice2: override?.targetPrice2 || '',
    note1: override?.note1 || '',
    note2: override?.note2 || '',
    reportDate: importedRevenueProfit?.reportDate || q1Row?.reportDate || null,
    quoteDate: importedBasic?.priceDate || q1Row?.quoteDate || dailyBasicRow?.tradeDate || null,
    q1Source: importedRow ? 'xlsx' : q1Row?.source || null,
    quote: {
      price: roundMetricValue(stockPrice),
      change: null,
      changeRate: null,
      date: importedBasic?.priceDate || q1Row?.quoteDate || dailyBasicRow?.tradeDate || null,
      instrumentType: 'STOCK'
    }
  };
}

function mergeStockFinancialCharts(baseCharts, importedCharts) {
  if (!baseCharts && !importedCharts) return null;
  return {
    revenue: mergeStockFinancialChartRows(baseCharts?.revenue, importedCharts?.revenue),
    profit: mergeStockFinancialChartRows(baseCharts?.profit, importedCharts?.profit)
  };
}

function mergeStockFinancialChartRows(baseRows, importedRows) {
  const rowsByYear = new Map();
  for (const row of baseRows || []) {
    if (row?.year) rowsByYear.set(String(row.year), row);
  }
  for (const row of importedRows || []) {
    if (row?.year) rowsByYear.set(String(row.year), row);
  }
  return [...rowsByYear.values()].sort((left, right) => String(left.year).localeCompare(String(right.year)));
}

async function enrichStockTableFinancialCharts(items) {
  return mapWithConcurrency(items || [], 4, async (item) => {
    if (item?.financialCharts?.revenue?.length || item?.financialCharts?.profit?.length) {
      return item;
    }

    try {
      const { profitQuarters, revenueQuarters } = await loadQ1IncomeQuarterSeries(item);
      return {
        ...item,
        financialCharts: {
          revenue: buildStockTableFinancialSeries(revenueQuarters),
          profit: buildStockTableFinancialSeries(profitQuarters)
        }
      };
    } catch (_error) {
      return item;
    }
  });
}

function getDailyBasicRowForInstrument(snapshot, instrument) {
  if (!snapshot?.byTsCode || !instrument) return null;
  try {
    return snapshot.byTsCode.get(toTushareTsCode(instrument.symbol)) || null;
  } catch (_error) {
    return null;
  }
}

function getStockTableOverride(overrides, instrument) {
  if (!overrides || !instrument) return {};
  return overrides[instrument.id] || overrides[`STOCK:${instrument.code}`] || overrides[instrument.code] || {};
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function toNullableNumber(value) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDailyBasicDividendRate(value) {
  const number = toFiniteNumber(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 1 ? roundMetricValue(number / 100) : roundMetricValue(number);
}

function calculateStockTableForecastPe(peRatioTtm, revenueGrowthRate, profitGrowthRate) {
  const pe = toFiniteNumber(peRatioTtm);
  if (!Number.isFinite(pe) || pe <= 0) return null;
  const growth = Math.max(toFiniteNumber(revenueGrowthRate) || 0, toFiniteNumber(profitGrowthRate) || 0);
  if (growth <= -0.99) return null;
  const divisor = (1 + growth) ** 3;
  return divisor > 0 ? pe / divisor : null;
}

function filterStockTableRows(rows, { search, filters }) {
  const query = normalizeSearchText(search);
  return rows.filter((row) => {
    if (query && !normalizeSearchText([
      row.tickerSymbol,
      row.tickerName,
      row.industryCategory,
      row.marketLabel,
      row.searchText
    ].join(' ')).includes(query)) {
      return false;
    }

    return (filters || []).every((filter) => applyStockTableFilter(row, filter));
  });
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function applyStockTableFilter(row, filter) {
  const value = row?.[filter.field];
  if (value === null || value === undefined || value === '') return false;

  if (STOCK_TABLE_NUMERIC_FIELDS.has(filter.field)) {
    const number = toFiniteNumber(value);
    let filterNumber = Number(filter.value);
    if (STOCK_TABLE_PERCENT_FIELDS.has(filter.field) && Math.abs(filterNumber) > 1) {
      filterNumber /= 100;
    }
    if (!Number.isFinite(number) || !Number.isFinite(filterNumber)) return false;
    if (filter.op === 'eq') return number === filterNumber;
    if (filter.op === 'gt') return number > filterNumber;
    if (filter.op === 'gte') return number >= filterNumber;
    if (filter.op === 'lt') return number < filterNumber;
    if (filter.op === 'lte') return number <= filterNumber;
  }

  const text = String(value).toLowerCase();
  const filterText = String(filter.value).toLowerCase();
  if (filter.op === 'eq') return text === filterText;
  return text.includes(filterText);
}

function sortStockTableRows(rows, field, direction) {
  const multiplier = direction === 'DESC' ? -1 : 1;
  return [...rows].sort((left, right) => compareStockTableValues(left?.[field], right?.[field]) * multiplier);
}

function compareStockTableValues(leftValue, rightValue) {
  const leftNumber = toFiniteNumber(leftValue);
  const rightNumber = toFiniteNumber(rightValue);
  if (Number.isFinite(leftNumber) || Number.isFinite(rightNumber)) {
    if (!Number.isFinite(leftNumber)) return 1;
    if (!Number.isFinite(rightNumber)) return -1;
    return leftNumber - rightNumber;
  }
  return String(leftValue || '').localeCompare(String(rightValue || ''), 'zh-CN', { numeric: true });
}

function parseNullableNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseNullablePercent(value) {
  const number = parseNullableNumber(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}

function isStockQ1TargetInstrument(instrument) {
  return Boolean(
    instrument?.type === 'STOCK' &&
    instrument?.countryCode === 'CHN' &&
    instrument?.exchangeCode === 'XSHE' &&
    typeof instrument.code === 'string' &&
    instrument.code >= STOCK_Q1_RANGE_START &&
    instrument.code <= STOCK_Q1_RANGE_END
  );
}

function buildQ1SnapshotMeta(snapshot) {
  if (!snapshot) return null;
  return {
    generatedAt: snapshot.generatedAt || null,
    rangeStart: snapshot.rangeStart || STOCK_Q1_RANGE_START,
    rangeEnd: snapshot.rangeEnd || STOCK_Q1_RANGE_END,
    totalTargets: Number(snapshot.totalTargets || 0),
    savedCount: Number(snapshot.savedCount || 0),
    missingCount: Number(snapshot.missingCount || 0)
  };
}

function isFreshStockQ1Cache(snapshot) {
  if (!snapshot?.items || !Object.keys(snapshot.items).length) return false;
  const generatedAt = snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : NaN;
  if (!Number.isFinite(generatedAt)) return false;
  return Date.now() - generatedAt <= STOCK_Q1_CACHE_TTL_MS;
}

async function getStockQ1Snapshot({ catalog = null, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && isFreshStockQ1Cache(stockQ1SnapshotCache.data) && stockQ1SnapshotCache.expiresAt > now) {
    return stockQ1SnapshotCache.data;
  }

  if (!forceRefresh) {
    const diskCache = readStockQ1CacheFromDisk();
    if (diskCache?.items && Object.keys(diskCache.items).length) {
      stockQ1SnapshotCache.data = diskCache;
      stockQ1SnapshotCache.expiresAt = isFreshStockQ1Cache(diskCache)
        ? now + STOCK_Q1_CACHE_TTL_MS
        : now + 30 * 60 * 1000;
      return diskCache;
    }
  }

  if (stockQ1SnapshotCache.promise) {
    return stockQ1SnapshotCache.promise;
  }

  stockQ1SnapshotCache.promise = buildStockQ1Snapshot(catalog)
    .then((snapshot) => {
      stockQ1SnapshotCache.data = snapshot;
      stockQ1SnapshotCache.expiresAt = Date.now() + STOCK_Q1_CACHE_TTL_MS;
      stockQ1SnapshotCache.promise = null;
      persistStockQ1Cache(snapshot);
      return snapshot;
    })
    .catch((error) => {
      stockQ1SnapshotCache.promise = null;
      const diskCache = readStockQ1CacheFromDisk();
      if (diskCache?.items && Object.keys(diskCache.items).length) {
        stockQ1SnapshotCache.data = diskCache;
        stockQ1SnapshotCache.expiresAt = Date.now() + 30 * 60 * 1000;
        console.warn('[q1-cache] build failed, using disk cache', error?.message || error);
        return diskCache;
      }
      throw error;
    });

  return stockQ1SnapshotCache.promise;
}

async function buildStockQ1Snapshot(catalog) {
  const sourceCatalog = Array.isArray(catalog) && catalog.length ? catalog : await getCatalog();
  const targets = sourceCatalog
    .filter(isStockQ1TargetInstrument)
    .sort((left, right) => left.code.localeCompare(right.code, 'zh-CN'));

  const rows = await mapWithConcurrency(targets, 6, async (instrument) => {
    try {
      return await buildStockQ1SnapshotRow(instrument);
    } catch (error) {
      return {
        code: instrument.code,
        symbol: instrument.symbol,
        name: instrument.name,
        error: error?.message || String(error)
      };
    }
  });

  const items = {};
  const missing = [];

  for (const row of rows) {
    if (row?.error) {
      missing.push({
        code: row.code,
        symbol: row.symbol,
        name: row.name,
        error: row.error
      });
      continue;
    }

    if (row?.code) {
      items[row.code] = row;
    }
  }

  const dailyBasicSnapshot = await getTushareDailyBasicSnapshot().catch(() => null);
  for (const instrument of targets) {
    const snapshotRow = items[instrument.code];
    if (!snapshotRow) continue;

    const dailyBasicRow = dailyBasicSnapshot?.byTsCode?.get(toTushareTsCode(instrument.symbol));
    if (!dailyBasicRow) continue;

    snapshotRow.peTtm = roundMetricValue(dailyBasicRow.peTtm);
    snapshotRow.price = roundMetricValue(dailyBasicRow.close);
    snapshotRow.marketValue = roundMetricValue(dailyBasicRow.totalMarketValue);
    snapshotRow.totalShares = roundMetricValue(dailyBasicRow.totalShares);
    snapshotRow.quoteDate = dailyBasicRow.tradeDate || null;
  }

  return {
    generatedAt: new Date().toISOString(),
    rangeStart: STOCK_Q1_RANGE_START,
    rangeEnd: STOCK_Q1_RANGE_END,
    totalTargets: targets.length,
    savedCount: Object.keys(items).length,
    missingCount: missing.length,
    items,
    missing
  };
}

async function buildStockQ1SnapshotRow(instrument) {
  const { profitQuarters, revenueQuarters, source } = await loadQ1IncomeQuarterSeries(instrument);
  const q1ProfitRows = (profitQuarters || []).filter((row) => row.reportDate?.endsWith('-03-31'));
  if (!q1ProfitRows.length) {
    throw new Error('未拿到一季度利润报表');
  }

  const latestProfitRow = q1ProfitRows.at(-1);
  const latestYear = Number(latestProfitRow.reportDate.slice(0, 4));
  const previousQ1Date = `${latestYear - 1}-03-31`;
  const previousProfitRow = q1ProfitRows.find((row) => row.reportDate === previousQ1Date) || null;

  const q1RevenueRows = (revenueQuarters || []).filter((row) => row.reportDate?.endsWith('-03-31'));
  const latestRevenueRow = q1RevenueRows.find((row) => row.reportDate === latestProfitRow.reportDate) || null;
  const previousRevenueRow = q1RevenueRows.find((row) => row.reportDate === previousQ1Date) || null;

  return {
    code: instrument.code,
    symbol: instrument.symbol,
    name: instrument.name,
    reportDate: latestProfitRow.reportDate,
    noticeDate: latestProfitRow.noticeDate,
    year: latestYear,
    profit: roundMetricValue(latestProfitRow.value),
    revenue: roundMetricValue(latestRevenueRow?.value),
    profitGrowthRate: calculateSnapshotGrowthRate(latestProfitRow.value, previousProfitRow?.value),
    revenueGrowthRate: calculateSnapshotGrowthRate(latestRevenueRow?.value, previousRevenueRow?.value),
    financialCharts: {
      revenue: buildStockTableFinancialSeries(revenueQuarters),
      profit: buildStockTableFinancialSeries(profitQuarters)
    },
    source
  };
}

function buildStockTableFinancialSeries(quarters) {
  const byYear = new Map();

  for (const row of quarters || []) {
    const reportDate = normalizeDate(row.reportDate);
    const value = toFiniteNumber(row.value);
    const quarterIndex = getQuarterIndex(reportDate);
    if (!reportDate || !quarterIndex || !Number.isFinite(value)) continue;

    const year = reportDate.slice(0, 4);
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 0
      });
    }

    byYear.get(year)[`q${quarterIndex}`] = value;
  }

  const rows = [...byYear.values()]
    .sort((left, right) => left.year.localeCompare(right.year))
    .map((row) => {
      const q1 = toFiniteNumber(row.q1) || 0;
      const q2 = toFiniteNumber(row.q2) || 0;
      const q3 = toFiniteNumber(row.q3) || 0;
      const q4 = toFiniteNumber(row.q4) || 0;
      return {
        year: row.year,
        q1,
        q2,
        q3,
        q4,
        midR: q1 + q2,
        q3R: q1 + q2 + q3,
        total: q1 + q2 + q3 + q4
      };
    });

  let previous = null;
  return rows.map((row) => {
    const enriched = {
      ...row,
      gr: calculateSnapshotGrowthRate(row.total, previous?.total) ?? 0,
      q1Gr: calculateSnapshotGrowthRate(row.q1, previous?.q1) ?? 0,
      q2Gr: calculateSnapshotGrowthRate(row.q2, previous?.q2) ?? 0,
      q3Gr: calculateSnapshotGrowthRate(row.q3, previous?.q3) ?? 0,
      q4Gr: calculateSnapshotGrowthRate(row.q4, previous?.q4) ?? 0,
      midRGr: calculateSnapshotGrowthRate(row.midR, previous?.midR) ?? 0,
      q3RGr: calculateSnapshotGrowthRate(row.q3R, previous?.q3R) ?? 0
    };
    previous = row;

    return {
      year: enriched.year,
      q1: roundMetricValue(enriched.q1),
      q2: roundMetricValue(enriched.q2),
      q3: roundMetricValue(enriched.q3),
      q4: roundMetricValue(enriched.q4),
      midR: roundMetricValue(enriched.midR),
      q3R: roundMetricValue(enriched.q3R),
      total: roundMetricValue(enriched.total),
      gr: roundMetricValue(enriched.gr),
      q1Gr: roundMetricValue(enriched.q1Gr),
      q2Gr: roundMetricValue(enriched.q2Gr),
      q3Gr: roundMetricValue(enriched.q3Gr),
      q4Gr: roundMetricValue(enriched.q4Gr),
      midRGr: roundMetricValue(enriched.midRGr),
      q3RGr: roundMetricValue(enriched.q3RGr)
    };
  });
}

async function loadQ1IncomeQuarterSeries(instrument) {
  const symbol = instrument.symbol;
  let tushareIncomeRows = [];
  if (canUseTushareFinancials(instrument)) {
    tushareIncomeRows = await getTushareIncomeSheet(symbol).catch(() => []);
  }

  const tushareProfitQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
    fallbackFieldCandidates: [],
    label: '利润'
  });
  const tushareRevenueQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['totalRevenue', 'revenue'],
    fallbackFieldCandidates: [],
    label: '营业收入'
  });

  if (tushareProfitQuarters.length || tushareRevenueQuarters.length) {
    return {
      profitQuarters: tushareProfitQuarters,
      revenueQuarters: tushareRevenueQuarters,
      source: 'tushare'
    };
  }

  const mianaIncomeRows = await getStockIncomeSheet(symbol).catch(() => []);
  return {
    profitQuarters: buildQuarterMetricSeries({
      primaryRows: mianaIncomeRows,
      fallbackRows: [],
      primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
      fallbackFieldCandidates: [],
      label: '利润'
    }),
    revenueQuarters: buildQuarterMetricSeries({
      primaryRows: mianaIncomeRows,
      fallbackRows: [],
      primaryFieldCandidates: ['totalRevenue', 'revenue'],
      fallbackFieldCandidates: [],
      label: '营业收入'
    }),
    source: 'miana'
  };
}

async function loadStockTableIncomeQuarterSeries(instrument) {
  const symbol = instrument.symbol;
  let tushareIncomeRows = [];
  if (canUseTushareFinancials(instrument)) {
    tushareIncomeRows = await getTushareIncomeSheet(symbol).catch(() => []);
  }

  const tushareProfitQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
    fallbackFieldCandidates: [],
    label: '利润'
  });
  const tushareRevenueQuarters = buildQuarterMetricSeries({
    primaryRows: tushareIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['totalRevenue', 'revenue'],
    fallbackFieldCandidates: [],
    label: '营业收入'
  });

  if (tushareProfitQuarters.length || tushareRevenueQuarters.length) {
    return {
      profitQuarters: tushareProfitQuarters,
      revenueQuarters: tushareRevenueQuarters,
      source: 'tushare'
    };
  }

  const mianaIncomeRows = await getStockIncomeSheet(symbol).catch(() => []);
  const mianaProfitQuarters = buildQuarterMetricSeries({
    primaryRows: mianaIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['netIncomeAttr_p', 'netIncome'],
    fallbackFieldCandidates: [],
    label: '利润'
  });
  const mianaRevenueQuarters = buildQuarterMetricSeries({
    primaryRows: mianaIncomeRows,
    fallbackRows: [],
    primaryFieldCandidates: ['totalRevenue', 'revenue'],
    fallbackFieldCandidates: [],
    label: '营业收入'
  });

  return {
    profitQuarters: mianaProfitQuarters,
    revenueQuarters: mianaRevenueQuarters,
    source: 'miana'
  };
}

function calculateSnapshotGrowthRate(currentValue, previousValue) {
  const current = toFiniteNumber(currentValue);
  const previous = toFiniteNumber(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return roundJavaMetric(current / previous - 1, 4);
}

async function getTushareDailyBasicSnapshot() {
  if (!tushareToken) {
    throw new Error('未配置 Tushare token');
  }

  const now = Date.now();
  if (tushareDailyBasicSnapshotCache.data && tushareDailyBasicSnapshotCache.expiresAt > now) {
    return tushareDailyBasicSnapshotCache.data;
  }

  if (tushareDailyBasicSnapshotCache.promise) {
    return tushareDailyBasicSnapshotCache.promise;
  }

  tushareDailyBasicSnapshotCache.promise = (async () => {
    const tradeDates = [];
    const cursor = new Date();
    for (let index = 0; index < 7; index += 1) {
      tradeDates.push(compactDateString(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }

    for (const tradeDate of tradeDates) {
      const rows = await fetchTushareTable('daily_basic', {
        trade_date: tradeDate
      }, 'ts_code,trade_date,pe_ttm,pb,dv_ratio,dv_ttm,close,total_share,total_mv').catch(() => []);

      if (!rows.length) continue;

      const normalizedRows = rows.map((row) => ({
        tsCode: String(row.ts_code || '').trim().toUpperCase(),
        tradeDate: normalizeDate(row.trade_date),
        peTtm: toFiniteNumber(row.pe_ttm),
        pb: toFiniteNumber(row.pb),
        dvRatio: toFiniteNumber(row.dv_ratio),
        dvTtm: toFiniteNumber(row.dv_ttm),
        close: toFiniteNumber(row.close),
        totalShares: Number.isFinite(toFiniteNumber(row.total_share)) ? toFiniteNumber(row.total_share) * 10000 : null,
        totalMarketValue: Number.isFinite(toFiniteNumber(row.total_mv)) ? toFiniteNumber(row.total_mv) * 10000 : null
      }));

      const snapshot = {
        tradeDate: normalizeDate(tradeDate),
        byTsCode: new Map(normalizedRows.map((row) => [row.tsCode, row]))
      };
      tushareDailyBasicSnapshotCache.data = snapshot;
      tushareDailyBasicSnapshotCache.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
      tushareDailyBasicSnapshotCache.promise = null;
      return snapshot;
    }

    throw new Error('未找到可用的 Tushare daily_basic 交易日快照');
  })().catch((error) => {
    tushareDailyBasicSnapshotCache.promise = null;
    throw error;
  });

  return tushareDailyBasicSnapshotCache.promise;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(list.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
    return value.slice(0, 10);
  }
  return toDateString(new Date(value));
}

function parseMarketDateTime(value, timeZone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return Math.floor(new Date(value).getTime() / 1000);

  const [, year, month, day, hour, minute, second = '00'] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return Math.floor((utcGuess - offset) / 1000);
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUTC - date.getTime();
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimeString(date) {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${hour}:${minute}:${second}`;
}

function stringifyChartTime(time) {
  if (!time) return '';
  if (typeof time === 'number') {
    return new Date(time * 1000).toLocaleString('zh-CN', { hour12: false });
  }
  return time;
}

function getCombinedSeriesRange(seriesList) {
  const times = seriesList
    .flat()
    .map((item) => item?.time)
    .filter(Boolean);

  if (!times.length) {
    return { start: '--', end: '--' };
  }

  const sorted = [...times].sort((left, right) => {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }

    return String(left).localeCompare(String(right), 'zh-CN');
  });

  return {
    start: stringifyChartTime(sorted[0]) || '--',
    end: stringifyChartTime(sorted.at(-1)) || '--'
  };
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(6));
}

function candleDateKey(time) {
  if (typeof time === 'number') {
    return toDateString(new Date(time * 1000));
  }
  return String(time).slice(0, 10);
}

function isValidCandle(candle) {
  return (
    candle &&
    candle.time &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
}

function dedupeByTime(candles) {
  return [...new Map(candles.map((item) => [item.time, item])).values()];
}

function intervalMs(interval) {
  if (interval.endsWith('m')) return Number(interval.slice(0, -1)) * 60 * 1000;
  if (interval.endsWith('h')) return Number(interval.slice(0, -1)) * 60 * 60 * 1000;
  if (interval.endsWith('d')) return Number(interval.slice(0, -1)) * DAY_MS;
  if (interval.endsWith('w')) return Number(interval.slice(0, -1)) * 7 * DAY_MS;
  if (interval === '1M') return 30 * DAY_MS;
  return DAY_MS;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function createLookupKey({ type, countryCode, exchangeCode, code }) {
  return [type || '', countryCode || '', exchangeCode || '', code || ''].join(':');
}

function getTypeLabel(type) {
  return LIST_TYPES.find((item) => item.key === type)?.label || type;
}

function getMarketLabel({ type, countryCode, exchangeCode }) {
  if (type === 'RATIO') return '汇率';
  if (type === 'CRYPTO') return '币圈';
  if (type === 'FOREX') return '外汇';
  if (countryCode === 'CHN') return 'A股';
  if (countryCode === 'HKG') return '港股';
  if (countryCode === 'USA') return type === 'INDEX' ? '美股指数' : '美股';
  if (exchangeCode) return exchangeCode;
  if (countryCode) return countryCode;
  return '--';
}

function compareInstruments(left, right) {
  const typeOrder = ['STOCK', 'INDEX', 'FUND', 'FUTURE', 'CRYPTO', 'FOREX', 'RATIO'];
  const leftType = typeOrder.indexOf(left.type);
  const rightType = typeOrder.indexOf(right.type);
  if (leftType !== rightType) {
    return leftType - rightType;
  }

  const marketScoreDiff = getInstrumentSearchMarketScore(right) - getInstrumentSearchMarketScore(left);
  if (marketScoreDiff !== 0) {
    return marketScoreDiff;
  }

  if (left.marketLabel !== right.marketLabel) {
    return left.marketLabel.localeCompare(right.marketLabel, 'zh-CN');
  }

  return left.code.localeCompare(right.code, 'zh-CN');
}
