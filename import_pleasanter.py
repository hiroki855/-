# -*- coding: utf-8 -*-
"""
プリザンター CSV取込バッチ
- デスクトップの import_YYYYMMDD.csv を読み込み、プリザンターの指定サイトに登録/更新する
- 既存レコード（申込番号が一致）は上書きし、ログに「上書き」と記録する
"""

# ───────────────────────────────────────────────
# 標準ライブラリのインポート
# ───────────────────────────────────────────────
# csv      : CSVファイルを読むための標準モジュール
# datetime : 今日の日付を取得するためのモジュール
# json     : APIに送るデータをJSON文字列にしたり、戻り値を辞書に変換するためのモジュール
# os       : ファイルの存在チェックなど、OSとやり取りするためのモジュール
# sys      : エラーで処理を終了する（sys.exit）ために使う
# time     : サーバ負荷配慮のためのウェイト（time.sleep）に使う
# traceback: 想定外の例外発生時、エラーの詳細（どこで起きたか）を文字列化するために使う
import csv
import datetime
import json
import os
import sys
import time
import traceback

# 外部ライブラリ。pip install requests でインストールされる。
# HTTP通信（プリザンターAPIへのPOST）を簡単に行うためのライブラリ。
import requests


# ═══════════════════════════════════════════════════════════════════
# ▼▼▼ 設定エリア（運用前にここを書き換える） ▼▼▼
# ═══════════════════════════════════════════════════════════════════

# プリザンターのホストURL（末尾の "/" は不要）。例: "https://example.pleasanter.net"
HOST_URL = "###REPLACE_ME###"

# プリザンターのAPIキー。プリザンター画面の「APIキー発行」で取得した文字列を貼り付ける。
API_KEY = "###REPLACE_ME###"

# 取込先サイト（テーブル）のID
SITE_ID = 44884

# CSVファイルが置かれているフォルダ
CSV_DIR = r"C:\Users\hn125141\Desktop"

# ───────────────────────────────────────────────
# 項目マッピング定義
# ───────────────────────────────────────────────
# CSVの列名 と プリザンターの項目コード の対応表。
# "hash" は プリザンターAPIで送信する際のグループ名（後述）。
#   - 分類項目      → "ClassHash"
#   - 日付項目      → "DateHash"
#   - 数値項目      → "NumHash"
#   - 説明項目      → "DescriptionHash"
#   - タイトル      → ハッシュではなく直接ルートに "Title" として置く（hash=None）
# "type" は文字列→正しい型へ変換するための種別。
# "required" は必須項目かどうか。
COLUMN_MAPPING = [
    {"csv": "申込番号",   "code": "ClassA",        "hash": "ClassHash",       "type": "str",  "required": True},
    {"csv": "申込日",     "code": "DateA",         "hash": "DateHash",        "type": "date", "required": True},
    {"csv": "顧客名",     "code": "Title",         "hash": None,              "type": "str",  "required": True},
    {"csv": "顧客カナ",   "code": "ClassB",        "hash": "ClassHash",       "type": "str",  "required": False},
    {"csv": "商品コード", "code": "ClassC",        "hash": "ClassHash",       "type": "str",  "required": True},
    {"csv": "商品名",     "code": "ClassD",        "hash": "ClassHash",       "type": "str",  "required": False},
    {"csv": "数量",       "code": "NumA",          "hash": "NumHash",         "type": "num",  "required": True},
    {"csv": "単価",       "code": "NumB",          "hash": "NumHash",         "type": "num",  "required": True},
    {"csv": "金額",       "code": "NumC",          "hash": "NumHash",         "type": "num",  "required": True},
    {"csv": "担当者",     "code": "ClassE",        "hash": "ClassHash",       "type": "str",  "required": False},
    {"csv": "備考",       "code": "DescriptionA",  "hash": "DescriptionHash", "type": "str",  "required": False},
]

