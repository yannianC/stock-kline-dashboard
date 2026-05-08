#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strFromU8, unzipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(__dirname, '../server/a-share-latest-snapshot.json');

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : '';
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;

if (!inputPath) {
  console.error('用法: npm run import:a-share -- /path/to/A股最新数据.xlsx [output.json]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`找不到文件: ${inputPath}`);
  process.exit(1);
}

const previousSnapshot = readJsonIfExists(outputPath);
const workbook = readWorkbook(inputPath);
const snapshot = buildSnapshot(workbook, inputPath, previousSnapshot);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, 'utf8');

const sample = snapshot.items['000001'];
console.log(JSON.stringify({
  output: outputPath,
  sourceFile: path.basename(inputPath),
  sheets: snapshot.meta.sheets,
  itemCount: snapshot.meta.itemCount,
  changedItemCount: snapshot.meta.changedItemCount,
  sample000001: sample
    ? {
        name: sample.name,
        price: sample.basic?.price,
        marketCap: sample.basic?.marketCap,
        peRatio: sample.basic?.peRatio,
        pbRatio: sample.basic?.pbRatio,
        revenue: sample.revenueProfit?.revenue,
        profit: sample.revenueProfit?.profit,
        revenueGrowthRate: sample.revenueProfit?.revenueGrowthRate,
        profitGrowthRate: sample.revenueProfit?.profitGrowthRate
      }
    : null
}, null, 2));

function readWorkbook(filePath) {
  const zip = unzipSync(fs.readFileSync(filePath));
  const workbookXml = readZipText(zip, 'xl/workbook.xml');
  const relsXml = readZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = parseSharedStrings(readOptionalZipText(zip, 'xl/sharedStrings.xml') || '');
  const rels = parseWorkbookRels(relsXml);
  const sheets = parseWorkbookSheets(workbookXml)
    .map((sheet) => {
      const target = rels.get(sheet.rid);
      if (!target) return null;
      const sheetPath = normalizeWorkbookTarget(target);
      const xml = readZipText(zip, sheetPath);
      return {
        ...sheet,
        path: sheetPath,
        rows: parseSheetRows(xml, sharedStrings)
      };
    })
    .filter(Boolean);

  return { sheets };
}

function buildSnapshot(workbook, sourceFile, previousSnapshot) {
  const items = {};
  const sheetStats = {};

  for (const sheet of workbook.sheets) {
    sheetStats[sheet.name] = {
      rows: Math.max(0, sheet.rows.length - 1),
      columns: sheet.rows[0]?.length || 0
    };
  }

  ingestBasicSheet(getSheet(workbook, '股票基本信息'), items);
  ingestRevenueProfitSheet(getSheet(workbook, '营业总收入+净利润'), items);
  ingestSeriesSheet(getSheet(workbook, '每股净资产'), items, {
    targetKey: 'bookValuePerShare',
    valueKey: 'value',
    headerPattern: /每股净资产/
  });
  ingestSeriesSheet(getSheet(workbook, '净资产'), items, {
    targetKey: 'netAssetsSeries',
    valueKey: 'value',
    headerPattern: /净资产/
  });
  ingestDividendDetailSheet(getSheet(workbook, '分红明细'), items);
  ingestAnnualDividendSheet(getSheet(workbook, '年度分红总额'), items);
  ingestDisclosureSheet(getSheet(workbook, '财报披露日期'), items);

  const sortedItems = Object.fromEntries(
    Object.entries(items)
      .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([code, item]) => [code, compactObject(item)])
  );

  const changedItemCount = countChangedItems(previousSnapshot?.items, sortedItems);

  return {
    version: 1,
    meta: {
      sourceFile: path.basename(sourceFile),
      importedAt: new Date().toISOString(),
      itemCount: Object.keys(sortedItems).length,
      changedItemCount,
      sheets: sheetStats,
      note: '由 scripts/import-a-share-snapshot.mjs 从 i问财导出的 A 股最新数据 xlsx 生成。'
    },
    items: sortedItems
  };
}

