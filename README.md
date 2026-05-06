# 多市场 K 线观察台

Vite + React + lightweight-charts 的多品种看盘面板。

- 行情与 K 线主数据源：`miana`
- 币圈补充数据源：`Binance`
- 美股指数补充数据源：`Yahoo Finance`
- A 股财务指标 fallback：`Tushare`
- 国内期货增强数据源：`TqSdk`

当前股票详情页会优先使用 `miana` 的财务接口；如果利润表或营业收入历史缺失，会自动回退到 `Tushare` 的财报接口补齐历史序列。这样像银行股这类 `miana` 财务覆盖不完整的标的，也能把 `TTM 利润 / TTM 营收 / 增长率 / 利润率` 这些历史曲线补出来。

当配置了 `TQSDK_USER / TQSDK_PASSWORD` 后，国内期货会优先通过 `TqSdk` 拉取：

- 实时行情
- 当前合约 K 线
- 主连所需的分月合约列表与历史 K 线

这样像郑商所棉花、广期所碳酸锂这类品种，就不再受 `miana` 对历史分月合约覆盖不足的限制。

## 启动

```bash
npm install
npm run dev
```

前端地址：http://localhost:5173

API 健康检查：http://localhost:8787/api/health

## 环境变量

复制 `.env.example` 到 `.env` 后按需填写：

```bash
MIANA_API_KEY=...
TUSHARE_API_TOKEN=...
TQSDK_USER=...
TQSDK_PASSWORD=...
API_PORT=8787
```

`TUSHARE_API_TOKEN` 不填也能运行；只是当 `miana` 某些股票财务接口为空时，历史财务曲线会缺失，只能补当前快照。

`TQSDK_USER / TQSDK_PASSWORD` 不填也能运行；只是国内期货会退回现有的 `miana` 数据链路。要启用 TqSdk，使用的是快期账号密码，常见只读接法是 `TqApi(auth=TqAuth(...))`，不需要额外指定实盘账户类。