# 重複判定キー（このCSV列の値で既存レコードを検索し、あれば上書き、なければ新規作成）
DUPLICATE_KEY_CSV  = "申込番号"
DUPLICATE_KEY_CODE = "ClassA"

# HTTP通信のタイムアウト秒数
REQUEST_TIMEOUT = 60

# 1リクエストごとの待機秒数（サーバ負荷配慮）
REQUEST_WAIT = 0.1

# ═══════════════════════════════════════════════════════════════════
# ▲▲▲ 設定エリアここまで ▲▲▲
# ═══════════════════════════════════════════════════════════════════


# ───────────────────────────────────────────────
# ログ出力ユーティリティ
# ───────────────────────────────────────────────
# 同じ内容を「ファイル」と「コンソール（画面）」の両方に出したいので、
# グローバル変数にログファイルのハンドルを保持し、log() で両方に書く。
LOG_FILE = None  # ファイルを開いた後にここへ代入する

def log(message: str) -> None:
    """ログを画面とファイルに同時出力する。
    Pythonでは「型ヒント」(message: str, -> None) で引数と戻り値の型を表せる。
    実行時には強制されないが、エディタの補完やバグ予防に役立つ。
    """
    # 行頭に現在時刻を付ける（例: 2025-05-15 10:00:00）
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    # print() は標準出力（コンソール）に表示する組み込み関数
    print(line)
    # LOG_FILE が None でない（=既に open 済み）なら、ファイルにも書き込む
    if LOG_FILE is not None:
        LOG_FILE.write(line + "\n")
        # flush() を呼ぶと、バッファに溜まっていた内容を即座にファイルへ書き出す。
        # 途中で異常終了してもログが残るようにするための保険。
        LOG_FILE.flush()


# ───────────────────────────────────────────────
# 値の型変換ユーティリティ
# ───────────────────────────────────────────────
def convert_value(raw: str, value_type: str):
    """CSVから読んだ文字列を、項目種別に応じて適切な型に変換する。

    Pythonの関数は型ヒントの戻り値を省略可能。ここでは「str か float か」と
    複数の型を返しうるので省略している。

    引数:
        raw        : CSVから読み込んだ生の文字列
        value_type : "str" / "num" / "date" のいずれか
    """
    # strip() で前後の空白を取り除く
    raw = raw.strip()

    if value_type == "num":
        # 数値項目。空文字や None は 0 として扱わず None にすると、
        # 「未入力」をプリザンター側で空欄として扱えるが、
        # 今回は必須なので空ならエラーにしたい。空チェックは呼び出し側で行う。
        # 単純に float に変換する。 "1,000" のようなカンマがあれば除去する。
        return float(raw.replace(",", ""))

    if value_type == "date":
        # 日付。CSVが "YYYY/MM/DD" 想定。プリザンターAPIにもこの形式で渡せばOK。
        # ただし "2025-05-15" のようなハイフン区切りでも受け付けたいので、
        # 一度 datetime に変換してから "YYYY/MM/DD" に直す。
        for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
            try:
                dt = datetime.datetime.strptime(raw, fmt)
                return dt.strftime("%Y/%m/%d")
            except ValueError:
                # この形式ではパースできなかった → 次の形式を試す
                continue
        # どの形式でもダメなら例外を投げる
        raise ValueError(f"日付として解釈できません: {raw}")

    # それ以外は文字列としてそのまま返す
    return raw