function ingestBasicSheet(sheet, items) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  for (const row of sheet.rows.slice(1)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record['股票代码']);
    if (!codeInfo.code) continue;

    const item = ensureItem(items, codeInfo, record['股票简称']);
    const priceHeader = findHeader(headers, /^现价/);
    const changeHeader = findHeader(headers, /^涨跌幅/);
    const dividendHeader = findHeader(headers, /^股息率/);
    const assetHeader = findHeader(headers, /^资产总计/);
    const sharesHeader = findHeader(headers, /^总股本/);
    const marketCapHeader = findHeader(headers, /^总市值/);
    const bpsHeader = findHeader(headers, /^每股净资产/);
    const liabilityHeader = findHeader(headers, /^负债合计/);
    const netAssetsHeader = findHeader(headers, /^净资产/);
    const peHeader = findHeader(headers, /^市盈率/);
    const pbHeader = findHeader(headers, /^市净率/);
    const industryHeader = findHeader(headers, /^所属/);

    item.basic = compactObject({
      price: toNumber(record[priceHeader]),
      priceDate: extractDateFromHeader(priceHeader),
      changeRate: normalizePercent(record[changeHeader]),
      changeDate: extractDateFromHeader(changeHeader),
      dividendYieldTrailing12m: normalizePercent(record[dividendHeader]),
      dividendYieldDate: extractDateFromHeader(dividendHeader),
      totalAssets: toNumber(record[assetHeader]),
      totalAssetsReportDate: extractDateFromHeader(assetHeader),
      totalShares: toNumber(record[sharesHeader]),
      totalSharesDate: extractDateFromHeader(sharesHeader),
      marketCap: toNumber(record[marketCapHeader]),
      marketCapDate: extractDateFromHeader(marketCapHeader),
      bookValuePerShare: toNumber(record[bpsHeader]),
      bookValuePerShareReportDate: extractDateFromHeader(bpsHeader),
      totalLiabilities: toNumber(record[liabilityHeader]),
      totalLiabilitiesReportDate: extractDateFromHeader(liabilityHeader),
      netAssets: toNumber(record[netAssetsHeader]),
      netAssetsReportDate: extractDateFromHeader(netAssetsHeader),
      peRatio: toNumber(record[peHeader]),
      peDate: extractDateFromHeader(peHeader),
      pbRatio: toNumber(record[pbHeader]),
      pbDate: extractDateFromHeader(pbHeader),
      industryCategory: normalizeText(record[industryHeader])
    });
  }
}

function ingestRevenueProfitSheet(sheet, items) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  const revenueColumns = headers
    .map((header, index) => ({ header, index, reportDate: extractDateFromHeader(header) }))
    .filter((column) => /营业总收入/.test(column.header) && column.reportDate);
  const profitColumns = headers
    .map((header, index) => ({ header, index, reportDate: extractDateFromHeader(header) }))
    .filter((column) => /净利润/.test(column.header) && column.reportDate);

  for (const row of sheet.rows.slice(1)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record['股票代码']);
    if (!codeInfo.code) continue;

    const item = ensureItem(items, codeInfo, record['股票简称']);
    const revenueByDate = collectDateValueMap(row, revenueColumns);
    const profitByDate = collectDateValueMap(row, profitColumns);
    const latestReportDate = latestDate([...revenueByDate.keys(), ...profitByDate.keys()]);
    const previousReportDate = latestReportDate ? shiftReportDateYear(latestReportDate, -1) : null;
    const revenue = latestReportDate ? revenueByDate.get(latestReportDate) : null;
    const profit = latestReportDate ? profitByDate.get(latestReportDate) : null;
    const previousRevenue = previousReportDate ? revenueByDate.get(previousReportDate) : null;
    const previousProfit = previousReportDate ? profitByDate.get(previousReportDate) : null;

    item.revenueProfit = compactObject({
      reportDate: latestReportDate,
      revenue,
      profit,
      previousReportDate,
      previousRevenue,
      previousProfit,
      revenueGrowthRate: calculateGrowthRate(revenue, previousRevenue),
      profitGrowthRate: calculateGrowthRate(profit, previousProfit),
      financialCharts: {
        revenue: cumulativeMapToFinancialRows(revenueByDate),
        profit: cumulativeMapToFinancialRows(profitByDate)
      },
      source: 'xlsx'
    });
  }
}

function ingestSeriesSheet(sheet, items, { targetKey, valueKey, headerPattern }) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  const columns = headers
    .map((header, index) => ({ header, index, reportDate: extractDateFromHeader(header) }))
    .filter((column) => headerPattern.test(column.header) && column.reportDate);

  for (const row of sheet.rows.slice(1)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record['股票代码']);
    if (!codeInfo.code) continue;
    const item = ensureItem(items, codeInfo, record['股票简称']);
    item[targetKey] = columns
      .map((column) => ({
        reportDate: column.reportDate,
        [valueKey]: toNumber(row[column.index])
      }))
      .filter((entry) => Number.isFinite(entry[valueKey]))
      .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  }
}

