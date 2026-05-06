#!/usr/bin/env python3

import contextlib
import csv
import io
import json
import math
import os
import sys
import tempfile
import time
import warnings
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

SILENT = io.StringIO()
with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
    from tqsdk import TqApi, TqAuth
    from tqsdk.tools import DataDownloader


def fail(message, code=1):
    sys.stdout.write(json.dumps({"ok": False, "message": message}, ensure_ascii=False))
    sys.exit(code)


def load_payload():
    if len(sys.argv) < 2:
        fail("缺少命令")
    command = sys.argv[1]
    raw_payload = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        fail(f"参数不是合法 JSON: {exc}")
    return command, payload


def get_auth():
    user = (os.environ.get("TQSDK_USER") or "").strip()
    password = (os.environ.get("TQSDK_PASSWORD") or "").strip()
    if not user or not password:
        fail("未配置 TQSDK_USER 或 TQSDK_PASSWORD")
    return user, password


def create_api():
    user, password = get_auth()
    return TqApi(auth=TqAuth(user, password), disable_print=True)


def wait_briefly(api, rounds=1, timeout_seconds=8):
    deadline = time.time() + timeout_seconds
    for _ in range(rounds):
        if time.time() >= deadline:
            break
        api.wait_update(deadline=deadline)


def to_epoch_seconds(value):
    number = to_number(value)
    if not math.isfinite(number) or number <= 0:
        return None
    return int(number / 1_000_000_000)


def to_date_text(value):
    epoch_seconds = to_epoch_seconds(value)
    if epoch_seconds is None:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(epoch_seconds + 8 * 3600))


def to_number(value):
    try:
        return float(value)
    except Exception:
        return float("nan")


def normalize_quote(quote):
    return {
        "symbol": getattr(quote, "instrument_id", None),
        "instrument_id": getattr(quote, "instrument_id", None),
        "instrument_name": getattr(quote, "instrument_name", None),
        "exchange_id": getattr(quote, "exchange_id", None),
        "product_id": getattr(quote, "product_id", None),
        "datetime": getattr(quote, "datetime", None),
        "last_price": to_nullable_number(getattr(quote, "last_price", None)),
        "ask_price1": to_nullable_number(getattr(quote, "ask_price1", None)),
        "bid_price1": to_nullable_number(getattr(quote, "bid_price1", None)),
        "open": to_nullable_number(getattr(quote, "open", None)),
        "highest": to_nullable_number(getattr(quote, "highest", None)),
        "lowest": to_nullable_number(getattr(quote, "lowest", None)),
        "pre_close": to_nullable_number(getattr(quote, "pre_close", None)),
        "volume": to_nullable_number(getattr(quote, "volume", None)),
        "open_interest": to_nullable_number(getattr(quote, "open_interest", None)),
        "price_tick": to_nullable_number(getattr(quote, "price_tick", None)),
        "volume_multiple": to_nullable_number(getattr(quote, "volume_multiple", None)),
        "expired": bool(getattr(quote, "expired", False)),
    }


def to_nullable_number(value):
    number = to_number(value)
    return number if math.isfinite(number) else None


def normalize_kline_frame(frame, intraday):
    rows = []
    if frame is None:
        return rows

    for _, row in frame.iterrows():
        dt_value = to_number(row.get("datetime"))
        open_price = to_number(row.get("open"))
        high_price = to_number(row.get("high"))
        low_price = to_number(row.get("low"))
        close_price = to_number(row.get("close"))

        if not math.isfinite(dt_value) or dt_value <= 0:
            continue
        if not all(math.isfinite(value) for value in [open_price, high_price, low_price, close_price]):
            continue

        rows.append({
            "time": to_epoch_seconds(dt_value) if intraday else to_date_text(dt_value),
            "datetime": int(dt_value),
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": to_nullable_number(row.get("volume")),
            "open_oi": to_nullable_number(row.get("open_oi")),
            "close_oi": to_nullable_number(row.get("close_oi")),
        })

    return rows


def local_date_from_tq_datetime(value):
    epoch_seconds = to_epoch_seconds(value)
    if epoch_seconds is None:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(epoch_seconds + 8 * 3600))


def average_kline_midpoint(rows):
    values = []
    for row in rows:
        high_value = to_number(row.get("high"))
        low_value = to_number(row.get("low"))
        if not math.isfinite(high_value) or not math.isfinite(low_value):
            continue
        values.append((high_value + low_value) / 2)

    if not values:
        return None
    return sum(values) / len(values)