# ───────────────────────────────────────────────
# CSV行 → プリザンター送信用ペイロード変換
# ───────────────────────────────────────────────
def build_payload(row: dict) -> dict:
    """CSV1行（辞書）からプリザンターAPIに送るリクエストボディ(dict)を組み立てる。

    プリザンターAPIは
        {
          "ApiVersion": 1.1,
          "ApiKey": "...",
          "Title": "...",
          "ClassHash":       {"ClassA": "...", "ClassB": "..."},
          "DateHash":        {"DateA":  "2025/05/15"},
          "NumHash":         {"NumA":   1,  "NumB": 2},
          "DescriptionHash": {"DescriptionA": "..."}
        }
    のような形を期待する。
    """
    payload = {
        "ApiVersion": 1.1,
        "ApiKey": API_KEY,
    }

    # マッピング定義をループしながら、対応するCSV値を payload に詰めていく
    for m in COLUMN_MAPPING:
        # CSV辞書から値を取り出す（キーがなければ空文字を返す）
        raw = row.get(m["csv"], "")
        # 必須チェックは呼び出し側で先に済ませる前提だが、空ならスキップ
        if raw is None or str(raw).strip() == "":
            continue

        # 型変換
        value = convert_value(str(raw), m["type"])

        if m["hash"] is None:
            # Title など、ハッシュではなくルートに置く項目
            payload[m["code"]] = value
        else:
            # ClassHash / DateHash / NumHash / DescriptionHash の中に入れる
            # setdefault は「キーがなければ初期値を入れ、その値を返す」便利メソッド
            payload.setdefault(m["hash"], {})[m["code"]] = value

    return payload


# ───────────────────────────────────────────────
# CSV行の必須チェック
# ───────────────────────────────────────────────
def check_required(row: dict) -> list:
    """必須項目が空の場合、欠落している項目名のリストを返す。
    全て埋まっていれば空のリスト [] を返す。
    """
    missing = []
    for m in COLUMN_MAPPING:
        if m["required"]:
            val = row.get(m["csv"], "")
            if val is None or str(val).strip() == "":
                missing.append(m["csv"])
    return missing


# ───────────────────────────────────────────────
# プリザンターAPI呼び出し
# ───────────────────────────────────────────────
def api_post(url: str, body: dict) -> dict:
    """指定URLにJSONをPOSTし、戻り値を辞書で返す。
    通信エラー時は例外が発生するので、呼び出し側で try/except する。
    """
    # サーバ負荷配慮の小休止
    time.sleep(REQUEST_WAIT)
    # requests.post は HTTPリクエストを送る。
    # json=body と書くと、辞書を自動的にJSON化し、Content-Type: application/json も付けてくれる。
    response = requests.post(url, json=body, timeout=REQUEST_TIMEOUT)
    # ステータスコードが 4xx/5xx なら例外を投げる
    response.raise_for_status()
    # 本文をJSONとしてパースして dict で返す
    return response.json()


def search_existing(duplicate_key_value: str):
    """重複判定キーで既存レコードを検索し、見つかればその RecordId を返す。
    見つからなければ None を返す。
    """
    url = f"{HOST_URL}/api/items/{SITE_ID}/get"
    body = {
        "ApiVersion": 1.1,
        "ApiKey": API_KEY,
        "View": {
            # ColumnFilterHash はプリザンターの絞り込み条件。
            # 分類項目を完全一致で絞り込む場合、JSON配列を文字列化した形 ["値"] を渡すのが安全。
            "ColumnFilterHash": {
                DUPLICATE_KEY_CODE: json.dumps([duplicate_key_value], ensure_ascii=False)
            }
        }
    }
    result = api_post(url, body)

    # 戻り値の構造: {"StatusCode":200, "Response":{"Data":[{...record...}, ...]}}
    data_list = result.get("Response", {}).get("Data", [])

    # サーバ側フィルタが部分一致になっている可能性も考えて、Python側でも厳密一致を確認する
    for record in data_list:
        # 分類項目は "ClassA" のようなキーで値が直接入る
        if str(record.get(DUPLICATE_KEY_CODE, "")) == str(duplicate_key_value):
            return record.get("ResultId") or record.get("IssueId")
    return None


def create_record(payload: dict) -> dict:
    """新規レコード作成API"""
    url = f"{HOST_URL}/api/items/{SITE_ID}/create"
    return api_post(url, payload)


def update_record(record_id, payload: dict) -> dict:
    """既存レコード更新API"""
    url = f"{HOST_URL}/api/items/{SITE_ID}/{record_id}/update"
    return api_post(url, payload)