function ingestDividendDetailSheet(sheet, items) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  const secondRow = sheet.rows[1] || [];
  const startsAt = looksLikeTranslatedHeader(secondRow) ? 2 : 1;

  for (const row of sheet.rows.slice(startsAt)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record.Symbol);
    if (!codeInfo.code) continue;
    const item = ensureItem(items, codeInfo, record.ShortName);
    if (!item.dividendDetails) item.dividendDetails = [];
    item.dividendDetails.push(compactObject({
      dividendYear: toNumber(record.DivdendYear),
      declareDate: normalizeExcelDateLike(record.DeclareDate),
      planDividendPer10: toNumber(record.PlanDividentBT),
      implementationDate: normalizeExcelDateLike(record.ImplementationDate),
      dividendPer10: toNumber(record.DividentBT),
      distributionBaseShares: toNumber(record.DistributionBaseShares),
      totalDividend: toNumber(record.TotalDividendDistri),
      recordDate: normalizeExcelDateLike(record.RecordDate),
      exDividendDate: normalizeExcelDateLike(record.ExDividendDate),
      paymentDate: normalizeExcelDateLike(record.PaymentDate),
      content: normalizeText(record.ImplementationContent || record.DivdendPlan)
    }));
  }

  for (const item of Object.values(items)) {
    if (item.dividendDetails) {
      item.dividendDetails.sort((left, right) => String(left.exDividendDate || '').localeCompare(String(right.exDividendDate || '')));
    }
  }
}

function ingestAnnualDividendSheet(sheet, items) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  const totalColumns = headers
    .map((header, index) => ({ header, index, year: extractYearFromHeader(header), declared: /已宣告/.test(header) }))
    .filter((column) => /年度累计分红总额/.test(column.header) && column.year);

  for (const row of sheet.rows.slice(1)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record['证券代码']);
    if (!codeInfo.code) continue;
    const item = ensureItem(items, codeInfo, record['证券名称']);
    const annual = {};

    for (const column of totalColumns) {
      const value = toNumber(row[column.index]);
      if (!Number.isFinite(value)) continue;
      const key = String(column.year);
      if (!annual[key]) annual[key] = {};
      if (column.declared) {
        annual[key].declaredTotalDividend = value;
      } else {
        annual[key].totalDividend = value;
      }
    }

    item.annualDividends = annual;
  }
}

function ingestDisclosureSheet(sheet, items) {
  if (!sheet?.rows?.length) return;
  const headers = normalizeHeaders(sheet.rows[0]);
  const columns = headers
    .map((header, index) => ({ header, index, reportDate: extractDateFromHeader(header) }))
    .filter((column) => /实际披露日期/.test(column.header) && column.reportDate);

  for (const row of sheet.rows.slice(1)) {
    const record = rowToRecord(headers, row);
    const codeInfo = normalizeStockCode(record['股票代码']);
    if (!codeInfo.code) continue;
    const item = ensureItem(items, codeInfo, record['股票简称']);
    item.disclosureDates = columns
      .map((column) => ({
        reportDate: column.reportDate,
        disclosureDate: normalizeCompactDate(row[column.index])
      }))
      .filter((entry) => entry.disclosureDate)
      .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  }
}

function getSheet(workbook, name) {
  return workbook.sheets.find((sheet) => sheet.name === name) || null;
}

function ensureItem(items, codeInfo, name) {
  if (!items[codeInfo.code]) {
    items[codeInfo.code] = compactObject({
      code: codeInfo.code,
      symbol: codeInfo.symbol,
      exchange: codeInfo.exchange,
      name: normalizeText(name)
    });
  }

  const item = items[codeInfo.code];
  if (!item.symbol && codeInfo.symbol) item.symbol = codeInfo.symbol;
  if (!item.exchange && codeInfo.exchange) item.exchange = codeInfo.exchange;
  if (!item.name && name) item.name = normalizeText(name);
  return item;
}

function parseWorkbookSheets(xml) {
  return [...xml.matchAll(/<sheet\b([^>]*)>/g)].map((match) => {
    const attrs = parseAttributes(match[1]);
    return {
      name: decodeXml(attrs.name || ''),
      sheetId: attrs.sheetId || '',
      rid: attrs['r:id'] || attrs.id || ''
    };
  });
}