def parse_trade_date(value):
    if not value:
        fail("缺少 trade_date")
    try:
        return datetime.strptime(str(value), "%Y-%m-%d")
    except ValueError:
        fail("trade_date 必须是 YYYY-MM-DD")


def pick_csv_field(row, plain_name, suffix):
    if plain_name in row:
        return row.get(plain_name)
    for key, value in row.items():
        if key.endswith(suffix):
            return value
    return None


def read_downloader_midpoint_average(path):
    values = []
    first_time = None
    last_time = None

    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            high_value = to_number(pick_csv_field(row, "high", ".high"))
            low_value = to_number(pick_csv_field(row, "low", ".low"))
            if not math.isfinite(high_value) or not math.isfinite(low_value):
                continue

            values.append((high_value + low_value) / 2)
            row_time = row.get("datetime") or row.get("datetime_nano")
            first_time = first_time or row_time
            last_time = row_time

    if not values:
        return None, 0, None, None
    return sum(values) / len(values), len(values), first_time, last_time


def quote_ready(quote):
    return bool(getattr(quote, "datetime", None))


def frame_ready(frame):
    rows = normalize_kline_frame(frame, intraday=False)
    return bool(rows)


def cmd_quotes(payload):
    symbols = payload.get("symbols") or []
    if not symbols:
        return {"ok": True, "quotes": []}

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        try:
            quotes = [api.get_quote(symbol) for symbol in symbols]
            deadline = time.time() + 8
            while time.time() < deadline:
                api.wait_update(deadline=deadline)
                if all(quote_ready(quote) for quote in quotes):
                    break
            rows = [normalize_quote(quote) for quote in quotes]
            return {"ok": True, "quotes": rows}
        finally:
            api.close()


def cmd_kline(payload):
    symbol = payload.get("symbol")
    duration_seconds = int(payload.get("duration_seconds") or 0)
    data_length = int(payload.get("data_length") or 200)
    intraday = bool(payload.get("intraday"))

    if not symbol:
        fail("缺少 symbol")
    if duration_seconds <= 0:
        fail("duration_seconds 必须大于 0")

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        try:
            frame = api.get_kline_serial(symbol, duration_seconds, data_length=data_length)
            rows = normalize_kline_frame(frame, intraday=intraday)
            return {
                "ok": True,
                "symbol": symbol,
                "duration_seconds": duration_seconds,
                "rows": rows
            }
        finally:
            api.close()


def cmd_klines(payload):
    symbols = payload.get("symbols") or []
    duration_seconds = int(payload.get("duration_seconds") or 0)
    data_length = int(payload.get("data_length") or 200)
    intraday = bool(payload.get("intraday"))

    if not symbols:
        return {"ok": True, "rows_by_symbol": {}}
    if duration_seconds <= 0:
        fail("duration_seconds 必须大于 0")

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        try:
            rows_by_symbol = {}
            for symbol in symbols:
                frame = api.get_kline_serial(symbol, duration_seconds, data_length=data_length)
                rows_by_symbol[symbol] = normalize_kline_frame(frame, intraday=intraday)
            return {
                "ok": True,
                "rows_by_symbol": rows_by_symbol
            }
        finally:
            api.close()


def cmd_day_kline_average(payload):
    symbol = payload.get("symbol")
    trade_date = parse_trade_date(payload.get("trade_date"))
    duration_seconds = int(payload.get("duration_seconds") or 60)
    timeout_seconds = int(payload.get("timeout_seconds") or 120)

    if not symbol:
        fail("缺少 symbol")
    if duration_seconds <= 0:
        fail("duration_seconds 必须大于 0")

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        temp_file = tempfile.NamedTemporaryFile(prefix="tqsdk-day-kline-average-", suffix=".csv", delete=False)
        temp_path = temp_file.name
        temp_file.close()
        try:
            task = DataDownloader(
                api,
                symbol_list=symbol,
                dur_sec=duration_seconds,
                start_dt=trade_date,
                end_dt=trade_date + timedelta(days=1),
                csv_file_name=temp_path,
            )

            deadline = time.time() + timeout_seconds
            while not task.is_finished():
                if time.time() >= deadline:
                    fail("TqSdk 下载指定日期分K超时")
                api.wait_update(deadline=deadline)
            average, rows, first_time, last_time = read_downloader_midpoint_average(temp_path)

            return {
                "ok": True,
                "symbol": symbol,
                "trade_date": trade_date.date().isoformat(),
                "duration_seconds": duration_seconds,
                "rows": rows,
                "average": average,
                "first_time": first_time,
                "last_time": last_time,
            }
        finally:
            api.close()
            with contextlib.suppress(Exception):
                os.remove(temp_path)