# ───────────────────────────────────────────────
# メイン処理
# ───────────────────────────────────────────────
def main() -> int:
    """戻り値は終了コード（0: 正常、1: 異常）"""

    global LOG_FILE  # 関数の外にあるグローバル変数を書き換えるための宣言

    # ① 実行日からファイルパスを組み立て
    today_str = datetime.datetime.now().strftime("%Y%m%d")
    csv_path = os.path.join(CSV_DIR, f"import_{today_str}.csv")
    log_path = os.path.join(CSV_DIR, f"import_{today_str}_log.txt")

    # ログファイルを開く（"w" = 上書き / "a" = 追記 ＝今回は同日に再実行されたら追記）
    # encoding="utf-8" で日本語が文字化けしないようにする
    LOG_FILE = open(log_path, "a", encoding="utf-8")

    log("=" * 60)
    log("プリザンター CSV取込バッチ 開始")
    log(f"対象CSV: {csv_path}")

    # ② ファイル存在チェック
    if not os.path.exists(csv_path):
        log(f"[エラー] CSVファイルが見つかりません: {csv_path}")
        log("処理を終了します。")
        LOG_FILE.close()
        return 1

    # 集計カウンタ
    count_new = 0       # 新規登録件数
    count_overwrite = 0 # 上書き件数
    count_fail = 0      # 失敗件数

    # ③ CSV読み込み
    # newline="" は、CSVをcsvモジュールで読むときの推奨指定（改行コードの誤判定防止）
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        # DictReader を使うと、ヘッダー行を自動でキーにした辞書として1行ずつ取れる
        reader = csv.DictReader(f)

        # ④ 1行ずつ処理する
        # enumerate(reader, start=2) でループに行番号も付与（ヘッダーが1行目なのでデータは2行目から）
        for line_no, row in enumerate(reader, start=2):

            # 重複判定キーの値（ログに使うので先に取り出す）
            key_value = (row.get(DUPLICATE_KEY_CSV) or "").strip()

            try:
                # ④-必須チェック
                missing = check_required(row)
                if missing:
                    count_fail += 1
                    log(f"行{line_no} 申込番号={key_value} 結果=失敗 理由=必須項目欠落({', '.join(missing)})")
                    continue  # 次の行へ

                # ペイロード組み立て
                payload = build_payload(row)

                # ④-a 既存レコード検索
                existing_id = search_existing(key_value)

                if existing_id is not None:
                    # ④-b 既存あり → 更新
                    update_record(existing_id, payload)
                    count_overwrite += 1
                    log(f"行{line_no} 申込番号={key_value} 結果=上書きしました (RecordId={existing_id})")
                else:
                    # ④-c 既存なし → 新規作成
                    create_record(payload)
                    count_new += 1
                    log(f"行{line_no} 申込番号={key_value} 結果=新規登録")

            except requests.RequestException as e:
                # API通信系のエラー（タイムアウト、ステータス4xx/5xx 等）
                count_fail += 1
                log(f"行{line_no} 申込番号={key_value} 結果=失敗 理由=API通信エラー: {e}")

            except Exception:
                # 想定外の例外。スタックトレース（どこで起きたか）も出す
                count_fail += 1
                log(f"行{line_no} 申込番号={key_value} 結果=失敗 理由=想定外の例外")
                log(traceback.format_exc())

    # ⑤ サマリ
    log("-" * 60)
    log(f"新規登録: {count_new} 件")
    log(f"上書き  : {count_overwrite} 件")
    log(f"失敗    : {count_fail} 件")
    log("プリザンター CSV取込バッチ 終了")
    log("=" * 60)

    LOG_FILE.close()
    return 0


# ───────────────────────────────────────────────
# エントリポイント
# ───────────────────────────────────────────────
# 「python import_pleasanter.py」と直接実行されたときだけ main() を呼ぶ。
# 他のスクリプトから import されたときには実行されない（Pythonの定型句）。
if __name__ == "__main__":
    sys.exit(main())