function parseWorkbookRels(xml) {
  const rels = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }
  return rels;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
    return parts.join('');
  });
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row = [];
    const body = rowMatch[2];
    for (const cellMatch of body.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const columnIndex = columnIndexFromRef(attrs.r);
      if (columnIndex < 0) continue;
      row[columnIndex] = parseCellValue(cellMatch[2], attrs, sharedStrings);
    }
    rows.push(row.map((value) => value ?? null));
  }
  return rows;
}

function parseCellValue(body, attrs, sharedStrings) {
  const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
  const inlineParts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
  const raw = valueMatch ? decodeXml(valueMatch[1]) : inlineParts.join('');
  if (raw === '') return null;

  if (attrs.t === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }
  if (attrs.t === 'str' || attrs.t === 'inlineStr') {
    return raw;
  }
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function parseAttributes(text) {
  const attrs = {};
  for (const match of text.matchAll(/([\w:]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function normalizeWorkbookTarget(target) {
  const clean = target.replace(/^\/+/, '');
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

function normalizeHeaders(row) {
  return (row || []).map((header) => normalizeHeader(header));
}

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n+/g, '\n')
    .trim();
}

function rowToRecord(headers, row) {
  const record = {};
  headers.forEach((header, index) => {
    if (header) record[header] = normalizeCellValue(row[index]);
  });
  return record;
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '--' || trimmed === '——') return null;
    return trimmed;
  }
  return value;
}

function normalizeStockCode(value) {
  const raw = normalizeText(value);
  if (!raw) return { code: '', exchange: '', symbol: '' };

  const match = raw.match(/(\d{1,6})(?:\.(SZ|SH|BJ))?/i);
  if (!match) return { code: '', exchange: '', symbol: '' };

  const code = match[1].padStart(6, '0');
  const exchange = (match[2] || inferExchangeFromCode(code)).toUpperCase();
  const prefix = exchange === 'SH' ? 'sh' : exchange === 'BJ' ? 'bj' : 'sz';
  return {
    code,
    exchange,
    symbol: `${prefix}${code}`
  };
}

function inferExchangeFromCode(code) {
  if (/^(5|6|9)/.test(code)) return 'SH';
  if (/^(8|4)/.test(code)) return 'BJ';
  return 'SZ';
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function findHeader(headers, pattern) {
  return headers.find((header) => pattern.test(header)) || '';
}

function extractDateFromHeader(header) {
  const text = String(header || '');
  const match = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function extractYearFromHeader(header) {
  const match = String(header || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function collectDateValueMap(row, columns) {
  const map = new Map();
  for (const column of columns) {
    const value = toNumber(row[column.index]);
    if (Number.isFinite(value)) map.set(column.reportDate, value);
  }
  return map;
}

function latestDate(dates) {
  return dates.filter(Boolean).sort().at(-1) || null;
}

function shiftReportDateYear(date, delta) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${Number(match[1]) + delta}-${match[2]}-${match[3]}`;
}

function cumulativeMapToFinancialRows(cumulativeByDate) {
  const cumulativeByYear = new Map();
  for (const [date, value] of cumulativeByDate.entries()) {
    const quarter = getQuarterIndex(date);
    if (!quarter || !Number.isFinite(value)) continue;
    const year = date.slice(0, 4);
    if (!cumulativeByYear.has(year)) cumulativeByYear.set(year, {});
    cumulativeByYear.get(year)[`q${quarter}`] = value;
  }

  const quarterRows = [...cumulativeByYear.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([year, cumulative]) => {
      const q1Cumulative = toNumber(cumulative.q1);
      const q2Cumulative = toNumber(cumulative.q2);
      const q3Cumulative = toNumber(cumulative.q3);
      const q4Cumulative = toNumber(cumulative.q4);
      const q1 = q1Cumulative;
      const q2 = Number.isFinite(q2Cumulative) && Number.isFinite(q1Cumulative) ? q2Cumulative - q1Cumulative : null;
      const q3 = Number.isFinite(q3Cumulative) && Number.isFinite(q2Cumulative) ? q3Cumulative - q2Cumulative : null;
      const q4 = Number.isFinite(q4Cumulative) && Number.isFinite(q3Cumulative) ? q4Cumulative - q3Cumulative : null;
      const latestQuarter = [
        Number.isFinite(q1Cumulative) ? 1 : 0,
        Number.isFinite(q2Cumulative) ? 2 : 0,
        Number.isFinite(q3Cumulative) ? 3 : 0,
        Number.isFinite(q4Cumulative) ? 4 : 0
      ].reduce((max, value) => Math.max(max, value), 0);
      return {
        year,
        latestQuarter,
        q1Present: Number.isFinite(q1),
        q2Present: Number.isFinite(q2),
        q3Present: Number.isFinite(q3),
        q4Present: Number.isFinite(q4),
        q1: Number.isFinite(q1) ? q1 : 0,
        q2: Number.isFinite(q2) ? q2 : 0,
        q3: Number.isFinite(q3) ? q3 : 0,
        q4: Number.isFinite(q4) ? q4 : 0
      };
    });

  let previous = null;
  return quarterRows.map((row) => {
    const midR = row.q1 + row.q2;
    const q3R = midR + row.q3;
    const total = q3R + row.q4;
    const comparableKey = row.latestQuarter <= 1 ? 'q1' : row.latestQuarter === 2 ? 'midR' : row.latestQuarter === 3 ? 'q3R' : 'total';
    const enriched = {
      year: row.year,
      q1: roundMetric(row.q1),
      q2: roundMetric(row.q2),
      q3: roundMetric(row.q3),
      q4: roundMetric(row.q4),
      midR: roundMetric(midR),
      q3R: roundMetric(q3R),
      total: roundMetric(total),
      gr: roundMetric(calculateGrowthRate({ q1: row.q1, midR, q3R, total }[comparableKey], previous?.[comparableKey]) ?? 0),
      q1Gr: row.q1Present ? roundMetric(calculateGrowthRate(row.q1, previous?.q1) ?? 0) : null,
      q2Gr: row.q2Present ? roundMetric(calculateGrowthRate(row.q2, previous?.q2) ?? 0) : null,
      q3Gr: row.q3Present ? roundMetric(calculateGrowthRate(row.q3, previous?.q3) ?? 0) : null,
      q4Gr: row.q4Present ? roundMetric(calculateGrowthRate(row.q4, previous?.q4) ?? 0) : null,
      midRGr: row.latestQuarter >= 2 ? roundMetric(calculateGrowthRate(midR, previous?.midR) ?? 0) : null,
      q3RGr: row.latestQuarter >= 3 ? roundMetric(calculateGrowthRate(q3R, previous?.q3R) ?? 0) : null
    };
    previous = { ...row, midR, q3R, total };
    return enriched;
  });
}

function getQuarterIndex(date) {
  const month = Number(String(date || '').slice(5, 7));
  if (month === 3) return 1;
  if (month === 6) return 2;
  if (month === 9) return 3;
  if (month === 12) return 4;
  return null;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text || text === '--' || text === '——') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizePercent(value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return null;
  return roundMetric(Math.abs(number) > 1 ? number / 100 : number);
}

function calculateGrowthRate(currentValue, previousValue) {
  const current = toNumber(currentValue);
  const previous = toNumber(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return roundMetric(current / previous - 1);
}

function normalizeCompactDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return normalizeExcelDateLike(value);
}

function normalizeExcelDateLike(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 10_000_000) return normalizeCompactDate(String(Math.trunc(value)));
    return excelSerialToDate(value);
  }
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return normalizeCompactDate(text);
  const dateLike = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dateLike) return `${dateLike[1]}-${dateLike[2].padStart(2, '0')}-${dateLike[3].padStart(2, '0')}`;
  return text;
}

function excelSerialToDate(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function looksLikeTranslatedHeader(row) {
  return row.some((value) => String(value || '').includes('股票代码') || String(value || '').includes('证券简称'));
}

function roundMetric(value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(6));
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactObject(entry);
    if (compacted === undefined || compacted === null || compacted === '') continue;
    if (Array.isArray(compacted) && !compacted.length) continue;
    if (typeof compacted === 'object' && !Array.isArray(compacted) && !Object.keys(compacted).length) continue;
    next[key] = compacted;
  }
  return next;
}

function countChangedItems(previousItems, nextItems) {
  if (!previousItems || typeof previousItems !== 'object') return Object.keys(nextItems).length;
  let changed = 0;
  for (const [code, item] of Object.entries(nextItems)) {
    if (JSON.stringify(previousItems[code] || null) !== JSON.stringify(item)) changed += 1;
  }
  return changed;
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function readZipText(zip, name) {
  const bytes = zip[name];
  if (!bytes) throw new Error(`xlsx 内缺少 ${name}`);
  return strFromU8(bytes);
}

function readOptionalZipText(zip, name) {
  const bytes = zip[name];
  return bytes ? strFromU8(bytes) : null;
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number) => String.fromCharCode(Number(number)))
    .replace(/&amp;/g, '&');
}

function columnIndexFromRef(ref) {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || '';
  if (!letters) return -1;
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}