def cmd_day_kline_averages(payload):
    requests = payload.get("requests") or []
    timeout_seconds = int(payload.get("timeout_seconds") or 180)
    if not requests:
        return {"ok": True, "results": {}}

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        entries = []
        try:
            for index, request in enumerate(requests):
                symbol = request.get("symbol")
                trade_date = parse_trade_date(request.get("trade_date"))
                duration_seconds = int(request.get("duration_seconds") or 60)
                key = request.get("key") or f"{symbol}:{trade_date.date().isoformat()}:{duration_seconds}:{index}"
                temp_file = tempfile.NamedTemporaryFile(prefix="tqsdk-day-kline-average-", suffix=".csv", delete=False)
                temp_path = temp_file.name
                temp_file.close()
                task = DataDownloader(
                    api,
                    symbol_list=symbol,
                    dur_sec=duration_seconds,
                    start_dt=trade_date,
                    end_dt=trade_date + timedelta(days=1),
                    csv_file_name=temp_path,
                )
                entries.append({
                    "key": key,
                    "symbol": symbol,
                    "trade_date": trade_date.date().isoformat(),
                    "duration_seconds": duration_seconds,
                    "path": temp_path,
                    "task": task,
                })

            deadline = time.time() + timeout_seconds
            while not all(entry["task"].is_finished() for entry in entries):
                if time.time() >= deadline:
                    fail("TqSdk 批量下载指定日期分K超时")
                api.wait_update(deadline=deadline)

            results = {}
            for entry in entries:
                average, rows, first_time, last_time = read_downloader_midpoint_average(entry["path"])
                results[entry["key"]] = {
                    "symbol": entry["symbol"],
                    "trade_date": entry["trade_date"],
                    "duration_seconds": entry["duration_seconds"],
                    "rows": rows,
                    "average": average,
                    "first_time": first_time,
                    "last_time": last_time,
                }

            return {
                "ok": True,
                "results": results,
            }
        finally:
            api.close()
            for entry in entries:
                with contextlib.suppress(Exception):
                    os.remove(entry["path"])


def cmd_contracts(payload):
    exchange_id = payload.get("exchange_id")
    product_id = payload.get("product_id")
    expired = payload.get("expired")
    if not exchange_id or not product_id:
        fail("缺少 exchange_id 或 product_id")

    with contextlib.redirect_stdout(SILENT), contextlib.redirect_stderr(SILENT):
        api = create_api()
        try:
            symbols = list(
                api.query_quotes(
                    ins_class="FUTURE",
                    exchange_id=exchange_id,
                    product_id=product_id,
                    expired=expired
                )
            )
            info = api.query_symbol_info(symbols) if symbols else None
            rows = []
            if info is not None:
                for _, row in info.iterrows():
                    rows.append({
                        "symbol": row.get("instrument_id"),
                        "instrument_id": row.get("instrument_id"),
                        "instrument_name": row.get("instrument_name"),
                        "exchange_id": row.get("exchange_id"),
                        "product_id": row.get("product_id"),
                        "expired": bool(row.get("expired", False)),
                        "price_tick": to_nullable_number(row.get("price_tick")),
                        "volume_multiple": to_nullable_number(row.get("volume_multiple")),
                        "delivery_year": to_nullable_number(row.get("delivery_year")),
                        "delivery_month": to_nullable_number(row.get("delivery_month")),
                        "ins_class": row.get("ins_class"),
                    })

            return {
                "ok": True,
                "exchange_id": exchange_id,
                "product_id": product_id,
                "contracts": rows
            }
        finally:
            api.close()


def main():
    command, payload = load_payload()
    commands = {
        "quotes": cmd_quotes,
        "kline": cmd_kline,
        "klines": cmd_klines,
        "contracts": cmd_contracts,
        "day_kline_average": cmd_day_kline_average,
        "day_kline_averages": cmd_day_kline_averages,
    }
    handler = commands.get(command)
    if handler is None:
        fail(f"未知命令 {command}")

    result = handler(payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
