import {
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  createChart
} from 'lightweight-charts';
import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  ChartCandlestick,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  Star,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { loadCompareDetail, loadInstrumentDetail, loadInstruments, loadStockTable, saveStockTableCell } from './api.js';
import { formatCompact } from './chartUtils.js';

const EMPTY_SERIES = [];

const INTERVAL_OPTIONS = [
  { key: '1m', label: '分钟K' },
  { key: '15m', label: '15分K' },
  { key: '1h', label: '1小时K' },
  { key: '4h', label: '4小时K' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' }
];

const DEFAULT_TYPES = [
  { key: 'all', label: '全部' },
  { key: 'STOCK', label: '股票' },
  { key: 'INDEX', label: '指数' },
  { key: 'FUND', label: '基金' },
  { key: 'FUTURE', label: '期货' },
  { key: 'CRYPTO', label: '币圈' },
  { key: 'FOREX', label: '外汇' },
  { key: 'RATIO', label: '汇率' }
];

const BUILTIN_COMPARE_OPTIONS = [
  {
    id: 'CRYPTO:BTC',
    code: 'BTC',
    displayCode: 'BTC',
    symbol: 'BTC',
    type: 'CRYPTO',
    typeLabel: '币圈',
    name: 'BTC',
    chineseName: '比特币',
    displayName: 'BTC / 比特币',
    marketLabel: '币圈',
    searchText: 'btc bitcoin 比特币 币圈'
  },
  {
    id: 'INDEX:NDX',
    code: 'NDX',
    displayCode: 'NDX',
    symbol: 'NDX',
    type: 'INDEX',
    typeLabel: '指数',
    name: '纳指',
    chineseName: '纳斯达克100',
    displayName: 'NDX / 纳指',
    marketLabel: '美股指数',
    searchText: 'ndx 纳指 纳斯达克 纳斯达克100 nasdaq nasdaq100 美股指数'
  }
];

const DEFAULT_COMPARE_FAVORITE = {
  key: 'divide:CRYPTO:BTC:INDEX:NDX',
  leftId: 'CRYPTO:BTC',
  rightId: 'INDEX:NDX',
  mode: 'divide',
  leftCode: 'BTC',
  rightCode: 'NDX',
  leftName: 'BTC',
  rightName: '纳指',
  code: 'BTC/NDX',
  name: 'BTC/纳指',
  displayName: 'BTC/纳指',
  searchText: 'btc/ndx btc/纳指 bitcoin 比特币 纳指 nasdaq 纳斯达克 汇率 ratio 对比',
  pinned: true
};

const COMPARE_FAVORITES_KEY = 'stock-kline-compare-favorites-v1';
const COMPARE_ADJUSTMENT_MODE_KEY = 'stock-kline-compare-adjustment-mode-v1';
const COMPARE_MODE_OPTIONS = [
  { key: 'subtract', label: '减法', symbol: '-' },
  { key: 'divide', label: '除法', symbol: '/' }
];
const COMPARE_ADJUSTMENT_OPTIONS = [
  { key: 'raw', label: 'K线' },
  { key: 'qfq', label: '前复权' },
  { key: 'hfq', label: '后复权' }
];
const DEFAULT_COMPARE_MULTIPLIER = '1';
const DEFAULT_STRATEGY_LEVERAGE = '1';
const COMPARE_MINUTE_DEFAULT_LOOKBACK_DAYS = 3650;
const COMPARE_MINUTE_MAX_LOOKBACK_DAYS = 15000;
const STOCK_TABLE_PAGE_SIZE = 80;
const STOCK_TABLE_COLUMNS = [
  { key: 'tickerSymbol', label: '股票代码', sortable: true, compact: true },
  { key: 'tickerName', label: '股票简称', sortable: true, sticky: true },
  { key: 'compare', label: '对比', action: true },
  { key: 'performanceGrowthScore', label: '业绩增长\n评分', sortable: true, editable: true, format: 'score' },
  { key: 'overallScore', label: '综合评分', sortable: true, editable: true, format: 'score' },
  { key: 'liudaScore', label: '刘大评分', sortable: true, editable: true, format: 'score' },
  { key: 'marketCap', label: '总市值\n(元)', sortable: true, format: 'amount' },
  { key: 'stockPrice', label: '股价', sortable: true, format: 'price' },
  { key: 'grossRevenue', label: '营业收入', sortable: true, format: 'amount' },
  { key: 'netProfit', label: '净利润', sortable: true, format: 'amount' },
  { key: 'industryCategory', label: '所属行业', sortable: true },
  { key: 'peRatioTtm', label: '市盈率\n(ttm)', sortable: true, format: 'ratio' },
  { key: 'pbRatio', label: '市净率', sortable: true, format: 'ratio' },
  { key: 'dividendYield2026', label: '2026年\n股息率', sortable: true, format: 'percent' },
  { key: 'dividendYield2025', label: '2025年\n股息率', sortable: true, format: 'percent' },
  { key: 'forecastRevenueGrowthRate', label: '收入预测\n增长率', sortable: true, format: 'percent' },
  { key: 'forecastProfitGrowthRate', label: '利润预测\n增长率', sortable: true, format: 'percent' },
  { key: 'forecastPe3Years', label: '预测\n3年后PE', sortable: true, format: 'ratio' },
  { key: 'annualPriceChange', label: '5年内\n涨跌幅', sortable: true, format: 'percent' },
  { key: 'revGrowthRateNew', label: '新营收\n增长率', sortable: true, format: 'percent' },
  { key: 'profitGrowthRateNew', label: '新利润\n增长率', sortable: true, format: 'percent' },
  { key: 'peForecastNew', label: '新预测PE', sortable: true, format: 'ratio' },
  { key: 'targetPrice1', label: '一级目标价', editable: true },
  { key: 'targetPrice2', label: '二级目标价', editable: true },
  { key: 'note1', label: '备注1', editable: true, wide: true },
  { key: 'note2', label: '备注2', editable: true, wide: true }
];
const STOCK_FILTER_FIELDS = STOCK_TABLE_COLUMNS
  .filter((column) => !column.action)
  .map((column) => ({ key: column.key, label: column.label.replace(/\n/g, '') }));
const STOCK_FILTER_OPERATORS = [
  { key: 'contains', label: '包含' },
  { key: 'eq', label: '=' },
  { key: 'gte', label: '>=' },
  { key: 'lte', label: '<=' },
  { key: 'gt', label: '>' },
  { key: 'lt', label: '<' }
];

function App() {
  const [route, setRoute] = useState(() => getRouteState());
  const [compareFavorites, setCompareFavorites] = useState(() => loadStoredCompareFavorites());

  useEffect(() => {
    const handlePopState = () => setRoute(getRouteState());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    storeCompareFavorites(compareFavorites);
  }, [compareFavorites]);

  const navigate = useCallback((nextRoute) => {
    const url = new URL(window.location.href);
    applyRouteToUrl(url, nextRoute);

    window.history.pushState({}, '', url);
    setRoute(getRouteState());
  }, []);

  const upsertCompareFavorite = useCallback((favorite) => {
    if (!favorite || isDefaultFavoriteKey(favorite.key)) return;

    setCompareFavorites((current) => {
      const normalized = normalizeStoredFavorite(favorite);
      if (!normalized) return current;
      const next = current.filter((item) => item.key !== normalized.key);
      next.push(normalized);
      next.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
      return next;
    });
  }, []);

  const removeCompareFavorite = useCallback((favoriteKey) => {
    if (isDefaultFavoriteKey(favoriteKey)) return;
    setCompareFavorites((current) => current.filter((item) => item.key !== favoriteKey));
  }, []);

  if (route.view === 'detail') {
    return (
      <InstrumentDetailPage
        id={route.id}
        initialIntervalKey={route.intervalKey}
        initialChartMode={route.chartMode}
        initialShowRaw={route.showRaw}
        initialShowQfq={route.showQfq}
        initialShowHfq={route.showHfq}
        initialShowMidAdjust={route.showMidAdjust}
        initialMidAdjustDate={route.midAdjustDate}
        initialShowLeftComponent={route.showLeftComponent}
        initialShowRightComponent={route.showRightComponent}
        onBack={() => navigate({ view: 'list' })}
      />
    );
  }

  if (route.view === 'compare') {
    return (
      <CompareDetailPage
        leftId={route.left}
        rightId={route.right}
        mode={route.mode}
        initialIntervalKey={route.intervalKey}
        initialChartMode={route.chartMode}
        initialShowRaw={route.showRaw}
        initialShowLeftComponent={route.showLeftComponent}
        initialShowRightComponent={route.showRightComponent}
        initialAnchorDate={route.anchorDate}
        initialAnchorEnabled={route.anchorEnabled}
        initialCompareAdjustmentMode={route.compareAdjustmentMode}
        initialCompareCommonBase={route.compareCommonBase}
        initialLeftMultiplier={route.leftMultiplier}
        initialRightMultiplier={route.rightMultiplier}
        initialCompareMinuteCandles={route.compareMinuteCandles}
        initialStrategyEnabled={route.strategyEnabled}
        initialStrategySide={route.strategySide}
        initialStrategyLeftLeverage={route.strategyLeftLeverage}
        initialStrategyRightLeverage={route.strategyRightLeverage}
        initialShowStrategySeries={route.showStrategySeries}
        compareFavorites={compareFavorites}
        onBack={() => navigate({ view: 'list' })}
        onNavigate={navigate}
        onSaveFavorite={upsertCompareFavorite}
        onRemoveFavorite={removeCompareFavorite}
      />
    );
  }

  return (
    <InstrumentListPage
      compareFavorites={compareFavorites}
      onOpenDetail={(id) => navigate({ view: 'detail', id })}
      onOpenCompare={(compare) => navigate({ view: 'compare', ...compare })}
    />
  );
}

function InstrumentListPage({ compareFavorites, onOpenDetail, onOpenCompare }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('STOCK');
  const [stockFilterDrafts, setStockFilterDrafts] = useState(() => createDefaultStockFilterDrafts());
  const [stockFilters, setStockFilters] = useState([]);
  const [stockSort, setStockSort] = useState({ field: 'tickerSymbol', direction: 'ASC' });
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [compareDraft, setCompareDraft] = useState(null);
  const [favoriteQuotes, setFavoriteQuotes] = useState({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 220);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchList = useCallback(async () => {
    if (type === 'RATIO') {
      setPayload(null);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const next = type === 'STOCK'
        ? await loadStockTable({
          page,
          pageSize: STOCK_TABLE_PAGE_SIZE,
          search,
          sortField: stockSort.field,
          sortDirection: stockSort.direction,
          filters: stockFilters
        })
        : await loadInstruments({
          page,
          pageSize: 40,
          search,
          type
        });
      setPayload(next);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, stockFilters, stockSort, type]);

  useEffect(() => {
    fetchList();
  }, [fetchList, reloadToken]);

  const ratioFavorites = useMemo(
    () => getVisibleCompareFavorites(compareFavorites, search, favoriteQuotes),
    [compareFavorites, search, favoriteQuotes]
  );

  useEffect(() => {
    if (type !== 'RATIO') return;

    const pendingFavorites = ratioFavorites.filter((favorite) => favoriteQuotes[favorite.key] === undefined);
    if (!pendingFavorites.length) return;

    let cancelled = false;

    Promise.all(
      pendingFavorites.map(async (favorite) => {
        try {
          const detail = await loadCompareDetail({
            left: favorite.leftId,
            right: favorite.rightId,
            mode: favorite.mode,
            interval: 'day'
          });

          return [
            favorite.key,
            {
              ...detail.quote,
              instrumentType: detail.instrument?.type
            }
          ];
        } catch (_error) {
          return [favorite.key, null];
        }
      })
    ).then((pairs) => {
      if (cancelled) return;

      setFavoriteQuotes((current) => {
        const next = { ...current };
        for (const [key, quote] of pairs) {
          next[key] = quote;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [type, ratioFavorites, favoriteQuotes]);

  const ratioPageSize = 40;
  const pageCount = type === 'RATIO'
    ? Math.max(1, Math.ceil(ratioFavorites.length / ratioPageSize))
    : Math.max(1, Math.ceil((payload?.total || 0) / (payload?.pageSize || 40)));
  const pageItems = type === 'RATIO'
    ? ratioFavorites.slice((page - 1) * ratioPageSize, page * ratioPageSize)
    : payload?.items || [];
  const totalCount = type === 'RATIO' ? ratioFavorites.length : payload?.total ?? '--';
  const listTypes = payload?.listTypes || DEFAULT_TYPES;
  const q1SnapshotMeta = payload?.filters?.q1Snapshot || null;
  const handleStockSort = useCallback((field) => {
    setPage(1);
    setStockSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'ASC' ? 'DESC' : 'ASC'
    }));
  }, []);
  const handleStockCellSaved = useCallback(({ id, field, value }) => {
    setPayload((current) => {
      if (!current?.items) return current;
      return {
        ...current,
        items: current.items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      };
    });
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Activity size={20} />
          </span>
          <div>
            <h1>多品种看盘台</h1>
            <p>列表看报价，支持直接拉起两边对比；对比页支持收藏，收藏后会出现在汇率分类里。</p>
          </div>
        </div>

        <div className="toolbar">
          <label className="search-box" aria-label="搜索品种">
            <Search size={16} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜名称、代码、市场"
            />
          </label>
          <button
            className="icon-button"
            onClick={() => setCompareDraft({ left: null, right: null, mode: 'divide' })}
            title="发起对比"
          >
            <ArrowLeftRight size={16} />
            对比
          </button>
          <button className="icon-button" onClick={() => setReloadToken((value) => value + 1)} disabled={loading} title="刷新列表">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <section className="filter-row">
        <div className="segmented-control" aria-label="品种类型">
          {listTypes.map((option) => (
            <button
              key={option.key}
              className={type === option.key ? 'segment is-active' : 'segment'}
              onClick={() => {
                setType(option.key);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="list-summary">
          <strong>{totalCount}</strong>
          <span>个品种</span>
        </div>
      </section>

      {type === 'STOCK' ? (
        <StockFilterPanel
          drafts={stockFilterDrafts}
          activeFilters={stockFilters}
          loading={loading}
          meta={q1SnapshotMeta}
          onDraftsChange={setStockFilterDrafts}
          onApply={(filters) => {
            setPage(1);
            setStockFilters(filters);
          }}
          onClear={() => {
            setStockFilterDrafts(createDefaultStockFilterDrafts());
            setStockFilters([]);
            setPage(1);
          }}
        />
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="list-region">
        <div className="table-scroll">
          {type === 'STOCK' ? (
            <StockTable
              items={pageItems}
              sort={stockSort}
              onSort={handleStockSort}
              onOpenDetail={onOpenDetail}
              onOpenCompare={(item) => {
                const compareSpec = getCompareSpecFromItem(item);
                setCompareDraft({
                  left: compareSpec ? buildDraftOptionFromSpec(item, compareSpec, 'left') : toCompareOption(item),
                  right: compareSpec ? buildDraftOptionFromSpec(item, compareSpec, 'right') : null,
                  mode: compareSpec?.mode || 'divide'
                });
              }}
              onCellSaved={handleStockCellSaved}
            />
          ) : (
            <DefaultInstrumentTable
              items={pageItems}
              onOpenDetail={onOpenDetail}
              onOpenCompareRoute={onOpenCompare}
              onOpenCompareDraft={(item) => {
                const compareSpec = getCompareSpecFromItem(item);
                setCompareDraft({
                  left: compareSpec ? buildDraftOptionFromSpec(item, compareSpec, 'left') : toCompareOption(item),
                  right: compareSpec ? buildDraftOptionFromSpec(item, compareSpec, 'right') : null,
                  mode: compareSpec?.mode || 'divide'
                });
              }}
            />
          )}

          {!loading && !pageItems.length ? <div className="empty-state">没有匹配到品种。</div> : null}
          {loading && type !== 'RATIO' ? <div className="loading-layer">正在加载品种列表...</div> : null}
        </div>

        <div className="pager">
          <button
            className="icon-button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            上一页
          </button>
          <span>
            第 {page} / {pageCount} 页
          </span>
          <button
            className="icon-button"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          >
            下一页
          </button>
        </div>
      </section>

      <CompareModal
        draft={compareDraft}
        onClose={() => setCompareDraft(null)}
        onConfirm={(compare) => {
          setCompareDraft(null);
          onOpenCompare(compare);
        }}
      />
    </main>
  );
}

function DefaultInstrumentTable({ items, onOpenDetail, onOpenCompareRoute, onOpenCompareDraft }) {
  return (
    <table className="market-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>代码</th>
          <th>分类</th>
          <th>市场</th>
          <th>最新价</th>
          <th>涨跌额</th>
          <th>涨跌幅</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            onClick={() => openListItem(item, { onOpenDetail, onOpenCompare: onOpenCompareRoute })}
            className="table-row"
          >
            <td>
              <div className="symbol-cell">
                <div className="symbol-main">
                  <strong>{item.name}</strong>
                  <button
                    className="compare-inline-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCompareDraft(item);
                    }}
                  >
                    对比
                  </button>
                </div>
                {item.chineseName && item.chineseName !== item.name ? <span>{item.chineseName}</span> : null}
              </div>
            </td>
            <td>{getDisplayCodeText(item)}</td>
            <td>{item.typeLabel}</td>
            <td>{item.marketLabel}</td>
            <td>{formatQuotePrice(item.quote?.price, item.quote?.instrumentType || item.type)}</td>
            <td className={toneClass(item.quote?.change)}>{formatSigned(item.quote?.change)}</td>
            <td className={toneClass(item.quote?.changeRate)}>{formatSignedPercent(item.quote?.changeRate)}</td>
            <td>{formatTableTime(item.quote?.date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StockTable({ items, sort, onSort, onOpenDetail, onOpenCompare, onCellSaved }) {
  return (
    <table className="market-table stock-data-table">
      <thead>
        <tr>
          {STOCK_TABLE_COLUMNS.map((column) => (
            <th key={column.key} className={column.sticky ? 'stock-name-header' : ''}>
              {column.sortable ? (
                <button className="table-sort-button" onClick={() => onSort(column.key)}>
                  {column.label.split('\n').map((part) => <span key={part}>{part}</span>)}
                  <b>{sort.field === column.key ? (sort.direction === 'ASC' ? '↑' : '↓') : ''}</b>
                </button>
              ) : (
                column.label.split('\n').map((part) => <span key={part}>{part}</span>)
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="table-row" onClick={() => onOpenDetail(item.id)}>
            {STOCK_TABLE_COLUMNS.map((column) => (
              <td key={column.key} className={getStockTableCellClass(column)}>
                {renderStockTableCell({ item, column, onOpenCompare, onCellSaved })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderStockTableCell({ item, column, onOpenCompare, onCellSaved }) {
  if (column.key === 'compare') {
    return (
      <button
        className="compare-inline-button is-visible"
        onClick={(event) => {
          event.stopPropagation();
          onOpenCompare(item);
        }}
      >
        对比
      </button>
    );
  }

  if (column.key === 'tickerName') {
    return (
      <div className="stock-name-cell">
        <strong>{item.tickerName || item.name}</strong>
        <span>{item.marketLabel}</span>
      </div>
    );
  }

  if (column.editable) {
    return (
      <StockEditableCell
        item={item}
        column={column}
        onSaved={onCellSaved}
      />
    );
  }

  return (
    <span className={getStockValueTone(item[column.key], column.format)}>
      {formatStockTableValue(item[column.key], column.format)}
    </span>
  );
}

function StockEditableCell({ item, column, onSaved }) {
  const [value, setValue] = useState(() => formatEditableStockValue(item[column.key]));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(formatEditableStockValue(item[column.key]));
  }, [item.id, item[column.key]]);

  const save = async () => {
    const nextValue = value.trim();
    if (nextValue === formatEditableStockValue(item[column.key])) return;
    setSaving(true);
    try {
      const normalizedValue = ['performanceGrowthScore', 'overallScore', 'liudaScore'].includes(column.key)
        ? (nextValue === '' ? null : Number(nextValue))
        : nextValue;
      await saveStockTableCell({
        id: item.id,
        code: item.code,
        field: column.key,
        value: normalizedValue
      });
      onSaved?.({ id: item.id, field: column.key, value: normalizedValue });
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      className={column.wide ? 'stock-edit-input is-wide' : 'stock-edit-input'}
      value={value}
      disabled={saving}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function StockFilterPanel({ drafts, activeFilters, loading, meta, onDraftsChange, onApply, onClear }) {
  const updateDraft = (index, patch) => {
    onDraftsChange(drafts.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  };
  const normalizedFilters = drafts
    .map((draft) => ({ ...draft, value: String(draft.value || '').trim() }))
    .filter((draft) => draft.field && draft.value !== '');

  return (
    <section className="stock-filter-panel stock-filter-panel-rich">
      <div className="stock-filter-toolbar">
        <strong>股票筛选</strong>
        <span>支持多条件同时过滤，数值字段可用大于、小于；文本字段用包含。</span>
        {activeFilters.length ? <b>{activeFilters.length} 个条件生效</b> : null}
      </div>
      <div className="stock-filter-builder">
        {drafts.map((draft, index) => (
          <div className="stock-filter-rule" key={index}>
            <select value={draft.field} onChange={(event) => updateDraft(index, { field: event.target.value })}>
              {STOCK_FILTER_FIELDS.map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
            <select value={draft.op} onChange={(event) => updateDraft(index, { op: event.target.value })}>
              {STOCK_FILTER_OPERATORS.map((operator) => (
                <option key={operator.key} value={operator.key}>{operator.label}</option>
              ))}
            </select>
            <input
              value={draft.value}
              onChange={(event) => updateDraft(index, { value: event.target.value })}
              placeholder="输入筛选值"
            />
            <button
              className="icon-button"
              onClick={() => onDraftsChange(drafts.filter((_, draftIndex) => draftIndex !== index))}
              disabled={drafts.length <= 1}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <div className="stock-filter-actions">
        <button
          className="icon-button"
          onClick={() => onDraftsChange([...drafts, createStockFilterDraft()])}
        >
          添加条件
        </button>
        <button className="icon-button modal-confirm" onClick={() => onApply(normalizedFilters)} disabled={loading}>
          应用筛选
        </button>
        <button className="icon-button is-muted" onClick={onClear} disabled={loading && !activeFilters.length}>
          清空
        </button>
        <span className="filter-help">
          当前快照范围：`000001` 到 `002902`
          {meta?.generatedAt ? `，快照生成于 ${formatTableTime(meta.generatedAt)}` : ''}
        </span>
      </div>
    </section>
  );
}

function createStockFilterDraft(field = 'peRatioTtm', op = 'lte', value = '') {
  return { field, op, value };
}

function createDefaultStockFilterDrafts() {
  return [
    createStockFilterDraft('peRatioTtm', 'lte', ''),
    createStockFilterDraft('profitGrowthRateNew', 'gte', '')
  ];
}

function getStockTableCellClass(column) {
  const classes = [];
  if (column.compact) classes.push('is-compact');
  if (column.wide) classes.push('is-wide');
  if (column.sticky) classes.push('stock-name-column');
  if (column.format === 'percent') classes.push('is-number');
  if (['amount', 'price', 'ratio', 'score'].includes(column.format)) classes.push('is-number');
  return classes.join(' ');
}

function formatEditableStockValue(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatStockTableValue(value, format) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);

  if (format === 'amount') {
    return Number.isFinite(number) ? formatAmountWithYi(number) : '--';
  }
  if (format === 'percent') {
    return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : '--';
  }
  if (format === 'price') {
    return Number.isFinite(number) ? formatQuotePrice(number, 'STOCK') : '--';
  }
  if (format === 'ratio' || format === 'score') {
    return Number.isFinite(number)
      ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(number)
      : '--';
  }

  return String(value);
}

function getStockValueTone(value, format) {
  if (format !== 'percent') return '';
  return toneClass(Number(value));
}

function CompareDetailPage({
  leftId,
  rightId,
  mode,
  initialIntervalKey = 'day',
  initialChartMode = 'candles',
  initialShowRaw = true,
  initialShowLeftComponent = true,
  initialShowRightComponent = true,
  initialAnchorDate = '',
  initialAnchorEnabled = false,
  initialCompareAdjustmentMode = 'qfq',
  initialCompareCommonBase = false,
  initialLeftMultiplier = DEFAULT_COMPARE_MULTIPLIER,
  initialRightMultiplier = DEFAULT_COMPARE_MULTIPLIER,
  initialCompareMinuteCandles = false,
  initialStrategyEnabled = false,
  initialStrategySide = 'leftLong',
  initialStrategyLeftLeverage = DEFAULT_STRATEGY_LEVERAGE,
  initialStrategyRightLeverage = DEFAULT_STRATEGY_LEVERAGE,
  initialShowStrategySeries = true,
  compareFavorites,
  onBack,
  onNavigate,
  onSaveFavorite,
  onRemoveFavorite
}) {
  const [intervalKey, setIntervalKey] = useState(() => normalizeIntervalKey(initialIntervalKey));
  const [chartMode, setChartMode] = useState(() => normalizeChartMode(initialChartMode || 'line'));
  const [showRaw, setShowRaw] = useState(initialShowRaw);
  const [showLeftComponent, setShowLeftComponent] = useState(initialShowLeftComponent);
  const [showRightComponent, setShowRightComponent] = useState(initialShowRightComponent);
  const [showStrategySeries, setShowStrategySeries] = useState(initialShowStrategySeries);
  const [payload, setPayload] = useState(null);
  const [minutePayload, setMinutePayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [minuteLoading, setMinuteLoading] = useState(false);
  const [error, setError] = useState('');
  const [minuteError, setMinuteError] = useState('');
  const [compareDraft, setCompareDraft] = useState(null);
  const [minuteConfirmOpen, setMinuteConfirmOpen] = useState(false);
  const [titleLeft, setTitleLeft] = useState(null);
  const [titleRight, setTitleRight] = useState(null);
  const [titleMode, setTitleMode] = useState(parseCompareMode(mode));
  const [compareAnchorDate, setCompareAnchorDate] = useState(() => normalizeCompactDateInput(initialAnchorDate));
  const [compareAnchorEnabled, setCompareAnchorEnabled] = useState(Boolean(initialAnchorEnabled));
  const [compareAdjustmentMode, setCompareAdjustmentMode] = useState(() => normalizeCompareAdjustmentMode(initialCompareAdjustmentMode));
  const [compareCommonBase, setCompareCommonBase] = useState(Boolean(initialCompareCommonBase));
  const [leftMultiplierInput, setLeftMultiplierInput] = useState(() => normalizeMultiplierInput(initialLeftMultiplier));
  const [rightMultiplierInput, setRightMultiplierInput] = useState(() => normalizeMultiplierInput(initialRightMultiplier));
  const [compareMinuteCandles, setCompareMinuteCandles] = useState(Boolean(initialCompareMinuteCandles));
  const [strategySideInput, setStrategySideInput] = useState(() => normalizeStrategySide(initialStrategySide));
  const [strategyLeftLeverageInput, setStrategyLeftLeverageInput] = useState(() => normalizeMultiplierInput(initialStrategyLeftLeverage));
  const [strategyRightLeverageInput, setStrategyRightLeverageInput] = useState(() => normalizeMultiplierInput(initialStrategyRightLeverage));
  const [strategyConfig, setStrategyConfig] = useState(() => buildInitialStrategyConfig({
    enabled: initialStrategyEnabled,
    side: initialStrategySide,
    leftLeverage: initialStrategyLeftLeverage,
    rightLeverage: initialStrategyRightLeverage
  }));
  const [chartSnapshot, setChartSnapshot] = useState(null);
  const requestSeqRef = useRef(0);
  const minuteRequestSeqRef = useRef(0);
  const activeIntervalLabel = getIntervalOptionLabel(intervalKey);
  const minuteLookbackDays = useMemo(() => getCompareMinuteLookbackDays(payload), [payload]);

  const fetchDetail = useCallback(async ({ force = false } = {}) => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const next = await loadCompareDetail({
        left: leftId,
        right: rightId,
        mode,
        interval: intervalKey,
        force
      });
      if (requestId !== requestSeqRef.current) return;
      setPayload(next);
    } catch (requestError) {
      if (requestId !== requestSeqRef.current) return;
      setError(requestError.message);
    } finally {
      if (requestId !== requestSeqRef.current) return;
      setLoading(false);
    }
  }, [intervalKey, leftId, mode, rightId]);

  const fetchMinuteDetail = useCallback(async ({ force = false } = {}) => {
    const requestId = minuteRequestSeqRef.current + 1;
    minuteRequestSeqRef.current = requestId;
    setMinuteLoading(true);
    setMinuteError('');

    try {
      const next = await loadCompareDetail({
        left: leftId,
        right: rightId,
        mode,
        interval: '1m',
        minuteLookbackDays,
        force
      });
      if (requestId !== minuteRequestSeqRef.current) return;
      setMinutePayload(next);
    } catch (requestError) {
      if (requestId !== minuteRequestSeqRef.current) return;
      setMinuteError(requestError.message);
    } finally {
      if (requestId !== minuteRequestSeqRef.current) return;
      setMinuteLoading(false);
    }
  }, [leftId, minuteLookbackDays, mode, rightId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    setMinutePayload(null);
    setMinuteError('');
    setMinuteConfirmOpen(false);
  }, [leftId, rightId, mode]);

  useEffect(() => {
    if (!compareMinuteCandles) {
      setMinuteError('');
      return;
    }

    fetchMinuteDetail();
  }, [compareMinuteCandles, fetchMinuteDetail]);

  useEffect(() => {
    setIntervalKey(normalizeIntervalKey(initialIntervalKey));
    setChartMode(normalizeChartMode(initialChartMode || 'line'));
    setShowRaw(Boolean(initialShowRaw));
    setShowLeftComponent(Boolean(initialShowLeftComponent));
    setShowRightComponent(Boolean(initialShowRightComponent));
    setShowStrategySeries(Boolean(initialShowStrategySeries));
  }, [initialChartMode, initialIntervalKey, initialShowLeftComponent, initialShowRaw, initialShowRightComponent, initialShowStrategySeries, leftId, mode, rightId]);

  useEffect(() => {
    setTitleLeft(toCompareOption(payload?.compare?.left) || findBuiltinCompareOptionById(leftId));
    setTitleRight(toCompareOption(payload?.compare?.right) || findBuiltinCompareOptionById(rightId));
    setTitleMode(parseCompareMode(mode));
  }, [leftId, mode, payload?.compare?.left, payload?.compare?.right, rightId]);

  useEffect(() => {
    const nextDate = normalizeCompactDateInput(initialAnchorDate);
    setCompareAnchorDate(nextDate);
    setCompareAnchorEnabled(Boolean(initialAnchorEnabled && normalizeAdjustmentDateInput(nextDate)));
  }, [initialAnchorDate, initialAnchorEnabled, leftId, rightId, mode]);

  useEffect(() => {
    setCompareAdjustmentMode(normalizeCompareAdjustmentMode(initialCompareAdjustmentMode));
    setCompareCommonBase(Boolean(initialCompareCommonBase));
    setLeftMultiplierInput(normalizeMultiplierInput(initialLeftMultiplier));
    setRightMultiplierInput(normalizeMultiplierInput(initialRightMultiplier));
    setCompareMinuteCandles(Boolean(initialCompareMinuteCandles));
    setStrategySideInput(normalizeStrategySide(initialStrategySide));
    setStrategyLeftLeverageInput(normalizeMultiplierInput(initialStrategyLeftLeverage));
    setStrategyRightLeverageInput(normalizeMultiplierInput(initialStrategyRightLeverage));
    setStrategyConfig(buildInitialStrategyConfig({
      enabled: initialStrategyEnabled,
      side: initialStrategySide,
      leftLeverage: initialStrategyLeftLeverage,
      rightLeverage: initialStrategyRightLeverage
    }));
    setChartSnapshot(null);
  }, [
    initialCompareAdjustmentMode,
    initialCompareCommonBase,
    initialCompareMinuteCandles,
    initialLeftMultiplier,
    initialRightMultiplier,
    initialStrategyEnabled,
    initialStrategyLeftLeverage,
    initialStrategyRightLeverage,
    initialStrategySide,
    leftId,
    rightId,
    mode
  ]);

  useEffect(() => {
    storeCompareAdjustmentMode(compareAdjustmentMode);
  }, [compareAdjustmentMode]);

  const leftMultiplier = parseMultiplierInput(leftMultiplierInput);
  const rightMultiplier = parseMultiplierInput(rightMultiplierInput);
  const anchorDateKey = normalizeAdjustmentDateInput(compareAnchorDate);
  const baseComparePayload = useMemo(
    () => buildCompareAdjustmentPayload(payload, compareAdjustmentMode, {
      useCommonBase: compareCommonBase,
      leftMultiplier,
      rightMultiplier,
      syntheticMode: 'closeLine'
    }),
    [compareAdjustmentMode, compareCommonBase, leftMultiplier, payload, rightMultiplier]
  );
  const adjustedComparePayload = useMemo(
    () => {
      if (!compareMinuteCandles || !minutePayload) return baseComparePayload;

      const adjustedMinuteSourcePayload = buildMinuteComparePayloadWithDailyAdjustments(minutePayload, baseComparePayload || payload);
      const minuteComparePayload = buildCompareAdjustmentPayload(adjustedMinuteSourcePayload, compareAdjustmentMode, {
        useCommonBase: compareCommonBase,
        leftMultiplier,
        rightMultiplier,
        syntheticMode: 'minuteDailyCandles'
      });

      if (!minuteComparePayload?.series?.raw?.length) return baseComparePayload;

      return replaceCompareMainSeries(baseComparePayload, minuteComparePayload.series.raw, {
        interval: {
          key: 'day',
          label: '分钟合成差值K'
        },
        sourceName: `${baseComparePayload?.sourceName || ''} · 分钟合成差值K`,
        comparePatch: {
          syntheticMode: 'minuteDailyCandles'
        }
      });
    },
    [baseComparePayload, compareAdjustmentMode, compareCommonBase, compareMinuteCandles, leftMultiplier, minutePayload, rightMultiplier]
  );
  const compareAnchorCandidate = useMemo(
    () => findCompareAnchorCandle(adjustedComparePayload?.series?.raw || [], anchorDateKey),
    [adjustedComparePayload?.series?.raw, anchorDateKey]
  );
  const compareAnchorDisabled =
    !anchorDateKey ||
    !compareAnchorCandidate ||
    (mode === 'divide' && !toFiniteNumber(compareAnchorCandidate?.close));
  const compareDisplay = useMemo(
    () => buildAnchoredComparePayload(adjustedComparePayload, {
      enabled: compareAnchorEnabled && !compareAnchorDisabled,
      dateInput: compareAnchorDate
    }),
    [adjustedComparePayload, compareAnchorDate, compareAnchorDisabled, compareAnchorEnabled]
  );
  const chartPayload = compareDisplay.payload || adjustedComparePayload || payload;
  const rawChartMode = compareMinuteCandles && minutePayload ? 'candles' : 'line';
  const strategySeries = useMemo(
    () => buildCompareStrategySeries(chartPayload, strategyConfig, compareAnchorDate),
    [chartPayload, compareAnchorDate, strategyConfig]
  );
  const strategyLabel = useMemo(
    () => buildStrategyLabel(chartPayload, strategyConfig),
    [chartPayload, strategyConfig]
  );
  const titleDirty = Boolean(
    titleLeft?.id &&
    titleRight?.id &&
    (titleLeft.id !== leftId || titleRight.id !== rightId || titleMode !== mode)
  );

  useEffect(() => {
    setChartSnapshot(null);
  }, [chartPayload]);

  useEffect(() => {
    const url = new URL(window.location.href);
    applyRouteToUrl(url, {
      view: 'compare',
      left: leftId,
      right: rightId,
      mode,
      intervalKey,
      chartMode,
      showRaw,
      showLeftComponent,
      showRightComponent,
      anchorDate: compareAnchorDate,
      anchorEnabled: compareAnchorEnabled,
      compareAdjustmentMode,
      compareCommonBase,
      leftMultiplier: leftMultiplierInput,
      rightMultiplier: rightMultiplierInput,
      compareMinuteCandles,
      showStrategySeries,
      strategyConfig
    });
    window.history.replaceState({}, '', url);
  }, [
    chartMode,
    compareAnchorDate,
    compareAnchorEnabled,
    compareAdjustmentMode,
    compareCommonBase,
    compareMinuteCandles,
    intervalKey,
    leftId,
    leftMultiplierInput,
    mode,
    rightId,
    rightMultiplierInput,
    showLeftComponent,
    showRaw,
    showRightComponent,
    showStrategySeries,
    strategyConfig
  ]);

  const leftComponent = chartPayload?.components?.[0] || null;
  const rightComponent = chartPayload?.components?.[1] || null;
  const latestRaw = chartPayload?.series?.raw?.at(-1) || null;
  const latestLeft = leftComponent?.candles?.at(-1) || null;
  const latestRight = rightComponent?.candles?.at(-1) || null;
  const activeSnapshot = chartSnapshot || getLegendSnapshot({ visible: false }, chartPayload, EMPTY_SERIES, strategySeries);
  const activeRaw = activeSnapshot?.raw || latestRaw;
  const activeLeft = activeSnapshot?.left || latestLeft;
  const activeRight = activeSnapshot?.right || latestRight;
  const activeRawMove = getSeriesCandleMove(activeRaw, chartPayload?.series?.raw || [], {
    useAbsoluteBase: chartPayload?.instrument?.type === 'COMPARE'
  });
  const allFavorites = useMemo(() => getAllCompareFavorites(compareFavorites), [compareFavorites]);
  const currentFavorite = useMemo(() => {
    if (!payload?.compare?.left || !payload?.compare?.right) return null;
    return buildCompareFavorite({
      left: payload.compare.left,
      right: payload.compare.right,
      mode: payload.compare.mode
    });
  }, [payload]);
  const savedFavorite = currentFavorite
    ? allFavorites.find((favorite) => favorite.key === currentFavorite.key) || null
    : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="back-button" onClick={onBack} title="返回列表">
            <ArrowLeft size={17} />
          </button>
          <CompareTitleEditor
            left={titleLeft}
            right={titleRight}
            mode={titleMode}
            dirty={titleDirty}
            anchorDate={compareAnchorDate}
            anchorEnabled={compareAnchorEnabled && !compareAnchorDisabled}
            anchorDisabled={compareAnchorDisabled}
            anchorMeta={compareDisplay.meta}
            adjustmentMode={compareAdjustmentMode}
            commonBase={compareCommonBase}
            leftMultiplier={leftMultiplierInput}
            rightMultiplier={rightMultiplierInput}
            onLeftChange={setTitleLeft}
            onRightChange={setTitleRight}
            onModeChange={setTitleMode}
            onAdjustmentModeChange={setCompareAdjustmentMode}
            onCommonBaseChange={setCompareCommonBase}
            onLeftMultiplierChange={setLeftMultiplierInput}
            onRightMultiplierChange={setRightMultiplierInput}
            onSwap={() => {
              setTitleLeft(titleRight);
              setTitleRight(titleLeft);
            }}
            onAnchorDateChange={(value) => {
              const nextDate = normalizeCompactDateInput(value);
              setCompareAnchorDate(nextDate);
              if (!normalizeAdjustmentDateInput(nextDate)) {
                setCompareAnchorEnabled(false);
              }
            }}
            onAnchorEnabledChange={setCompareAnchorEnabled}
            onConfirm={() => {
              if (!titleLeft?.id || !titleRight?.id) return;
              onNavigate({
                view: 'compare',
                left: titleLeft.id,
                right: titleRight.id,
                mode: titleMode,
                intervalKey,
                chartMode,
                showRaw,
                showLeftComponent,
                showRightComponent,
                anchorDate: compareAnchorDate,
                anchorEnabled: compareAnchorEnabled,
                compareAdjustmentMode,
                compareCommonBase,
                leftMultiplier: leftMultiplierInput,
                rightMultiplier: rightMultiplierInput,
                compareMinuteCandles,
                showStrategySeries,
                strategyConfig
              });
            }}
          />
        </div>

        <div className="toolbar">
          <div className="segmented-control" aria-label="K线周期">
            {INTERVAL_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={intervalKey === option.key ? 'segment is-active' : 'segment'}
                onClick={() => setIntervalKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className={savedFavorite ? 'icon-button is-favorite' : 'icon-button'}
            onClick={() => {
              if (!currentFavorite) return;
              if (savedFavorite && !savedFavorite.pinned) {
                onRemoveFavorite(savedFavorite.key);
                return;
              }
              if (!savedFavorite) {
                onSaveFavorite(currentFavorite);
              }
            }}
            disabled={savedFavorite?.pinned}
            title={savedFavorite?.pinned ? '这是默认收藏' : savedFavorite ? '取消收藏' : '收藏到汇率'}
          >
            <Star size={16} fill={savedFavorite ? 'currentColor' : 'none'} />
            {savedFavorite ? (savedFavorite.pinned ? '默认收藏' : '已收藏') : '收藏'}
          </button>
          <button
            className="icon-button"
            onClick={() =>
              setCompareDraft({
                left: toCompareOption(payload?.compare?.left) || findBuiltinCompareOptionById(leftId),
                right: toCompareOption(payload?.compare?.right) || findBuiltinCompareOptionById(rightId),
                mode
              })
            }
            disabled={!payload?.compare?.left || !payload?.compare?.right}
            title="重新选择对比"
          >
            <Search size={16} />
            重新选择
          </button>
          <button className="icon-button" onClick={() => fetchDetail({ force: true })} disabled={loading} title="刷新对比">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <CompareStrategyPanel
        leftLabel={leftComponent?.displayName || '左边'}
        rightLabel={rightComponent?.displayName || '右边'}
        side={strategySideInput}
        leftLeverage={strategyLeftLeverageInput}
        rightLeverage={strategyRightLeverageInput}
        active={Boolean(strategyConfig && strategySeries.length)}
        activeLabel={strategyLabel}
        latestValue={strategySeries.at(-1)?.close}
        onSideChange={setStrategySideInput}
        onLeftLeverageChange={setStrategyLeftLeverageInput}
        onRightLeverageChange={setStrategyRightLeverageInput}
        onConfirm={() => setStrategyConfig({
          side: normalizeStrategySide(strategySideInput),
          leftLeverage: parseMultiplierInput(strategyLeftLeverageInput),
          rightLeverage: parseMultiplierInput(strategyRightLeverageInput)
        })}
        onClear={() => setStrategyConfig(null)}
      />

      <section className="status-strip">
        <Metric
          label="当前对比值"
          value={formatQuotePrice(activeRaw?.close, chartPayload?.instrument?.type)}
          change={activeRawMove.changeRate}
        />
        <Metric label="涨跌额" value={formatSigned(activeRawMove.change)} />
        <Metric
          label={leftComponent?.displayName || '左侧'}
          value={formatQuotePrice(activeLeft?.close, chartPayload?.compare?.left?.type)}
        />
        <Metric
          label={rightComponent?.displayName || '右侧'}
          value={formatQuotePrice(activeRight?.close, chartPayload?.compare?.right?.type)}
        />
      </section>

      <section className="filter-row detail-controls">
        <div className="segmented-control" aria-label="图表显示方式">
          <button
            className={chartMode === 'candles' ? 'segment is-active' : 'segment'}
            onClick={() => setChartMode('candles')}
            title="K线图"
          >
            <ChartCandlestick size={14} />
            K线
          </button>
          <button
            className={chartMode === 'line' ? 'segment is-active' : 'segment'}
            onClick={() => setChartMode('line')}
            title="折线图"
          >
            <Activity size={14} />
            折线
          </button>
        </div>
        <label className={showRaw ? 'toggle-button is-active' : 'toggle-button'}>
          <input type="checkbox" checked={showRaw} onChange={() => setShowRaw((value) => !value)} />
          {showRaw ? <Eye size={16} /> : <EyeOff size={16} />}
          {chartPayload?.compare ? getCompareSeriesLabel(chartPayload.compare.mode) : '对比线'}
          {chartPayload?.compare?.adjustmentLabel ? `(${chartPayload.compare.adjustmentLabel})` : ''}
          {compareDisplay.meta ? ` ${formatQuotePrice(latestRaw?.close, chartPayload?.instrument?.type)}` : ''}
        </label>
        <label className={compareMinuteCandles ? 'toggle-button is-active' : 'toggle-button'}>
          <input
            type="checkbox"
            checked={compareMinuteCandles}
            disabled={minuteLoading}
            onChange={(event) => {
              if (!event.target.checked) {
                setCompareMinuteCandles(false);
                return;
              }
              setMinuteConfirmOpen(true);
            }}
          />
          {compareMinuteCandles ? <ChartCandlestick size={16} /> : <Activity size={16} />}
          分钟合成K
        </label>
        {leftComponent ? (
          <label className={showLeftComponent ? 'toggle-button is-active' : 'toggle-button'}>
            <input type="checkbox" checked={showLeftComponent} onChange={() => setShowLeftComponent((value) => !value)} />
            {showLeftComponent ? <Eye size={16} /> : <EyeOff size={16} />}
            {leftComponent.displayName} {latestLeft ? formatQuotePrice(latestLeft.close, payload?.compare?.left?.type) : ''}
          </label>
        ) : null}
        {rightComponent ? (
          <label className={showRightComponent ? 'toggle-button is-active' : 'toggle-button'}>
            <input type="checkbox" checked={showRightComponent} onChange={() => setShowRightComponent((value) => !value)} />
            {showRightComponent ? <Eye size={16} /> : <EyeOff size={16} />}
            {rightComponent.displayName} {latestRight ? formatQuotePrice(latestRight.close, payload?.compare?.right?.type) : ''}
          </label>
        ) : null}
        {strategySeries.length ? (
          <label className={showStrategySeries ? 'toggle-button is-active' : 'toggle-button'}>
            <input type="checkbox" checked={showStrategySeries} onChange={() => setShowStrategySeries((value) => !value)} />
            {showStrategySeries ? <Eye size={16} /> : <EyeOff size={16} />}
            策略K线 {formatStrategyReturnValue(strategySeries.at(-1)?.close)}
          </label>
        ) : null}
        <div className="meta-note">
          {chartPayload ? `${chartPayload.range.start} 至 ${chartPayload.range.end} · ${chartPayload.interval.label} · ${chartPayload.compare.modeLabel} · ${chartPayload.compare.adjustmentLabel || 'K线'}${chartPayload.compare.commonBaseTime ? ` · 共同起点 ${formatTime(chartPayload.compare.commonBaseTime)}` : ''}` : '加载中'}
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {minuteError ? <div className="error-banner">{minuteError}</div> : null}

      <section className="chart-region">
        <div className="chart-header">
          <div>
            <strong>{chartPayload?.instrument?.displayName || '对比K线图'}</strong>
          </div>
          <div className="source-line">
            {compareDisplay.meta
              ? `${getCompareModeDescription(chartPayload?.compare?.mode)} · 锚点 ${formatTime(compareDisplay.meta.anchorTime)}`
              : `${getCompareModeDescription(chartPayload?.compare?.mode)}${chartPayload?.compare?.commonBaseTime ? ` · 共同起点 ${formatTime(chartPayload.compare.commonBaseTime)}` : ''}`}
          </div>
        </div>

        <ChartPanel
          payload={chartPayload}
          loading={loading || (compareMinuteCandles && minuteLoading)}
          loadingMessage={compareMinuteCandles && minuteLoading ? `正在加载约 ${minuteLookbackDays} 天1分钟数据并合成日K...` : `正在加载${activeIntervalLabel}...`}
          chartMode={chartMode}
          rawChartMode={rawChartMode}
          showRaw={showRaw}
          showQfq={false}
          showHfq={false}
          showLeftComponent={showLeftComponent}
          showRightComponent={showRightComponent}
          showStrategySeries={showStrategySeries}
          strategySeries={strategySeries}
          strategyLabel={strategyLabel}
          onSnapshotChange={setChartSnapshot}
        />
      </section>

      {payload?.warnings?.length ? (
        <section className="warning-list">
          {payload.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      ) : null}

      <CompareModal
        draft={compareDraft}
        onClose={() => setCompareDraft(null)}
        onConfirm={(compare) => {
          setCompareDraft(null);
          onNavigate({ view: 'compare', ...compare });
        }}
      />
      <MinuteKConfirmModal
        open={minuteConfirmOpen}
        lookbackDays={minuteLookbackDays}
        onClose={() => setMinuteConfirmOpen(false)}
        onConfirm={() => {
          setMinuteConfirmOpen(false);
          setMinutePayload(null);
          setMinuteError('');
          setCompareMinuteCandles(true);
        }}
      />
    </main>
  );
}

function InstrumentDetailPage({
  id,
  initialIntervalKey = 'day',
  initialChartMode = 'candles',
  initialShowRaw = true,
  initialShowQfq = false,
  initialShowHfq = false,
  initialShowMidAdjust = false,
  initialMidAdjustDate = '',
  initialShowLeftComponent = true,
  initialShowRightComponent = true,
  onBack
}) {
  const [intervalKey, setIntervalKey] = useState(() => normalizeIntervalKey(initialIntervalKey));
  const [chartMode, setChartMode] = useState(() => normalizeChartMode(initialChartMode));
  const [showRaw, setShowRaw] = useState(initialShowRaw);
  const [showQfq, setShowQfq] = useState(initialShowQfq);
  const [showHfq, setShowHfq] = useState(initialShowHfq);
  const [showMidAdjust, setShowMidAdjust] = useState(initialShowMidAdjust);
  const [midAdjustDate, setMidAdjustDate] = useState(() => normalizeCompactDateInput(initialMidAdjustDate));
  const [showLeftComponent, setShowLeftComponent] = useState(initialShowLeftComponent);
  const [showRightComponent, setShowRightComponent] = useState(initialShowRightComponent);
  const [selectedMetricKeys, setSelectedMetricKeys] = useState([]);
  const [metricScaleInputs, setMetricScaleInputs] = useState({});
  const [chartSnapshot, setChartSnapshot] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);
  const activeIntervalLabel = getIntervalOptionLabel(intervalKey);

  const fetchDetail = useCallback(async ({ force = false } = {}) => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const next = await loadInstrumentDetail({ id, interval: intervalKey, force });
      if (requestId !== requestSeqRef.current) return;
      setPayload(next);
    } catch (requestError) {
      if (requestId !== requestSeqRef.current) return;
      setError(requestError.message);
    } finally {
      if (requestId !== requestSeqRef.current) return;
      setLoading(false);
    }
  }, [id, intervalKey]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    const nextMidDate = normalizeCompactDateInput(initialMidAdjustDate);
    setIntervalKey(normalizeIntervalKey(initialIntervalKey));
    setChartMode(normalizeChartMode(initialChartMode));
    setShowRaw(Boolean(initialShowRaw));
    setShowQfq(Boolean(initialShowQfq));
    setShowHfq(Boolean(initialShowHfq));
    setShowMidAdjust(Boolean(initialShowMidAdjust && normalizeAdjustmentDateInput(nextMidDate)));
    setMidAdjustDate(nextMidDate);
    setShowLeftComponent(Boolean(initialShowLeftComponent));
    setShowRightComponent(Boolean(initialShowRightComponent));
    setSelectedMetricKeys([]);
    setMetricScaleInputs({});
    setChartSnapshot(null);
  }, [
    id,
    initialChartMode,
    initialIntervalKey,
    initialMidAdjustDate,
    initialShowHfq,
    initialShowLeftComponent,
    initialShowMidAdjust,
    initialShowQfq,
    initialShowRaw,
    initialShowRightComponent
  ]);

  const latestRaw = payload?.series?.raw?.at(-1);
  const latestQfq = payload?.series?.qfq?.at(-1);
  const latestHfq = payload?.series?.hfq?.at(-1);
  const midAdjustedSeries = useMemo(
    () =>
      buildMidAdjustedSeries(
        payload?.series?.raw || [],
        payload?.series?.qfq || [],
        payload?.series?.hfq || [],
        midAdjustDate,
        payload?.instrument?.type
      ),
    [midAdjustDate, payload?.instrument?.type, payload?.series?.hfq, payload?.series?.qfq, payload?.series?.raw]
  );
  const latestMidAdjust = midAdjustedSeries.at(-1);
  const leftComponent = payload?.components?.[0] || null;
  const rightComponent = payload?.components?.[1] || null;
  const latestLeftComponent = leftComponent?.candles?.at(-1) || null;
  const latestRightComponent = rightComponent?.candles?.at(-1) || null;
  const qfqDisabled = !payload?.supportsAdjustments || !payload?.series?.qfq?.length;
  const hfqDisabled = !payload?.supportsAdjustments || !payload?.series?.hfq?.length;
  const midAdjustDisabled = qfqDisabled || hfqDisabled || !normalizeAdjustmentDateInput(midAdjustDate) || !midAdjustedSeries.length;
  const activeSnapshot = chartSnapshot || getLegendSnapshot({ visible: false }, payload, midAdjustedSeries);
  const activeFundamentalRow = getFundamentalRow(payload?.fundamentals?.rows, activeSnapshot?.time);
  const metricOptions = payload?.fundamentals?.metrics || [];
  const availableMetricKeys = useMemo(
    () => new Set(metricOptions.filter((metric) => hasMetricData(payload?.fundamentals?.rows, metric.key)).map((metric) => metric.key)),
    [metricOptions, payload?.fundamentals?.rows]
  );
  const metricScaleByKey = useMemo(
    () =>
      Object.fromEntries(
        metricOptions.map((metric) => [
          metric.key,
          parseMetricScaleInput(metricScaleInputs[metric.key])
        ])
      ),
    [metricOptions, metricScaleInputs]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    applyRouteToUrl(url, {
      view: 'detail',
      id,
      intervalKey,
      chartMode,
      showRaw,
      showQfq,
      showHfq,
      showMidAdjust,
      midAdjustDate,
      showLeftComponent,
      showRightComponent
    });
    window.history.replaceState({}, '', url);
  }, [
    chartMode,
    id,
    intervalKey,
    midAdjustDate,
    showHfq,
    showLeftComponent,
    showMidAdjust,
    showQfq,
    showRaw,
    showRightComponent
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="back-button" onClick={onBack} title="返回列表">
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1>{payload?.instrument?.name || 'K线详情'}</h1>
            <p>
              {getDisplayCodeText(payload?.instrument) || '--'} · {payload?.instrument?.marketLabel || '--'} · {payload?.instrument?.typeLabel || '--'}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <div className="segmented-control" aria-label="K线周期">
            {INTERVAL_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={intervalKey === option.key ? 'segment is-active' : 'segment'}
                onClick={() => setIntervalKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="icon-button" onClick={() => fetchDetail({ force: true })} disabled={loading} title="刷新K线">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <section className="status-strip">
        <Metric
          label="最新价"
          value={formatQuotePrice(payload?.quote?.price, payload?.instrument?.type)}
          change={payload?.quote?.changeRate}
        />
        <Metric label="涨跌额" value={formatSigned(payload?.quote?.change)} />
        <Metric label="原始K最新收盘" value={formatQuotePrice(latestRaw?.close, payload?.instrument?.type)} />
        <Metric label="数据源" value={payload?.sourceName || '--'} small />
      </section>

      <section className="filter-row detail-controls">
        <div className="segmented-control" aria-label="图表显示方式">
          <button
            className={chartMode === 'candles' ? 'segment is-active' : 'segment'}
            onClick={() => setChartMode('candles')}
            title="K线图"
          >
            <ChartCandlestick size={14} />
            K线
          </button>
          <button
            className={chartMode === 'line' ? 'segment is-active' : 'segment'}
            onClick={() => setChartMode('line')}
            title="折线图"
          >
            <Activity size={14} />
            折线
          </button>
        </div>
        <label className={showRaw ? 'toggle-button is-active' : 'toggle-button'}>
          <input type="checkbox" checked={showRaw} onChange={() => setShowRaw((value) => !value)} />
          {showRaw ? <Eye size={16} /> : <EyeOff size={16} />}
          普通K
        </label>
        <label className={showQfq ? 'toggle-button is-active' : 'toggle-button'}>
          <input type="checkbox" checked={showQfq} onChange={() => setShowQfq((value) => !value)} disabled={qfqDisabled} />
          {showQfq ? <Eye size={16} /> : <EyeOff size={16} />}
          前复权 {latestQfq ? formatQuotePrice(latestQfq.close, payload?.instrument?.type) : ''}
        </label>
        <label className={showHfq ? 'toggle-button is-active' : 'toggle-button'}>
          <input type="checkbox" checked={showHfq} onChange={() => setShowHfq((value) => !value)} disabled={hfqDisabled} />
          {showHfq ? <Eye size={16} /> : <EyeOff size={16} />}
          后复权 {latestHfq ? formatQuotePrice(latestHfq.close, payload?.instrument?.type) : ''}
        </label>
        <div className="mid-adjust-control">
          <input
            className="mid-adjust-date-input"
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={midAdjustDate}
            onChange={(event) => {
              const nextDate = normalizeCompactDateInput(event.target.value);
              setMidAdjustDate(nextDate);
              if (!normalizeAdjustmentDateInput(nextDate)) {
                setShowMidAdjust(false);
              }
            }}
            disabled={qfqDisabled || hfqDisabled}
            placeholder="20250502"
            aria-label="中间复权节点日期"
            title="中间复权节点日期，格式 20250502"
          />
          <label className={showMidAdjust && !midAdjustDisabled ? 'toggle-button is-active' : 'toggle-button'}>
            <input
              type="checkbox"
              checked={showMidAdjust}
              onChange={() => setShowMidAdjust((value) => !value)}
              disabled={midAdjustDisabled}
            />
            {showMidAdjust ? <Eye size={16} /> : <EyeOff size={16} />}
            中间复权 {latestMidAdjust ? formatQuotePrice(latestMidAdjust.close, payload?.instrument?.type) : ''}
          </label>
        </div>
        {leftComponent ? (
          <label className={showLeftComponent ? 'toggle-button is-active' : 'toggle-button'}>
            <input type="checkbox" checked={showLeftComponent} onChange={() => setShowLeftComponent((value) => !value)} />
            {showLeftComponent ? <Eye size={16} /> : <EyeOff size={16} />}
            {leftComponent.displayName} {latestLeftComponent ? formatQuotePrice(latestLeftComponent.close) : ''}
          </label>
        ) : null}
        {rightComponent ? (
          <label className={showRightComponent ? 'toggle-button is-active' : 'toggle-button'}>
            <input type="checkbox" checked={showRightComponent} onChange={() => setShowRightComponent((value) => !value)} />
            {showRightComponent ? <Eye size={16} /> : <EyeOff size={16} />}
            {rightComponent.displayName} {latestRightComponent ? formatQuotePrice(latestRightComponent.close) : ''}
          </label>
        ) : null}
        {metricOptions.map((metric) => (
          <div
            key={metric.key}
            className="metric-control"
            style={{ '--metric-color': metric.color }}
          >
            <label
              className={selectedMetricKeys.includes(metric.key) ? 'toggle-button is-active metric-toggle' : 'toggle-button metric-toggle'}
            >
              <input
                type="checkbox"
                checked={selectedMetricKeys.includes(metric.key)}
                onChange={() =>
                  setSelectedMetricKeys((current) =>
                    current.includes(metric.key)
                      ? current.filter((item) => item !== metric.key)
                      : [...current, metric.key]
                  )
                }
                disabled={!availableMetricKeys.has(metric.key)}
              />
              {selectedMetricKeys.includes(metric.key) ? <Eye size={16} /> : <EyeOff size={16} />}
              {metric.label}
            </label>
            <input
              className="metric-scale-input"
              type="text"
              inputMode="decimal"
              value={metricScaleInputs[metric.key] ?? '1'}
              onChange={(event) =>
                setMetricScaleInputs((current) => ({
                  ...current,
                  [metric.key]: event.target.value
                }))
              }
              disabled={!availableMetricKeys.has(metric.key)}
              placeholder="1"
              aria-label={`${metric.label} 倍数`}
              title={`${metric.label} 倍数，默认 1`}
            />
          </div>
        ))}
        <div className="meta-note">
          {payload ? `${payload.range.start} 至 ${payload.range.end} · ${payload.interval.label}` : '加载中'}
        </div>
      </section>

      {payload?.instrument?.type === 'STOCK' ? (
        <section className="stock-info-board">
          <div className="stock-info-line">
            <StockSnapshotText label="普通" candle={activeSnapshot?.raw} instrumentType={payload?.instrument?.type} />
            <StockSnapshotText label="前" candle={activeSnapshot?.qfq} instrumentType={payload?.instrument?.type} />
            <StockSnapshotText label="后" candle={activeSnapshot?.hfq} instrumentType={payload?.instrument?.type} />
            {midAdjustedSeries.length ? (
              <StockSnapshotText label="中" candle={activeSnapshot?.mid} instrumentType={payload?.instrument?.type} />
            ) : null}
          </div>
          <div className="stock-info-line">
            <SummaryToken label="总股本" value={formatShareCapital(activeFundamentalRow?.totalShares)} />
            <SummaryToken label="价格" value={formatQuotePrice(activeFundamentalRow?.price, payload?.instrument?.type)} />
            <SummaryToken label="总市值" value={formatAmountWithYi(activeFundamentalRow?.marketCap)} />
            <SummaryToken label="前4个季度利润" value={formatAmountWithYi(activeFundamentalRow?.ttmProfit)} />
            <SummaryToken label="市盈率" value={formatMetricValue(activeFundamentalRow?.peRatio, 'ratio')} />
            <SummaryToken label="前4个季度营业收入" value={formatAmountWithYi(activeFundamentalRow?.ttmRevenue)} />
            <SummaryToken label="净资产" value={formatAmountWithYi(activeFundamentalRow?.netAssets)} />
            <SummaryToken label="资产回报率" value={formatMetricValue(activeFundamentalRow?.returnOnAssets, 'percent')} />
            <SummaryToken label="市值回报率" value={formatMetricValue(activeFundamentalRow?.marketCapReturnRate, 'percent')} />
            <SummaryToken label="收入增长率" value={formatMetricValue(activeFundamentalRow?.revenueGrowthRate, 'percent')} />
            <SummaryToken label="利润增长率" value={formatMetricValue(activeFundamentalRow?.profitGrowthRate, 'percent')} />
            <SummaryToken label="股息率" value={formatMetricValue(activeFundamentalRow?.dividendYield, 'percent')} />
            <SummaryToken label="市净率" value={formatMetricValue(activeFundamentalRow?.pbRatio, 'ratio')} />
            <SummaryToken label="利润率" value={formatMetricValue(activeFundamentalRow?.profitMargin, 'percent')} />
          </div>
        </section>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="chart-region">
        <div className="chart-header">
          <div>
            <strong>{payload?.instrument?.displayName || 'K线图'}</strong>
          </div>
          <div className="source-line">
            {getAdjustmentSourceText(payload)}
          </div>
        </div>

        <ChartPanel
          payload={payload}
          loading={loading}
          loadingMessage={`正在加载${activeIntervalLabel}...`}
          chartMode={chartMode}
          showRaw={showRaw}
          showQfq={showQfq}
          showHfq={showHfq}
          showMidAdjust={showMidAdjust && !midAdjustDisabled}
          midAdjustedSeries={midAdjustedSeries}
          showLeftComponent={showLeftComponent}
          showRightComponent={showRightComponent}
          selectedMetricKeys={selectedMetricKeys}
          metricScaleByKey={metricScaleByKey}
          onSnapshotChange={setChartSnapshot}
        />
      </section>

      {payload?.warnings?.length ? (
        <section className="warning-list">
          {payload.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function CompareTitleEditor({
  left,
  right,
  mode,
  dirty,
  anchorDate,
  anchorEnabled,
  anchorDisabled,
  anchorMeta,
  adjustmentMode,
  commonBase,
  leftMultiplier,
  rightMultiplier,
  onLeftChange,
  onRightChange,
  onModeChange,
  onAdjustmentModeChange,
  onCommonBaseChange,
  onLeftMultiplierChange,
  onRightMultiplierChange,
  onSwap,
  onAnchorDateChange,
  onAnchorEnabledChange,
  onConfirm
}) {
  const modeOption = COMPARE_MODE_OPTIONS.find((option) => option.key === mode) || COMPARE_MODE_OPTIONS[0];

  return (
    <div className="compare-title-editor">
      <div className="compare-title-row">
        <CompactInstrumentSelect
          value={left}
          onChange={onLeftChange}
          placeholder="左侧品种"
        />
        <CompareMultiplierInput
          value={leftMultiplier}
          onChange={onLeftMultiplierChange}
          ariaLabel="左侧系数"
        />
        <select
          className="compare-title-mode"
          value={mode}
          onChange={(event) => onModeChange(event.target.value)}
          aria-label="对比模式"
          title="对比模式"
        >
          {COMPARE_MODE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.symbol}
            </option>
          ))}
        </select>
        <CompactInstrumentSelect
          value={right}
          onChange={onRightChange}
          placeholder="右侧品种"
        />
        <CompareMultiplierInput
          value={rightMultiplier}
          onChange={onRightMultiplierChange}
          ariaLabel="右侧系数"
        />
        <button className="icon-button compare-title-swap" onClick={onSwap} title="互换左右">
          <ArrowLeftRight size={16} />
        </button>
        {dirty ? (
          <button className="icon-button modal-confirm compare-title-confirm" onClick={onConfirm} disabled={!left || !right}>
            确定
          </button>
        ) : null}
      </div>
      <div className="compare-title-subrow">
        <span>{getDisplayCodeText(left)}</span>
        <b>{modeOption.label}</b>
        <span>{getDisplayCodeText(right)}</span>
        <label className={anchorEnabled ? 'compare-anchor-toggle is-active' : 'compare-anchor-toggle'}>
          <input
            type="checkbox"
            checked={anchorEnabled}
            disabled={anchorDisabled}
            onChange={(event) => onAnchorEnabledChange(event.target.checked)}
          />
          归一
        </label>
        <input
          className="compare-anchor-input"
          type="text"
          inputMode="numeric"
          maxLength={8}
          value={anchorDate}
          onChange={(event) => onAnchorDateChange(event.target.value)}
          placeholder="20250502"
          title="归一锚点日期，格式 20250502"
        />
        {anchorMeta ? (
          <span className="compare-anchor-meta">
            <b>{formatTime(anchorMeta.anchorTime)}</b>
            <strong>{formatPriceValue(anchorMeta.anchorValue)}</strong>
          </span>
        ) : null}
        <div className="compare-adjustment-options" aria-label="对比复权口径">
          {COMPARE_ADJUSTMENT_OPTIONS.map((option) => (
            <label
              key={option.key}
              className={adjustmentMode === option.key ? 'compare-adjustment-option is-active' : 'compare-adjustment-option'}
            >
              <input
                type="checkbox"
                checked={adjustmentMode === option.key}
                onChange={() => onAdjustmentModeChange(option.key)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <label
          className={commonBase ? 'compare-common-base-toggle is-active' : 'compare-common-base-toggle'}
          title="前复权/后复权以左右两边都有数据的第一根K线重新定基准"
        >
          <input
            type="checkbox"
            checked={commonBase}
            disabled={adjustmentMode === 'raw'}
            onChange={(event) => onCommonBaseChange(event.target.checked)}
          />
          共同起点
        </label>
      </div>
    </div>
  );
}

function CompareMultiplierInput({ value, onChange, ariaLabel }) {
  return (
    <input
      className="compare-multiplier-input"
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onChange(normalizeMultiplierInput(event.target.value))}
      aria-label={ariaLabel}
      title={ariaLabel}
      placeholder="1"
    />
  );
}

function CompareStrategyPanel({
  leftLabel,
  rightLabel,
  side,
  leftLeverage,
  rightLeverage,
  active,
  activeLabel,
  latestValue,
  onSideChange,
  onLeftLeverageChange,
  onRightLeverageChange,
  onConfirm,
  onClear
}) {
  const leftLong = normalizeStrategySide(side) === 'leftLong';

  return (
    <section className="compare-strategy-panel">
      <div className="compare-strategy-row">
        <span className={leftLong ? 'strategy-side is-long' : 'strategy-side is-short'}>
          {leftLong ? '做多' : '做空'}
        </span>
        <input
          className="strategy-number-input"
          type="text"
          inputMode="decimal"
          value={leftLeverage}
          onChange={(event) => onLeftLeverageChange(event.target.value)}
          onBlur={(event) => onLeftLeverageChange(normalizeMultiplierInput(event.target.value))}
          aria-label="左边倍数"
        />
        <span className="strategy-name">{leftLabel}</span>
        <button
          className="icon-button"
          onClick={() => onSideChange(leftLong ? 'rightLong' : 'leftLong')}
          title="互换多空方向"
        >
          <ArrowLeftRight size={15} />
          互换
        </button>
        <span className={leftLong ? 'strategy-side is-short' : 'strategy-side is-long'}>
          {leftLong ? '做空' : '做多'}
        </span>
        <input
          className="strategy-number-input"
          type="text"
          inputMode="decimal"
          value={rightLeverage}
          onChange={(event) => onRightLeverageChange(event.target.value)}
          onBlur={(event) => onRightLeverageChange(normalizeMultiplierInput(event.target.value))}
          aria-label="右边倍数"
        />
        <span className="strategy-name">{rightLabel}</span>
        <button className="icon-button modal-confirm" onClick={onConfirm}>
          确定
        </button>
        {active ? (
          <button className="icon-button" onClick={onClear}>
            清除
          </button>
        ) : null}
      </div>
      {active ? (
        <div className="compare-strategy-active">
          <b>{activeLabel}</b>
          <span>最新 {formatStrategyReturnValue(latestValue)}</span>
        </div>
      ) : null}
    </section>
  );
}

function CompactInstrumentSelect({ value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setQuery(value ? (value.name || value.code || '') : '');
  }, [value?.id]);

  useEffect(() => {
    if (!open) return undefined;

    const normalizedQuery = normalizeSearchText(query);
    const localSeed = [value, ...BUILTIN_COMPARE_OPTIONS].map(toCompareOption).filter(Boolean);

    if (!normalizedQuery) {
      setOptions(deduplicateCompareOptions(localSeed).sort(compareOptions).slice(0, 12));
      setLoading(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');

      try {
        const payload = await loadInstruments({
          page: 1,
          pageSize: 20,
          search: normalizedQuery,
          type: 'all'
        });

        if (cancelled) return;
        const remoteOptions = Array.isArray(payload?.items) ? payload.items.map(toCompareOption).filter(Boolean) : [];
        setOptions(deduplicateCompareOptions([...localSeed, ...remoteOptions]).sort(compareOptions));
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
          setOptions(deduplicateCompareOptions(localSeed).sort(compareOptions).slice(0, 12));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, value]);

  const filteredOptions = useMemo(() => rankCompareOptions(options, query).slice(0, 12), [options, query]);

  return (
    <div
      className="compare-title-select"
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <input
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setOpen(true);
          if (value && normalizeSearchText(nextQuery) !== normalizeSearchText(value.name || value.code)) {
            onChange(null);
          }
        }}
      />
      {open ? (
        <div className="compare-title-dropdown">
          {loading ? <div className="compare-option-empty">正在加载...</div> : null}
          {!loading && error ? <div className="compare-option-empty">{error}</div> : null}
          {!loading && !error && !filteredOptions.length ? <div className="compare-option-empty">没有匹配的品种。</div> : null}
          {!loading && !error
            ? filteredOptions.map((option) => (
              <button
                key={option.id}
                className={value?.id === option.id ? 'compare-option is-active' : 'compare-option'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(option);
                  setQuery(option.name || option.code);
                  setOpen(false);
                }}
              >
                <strong>{option.name}</strong>
                <span>{getDisplayCodeText(option)} · {option.marketLabel}</span>
              </button>
            ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function CompareModal({ draft, onClose, onConfirm }) {
  const open = Boolean(draft);
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [mode, setMode] = useState('divide');

  useEffect(() => {
    if (!open) return;
    setLeft(toCompareOption(draft?.left));
    setRight(toCompareOption(draft?.right));
    setMode(parseCompareMode(draft?.mode));
  }, [draft, open]);

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="compare-modal" role="dialog" aria-modal="true" aria-label="发起对比" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>发起对比</h2>
            <p>左侧和右侧都支持按代码或名字搜索；确认后会跳到可分享链接的对比页面。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭对比弹窗">
            <X size={16} />
          </button>
        </div>

        <div className="compare-modal-grid">
          <InstrumentSelectField
            label="左侧"
            value={left}
            onChange={setLeft}
            placeholder="输入代码或名字搜索左侧品种"
          />

          <div className="compare-mode-panel">
            <div className="mode-switch">
              <span>对比模式</span>
              <div className="segmented-control" aria-label="对比模式">
                {COMPARE_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    className={mode === option.key ? 'segment is-active' : 'segment'}
                    onClick={() => setMode(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="icon-button compare-swap-button"
              onClick={() => {
                setLeft(right);
                setRight(left);
              }}
            >
              <ArrowLeftRight size={16} />
              互换左右
            </button>
          </div>

          <InstrumentSelectField
            label="右侧"
            value={right}
            onChange={setRight}
            placeholder="输入代码或名字搜索右侧品种"
          />
        </div>

        <div className="modal-footer">
          <button className="icon-button" onClick={onClose}>
            取消
          </button>
          <button
            className="icon-button modal-confirm"
            disabled={!left || !right}
            onClick={() =>
              onConfirm({
                left: left.id,
                right: right.id,
                mode
              })
            }
          >
            确定对比
          </button>
        </div>
      </div>
    </div>
  );
}

function MinuteKConfirmModal({ open, lookbackDays, onClose, onConfirm }) {
  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="compare-modal minute-confirm-modal" role="dialog" aria-modal="true" aria-label="开启分钟合成K" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>开启分钟合成K</h2>
            <p>分钟合成K会按当前对比的历史范围拉取1分钟数据，再按每分钟差值或比值合成为日K，耗时较长。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭分钟合成K提示">
            <X size={16} />
          </button>
        </div>

        <div className="minute-confirm-body">
          <strong>预计加载范围：约 {lookbackDays} 天</strong>
          <span>确认后页面会保留当前图表并显示 loading，加载完成后自动切换到分钟合成K。</span>
        </div>

        <div className="modal-footer">
          <button className="icon-button" onClick={onClose}>
            取消
          </button>
          <button className="icon-button modal-confirm" onClick={onConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function InstrumentSelectField({ label, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setQuery(value ? formatOptionInput(value) : '');
  }, [value?.id]);

  useEffect(() => {
    if (!open) return undefined;

    const normalizedQuery = normalizeSearchText(query);
    const localSeed = [value, ...BUILTIN_COMPARE_OPTIONS].map(toCompareOption).filter(Boolean);

    if (!normalizedQuery) {
      setOptions(deduplicateCompareOptions(localSeed).sort(compareOptions).slice(0, 12));
      setLoading(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');

      try {
        const payload = await loadInstruments({
          page: 1,
          pageSize: 20,
          search: normalizedQuery,
          type: 'all'
        });

        if (cancelled) return;
        const remoteOptions = Array.isArray(payload?.items) ? payload.items.map(toCompareOption).filter(Boolean) : [];
        setOptions(deduplicateCompareOptions([...localSeed, ...remoteOptions]).sort(compareOptions));
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
          setOptions(deduplicateCompareOptions(localSeed).sort(compareOptions).slice(0, 12));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, value]);

  const filteredOptions = useMemo(() => rankCompareOptions(options, query).slice(0, 12), [options, query]);

  return (
    <div
      className="compare-select"
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    >
      <span className="compare-select-label">{label}</span>
      <div className="compare-select-input">
        <Search size={16} />
        <input
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);

            if (value && normalizeSearchText(nextQuery) !== normalizeSearchText(formatOptionInput(value))) {
              onChange(null);
            }
          }}
        />
      </div>
      {value ? <div className="compare-select-current">当前选择：{getDisplayCodeText(value)} · {value.name}</div> : null}

      {open ? (
        <div className="compare-select-dropdown">
          {loading ? <div className="compare-option-empty">正在加载可对比品种...</div> : null}
          {!loading && error ? <div className="compare-option-empty">{error}</div> : null}
          {!loading && !error && !filteredOptions.length ? <div className="compare-option-empty">没有匹配的品种。</div> : null}
          {!loading && !error
            ? filteredOptions.map((option) => (
              <button
                key={option.id}
                className={value?.id === option.id ? 'compare-option is-active' : 'compare-option'}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(option);
                  setQuery(formatOptionInput(option));
                  setOpen(false);
                }}
              >
                <strong>{getDisplayCodeText(option)}</strong>
                <span>{option.name}</span>
                <em>
                  {option.marketLabel} · {option.typeLabel}
                </em>
              </button>
            ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function ChartPanel({
  payload,
  loading,
  loadingMessage,
  chartMode,
  rawChartMode,
  showRaw,
  showQfq,
  showHfq,
  showMidAdjust = false,
  midAdjustedSeries,
  showLeftComponent,
  showRightComponent,
  showStrategySeries = true,
  selectedMetricKeys = [],
  metricScaleByKey = {},
  strategySeries = EMPTY_SERIES,
  strategyLabel = '多空组合',
  onSnapshotChange
}) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const lookupRef = useRef({ raw: new Map(), qfq: new Map(), hfq: new Map(), mid: new Map(), left: new Map(), right: new Map(), strategy: new Map(), rollovers: new Map() });
  const [tooltip, setTooltip] = useState({ visible: false });
  const midSeries = midAdjustedSeries || EMPTY_SERIES;
  const mainChartMode = rawChartMode || chartMode;
  const visibleStrategySeries = showStrategySeries ? strategySeries : EMPTY_SERIES;

  useEffect(() => {
    if (!hostRef.current || chartRef.current) return;

    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: {
        background: { color: '#f7f8f5' },
        textColor: '#2d3748',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      },
      grid: {
        vertLines: { color: '#e4e7dd' },
        horzLines: { color: '#e4e7dd' }
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#bec5b8',
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },
      leftPriceScale: {
        visible: false,
        borderColor: '#b9c4ce',
        scaleMargins: { top: 0.12, bottom: 0.12 }
      },
      localization: {
        timeFormatter: formatChartAxisTime
      },
      timeScale: {
        borderColor: '#bec5b8',
        rightOffset: 10,
        barSpacing: 8,
        minBarSpacing: 0.5,
        lockVisibleTimeRangeOnResize: true,
        fixLeftEdge: false
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          width: 1,
          color: 'rgba(37, 48, 56, 0.34)',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#154f54'
        },
        horzLine: {
          visible: true,
          width: 1,
          color: 'rgba(37, 48, 56, 0.34)',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#154f54'
        }
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true
        }
      }
    });

    const rawSeries = chart.addSeries(CandlestickSeries, {
      title: '普通K',
      priceScaleId: 'right',
      upColor: '#0f8f72',
      downColor: '#cf3f35',
      borderUpColor: '#0f8f72',
      borderDownColor: '#cf3f35',
      wickUpColor: '#0f8f72',
      wickDownColor: '#cf3f35'
    });
    const rawLineSeries = chart.addSeries(LineSeries, {
      title: '普通收盘线',
      priceScaleId: 'right',
      color: '#0f8f72',
      lineWidth: 2,
      visible: false
    });
    const compareRawSeries = chart.addSeries(CandlestickSeries, {
      title: '对比K',
      priceScaleId: 'left',
      upColor: '#0f8f72',
      downColor: '#cf3f35',
      borderUpColor: '#0f8f72',
      borderDownColor: '#cf3f35',
      wickUpColor: '#0f8f72',
      wickDownColor: '#cf3f35',
      visible: false
    });
    const compareRawLineSeries = chart.addSeries(LineSeries, {
      title: '对比收盘线',
      priceScaleId: 'left',
      color: '#0f8f72',
      lineWidth: 2,
      visible: false
    });
    const qfqSeries = chart.addSeries(LineSeries, {
      title: '前复权',
      priceScaleId: 'right',
      color: '#206fb1',
      lineWidth: 2,
      visible: false
    });
    const hfqSeries = chart.addSeries(LineSeries, {
      title: '后复权',
      priceScaleId: 'right',
      color: '#9b6b10',
      lineWidth: 2,
      visible: false
    });
    const midAdjustSeries = chart.addSeries(LineSeries, {
      title: '中间复权',
      priceScaleId: 'right',
      color: '#7c3aed',
      lineWidth: 2,
      visible: false
    });
    const leftComponentSeries = chart.addSeries(CandlestickSeries, {
      title: '左侧对比',
      priceScaleId: 'right',
      upColor: 'rgba(32, 111, 177, 0.58)',
      downColor: 'rgba(186, 86, 36, 0.58)',
      borderUpColor: '#206fb1',
      borderDownColor: '#ba5624',
      wickUpColor: '#206fb1',
      wickDownColor: '#ba5624',
      visible: false
    });
    const leftComponentLineSeries = chart.addSeries(LineSeries, {
      title: '左侧收盘线',
      priceScaleId: 'right',
      color: '#206fb1',
      lineWidth: 2,
      visible: false
    });
    const rightComponentSeries = chart.addSeries(CandlestickSeries, {
      title: '右侧对比',
      priceScaleId: 'right',
      upColor: 'rgba(125, 92, 20, 0.42)',
      downColor: 'rgba(91, 102, 116, 0.42)',
      borderUpColor: '#9b6b10',
      borderDownColor: '#5b6674',
      wickUpColor: '#9b6b10',
      wickDownColor: '#5b6674',
      visible: false
    });
    const rightComponentLineSeries = chart.addSeries(LineSeries, {
      title: '右侧收盘线',
      priceScaleId: 'right',
      color: '#9b6b10',
      lineWidth: 2,
      visible: false
    });
    const strategyLineSeries = chart.addSeries(LineSeries, {
      title: '多空组合',
      priceScaleId: 'left',
      color: '#db2777',
      lineWidth: 2,
      visible: false
    });

    chartRef.current = chart;
    const rawMarkers = createSeriesMarkers(rawSeries, []);
    const rawLineMarkers = createSeriesMarkers(rawLineSeries, []);
    const compareRawMarkers = createSeriesMarkers(compareRawSeries, []);
    const compareRawLineMarkers = createSeriesMarkers(compareRawLineSeries, []);
    seriesRef.current = {
      rawSeries,
      rawLineSeries,
      rawMarkers,
      rawLineMarkers,
      compareRawSeries,
      compareRawLineSeries,
      compareRawMarkers,
      compareRawLineMarkers,
      qfqSeries,
      hfqSeries,
      midAdjustSeries,
      leftComponentSeries,
      leftComponentLineSeries,
      rightComponentSeries,
      rightComponentLineSeries,
      strategyLineSeries,
      metricSeriesMap: new Map()
    };

    const handleMove = (param) => {
      if (!param.time || !param.point) {
        setTooltip({ visible: false });
        return;
      }

      const timeKey = String(param.time);
      const raw = lookupRef.current.raw.get(timeKey);
      const qfq = lookupRef.current.qfq.get(timeKey);
      const hfq = lookupRef.current.hfq.get(timeKey);
      const mid = lookupRef.current.mid.get(timeKey);
      const left = lookupRef.current.left.get(timeKey);
      const right = lookupRef.current.right.get(timeKey);
      const strategy = lookupRef.current.strategy.get(timeKey);
      const rollover = lookupRef.current.rollovers.get(timeKey) || null;
      const rolloverContext = raw?.rolloverContext || null;

      if (!raw && !qfq && !hfq && !mid && !left && !right && !strategy && !rollover && !rolloverContext) {
        setTooltip({ visible: false });
        return;
      }

      setTooltip({
        visible: true,
        x: param.point.x,
        y: param.point.y,
        time: param.time,
        raw,
        qfq,
        hfq,
        mid,
        left,
        right,
        strategy,
        rollover,
        rolloverContext
      });
    };

    chart.subscribeCrosshairMove(handleMove);
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ autoSize: true });
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      chart.unsubscribeCrosshairMove(handleMove);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!payload || !seriesRef.current.rawSeries) return;

    const priceFormat = getSeriesPriceFormat(payload.instrument?.type, payload.series?.raw || []);
    const leftComponentName = getComponentDisplayName(payload?.components?.[0], payload?.compare?.left, '左侧对比');
    const rightComponentName = getComponentDisplayName(payload?.components?.[1], payload?.compare?.right, '右侧对比');
    const rolloverMarkers = buildRolloverMarkers(payload?.rollovers || []);

    seriesRef.current.rawSeries.applyOptions({ priceFormat });
    seriesRef.current.rawLineSeries.applyOptions({ priceFormat });
    seriesRef.current.compareRawSeries.applyOptions({ priceFormat });
    seriesRef.current.compareRawLineSeries.applyOptions({ priceFormat });
    seriesRef.current.qfqSeries.applyOptions({ priceFormat });
    seriesRef.current.hfqSeries.applyOptions({ priceFormat });
    seriesRef.current.midAdjustSeries.applyOptions({ priceFormat });
    seriesRef.current.leftComponentSeries.applyOptions({ title: leftComponentName });
    seriesRef.current.leftComponentLineSeries.applyOptions({ title: `${leftComponentName} 收盘线` });
    seriesRef.current.rightComponentSeries.applyOptions({ title: rightComponentName });
    seriesRef.current.rightComponentLineSeries.applyOptions({ title: `${rightComponentName} 收盘线` });
    seriesRef.current.rawSeries.setData(payload.series.raw || []);
    seriesRef.current.rawLineSeries.setData(toLineData(payload.series.raw || []));
    seriesRef.current.compareRawSeries.setData(payload.series.raw || []);
    seriesRef.current.compareRawLineSeries.setData(toLineData(payload.series.raw || []));
    seriesRef.current.qfqSeries.setData(toLineData(payload.series.qfq || []));
    seriesRef.current.hfqSeries.setData(toLineData(payload.series.hfq || []));
    seriesRef.current.leftComponentSeries.setData(payload.components?.[0]?.candles || []);
    seriesRef.current.leftComponentLineSeries.setData(toLineData(payload.components?.[0]?.candles || []));
    seriesRef.current.rightComponentSeries.setData(payload.components?.[1]?.candles || []);
    seriesRef.current.rightComponentLineSeries.setData(toLineData(payload.components?.[1]?.candles || []));
    seriesRef.current.rawMarkers?.setMarkers(rolloverMarkers);
    seriesRef.current.rawLineMarkers?.setMarkers(rolloverMarkers);
    seriesRef.current.compareRawMarkers?.setMarkers(rolloverMarkers);
    seriesRef.current.compareRawLineMarkers?.setMarkers(rolloverMarkers);
    lookupRef.current = {
      raw: createLookup(payload.series.raw || []),
      qfq: createLookup(payload.series.qfq || []),
      hfq: createLookup(payload.series.hfq || []),
      mid: createLookup(midSeries),
      left: createLookup(payload.components?.[0]?.candles || []),
      right: createLookup(payload.components?.[1]?.candles || []),
      strategy: createLookup(strategySeries || []),
      rollovers: createRolloverLookup(payload.rollovers || [])
    };
    applyDefaultVisibleRange(chartRef.current, payload.interval?.key, payload.series.raw || [], payload.instrument?.type);
    setTooltip({ visible: false });
  }, [payload]);

  useEffect(() => {
    if (!seriesRef.current.midAdjustSeries) return;
    seriesRef.current.midAdjustSeries.setData(toLineData(midSeries));
    lookupRef.current = {
      ...lookupRef.current,
      mid: createLookup(midSeries)
    };
    setTooltip({ visible: false });
  }, [midSeries]);

  useEffect(() => {
    if (!seriesRef.current.strategyLineSeries || !chartRef.current) return;
    seriesRef.current.strategyLineSeries.applyOptions({
      title: strategyLabel,
      visible: Boolean(showStrategySeries && strategySeries?.length),
      priceFormat: getStrategyReturnSeriesPriceFormat()
    });
    seriesRef.current.strategyLineSeries.setData(toLineData(strategySeries || []));
    chartRef.current.priceScale('left').applyOptions({
      ...getLeftAxisOptions(payload),
      visible: isLeftAxisVisible(payload, selectedMetricKeys, visibleStrategySeries, showRaw)
    });
    lookupRef.current = {
      ...lookupRef.current,
      strategy: createLookup(strategySeries || [])
    };
    setTooltip({ visible: false });
  }, [payload, selectedMetricKeys, showRaw, showStrategySeries, strategyLabel, strategySeries, visibleStrategySeries]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current.metricSeriesMap) return;

    const metricRows = payload?.fundamentals?.rows || [];
    const metricDefs = payload?.fundamentals?.metrics || [];
    const metricSeriesMap = seriesRef.current.metricSeriesMap;
    const activeMetricKeys = new Set(metricDefs.map((metric) => metric.key));

    for (const metric of metricDefs) {
      let metricSeries = metricSeriesMap.get(metric.key);
      if (!metricSeries) {
        metricSeries = chartRef.current.addSeries(LineSeries, {
          title: metric.label,
          priceScaleId: 'left',
          color: metric.color,
          lineWidth: 2,
          visible: false,
          lastValueVisible: false,
          priceLineVisible: false
        });
        metricSeriesMap.set(metric.key, metricSeries);
      }

      const metricScale = metricScaleByKey[metric.key] ?? 1;
      metricSeries.applyOptions({
        title: metricScale === 1 ? metric.label : `${metric.label} × ${formatMetricScaleDisplay(metricScale)}`,
        color: metric.color,
        visible: selectedMetricKeys.includes(metric.key) && hasMetricData(metricRows, metric.key),
        priceFormat: getMetricSeriesPriceFormat(metric.format)
      });
      metricSeries.setData(toMetricLineData(metricRows, metric.key, metricScale));
    }

    for (const [key, metricSeries] of metricSeriesMap.entries()) {
      if (activeMetricKeys.has(key)) continue;
      metricSeries.applyOptions({ visible: false });
      metricSeries.setData([]);
    }
    chartRef.current.priceScale('left').applyOptions({
      ...getLeftAxisOptions(payload),
      visible: isLeftAxisVisible(payload, selectedMetricKeys, visibleStrategySeries, showRaw)
    });
  }, [metricScaleByKey, payload, selectedMetricKeys, showRaw, visibleStrategySeries]);

  useEffect(() => {
    if (!seriesRef.current.rawSeries || !chartRef.current) return;

    const comparePayload = Boolean(payload?.compare);
    const rawVisible = showRaw && mainChartMode === 'candles';
    const rawLineVisible = showRaw && mainChartMode === 'line';
    const componentCandlesVisible = chartMode === 'candles';
    const componentLinesVisible = chartMode === 'line';

    seriesRef.current.rawSeries.applyOptions({ visible: !comparePayload && rawVisible });
    seriesRef.current.rawLineSeries.applyOptions({ visible: !comparePayload && rawLineVisible });
    seriesRef.current.compareRawSeries.applyOptions({ visible: comparePayload && rawVisible });
    seriesRef.current.compareRawLineSeries.applyOptions({ visible: comparePayload && rawLineVisible });
    seriesRef.current.qfqSeries.applyOptions({ visible: showQfq });
    seriesRef.current.hfqSeries.applyOptions({ visible: showHfq });
    seriesRef.current.midAdjustSeries.applyOptions({ visible: showMidAdjust });
    seriesRef.current.strategyLineSeries.applyOptions({ visible: Boolean(showStrategySeries && strategySeries?.length) });
    seriesRef.current.leftComponentSeries.applyOptions({
      visible: showLeftComponent && componentCandlesVisible && Boolean(payload?.components?.[0]?.candles?.length)
    });
    seriesRef.current.leftComponentLineSeries.applyOptions({
      visible: showLeftComponent && componentLinesVisible && Boolean(payload?.components?.[0]?.candles?.length)
    });
    seriesRef.current.rightComponentSeries.applyOptions({
      visible: showRightComponent && componentCandlesVisible && Boolean(payload?.components?.[1]?.candles?.length)
    });
    seriesRef.current.rightComponentLineSeries.applyOptions({
      visible: showRightComponent && componentLinesVisible && Boolean(payload?.components?.[1]?.candles?.length)
    });
    chartRef.current.priceScale('right').applyOptions({
      visible: !comparePayload || (showLeftComponent && Boolean(payload?.components?.[0]?.candles?.length)) || (showRightComponent && Boolean(payload?.components?.[1]?.candles?.length))
    });
    chartRef.current.priceScale('left').applyOptions({
      ...getLeftAxisOptions(payload),
      visible: isLeftAxisVisible(payload, selectedMetricKeys, visibleStrategySeries, showRaw)
    });
  }, [chartMode, mainChartMode, payload, selectedMetricKeys, showHfq, showLeftComponent, showMidAdjust, showQfq, showRaw, showRightComponent, showStrategySeries, strategySeries, visibleStrategySeries]);

  useEffect(() => {
    onSnapshotChange?.(getLegendSnapshot(tooltip, payload, midSeries, visibleStrategySeries));
  }, [midSeries, onSnapshotChange, payload, tooltip, visibleStrategySeries]);

  const hasChartData = hasAnyChartData(payload);
  const emptyMessage = getEmptyChartMessage(payload);
  const hoverGuides = buildHoverGuides({
    payload,
    tooltip,
    chartMode,
    rawChartMode: mainChartMode,
    showRaw,
    showQfq,
    showHfq,
    showMidAdjust,
    showLeftComponent,
    showRightComponent,
    selectedMetricKeys,
    metricScaleByKey,
    strategySeries: visibleStrategySeries,
    seriesState: seriesRef.current
  });

  return (
    <div className="chart-panel">
      <ChartLegend
        tooltip={tooltip}
        payload={payload}
        showRaw={showRaw}
        showQfq={showQfq}
        showHfq={showHfq}
        showMidAdjust={showMidAdjust}
        midAdjustedSeries={midSeries}
        chartMode={chartMode}
        rawChartMode={mainChartMode}
        showLeftComponent={showLeftComponent}
        showRightComponent={showRightComponent}
        instrumentType={payload?.instrument?.type}
        leftLabel={getComponentDisplayName(payload?.components?.[0], payload?.compare?.left, '左侧对比')}
        rightLabel={getComponentDisplayName(payload?.components?.[1], payload?.compare?.right, '右侧对比')}
        leftInstrumentType={payload?.compare?.left?.type}
        rightInstrumentType={payload?.compare?.right?.type}
        strategySeries={visibleStrategySeries}
        strategyLabel={strategyLabel}
      />
      <div className="chart-host" ref={hostRef}>
        {hoverGuides.length ? (
          <div className="chart-hover-guides" aria-hidden="true">
            {hoverGuides.map((guide) => (
              <div
                key={guide.key}
                className={`chart-hover-guide ${guide.axisSide === 'left' ? 'is-left-axis' : 'is-right-axis'}`}
                style={{
                  top: `${guide.y}px`,
                  '--guide-color': guide.color
                }}
              >
                <span className="chart-hover-guide-line" />
                <span className="chart-hover-guide-label">{guide.valueText}</span>
              </div>
            ))}
          </div>
        ) : null}
        {loading ? (
          <div className={`loading-layer${payload ? ' is-overlay' : ''}`}>
            <div className="loading-card">
              <RefreshCw size={16} className="spin" />
              <div>
                <div>{loadingMessage || '加载K线中...'}</div>
                {payload ? <small>已保留上一张图，加载完成后会自动切换。</small> : null}
              </div>
            </div>
          </div>
        ) : null}
        {!loading && payload && !hasChartData ? <div className="empty-state chart-empty-state">{emptyMessage}</div> : null}
      </div>
    </div>
  );
}

function ChartLegend({
  tooltip,
  payload,
  showRaw,
  showQfq,
  showHfq,
  showMidAdjust,
  midAdjustedSeries = EMPTY_SERIES,
  chartMode,
  rawChartMode,
  showLeftComponent,
  showRightComponent,
  instrumentType,
  leftLabel,
  rightLabel,
  leftInstrumentType,
  rightInstrumentType,
  strategySeries = EMPTY_SERIES,
  strategyLabel = '多空组合'
}) {
  const snapshot = getLegendSnapshot(tooltip, payload, midAdjustedSeries, strategySeries);
  if (!snapshot?.time) return null;
  const mainChartMode = rawChartMode || chartMode;
  const rawLegendLabel = getFutureAwareRawLabel(snapshot.raw, instrumentType, mainChartMode);

  return (
    <div className="chart-legend">
      <div className="legend-time">
        {formatTime(snapshot.time)}
        {!tooltip.visible ? ' · 最新' : ''}
      </div>
      <div className="legend-content">
        <div className="legend-items">
          {showRaw ? (
            mainChartMode === 'line' ? (
              <LegendLineItem label={rawLegendLabel} candle={snapshot.raw} tone="raw" instrumentType={instrumentType} />
            ) : (
              <LegendCandleItem label={rawLegendLabel} candle={snapshot.raw} tone="raw" instrumentType={instrumentType} />
            )
          ) : null}
          {showQfq ? <LegendLineItem label="前复权" candle={snapshot.qfq} tone="qfq" instrumentType={instrumentType} /> : null}
          {showHfq ? <LegendLineItem label="后复权" candle={snapshot.hfq} tone="hfq" instrumentType={instrumentType} /> : null}
          {showMidAdjust ? <LegendLineItem label="中间复权" candle={snapshot.mid} tone="mid" instrumentType={instrumentType} /> : null}
          {showLeftComponent ? (
            chartMode === 'line' ? (
              <LegendLineItem label={`${leftLabel} 收盘线`} candle={snapshot.left} tone="left-component" instrumentType={leftInstrumentType} />
            ) : (
              <LegendCandleItem label={leftLabel} candle={snapshot.left} tone="left-component" instrumentType={leftInstrumentType} />
            )
          ) : null}
          {showRightComponent ? (
            chartMode === 'line' ? (
              <LegendLineItem label={`${rightLabel} 收盘线`} candle={snapshot.right} tone="right-component" instrumentType={rightInstrumentType} />
            ) : (
              <LegendCandleItem label={rightLabel} candle={snapshot.right} tone="right-component" instrumentType={rightInstrumentType} />
            )
          ) : null}
          {strategySeries?.length ? (
            <LegendLineItem label={strategyLabel} candle={snapshot.strategy} tone="strategy" instrumentType="RETURN_DECIMAL" />
          ) : null}
        </div>
        {snapshot.rollover || snapshot.rolloverContext ? (
          <LegendRolloverItem rollover={snapshot.rollover || snapshot.rolloverContext} />
        ) : null}
      </div>
    </div>
  );
}

function LegendRolloverItem({ rollover }) {
  const premiumLabel = getRolloverPremiumLabel(rollover);
  const priceLabel = getRolloverPriceLabel(rollover);
  const fromPrice = getRolloverDisplayPrice(rollover, 'from');
  const toPrice = getRolloverDisplayPrice(rollover, 'to');
  const title = rollover.isSwitch ? '切换' : '观察';
  return (
    <div className="legend-rollover">
      <b>{title}</b>
      <span>{rollover.fromCode}({rollover.fromMonthLabel}) → {rollover.toCode}({rollover.toMonthLabel})</span>
      <span>{rollover.fromMonthLabel}{priceLabel}: {formatPriceValue(fromPrice, 'FUTURE')} / 量 {formatCompact(rollover.fromVolume)}</span>
      <span>{rollover.toMonthLabel}{priceLabel}: {formatPriceValue(toPrice, 'FUTURE')} / 量 {formatCompact(rollover.toVolume)}</span>
      <span>
        {premiumLabel}: {Number.isFinite(rollover.premium) ? formatSigned(rollover.premium) : '--'}
        {Number.isFinite(rollover.premiumRate) ? ` (${formatSignedPercent(rollover.premiumRate)})` : ''}
      </span>
      {rollover.reason === 'availability' ? <span>因原合约无后续数据切换</span> : null}
    </div>
  );
}

function getRolloverDisplayPrice(rollover, side) {
  const averageKey = side === 'from' ? 'fromAveragePrice' : 'toAveragePrice';
  const closeKey = side === 'from' ? 'fromPrice' : 'toPrice';
  return Number.isFinite(rollover?.[averageKey]) ? rollover[averageKey] : rollover?.[closeKey];
}

function getRolloverPriceLabel(rollover) {
  const source = String(rollover?.premiumSource || '');
  if (source.includes('tqsdk') || source.includes('minute') || source.includes('miana')) return '均价';
  if (source.includes('daily')) return '日中价';
  return '价';
}

function getRolloverPremiumLabel(rollover) {
  const source = String(rollover?.premiumSource || '');
  if (source.includes('tqsdk-1m')) return '溢价(1分均价)';
  if (source.includes('minute') || source.includes('miana')) return '溢价(分钟均价)';
  if (source.includes('daily')) return '溢价(日K近似)';
  return '溢价';
}

function hasAnyChartData(payload) {
  if (!payload) return false;
  if (payload.series?.raw?.length) return true;
  if (payload.series?.qfq?.length) return true;
  if (payload.series?.hfq?.length) return true;
  if (payload.components?.some((component) => component?.candles?.length)) return true;
  return false;
}

function getEmptyChartMessage(payload) {
  const intervalLabel = payload?.interval?.label || '当前周期';
  return `${intervalLabel} 暂无可用数据，请切换其他周期。`;
}

function LegendCandleItem({ label, candle, tone, instrumentType }) {
  const changeRate = getCandleChangeRate(candle);

  return (
    <div className={`legend-item ${tone}`}>
      <span className="legend-label">{label}</span>
      {candle ? (
        <span className="legend-values">
          O {formatPriceValue(candle.open, instrumentType)}
          {Number.isFinite(changeRate) ? <b className={toneClass(changeRate)}>{formatSignedPercent(changeRate)}</b> : null}
          <b>H {formatPriceValue(candle.high, instrumentType)}</b>
          <b>L {formatPriceValue(candle.low, instrumentType)}</b>
          C {formatPriceValue(candle.close, instrumentType)}
        </span>
      ) : (
        <span className="legend-empty">当前时间无数据</span>
      )}
    </div>
  );
}

function LegendLineItem({ label, candle, tone, instrumentType }) {
  return (
    <div className={`legend-item ${tone}`}>
      <span className="legend-label">{label}</span>
      {candle ? (
        <span className="legend-single">C {formatPriceValue(candle.close, instrumentType)}</span>
      ) : (
        <span className="legend-empty">当前时间无数据</span>
      )}
    </div>
  );
}

function getFutureAwareRawLabel(candle, instrumentType, chartMode) {
  const baseLabel = chartMode === 'line' ? '普通收盘线' : '普通K';
  if (instrumentType !== 'FUTURE') return baseLabel;

  const contractLabel = formatFutureContractLegendLabel(candle);
  return contractLabel ? `${contractLabel} · ${baseLabel}` : baseLabel;
}

function formatFutureContractLegendLabel(candle) {
  if (!candle) return '';

  const contractCode = String(candle.contractCode || '').trim();
  const expiry = String(candle.contractExpiry || '').trim();
  const monthLabel = expiry.length >= 4 ? `${Number(expiry.slice(2))}月` : '';

  if (contractCode && monthLabel) {
    return `${contractCode.toUpperCase()}(${monthLabel})`;
  }

  if (contractCode) {
    return contractCode.toUpperCase();
  }

  if (expiry && monthLabel) {
    return `${expiry}(${monthLabel})`;
  }

  return expiry || '';
}

function Metric({ label, value, change, small = false }) {
  const tone = toneClass(change);

  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={small ? 'metric-small' : ''}>{value}</strong>
      {Number.isFinite(change) ? <em className={tone}>{formatSignedPercent(change)}</em> : null}
    </article>
  );
}

function StockSnapshotText({ label, candle, instrumentType }) {
  if (!candle) {
    return (
      <span className="stock-info-item">
        <b>{label}:</b> --
      </span>
    );
  }

  return (
    <span className="stock-info-item">
      <b>{label}:</b> 时间: {formatTime(candle.time)} 开: {formatPriceValue(candle.open, instrumentType)} 高: {formatPriceValue(candle.high, instrumentType)} 低: {formatPriceValue(candle.low, instrumentType)} 收: {formatPriceValue(candle.close, instrumentType)}
    </span>
  );
}

const EMPHASIZED_SUMMARY_LABELS = new Set(['价格', '市盈率', '收入增长率', '利润增长率']);

function SummaryToken({ label, value }) {
  const emphasized = EMPHASIZED_SUMMARY_LABELS.has(label);
  return (
    <span className={emphasized ? 'stock-info-item stock-info-item-emphasized' : 'stock-info-item'}>
      <b>{label}:</b> {value}
    </span>
  );
}

function getRouteState() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('view') === 'detail' && params.get('id')) {
    return {
      view: 'detail',
      id: params.get('id'),
      intervalKey: normalizeIntervalKey(params.get('interval')),
      chartMode: normalizeChartMode(params.get('chart')),
      showRaw: parseUrlBoolean(params.get('raw'), true),
      showQfq: parseUrlBoolean(params.get('qfq'), false),
      showHfq: parseUrlBoolean(params.get('hfq'), false),
      showMidAdjust: parseUrlBoolean(params.get('mid'), false),
      midAdjustDate: normalizeCompactDateInput(params.get('midDate')),
      showLeftComponent: parseUrlBoolean(params.get('leftLine'), true),
      showRightComponent: parseUrlBoolean(params.get('rightLine'), true)
    };
  }

  if (params.get('view') === 'compare' && params.get('left') && params.get('right')) {
    return {
      view: 'compare',
      left: params.get('left'),
      right: params.get('right'),
      mode: parseCompareMode(params.get('mode')),
      intervalKey: normalizeIntervalKey(params.get('interval')),
      chartMode: normalizeChartMode(params.get('chart') || (parseUrlBoolean(params.get('minuteK'), false) ? 'candles' : 'line')),
      showRaw: parseUrlBoolean(params.get('raw'), true),
      showLeftComponent: parseUrlBoolean(params.get('leftLine'), true),
      showRightComponent: parseUrlBoolean(params.get('rightLine'), true),
      anchorDate: normalizeCompactDateInput(params.get('anchorDate')),
      anchorEnabled: parseUrlBoolean(params.get('anchor'), false),
      compareAdjustmentMode: normalizeCompareAdjustmentMode(params.get('adjust') || loadStoredCompareAdjustmentMode()),
      compareCommonBase: parseUrlBoolean(params.get('commonBase'), false),
      leftMultiplier: normalizeMultiplierInput(params.get('leftMul')),
      rightMultiplier: normalizeMultiplierInput(params.get('rightMul')),
      compareMinuteCandles: parseUrlBoolean(params.get('minuteK'), false),
      strategyEnabled: parseUrlBoolean(params.get('strategy'), false),
      strategySide: normalizeStrategySide(params.get('strategySide')),
      strategyLeftLeverage: normalizeMultiplierInput(params.get('strategyLeft')),
      strategyRightLeverage: normalizeMultiplierInput(params.get('strategyRight')),
      showStrategySeries: parseUrlBoolean(params.get('strategyLine'), true)
    };
  }

  return {
    view: 'list',
    id: ''
  };
}

function applyRouteToUrl(url, route) {
  url.search = '';

  if (route.view === 'detail' && route.id) {
    url.searchParams.set('view', 'detail');
    url.searchParams.set('id', route.id);
    url.searchParams.set('interval', normalizeIntervalKey(route.intervalKey));
    url.searchParams.set('chart', normalizeChartMode(route.chartMode));
    url.searchParams.set('raw', route.showRaw === false ? '0' : '1');
    url.searchParams.set('qfq', route.showQfq ? '1' : '0');
    url.searchParams.set('hfq', route.showHfq ? '1' : '0');
    url.searchParams.set('mid', route.showMidAdjust ? '1' : '0');
    url.searchParams.set('leftLine', route.showLeftComponent === false ? '0' : '1');
    url.searchParams.set('rightLine', route.showRightComponent === false ? '0' : '1');

    const midDate = normalizeCompactDateInput(route.midAdjustDate);
    if (midDate) {
      url.searchParams.set('midDate', midDate);
    }
    return url;
  }

  if (route.view === 'compare' && route.left && route.right) {
    url.searchParams.set('view', 'compare');
    url.searchParams.set('left', route.left);
    url.searchParams.set('right', route.right);
    url.searchParams.set('mode', parseCompareMode(route.mode));
    url.searchParams.set('interval', normalizeIntervalKey(route.intervalKey));
    url.searchParams.set('chart', normalizeChartMode(route.chartMode));
    url.searchParams.set('raw', route.showRaw === false ? '0' : '1');
    url.searchParams.set('leftLine', route.showLeftComponent === false ? '0' : '1');
    url.searchParams.set('rightLine', route.showRightComponent === false ? '0' : '1');
    url.searchParams.set('anchor', route.anchorEnabled ? '1' : '0');
    url.searchParams.set('adjust', normalizeCompareAdjustmentMode(route.compareAdjustmentMode));
    url.searchParams.set('commonBase', route.compareCommonBase ? '1' : '0');
    url.searchParams.set('leftMul', formatMultiplierParam(route.leftMultiplier));
    url.searchParams.set('rightMul', formatMultiplierParam(route.rightMultiplier));
    url.searchParams.set('minuteK', route.compareMinuteCandles ? '1' : '0');
    url.searchParams.set('strategyLine', route.showStrategySeries === false ? '0' : '1');

    if (route.strategyConfig) {
      url.searchParams.set('strategy', '1');
      url.searchParams.set('strategySide', normalizeStrategySide(route.strategyConfig.side));
      url.searchParams.set('strategyLeft', formatMultiplierParam(route.strategyConfig.leftLeverage));
      url.searchParams.set('strategyRight', formatMultiplierParam(route.strategyConfig.rightLeverage));
    } else {
      url.searchParams.set('strategy', '0');
    }

    const anchorDate = normalizeCompactDateInput(route.anchorDate);
    if (anchorDate) {
      url.searchParams.set('anchorDate', anchorDate);
    }
  }

  return url;
}

function parseUrlBoolean(value, fallback) {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function normalizeMultiplierInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_COMPARE_MULTIPLIER;
  const number = Number(text);
  return Number.isFinite(number) ? formatMetricScaleDisplay(number) : DEFAULT_COMPARE_MULTIPLIER;
}

function parseMultiplierInput(value) {
  return parseMetricScaleInput(value);
}

function formatMultiplierParam(value) {
  return normalizeMultiplierInput(value);
}

function normalizeIntervalKey(value) {
  const key = String(value || '').trim();
  return INTERVAL_OPTIONS.some((option) => option.key === key) ? key : 'day';
}

function normalizeChartMode(value) {
  return value === 'line' ? 'line' : 'candles';
}

function loadStoredCompareFavorites() {
  try {
    const raw = window.localStorage.getItem(COMPARE_FAVORITES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeStoredFavorite)
      .filter(Boolean)
      .filter((item) => !isDefaultFavoriteKey(item.key));
  } catch {
    return [];
  }
}

function storeCompareFavorites(favorites) {
  try {
    window.localStorage.setItem(COMPARE_FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // ignore local storage failures
  }
}

function loadStoredCompareAdjustmentMode() {
  try {
    return normalizeCompareAdjustmentMode(window.localStorage.getItem(COMPARE_ADJUSTMENT_MODE_KEY));
  } catch {
    return 'qfq';
  }
}

function storeCompareAdjustmentMode(mode) {
  try {
    window.localStorage.setItem(COMPARE_ADJUSTMENT_MODE_KEY, normalizeCompareAdjustmentMode(mode));
  } catch {
    // ignore local storage failures
  }
}

function normalizeStoredFavorite(favorite) {
  if (!favorite?.leftId || !favorite?.rightId) return null;
  const mode = parseCompareMode(favorite.mode);
  const leftCode = String(favorite.leftCode || favorite.leftId.split(':').at(-1) || '').trim();
  const rightCode = String(favorite.rightCode || favorite.rightId.split(':').at(-1) || '').trim();
  const leftName = String(favorite.leftName || leftCode).trim();
  const rightName = String(favorite.rightName || rightCode).trim();
  const operator = getCompareOperator(mode);
  const code = String(favorite.code || `${leftCode}${operator}${rightCode}`).trim();
  const displayName = String(favorite.displayName || favorite.name || `${leftName}${operator}${rightName}`).trim();
  const searchText = String(
    favorite.searchText || `${code} ${displayName} ${leftName} ${rightName} ${leftCode} ${rightCode} 对比 汇率`
  )
    .toLowerCase()
    .trim();

  return {
    key: favorite.key || `${mode}:${favorite.leftId}:${favorite.rightId}`,
    leftId: favorite.leftId,
    rightId: favorite.rightId,
    mode,
    leftCode,
    rightCode,
    leftName,
    rightName,
    code,
    name: String(favorite.name || displayName).trim(),
    displayName,
    searchText,
    pinned: Boolean(favorite.pinned)
  };
}

function getAllCompareFavorites(customFavorites) {
  const merged = [DEFAULT_COMPARE_FAVORITE, ...customFavorites];
  return [...new Map(merged.map((favorite) => [favorite.key, normalizeStoredFavorite(favorite)])).values()].filter(Boolean);
}

function getVisibleCompareFavorites(customFavorites, search, favoriteQuotes) {
  const normalizedSearch = normalizeSearchText(search);

  return getAllCompareFavorites(customFavorites)
    .filter((favorite) => !normalizedSearch || favorite.searchText.includes(normalizedSearch))
    .map((favorite) => decorateCompareFavorite(favorite, favoriteQuotes[favorite.key]));
}

function decorateCompareFavorite(favorite, quote) {
  return {
    id: `COMPARE_FAVORITE:${favorite.key}`,
    key: favorite.key,
    type: 'RATIO',
    typeLabel: getCompareFavoriteTypeLabel(favorite.mode),
    marketLabel: favorite.pinned ? '默认收藏' : '自定义收藏',
    code: favorite.code,
    symbol: favorite.code,
    name: favorite.displayName,
    chineseName: '',
    displayName: favorite.displayName,
    searchText: favorite.searchText,
    leftId: favorite.leftId,
    rightId: favorite.rightId,
    mode: favorite.mode,
    quote,
    compareSpec: {
      left: favorite.leftId,
      right: favorite.rightId,
      mode: favorite.mode
    },
    compareLeftInstrument: {
      id: favorite.leftId,
      code: favorite.leftCode,
      name: favorite.leftName,
      displayName: `${favorite.leftCode} / ${favorite.leftName}`,
      searchText: `${favorite.leftCode} ${favorite.leftName}`.toLowerCase()
    },
    compareRightInstrument: {
      id: favorite.rightId,
      code: favorite.rightCode,
      name: favorite.rightName,
      displayName: `${favorite.rightCode} / ${favorite.rightName}`,
      searchText: `${favorite.rightCode} ${favorite.rightName}`.toLowerCase()
    }
  };
}

function buildCompareFavorite({ left, right, mode }) {
  const leftOption = toCompareOption(left);
  const rightOption = toCompareOption(right);
  if (!leftOption || !rightOption) return null;

  const operator = getCompareOperator(mode);
  const leftName = leftOption.name || leftOption.code;
  const rightName = rightOption.name || rightOption.code;

  return normalizeStoredFavorite({
    key: `${mode}:${leftOption.id}:${rightOption.id}`,
    leftId: leftOption.id,
    rightId: rightOption.id,
    mode,
    leftCode: leftOption.code,
    rightCode: rightOption.code,
    leftName,
    rightName,
    code: `${leftOption.code}${operator}${rightOption.code}`,
    name: `${leftName}${operator}${rightName}`,
    displayName: `${leftName}${operator}${rightName}`,
    searchText: `${leftOption.code}${operator}${rightOption.code} ${leftName}${operator}${rightName} ${leftOption.searchText || ''} ${rightOption.searchText || ''} 对比 汇率`
  });
}

function getCompareSpecFromItem(item) {
  if (item?.compareSpec?.left && item?.compareSpec?.right) {
    return item.compareSpec;
  }

  if (item?.id === 'RATIO:btc-ndx') {
    return {
      left: 'CRYPTO:BTC',
      right: 'INDEX:NDX',
      mode: 'divide'
    };
  }

  if (item?.id === 'RATIO:ndx-btc') {
    return {
      left: 'INDEX:NDX',
      right: 'CRYPTO:BTC',
      mode: 'divide'
    };
  }

  return null;
}

function openListItem(item, { onOpenDetail, onOpenCompare }) {
  const compareSpec = getCompareSpecFromItem(item);
  if (compareSpec) {
    onOpenCompare(compareSpec);
    return;
  }

  onOpenDetail(item.id);
}

function buildDraftOptionFromSpec(item, compareSpec, side) {
  if (side === 'left') {
    return toCompareOption(item.compareLeftInstrument) || findBuiltinCompareOptionById(compareSpec.left);
  }

  return toCompareOption(item.compareRightInstrument) || findBuiltinCompareOptionById(compareSpec.right);
}

function toCompareOption(item) {
  if (!item?.id) return null;

  const type = String(item.type || '').toUpperCase();
  if (type === 'RATIO' || type === 'COMPARE') return null;

  const code = String(item.code || item.displayCode || item.symbol || item.id.split(':').at(-1) || '').trim();
  const name = String(item.chineseName || item.name || item.displayName || code).trim();
  const displayName = String(item.displayName || `${code} / ${name}`).trim();
  const typeLabel = String(item.typeLabel || DEFAULT_TYPES.find((option) => option.key === type)?.label || type).trim();
  const marketLabel = String(item.marketLabel || '--').trim();
  const searchText = String(
    item.searchText || `${code} ${item.code || ''} ${name} ${displayName} ${marketLabel} ${typeLabel}`
  )
    .toLowerCase()
    .trim();

  return {
    id: item.id,
    code,
    displayCode: String(item.code || item.displayCode || code).trim(),
    symbol: String(item.symbol || code),
    type,
    typeLabel,
    name,
    chineseName: String(item.chineseName || '').trim(),
    displayName,
    marketLabel,
    searchText
  };
}

function findBuiltinCompareOptionById(id) {
  return BUILTIN_COMPARE_OPTIONS.find((item) => item.id === id) || null;
}

function compareOptions(left, right) {
  const marketScoreDiff = getOptionMarketRank(right) - getOptionMarketRank(left);
  if (marketScoreDiff !== 0) {
    return marketScoreDiff;
  }

  if (left.marketLabel !== right.marketLabel) {
    return left.marketLabel.localeCompare(right.marketLabel, 'zh-CN');
  }

  return left.code.localeCompare(right.code, 'zh-CN');
}

function deduplicateCompareOptions(options) {
  return [...new Map(options.filter(Boolean).map((item) => [item.id, item])).values()];
}

function rankCompareOptions(options, query) {
  const normalizedQuery = normalizeSearchText(query);
  const ranked = options
    .map((option) => ({
      option,
      score: getCompareOptionScore(option, normalizedQuery)
    }))
    .filter((item) => item.score > -1)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return compareOptions(left.option, right.option);
    });

  return ranked.map((item) => item.option);
}

function getCompareOptionScore(option, query) {
  if (!query) return 1;

  const code = option.code.toLowerCase();
  const name = option.name.toLowerCase();
  const displayName = option.displayName.toLowerCase();
  const searchText = option.searchText.toLowerCase();

  if (code === query) return 100;
  if (name === query) return 95;
  if (displayName === query) return 90;
  if (code.startsWith(query)) return 80;
  if (name.startsWith(query)) return 75;
  if (displayName.startsWith(query)) return 70;
  if (searchText.includes(query)) return 60;
  return -1;
}

function formatOptionInput(option) {
  return `${option.code} ${option.name}`.trim();
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getOptionMarketRank(option) {
  if (option?.marketLabel === 'A股') return 4;
  if (option?.marketLabel === '港股') return 3;
  if (option?.marketLabel === '美股' || option?.marketLabel === '美股指数') return 2;
  return 1;
}

function isDefaultFavoriteKey(key) {
  return key === DEFAULT_COMPARE_FAVORITE.key;
}

function getComponentDisplayName(component, compareSide, fallback) {
  if (component?.displayName) return component.displayName;
  if (component?.label) return component.label;
  if (compareSide?.chineseName) return compareSide.chineseName;
  if (compareSide?.name) return compareSide.name;
  if (compareSide?.code) return compareSide.code;
  return fallback;
}

function getDisplayCodeText(item) {
  return String(item?.code || item?.displayCode || item?.symbol || '--').trim();
}

function getAdjustmentSourceText(payload) {
  if (!payload?.supportsAdjustments) return '当前品种仅提供普通K';
  if (payload?.instrument?.type === 'FUTURE') return '期货主连按换季溢价计算前复权/后复权';
  if (payload?.instrument?.type === 'STOCK') return '股票按分红送转因子自定义计算前复权/后复权';
  return '已提供前复权/后复权';
}

function getCandleChangeRate(candle) {
  if (!candle || !Number.isFinite(candle.open) || !Number.isFinite(candle.close) || !candle.open) {
    return null;
  }

  return ((candle.close - candle.open) / candle.open) * 100;
}

function getSeriesCandleMove(candle, candles, options = {}) {
  const close = toFiniteNumber(candle?.close);
  if (!Number.isFinite(close) || !Array.isArray(candles) || !candles.length) {
    return { change: null, changeRate: null };
  }

  const index = candles.findIndex((item) => String(item?.time) === String(candle?.time));
  const previous = index > 0 ? candles[index - 1] : null;
  const previousClose = toFiniteNumber(previous?.close);
  if (!Number.isFinite(previousClose)) {
    return { change: null, changeRate: null };
  }

  const change = close - previousClose;
  const base = options.useAbsoluteBase ? Math.abs(previousClose) : previousClose;
  const changeRate = base ? (change / base) * 100 : null;

  return {
    change,
    changeRate
  };
}

function createLookup(candles) {
  return new Map(candles.map((candle) => [String(candle.time), candle]));
}

function createRolloverLookup(rollovers) {
  return new Map((rollovers || []).map((event) => [String(event.markerTime), event]));
}

function buildCompareAdjustmentPayload(payload, adjustmentMode, options = {}) {
  if (!payload?.compare || !payload?.components?.length) return payload;

  const {
    useCommonBase = false,
    leftMultiplier = 1,
    rightMultiplier = 1,
    syntheticMode = 'closeLine'
  } = options;
  const normalizedMode = normalizeCompareAdjustmentMode(adjustmentMode);
  const baseAdjustmentLabel = getCompareAdjustmentLabel(normalizedMode);
  const leftComponent = payload.components[0];
  const rightComponent = payload.components[1];
  let leftCandles = getCompareComponentCandles(leftComponent, normalizedMode);
  let rightCandles = getCompareComponentCandles(rightComponent, normalizedMode);
  const leftRawCandles = leftComponent.candles || [];
  const rightRawCandles = rightComponent.candles || [];
  let commonBaseMeta = null;

  if (useCommonBase && normalizedMode !== 'raw') {
    const rebased = buildCommonBaseAdjustedPair({
      leftCandles,
      rightCandles,
      leftRawCandles,
      rightRawCandles
    });

    if (rebased) {
      leftCandles = rebased.leftCandles;
      rightCandles = rebased.rightCandles;
      commonBaseMeta = rebased.meta;
    }
  }
  const adjustmentLabel = commonBaseMeta
    ? `${baseAdjustmentLabel}·共同起点`
    : baseAdjustmentLabel;

  if (!leftCandles?.length || !rightCandles?.length) {
    return {
      ...payload,
      compare: {
        ...payload.compare,
        adjustmentMode: 'raw',
        adjustmentLabel: 'K线',
        commonBase: false,
        commonBaseTime: null
      }
    };
  }

  const scaledLeftCandles = multiplyCandles(leftCandles, leftMultiplier);
  const scaledRightCandles = multiplyCandles(rightCandles, rightMultiplier);
  const compareCandles = buildClientSyntheticComparisonCandles(scaledLeftCandles, scaledRightCandles, payload.compare.mode, syntheticMode);
  if (!compareCandles.length) {
    return payload;
  }

  const adjustedComponents = [
    {
      ...leftComponent,
      displayName: withMultiplierDisplayName(leftComponent.displayName || leftComponent.label, leftMultiplier),
      rawCandles: leftRawCandles,
      candles: syntheticMode === 'minuteDailyCandles' ? aggregateClientCandlesByDate(scaledLeftCandles) : scaledLeftCandles
    },
    {
      ...rightComponent,
      displayName: withMultiplierDisplayName(rightComponent.displayName || rightComponent.label, rightMultiplier),
      rawCandles: rightRawCandles,
      candles: syntheticMode === 'minuteDailyCandles' ? aggregateClientCandlesByDate(scaledRightCandles) : scaledRightCandles
    }
  ];
  const interval = syntheticMode === 'minuteDailyCandles'
    ? {
        key: 'day',
        label: '分钟合成日K'
      }
    : payload.interval;

  return {
    ...payload,
    interval,
    quote: buildClientQuoteFromCandles(compareCandles),
    range: getClientCombinedSeriesRange([
      compareCandles,
      adjustedComponents[0].candles || [],
      adjustedComponents[1].candles || []
    ]),
    sourceName: `${payload.sourceName || ''} · ${adjustmentLabel}`,
    compare: {
      ...payload.compare,
      adjustmentMode: normalizedMode,
      adjustmentLabel,
      commonBase: Boolean(commonBaseMeta),
      commonBaseTime: commonBaseMeta?.time || null,
      leftMultiplier,
      rightMultiplier,
      syntheticMode
    },
    components: adjustedComponents,
    series: {
      ...payload.series,
      raw: compareCandles
    }
  };
}

function getCompareComponentCandles(component, adjustmentMode) {
  if (!component) return [];
  if (adjustmentMode === 'raw') return component.candles || [];
  return component[adjustmentMode]?.length ? component[adjustmentMode] : component.candles || [];
}

function multiplyCandles(candles, multiplier) {
  const scale = Number.isFinite(multiplier) ? multiplier : 1;
  if (!Array.isArray(candles) || !candles.length) return [];
  if (scale === 1) return candles.map((candle) => ({ ...candle }));

  return candles.map((candle) => ({
    ...candle,
    open: multiplyPrice(candle.open, scale),
    high: multiplyPrice(candle.high, scale),
    low: multiplyPrice(candle.low, scale),
    close: multiplyPrice(candle.close, scale)
  }));
}

function multiplyPrice(value, multiplier) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number) ? roundChartAdjustedPrice(number * multiplier) : value;
}

function withMultiplierDisplayName(name, multiplier) {
  const base = String(name || '').trim() || '--';
  const scale = Number.isFinite(multiplier) ? multiplier : 1;
  if (scale === 1) return base;
  return `${base}*${formatMetricScaleDisplay(scale)}`;
}

function buildCommonBaseAdjustedPair({ leftCandles, rightCandles, leftRawCandles, rightRawCandles }) {
  const commonTime = findFirstCommonCandleTime(leftRawCandles, rightRawCandles);
  if (!commonTime) return null;

  return {
    leftCandles: rebaseAdjustedCandlesFromTime(leftCandles, leftRawCandles, commonTime),
    rightCandles: rebaseAdjustedCandlesFromTime(rightCandles, rightRawCandles, commonTime),
    meta: {
      time: commonTime
    }
  };
}

function findFirstCommonCandleTime(leftCandles, rightCandles) {
  if (!Array.isArray(leftCandles) || !Array.isArray(rightCandles) || !leftCandles.length || !rightCandles.length) {
    return null;
  }

  const rightTimes = new Set(rightCandles.map((candle) => String(candle?.time)).filter(Boolean));
  const common = leftCandles
    .filter((candle) => candle?.time && rightTimes.has(String(candle.time)))
    .sort((left, right) => compareChartTimes(left.time, right.time));

  return common[0]?.time || null;
}

function rebaseAdjustedCandlesFromTime(adjustedCandles, rawCandles, startTime) {
  if (!Array.isArray(adjustedCandles) || !adjustedCandles.length || !startTime) return [];

  const adjustedByTime = createLookup(adjustedCandles);
  const rawByTime = createLookup(rawCandles || []);
  const startAdjusted = adjustedByTime.get(String(startTime));
  const startRaw = rawByTime.get(String(startTime));
  const basis = getCommonBaseAdjustmentBasis(startAdjusted, startRaw);

  return adjustedCandles
    .filter((candle) => candle?.time && compareChartTimes(candle.time, startTime) >= 0)
    .map((candle) => applyCommonBaseAdjustment(candle, basis, rawByTime.get(String(candle.time))));
}

function getCommonBaseAdjustmentBasis(adjusted, raw) {
  const adjustedClose = toFiniteNumber(adjusted?.close);
  const rawClose = toFiniteNumber(raw?.close);

  if (!Number.isFinite(adjustedClose) || !Number.isFinite(rawClose) || rawClose === 0) {
    return 1;
  }

  const basis = adjustedClose / rawClose;
  return Number.isFinite(basis) && basis > 0 ? basis : 1;
}

function applyCommonBaseAdjustment(candle, basis, rawCandle) {
  const normalizedBasis = Number.isFinite(basis) && basis > 0 ? basis : 1;
  const adjustPrice = (value) => {
    const number = toFiniteNumber(value);
    return Number.isFinite(number) ? roundChartAdjustedPrice(number / normalizedBasis) : value;
  };

  return {
    ...candle,
    open: adjustPrice(candle.open),
    high: adjustPrice(candle.high),
    low: adjustPrice(candle.low),
    close: adjustPrice(candle.close),
    volume: rawCandle?.volume ?? candle.volume
  };
}

function compareChartTimes(left, right) {
  const leftNumber = getChartTimeSortValue(left);
  const rightNumber = getChartTimeSortValue(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return String(left || '').localeCompare(String(right || ''), 'zh-CN');
}

function getChartTimeSortValue(time) {
  if (typeof time === 'number') return time * 1000;

  const text = String(time || '').trim();
  if (text && /[T\s]\d{1,2}:\d{2}/.test(text)) {
    const parsedFull = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
    if (!Number.isNaN(parsedFull.getTime())) return parsedFull.getTime();
  }

  const dateKey = getChartDateKey(time);
  if (dateKey) {
    const parsed = new Date(`${dateKey}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? NaN : parsed.getTime();
}

function getCompareMinuteLookbackDays(payload) {
  const compareCandles = payload?.series?.raw || [];
  const startSource = compareCandles[0]?.time || payload?.range?.start;
  const endSource = compareCandles.at(-1)?.time || payload?.range?.end;
  const endValue = parseRangeDateSortValue(endSource);
  const startValue = parseRangeDateSortValue(startSource);
  const end = Number.isFinite(endValue) ? endValue : Date.now();
  if (!Number.isFinite(startValue) || startValue >= end) {
    return COMPARE_MINUTE_DEFAULT_LOOKBACK_DAYS;
  }

  const days = Math.ceil((end - startValue) / 86_400_000) + 14;
  return Math.min(COMPARE_MINUTE_MAX_LOOKBACK_DAYS, Math.max(30, days));
}

function parseRangeDateSortValue(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  const date = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (date) {
    return new Date(`${date[1]}-${padDatePart(date[2])}-${padDatePart(date[3])}T00:00:00`).getTime();
  }

  return getChartTimeSortValue(value);
}

function buildMinuteComparePayloadWithDailyAdjustments(minutePayload, dailyPayload) {
  if (!minutePayload?.compare || !minutePayload?.components?.length || !dailyPayload?.components?.length) {
    return minutePayload;
  }

  const components = minutePayload.components.map((component, index) => {
    const dailyComponent = dailyPayload.components[index];
    const minuteCandles = component?.candles || [];
    if (!dailyComponent || !minuteCandles.length) return component;

    return {
      ...component,
      qfq: buildMinuteAdjustedCandlesFromDailyFactors(
        minuteCandles,
        dailyComponent.rawCandles || dailyComponent.candles || [],
        dailyComponent.qfq || []
      ),
      hfq: buildMinuteAdjustedCandlesFromDailyFactors(
        minuteCandles,
        dailyComponent.rawCandles || dailyComponent.candles || [],
        dailyComponent.hfq || []
      )
    };
  });

  return {
    ...minutePayload,
    components
  };
}

function buildMinuteAdjustedCandlesFromDailyFactors(minuteCandles, dailyRawCandles, dailyAdjustedCandles) {
  if (!Array.isArray(minuteCandles) || !minuteCandles.length || !Array.isArray(dailyRawCandles) || !Array.isArray(dailyAdjustedCandles)) {
    return [];
  }

  const rawByDate = createDateLookup(dailyRawCandles);
  const adjustedByDate = createDateLookup(dailyAdjustedCandles);

  return minuteCandles
    .map((candle) => {
      const dateKey = getChartDateKey(candle?.time);
      const raw = rawByDate.get(dateKey);
      const adjusted = adjustedByDate.get(dateKey);
      const factor = getDailyAdjustmentFactor(raw, adjusted);
      if (!Number.isFinite(factor)) return null;
      return multiplyCandleByFactor(candle, factor);
    })
    .filter(isClientValidCandle);
}

function createDateLookup(candles) {
  return new Map(
    (candles || [])
      .map((candle) => [getChartDateKey(candle?.time), candle])
      .filter(([time]) => Boolean(time))
  );
}

function getDailyAdjustmentFactor(raw, adjusted) {
  const rawClose = toFiniteNumber(raw?.close);
  const adjustedClose = toFiniteNumber(adjusted?.close);
  if (!Number.isFinite(rawClose) || !Number.isFinite(adjustedClose) || rawClose === 0) {
    return NaN;
  }
  return adjustedClose / rawClose;
}

function multiplyCandleByFactor(candle, factor) {
  const adjust = (value) => {
    const number = toFiniteNumber(value);
    return Number.isFinite(number) ? roundChartAdjustedPrice(number * factor) : NaN;
  };

  return {
    ...candle,
    open: adjust(candle.open),
    high: adjust(candle.high),
    low: adjust(candle.low),
    close: adjust(candle.close)
  };
}

function buildClientSyntheticComparisonCandles(leftCandles, rightCandles, mode, syntheticMode = 'closeLine') {
  if (syntheticMode === 'minuteDailyCandles') {
    return buildClientMinuteDailySyntheticCandles(leftCandles, rightCandles, mode);
  }

  const rightByTime = createLookup(rightCandles || []);
  return (leftCandles || [])
    .map((left) => {
      const right = rightByTime.get(String(left.time));
      if (!right) return null;
      return buildClientSyntheticPairCandle(left, right, mode, syntheticMode);
    })
    .filter(isClientValidCandle);
}

function buildClientSyntheticPairCandle(left, right, mode, syntheticMode = 'closeLine') {
  if (syntheticMode === 'closeLine') {
    const close = mode === 'subtract'
      ? safeClientSubtract(left.close, right.close)
      : safeClientDivide(left.close, right.close);
    return {
      time: left.time,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0
    };
  }

  if (mode === 'subtract') {
    return {
      time: left.time,
      open: safeClientSubtract(left.open, right.open),
      high: safeClientSubtract(left.high, right.low),
      low: safeClientSubtract(left.low, right.high),
      close: safeClientSubtract(left.close, right.close),
      volume: 0
    };
  }

  return {
    time: left.time,
    open: safeClientDivide(left.open, right.open),
    high: safeClientDivide(left.high, right.low),
    low: safeClientDivide(left.low, right.high),
    close: safeClientDivide(left.close, right.close),
    volume: 0
  };
}

function buildClientMinuteDailySyntheticCandles(leftCandles, rightCandles, mode) {
  const rightByTime = createLookup(rightCandles || []);
  const groups = new Map();

  for (const left of leftCandles || []) {
    const right = rightByTime.get(String(left.time));
    if (!right) continue;

    const dateKey = getChartDateKey(left.time);
    if (!dateKey) continue;

    const value = mode === 'subtract'
      ? safeClientSubtract(left.close, right.close)
      : safeClientDivide(left.close, right.close);
    if (!Number.isFinite(value)) continue;

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey).push({
      time: left.time,
      value
    });
  }

  return [...groups.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, rows]) => {
      const sorted = rows.sort((left, right) => compareChartTimes(left.time, right.time));
      const values = sorted.map((row) => row.value);
      return {
        time: date,
        open: values[0],
        high: Math.max(...values),
        low: Math.min(...values),
        close: values.at(-1),
        volume: 0
      };
    })
    .filter(isClientValidCandle);
}

function aggregateClientCandlesByDate(candles) {
  const groups = new Map();
  for (const candle of candles || []) {
    const dateKey = getChartDateKey(candle?.time);
    if (!dateKey) continue;
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey).push(candle);
  }

  return [...groups.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, rows]) => {
      const sorted = rows.sort((left, right) => compareChartTimes(left.time, right.time));
      const highs = sorted.map((row) => toFiniteNumber(row.high)).filter(Number.isFinite);
      const lows = sorted.map((row) => toFiniteNumber(row.low)).filter(Number.isFinite);
      return {
        ...sorted.at(-1),
        time: date,
        open: sorted[0].open,
        high: highs.length ? Math.max(...highs) : sorted[0].high,
        low: lows.length ? Math.min(...lows) : sorted[0].low,
        close: sorted.at(-1).close,
        volume: sorted.reduce((sum, row) => sum + (toFiniteNumber(row.volume) || 0), 0)
      };
    })
    .filter(isClientValidCandle);
}

function safeClientSubtract(left, right) {
  const leftValue = toFiniteNumber(left);
  const rightValue = toFiniteNumber(right);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) ? roundChartAdjustedPrice(leftValue - rightValue) : NaN;
}

function safeClientDivide(left, right) {
  const leftValue = toFiniteNumber(left);
  const rightValue = toFiniteNumber(right);
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) && rightValue !== 0
    ? roundChartAdjustedPrice(leftValue / rightValue)
    : NaN;
}

function isClientValidCandle(candle) {
  return (
    candle &&
    candle.time &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
}

function buildClientQuoteFromCandles(candles) {
  const last = candles?.at(-1);
  const previous = candles?.at(-2);
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

function replaceCompareMainSeries(payload, compareCandles, { interval, sourceName, comparePatch } = {}) {
  if (!payload || !Array.isArray(compareCandles) || !compareCandles.length) return payload;
  const seriesList = [
    compareCandles,
    payload.components?.[0]?.candles || [],
    payload.components?.[1]?.candles || []
  ];

  return {
    ...payload,
    interval: interval || payload.interval,
    quote: buildClientQuoteFromCandles(compareCandles),
    range: getClientCombinedSeriesRange(seriesList),
    sourceName: sourceName || payload.sourceName,
    compare: {
      ...payload.compare,
      ...(comparePatch || {})
    },
    series: {
      ...payload.series,
      raw: compareCandles
    }
  };
}

function buildInitialStrategyConfig({ enabled, side, leftLeverage, rightLeverage }) {
  if (!enabled) return null;

  return {
    side: normalizeStrategySide(side),
    leftLeverage: parseMultiplierInput(leftLeverage),
    rightLeverage: parseMultiplierInput(rightLeverage)
  };
}

function buildCompareStrategySeries(payload, config, anchorDateInput) {
  if (!payload || !config) return [];

  const leftCandles = payload.components?.[0]?.candles || [];
  const rightCandles = payload.components?.[1]?.candles || [];
  if (!leftCandles.length || !rightCandles.length) return [];

  const anchorDate = normalizeAdjustmentDateInput(anchorDateInput);
  if (!anchorDate) return [];

  const rightByTime = createLookup(rightCandles);
  const rows = leftCandles
    .map((left) => {
      const right = rightByTime.get(String(left.time));
      if (!right) return null;
      const dateKey = getChartDateKey(left.time);
      if (!dateKey) return null;
      return { time: left.time, left, right };
    })
    .filter(Boolean)
    .sort((left, right) => compareChartTimes(left.time, right.time));

  if (!rows.length) return [];

  const anchorRow = findCompareAnchorRow(rows, anchorDate);
  if (!anchorRow) return [];

  const leftBase = toFiniteNumber(anchorRow.left.close);
  const rightBase = toFiniteNumber(anchorRow.right.close);
  if (!Number.isFinite(leftBase) || !leftBase || !Number.isFinite(rightBase) || !rightBase) return [];

  const leftSign = normalizeStrategySide(config.side) === 'leftLong' ? 1 : -1;
  const rightSign = -leftSign;
  const leftLeverage = Number.isFinite(config.leftLeverage) ? config.leftLeverage : 1;
  const rightLeverage = Number.isFinite(config.rightLeverage) ? config.rightLeverage : 1;

  return rows
    .map((row) => {
      const leftClose = toFiniteNumber(row.left.close);
      const rightClose = toFiniteNumber(row.right.close);
      if (!Number.isFinite(leftClose) || !Number.isFinite(rightClose)) return null;

      const leftReturn = (leftClose / leftBase) - 1;
      const rightReturn = (rightClose / rightBase) - 1;
      const value = (leftReturn * leftSign * leftLeverage) + (rightReturn * rightSign * rightLeverage);

      return {
        time: row.time,
        open: roundChartAdjustedPrice(value),
        high: roundChartAdjustedPrice(value),
        low: roundChartAdjustedPrice(value),
        close: roundChartAdjustedPrice(value),
        volume: 0
      };
    })
    .filter(isClientValidCandle);
}

function findCompareAnchorRow(rows, anchorDate) {
  if (!anchorDate || !Array.isArray(rows) || !rows.length) return null;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const dateKey = getChartDateKey(row?.time);
    if (dateKey && dateKey <= anchorDate) {
      return row;
    }
  }

  return null;
}

function buildStrategyLabel(payload, config) {
  if (!config) return '多空组合';

  const leftLabel = payload?.components?.[0]?.displayName || '左边';
  const rightLabel = payload?.components?.[1]?.displayName || '右边';
  const leftLong = normalizeStrategySide(config.side) === 'leftLong';
  const leftAction = leftLong ? '多' : '空';
  const rightAction = leftLong ? '空' : '多';
  return `${leftAction}${formatMetricScaleDisplay(config.leftLeverage)} ${leftLabel} / ${rightAction}${formatMetricScaleDisplay(config.rightLeverage)} ${rightLabel}`;
}

function normalizeStrategySide(value) {
  return value === 'rightLong' ? 'rightLong' : 'leftLong';
}

function getClientCombinedSeriesRange(seriesList) {
  const times = seriesList.flat().map((item) => item?.time).filter(Boolean);
  if (!times.length) return { start: '--', end: '--' };

  const sorted = [...times].sort(compareChartTimes);

  return {
    start: formatTime(sorted[0]) || '--',
    end: formatTime(sorted.at(-1)) || '--'
  };
}

function buildAnchoredComparePayload(payload, { enabled, dateInput }) {
  if (!payload || !enabled) return { payload, meta: null };

  const anchorDate = normalizeAdjustmentDateInput(dateInput);
  const mode = parseCompareMode(payload?.compare?.mode);
  const rawCandles = payload?.series?.raw || [];
  const anchor = findCompareAnchorCandle(rawCandles, anchorDate);
  const anchorValue = toFiniteNumber(anchor?.close);

  if (!anchorDate || !anchor || !Number.isFinite(anchorValue) || (mode === 'divide' && anchorValue === 0)) {
    return { payload, meta: null };
  }

  const adjustedRaw = rawCandles.map((candle) => applyCompareAnchorAdjustment(candle, mode, anchorValue));
  const latest = adjustedRaw.at(-1) || null;
  const previous = adjustedRaw.at(-2) || null;
  const change = latest && previous ? latest.close - previous.close : null;
  const changeRate = previous?.close ? (change / previous.close) * 100 : null;

  return {
    payload: {
      ...payload,
      quote: {
        ...payload.quote,
        price: latest?.close ?? payload.quote?.price,
        change,
        changeRate
      },
      sourceName: `${payload.sourceName || ''} · ${formatTime(anchor.time)} 归一`,
      series: {
        ...payload.series,
        raw: adjustedRaw
      }
    },
    meta: {
      mode,
      anchorDate,
      anchorTime: anchor.time,
      anchorValue
    }
  };
}

function findCompareAnchorCandle(candles, dateKey) {
  if (!dateKey || !Array.isArray(candles) || !candles.length) return null;

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const candleDate = getChartDateKey(candle?.time);
    if (candleDate && candleDate <= dateKey && Number.isFinite(toFiniteNumber(candle?.close))) {
      return candle;
    }
  }

  return null;
}

function applyCompareAnchorAdjustment(candle, mode, anchorValue) {
  const transform = (value) => {
    const number = toFiniteNumber(value);
    if (!Number.isFinite(number)) return value;
    if (mode === 'subtract') return roundChartAdjustedPrice(number - anchorValue);
    return roundChartAdjustedPrice(number / anchorValue);
  };

  const open = transform(candle.open);
  const high = transform(candle.high);
  const low = transform(candle.low);
  const close = transform(candle.close);
  const prices = [open, high, low, close].filter(Number.isFinite);

  return {
    ...candle,
    open,
    high: prices.length ? Math.max(...prices) : high,
    low: prices.length ? Math.min(...prices) : low,
    close
  };
}

function buildMidAdjustedSeries(rawCandles, qfqCandles, hfqCandles, pivotDateInput, instrumentType) {
  const pivotDate = normalizeAdjustmentDateInput(pivotDateInput);
  if (
    !pivotDate ||
    !Array.isArray(rawCandles) ||
    !Array.isArray(qfqCandles) ||
    !Array.isArray(hfqCandles) ||
    !rawCandles.length ||
    !qfqCandles.length ||
    !hfqCandles.length
  ) {
    return [];
  }

  const hfqByTime = createLookup(hfqCandles);
  const qfqByTime = createLookup(qfqCandles);
  const rows = rawCandles
    .map((raw) => {
      const dateKey = getChartDateKey(raw?.time);
      const qfq = qfqByTime.get(String(raw?.time));
      const hfq = hfqByTime.get(String(raw?.time));
      if (!dateKey || !qfq || !hfq) return null;
      return { dateKey, raw, qfq, hfq };
    })
    .filter(Boolean);

  if (!rows.length) return [];

  const pivotRow = findPivotAdjustmentRow(rows, pivotDate);
  if (!pivotRow) return [];

  const additive = instrumentType === 'FUTURE';
  const qfqBasis = getMiddleAdjustmentBasis(pivotRow.raw, pivotRow.qfq, additive);
  const hfqBasis = getMiddleAdjustmentBasis(pivotRow.raw, pivotRow.hfq, additive);

  return rows.map((row) => {
    const useQfq = row.dateKey <= pivotDate;
    return applyMiddleAdjustment(row.raw, useQfq ? row.qfq : row.hfq, useQfq ? qfqBasis : hfqBasis, additive);
  });
}

function findPivotAdjustmentRow(rows, pivotDate) {
  const before = [...rows].reverse().find((row) => row.dateKey <= pivotDate);
  return before || rows[0] || null;
}

function getMiddleAdjustmentBasis(raw, adjusted, additive) {
  const rawClose = toFiniteNumber(raw?.close);
  const adjustedClose = toFiniteNumber(adjusted?.close);
  if (!Number.isFinite(rawClose) || !Number.isFinite(adjustedClose)) return additive ? 0 : 1;

  if (additive) {
    return adjustedClose - rawClose;
  }

  if (!rawClose) return 1;
  const basis = adjustedClose / rawClose;
  return Number.isFinite(basis) && basis > 0 ? basis : 1;
}

function applyMiddleAdjustment(raw, adjusted, basis, additive) {
  const adjustPrice = (value) => {
    const number = toFiniteNumber(value);
    if (!Number.isFinite(number)) return value;
    if (additive) return roundChartAdjustedPrice(number - (Number.isFinite(basis) ? basis : 0));
    const normalizedBasis = Number.isFinite(basis) && basis > 0 ? basis : 1;
    return roundChartAdjustedPrice(number / normalizedBasis);
  };

  return {
    ...adjusted,
    time: raw.time,
    open: adjustPrice(adjusted.open),
    high: adjustPrice(adjusted.high),
    low: adjustPrice(adjusted.low),
    close: adjustPrice(adjusted.close),
    volume: raw.volume ?? adjusted.volume
  };
}

function roundChartAdjustedPrice(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(6));
}

function normalizeCompactDateInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function normalizeAdjustmentDateInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const dashed = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = dashed || compact;
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return '';

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';

  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function getChartDateKey(time) {
  if (!time) return '';

  if (typeof time === 'object' && Number.isFinite(time.year) && Number.isFinite(time.month) && Number.isFinite(time.day)) {
    return `${time.year}-${padDatePart(time.month)}-${padDatePart(time.day)}`;
  }

  if (typeof time === 'number') {
    return formatLocalDateKey(new Date(time * 1000));
  }

  const text = String(time).trim();
  const dashed = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatLocalDateKey(parsed);
}

function formatLocalDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function toLineData(candles) {
  return candles.map((item) => ({ time: item.time, value: item.close }));
}

function getLegendSnapshot(tooltip, payload, midAdjustedSeries = EMPTY_SERIES, strategySeries = EMPTY_SERIES) {
  if (tooltip?.visible) return tooltip;

  const time =
    payload?.series?.raw?.at(-1)?.time ||
    payload?.series?.qfq?.at(-1)?.time ||
    payload?.series?.hfq?.at(-1)?.time ||
    midAdjustedSeries?.at(-1)?.time ||
    payload?.components?.[0]?.candles?.at(-1)?.time ||
    payload?.components?.[1]?.candles?.at(-1)?.time ||
    strategySeries?.at(-1)?.time ||
    null;

  return {
    visible: false,
    time,
    raw: payload?.series?.raw?.at(-1) || null,
    qfq: payload?.series?.qfq?.at(-1) || null,
    hfq: payload?.series?.hfq?.at(-1) || null,
    mid: midAdjustedSeries?.at(-1) || null,
    left: payload?.components?.[0]?.candles?.at(-1) || null,
    right: payload?.components?.[1]?.candles?.at(-1) || null,
    strategy: strategySeries?.at(-1) || null,
    rollover: findRolloverByTime(payload?.rollovers || [], time),
    rolloverContext: payload?.series?.raw?.at(-1)?.rolloverContext || null
  };
}

function findRolloverByTime(rollovers, time) {
  if (!time) return null;
  return (rollovers || []).find((event) => String(event.markerTime) === String(time)) || null;
}

function formatQuotePrice(value, instrumentType) {
  if (!Number.isFinite(value)) return '--';
  if (instrumentType === 'RATIO') {
    return formatRatioValue(value);
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 3 : 6,
    maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 3 : 6
  }).format(value);
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${formatCompact(value, { maximumFractionDigits: Math.abs(value) >= 1000 ? 2 : 4 })}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function toneClass(value) {
  if (!Number.isFinite(value)) return '';
  return value >= 0 ? 'positive' : 'negative';
}

function formatTableTime(value) {
  if (!value) return '--';
  return typeof value === 'number'
    ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false })
    : String(value).replace('T', ' ');
}

function formatTime(value) {
  return formatChartAxisTime(value);
}

function formatChartAxisTime(value) {
  if (!value) return '--';

  if (typeof value === 'object' && Number.isFinite(value.year) && Number.isFinite(value.month) && Number.isFinite(value.day)) {
    return `${value.year}/${padDatePart(value.month)}/${padDatePart(value.day)}`;
  }

  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) return '--';
    return formatSlashDateTime(date);
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (match) {
    const dateText = `${match[1]}/${padDatePart(match[2])}/${padDatePart(match[3])}`;
    return match[4] ? `${dateText} ${padDatePart(match[4])}:${match[5]}` : dateText;
  }

  return text.replace('T', ' ');
}

function formatSlashDateTime(date) {
  const dateText = `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return dateText;
  }
  return `${dateText} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function toFiniteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function formatPriceValue(value, instrumentType) {
  if (!Number.isFinite(value)) return '--';
  if (instrumentType === 'PERCENT_POINT') {
    return formatPercentPointValue(value);
  }
  if (instrumentType === 'RETURN_DECIMAL') {
    return formatStrategyReturnValue(value);
  }
  if (instrumentType === 'RATIO') {
    return formatRatioValue(value);
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(value);
}

function formatPercentPointValue(value) {
  if (!Number.isFinite(value)) return '--';
  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)}%`;
}

function formatStrategyReturnValue(value) {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(value);
}

function getSeriesPriceFormat(instrumentType, candles) {
  if (instrumentType === 'RATIO') {
    return {
      type: 'custom',
      formatter: (price) => formatRatioValue(price),
      minMove: 0.00000001
    };
  }

  const sample = candles?.at(-1)?.close;
  const precision = !Number.isFinite(sample)
    ? 2
    : sample >= 1000
      ? 2
      : sample >= 1
        ? 3
        : sample >= 0.1
          ? 4
          : 6;

  return {
    type: 'price',
    precision,
    minMove: 1 / (10 ** precision)
  };
}

function getLeftAxisOptions(payload) {
  if (payload?.compare) {
    return {
      borderColor: '#0f8f72',
      scaleMargins: { top: 0.12, bottom: 0.12 }
    };
  }

  return {
    borderColor: '#7c3aed',
    scaleMargins: { top: 0.12, bottom: 0.12 }
  };
}

function isLeftAxisVisible(payload, selectedMetricKeys = [], strategySeries = EMPTY_SERIES, showRaw = true) {
  if (payload?.compare && showRaw) return true;
  if (strategySeries?.length) return true;

  const metricRows = payload?.fundamentals?.rows || [];
  const metricDefs = payload?.fundamentals?.metrics || [];
  return metricDefs.some((metric) => selectedMetricKeys.includes(metric.key) && hasMetricData(metricRows, metric.key));
}

function getPercentSeriesPriceFormat() {
  return {
    type: 'custom',
    formatter: (price) => formatPercentPointValue(price),
    minMove: 0.01
  };
}

function getStrategyReturnSeriesPriceFormat() {
  return {
    type: 'custom',
    formatter: (price) => formatStrategyReturnValue(price),
    minMove: 0.0001
  };
}

function formatRatioValue(value) {
  return new Intl.NumberFormat('zh-CN', {
    minimumSignificantDigits: 5,
    maximumSignificantDigits: 5,
    useGrouping: false
  }).format(value);
}

function buildRolloverMarkers(rollovers) {
  return (rollovers || [])
    .filter((event) => event?.markerTime != null)
    .flatMap((event) => ([
      {
        time: event.markerTime,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: '#7c3aed',
        text: event.markerText || `${event.fromMonthLabel}→${event.toMonthLabel}`
      },
      {
        time: event.markerTime,
        position: 'inBar',
        shape: 'circle',
        color: '#f59e0b',
        text: '换季'
      }
    ]));
}

function applyDefaultVisibleRange(chart, intervalKey, candles, instrumentType) {
  if (!chart || !Array.isArray(candles) || !candles.length) return;

  const visibleBars = getDefaultVisibleBars(intervalKey, instrumentType);
  const logicalTo = candles.length + 2;
  const logicalFrom = Math.max(0, candles.length - visibleBars);

  if (instrumentType === 'FUTURE') {
    chart.timeScale().setVisibleLogicalRange({ from: logicalFrom, to: logicalTo });
    return;
  }

  const fromIndex = Math.max(0, candles.length - visibleBars);
  const from = normalizeVisibleRangeTime(candles[fromIndex]?.time);
  const to = normalizeVisibleRangeTime(candles.at(-1)?.time);

  if (from && to) {
    chart.timeScale().setVisibleRange({ from, to });
    return;
  }

  chart.timeScale().setVisibleLogicalRange({ from: logicalFrom, to: logicalTo });
}

function normalizeVisibleRangeTime(time) {
  if (typeof time === 'number') return time;
  if (typeof time !== 'string') return null;

  const match = time.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return time;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function getDefaultVisibleBars(intervalKey, instrumentType) {
  if (instrumentType === 'FUTURE') {
    if (intervalKey === 'day') return 260;
    if (intervalKey === 'week') return 52;
    if (intervalKey === 'month') return 12;
  }
  if (intervalKey === '1m') return 240;
  if (intervalKey === '15m') return 120;
  if (intervalKey === '1h') return 160;
  if (intervalKey === '4h') return 180;
  if (intervalKey === 'week') return 160;
  if (intervalKey === 'month') return 120;
  return 240;
}

function getDefaultVisibleBarsLabel(intervalKey, instrumentType) {
  const bars = getDefaultVisibleBars(intervalKey, instrumentType);
  return `${bars} 根K线`;
}

function getIntervalOptionLabel(intervalKey) {
  return INTERVAL_OPTIONS.find((option) => option.key === intervalKey)?.label || 'K线';
}

function parseCompareMode(mode) {
  if (mode === 'subtract') return 'subtract';
  return 'divide';
}

function getCompareOperator(mode) {
  if (mode === 'subtract') return '-';
  return '/';
}

function getCompareModeLabel(mode) {
  if (mode === 'subtract') return '减法';
  return '除法';
}

function getCompareFavoriteTypeLabel(mode) {
  if (mode === 'divide') return '汇率';
  return '减法对比';
}

function getCompareSeriesLabel(mode) {
  if (mode === 'divide') return '汇率';
  return '差线';
}

function getCompareModeDescription(mode) {
  if (mode === 'subtract') {
    return '减法模式显示左侧减右侧的价差';
  }

  return '除法模式显示左侧除右侧的比值';
}

function normalizeCompareAdjustmentMode(mode) {
  if (mode === 'raw' || mode === 'hfq') return mode;
  return 'qfq';
}

function getCompareAdjustmentLabel(mode) {
  return COMPARE_ADJUSTMENT_OPTIONS.find((option) => option.key === normalizeCompareAdjustmentMode(mode))?.label || '前复权';
}

function buildHoverGuides({
  payload,
  tooltip,
  chartMode,
  rawChartMode,
  showRaw,
  showQfq,
  showHfq,
  showMidAdjust,
  showLeftComponent,
  showRightComponent,
  selectedMetricKeys,
  metricScaleByKey,
  strategySeries,
  seriesState
}) {
  if (!payload || !tooltip?.visible || !tooltip?.time || !seriesState) return [];

  const guides = [];
  const pushGuide = ({ key, series, value, valueText, color, axisSide = 'right' }) => {
    if (!series || !Number.isFinite(value)) return;
    const y = series.priceToCoordinate(value);
    if (!Number.isFinite(y)) return;
    guides.push({
      key,
      y,
      valueText,
      color,
      axisSide
    });
  };

  if (showRaw && tooltip.raw) {
    const rawValue = toFiniteNumber(tooltip.raw.close);
    const mainChartMode = rawChartMode || chartMode;
    const comparePayload = Boolean(payload?.compare);
    const rawSeries = mainChartMode === 'line'
      ? (comparePayload ? seriesState.compareRawLineSeries : seriesState.rawLineSeries)
      : (comparePayload ? seriesState.compareRawSeries : seriesState.rawSeries);
    pushGuide({
      key: 'raw',
      series: rawSeries,
      value: rawValue,
      valueText: formatPriceValue(rawValue, payload.instrument?.type),
      color: getGuideColor('raw', tooltip.raw, mainChartMode),
      axisSide: comparePayload ? 'left' : 'right'
    });
  }

  if (showQfq && tooltip.qfq) {
    const qfqValue = toFiniteNumber(tooltip.qfq.close);
    pushGuide({
      key: 'qfq',
      series: seriesState.qfqSeries,
      value: qfqValue,
      valueText: formatPriceValue(qfqValue, payload.instrument?.type),
      color: getGuideColor('qfq')
    });
  }

  if (showHfq && tooltip.hfq) {
    const hfqValue = toFiniteNumber(tooltip.hfq.close);
    pushGuide({
      key: 'hfq',
      series: seriesState.hfqSeries,
      value: hfqValue,
      valueText: formatPriceValue(hfqValue, payload.instrument?.type),
      color: getGuideColor('hfq')
    });
  }

  if (showMidAdjust && tooltip.mid) {
    const midValue = toFiniteNumber(tooltip.mid.close);
    pushGuide({
      key: 'mid',
      series: seriesState.midAdjustSeries,
      value: midValue,
      valueText: formatPriceValue(midValue, payload.instrument?.type),
      color: getGuideColor('mid')
    });
  }

  if (showLeftComponent && tooltip.left) {
    const leftValue = toFiniteNumber(tooltip.left.close);
    const leftSeries = chartMode === 'line' ? seriesState.leftComponentLineSeries : seriesState.leftComponentSeries;
    pushGuide({
      key: 'left',
      series: leftSeries,
      value: leftValue,
      valueText: formatPriceValue(leftValue, payload?.compare?.left?.type),
      color: getGuideColor('left-component', tooltip.left, chartMode)
    });
  }

  if (showRightComponent && tooltip.right) {
    const rightValue = toFiniteNumber(tooltip.right.close);
    const rightSeries = chartMode === 'line' ? seriesState.rightComponentLineSeries : seriesState.rightComponentSeries;
    pushGuide({
      key: 'right',
      series: rightSeries,
      value: rightValue,
      valueText: formatPriceValue(rightValue, payload?.compare?.right?.type),
      color: getGuideColor('right-component', tooltip.right, chartMode)
    });
  }

  if (strategySeries?.length && tooltip.strategy) {
    const strategyValue = toFiniteNumber(tooltip.strategy.close);
    pushGuide({
      key: 'strategy',
      series: seriesState.strategyLineSeries,
      value: strategyValue,
      valueText: formatStrategyReturnValue(strategyValue),
      color: getGuideColor('strategy'),
      axisSide: 'left'
    });
  }

  const metricSeriesMap = seriesState.metricSeriesMap;
  if (metricSeriesMap?.size && selectedMetricKeys?.length) {
    const metricRow = getFundamentalRow(payload?.fundamentals?.rows, tooltip.time);
    for (const metric of payload?.fundamentals?.metrics || []) {
      if (!selectedMetricKeys.includes(metric.key)) continue;
      const metricScale = metricScaleByKey?.[metric.key] ?? 1;
      const metricValue = toFiniteNumber(metricRow?.[metric.key]) * metricScale;
      pushGuide({
        key: `metric-${metric.key}`,
        series: metricSeriesMap.get(metric.key),
        value: metricValue,
        valueText: formatMetricValue(metricValue, metric.format),
        color: metric.color,
        axisSide: 'left'
      });
    }
  }

  return guides.sort((left, right) => left.y - right.y);
}

function getGuideColor(tone, candle = null, chartMode = 'candles') {
  if (tone === 'raw') {
    if (chartMode === 'candles' && candle) {
      return getCandleChangeRate(candle) >= 0 ? '#0f8f72' : '#cf3f35';
    }
    return '#0f8f72';
  }

  if (tone === 'qfq') return '#206fb1';
  if (tone === 'hfq') return '#9b6b10';
  if (tone === 'mid') return '#7c3aed';
  if (tone === 'strategy') return '#db2777';

  if (tone === 'left-component') {
    if (chartMode === 'candles' && candle) {
      return getCandleChangeRate(candle) >= 0 ? '#206fb1' : '#ba5624';
    }
    return '#206fb1';
  }

  if (tone === 'right-component') {
    if (chartMode === 'candles' && candle) {
      return getCandleChangeRate(candle) >= 0 ? '#9b6b10' : '#5b6674';
    }
    return '#9b6b10';
  }

  return '#334155';
}

function getFundamentalRow(rows, time) {
  if (!Array.isArray(rows) || !rows.length || !time) return rows?.at(-1) || null;
  return rows.find((row) => String(row.time) === String(time)) || rows.at(-1) || null;
}

function hasMetricData(rows, key) {
  return Array.isArray(rows) && rows.some((row) => Number.isFinite(row?.[key]));
}

function toMetricLineData(rows, key, scale = 1) {
  return (rows || [])
    .filter((row) => Number.isFinite(row?.[key]))
    .map((row) => ({
      time: row.time,
      value: row[key] * scale
    }));
}

function getMetricSeriesPriceFormat(format) {
  if (format === 'percent') {
    return {
      type: 'price',
      precision: 4,
      minMove: 0.0001
    };
  }

  if (format === 'ratio') {
    return {
      type: 'price',
      precision: 4,
      minMove: 0.0001
    };
  }

  return {
    type: 'price',
    precision: 2,
    minMove: 0.01
  };
}

function parseMetricScaleInput(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 1;
  const number = Number(value);
  return Number.isFinite(number) ? number : 1;
}

function formatMetricScaleDisplay(value) {
  if (!Number.isFinite(value)) return '1';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 6,
    useGrouping: false
  }).format(value);
}

function formatMetricValue(value, format) {
  if (!Number.isFinite(value)) return '--';

  if (format === 'percent') {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (format === 'ratio') {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3
    }).format(value);
  }

  return formatAmountWithYi(value);
}

function formatShareCapital(value) {
  if (!Number.isFinite(value)) return '--';
  return `${formatYiNumber(value)}亿`;
}

function formatAmountWithYi(value) {
  if (!Number.isFinite(value)) return '--';
  return `${formatYiNumber(value)}亿`;
}

function formatYiNumber(value) {
  const yi = value / 1e8;
  const digits = Math.abs(yi) >= 1000 ? 0 : Math.abs(yi) >= 100 ? 1 : 2;
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(yi);
}

export default App;
