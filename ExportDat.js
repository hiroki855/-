// =============================================================================
// ExportDat.js
// -----------------------------------------------------------------------------
// プリザンター サーバスクリプト：プロセスボタン押下で対象テーブルのレコードを
//                              ^（キャレット）区切り・ダブルクォート囲み・
//                              UTF-8エンコードの .dat ファイルとして出力する。
//
// 処理概要:
//   1) プロセスボタン (ControlId === "Process_<PROCESS_ID>") のクリックで発火
//   2) 事前に作成済みのエクスポート設定 (ExportId) を使い、タブ区切りCSVを
//      中間ファイルとしてサーバ上に出力する ($ps.file.export)
//   3) 中間CSVをUTF-8で読み込み、タブ → ^ に置換する
//   4) 必要に応じてBOMを付与し、output/ 配下に <FILE_PREFIX>_<yyMMdd>.dat
//      として上書き保存する ($ps.file.writeAllText)
//   5) 中間CSVを削除する ($ps.file.deleteFile)
//   6) 成否をログ出力／エラー時は画面通知＋ログ
//
// 前提:
//   - Pleasanter オンプレミス版 1.4.13.0 以降
//   - Script.json の DisableServerScriptFile = false
//   - Script.json の ServerScriptFilePath = C:\fileshare （基準ディレクトリ）
//   - 対象テーブルにエクスポート権限あり
//   - エクスポート設定（区切り=タブ、ダブルクォート囲み=ON、ヘッダ=OFF）が
//     EXPORT_ID で指定したIDで作成済み
//   - 値内に ^・タブ・改行は含まれない前提（含まれる場合はエスケープ未対応）
//
// 出力例 (2026-05-08 実行):
//   C:\fileshare\output\Test_260508.dat
//   "値1"^"値2"^"値3"\r\n
//   ...
// =============================================================================

// -------- 設定定数（運用に応じて変更する） ----------------------------------
const SITE_ID     = 1000;        // 対象テーブルのサイトID
const EXPORT_ID   = 1;           // エクスポート設定のID（事前作成済み）
const PROCESS_ID  = 1;           // 発火させたいプロセスのID
const SECTION     = "01_export"; // $ps.file 操作のセクション名
const FILE_PREFIX = "Test";      // 出力ファイル名のプレフィックス
const WRITE_BOM   = false;       // true にすると BOM 付き UTF-8 で出力する
// ----------------------------------------------------------------------------

// プロセスボタン以外（一覧表示・編集など）のイベントでは何もしない
if (context.ControlId !== "Process_" + PROCESS_ID) {
    return;
}

try {
    // 1) 現在日時から2種類のタイムスタンプ文字列を生成
    //    - 中間CSV: 衝突回避のため秒まで含める (yyMMddHHmmss)
    //    - 最終 .dat : 日付のみ (yyMMdd)
    const now = new Date();
    const yy   = pad2(now.getFullYear() % 100);
    const MM   = pad2(now.getMonth() + 1);
    const dd   = pad2(now.getDate());
    const HH   = pad2(now.getHours());
    const mm   = pad2(now.getMinutes());
    const ss   = pad2(now.getSeconds());
    const tsFile  = yy + MM + dd;                     // 例) 260508
    const tsTmp   = tsFile + HH + mm + ss;            // 例) 260508153012

    // 中間CSV / 最終 .dat のファイル名（パスは "/" 区切り）
    const tmpCsvPath = "tmp/"    + FILE_PREFIX + "_" + tsTmp  + ".csv";
    const outDatPath = "output/" + FILE_PREFIX + "_" + tsFile + ".dat";

    // 2) エクスポート設定IDを指定して中間CSVを出力
    //    タブ区切り＋ダブルクォート囲み＋ヘッダ無し で出力されるよう
    //    エクスポート設定側で構成済みである前提
    const exportParam = {
        ExportId: EXPORT_ID,
        Encoding: "UTF-8"
    };
    const exportOk = $ps.file.export(
        SECTION,
        tmpCsvPath,
        SITE_ID,
        $ps.JSON.stringify(exportParam)
    );
    if (!exportOk) {
        throw new Error("エクスポート(中間CSV生成)に失敗しました: " + tmpCsvPath);
    }

    // 3) 中間CSV を UTF-8 で読み込む
    let body = $ps.file.readAllText(SECTION, tmpCsvPath, "UTF-8");
    if (body === null || body === undefined) {
        throw new Error("中間CSVの読み込みに失敗しました: " + tmpCsvPath);
    }

    // 4) タブ → ^ に一括置換
    //    ※ 値内にタブ／^／改行は含まれない前提のため単純置換で十分
    body = body.split("\t").join("^");

    // 5) BOM が必要な連携先向けに、フラグONなら先頭に ﻿ を付与
    if (WRITE_BOM) {
        body = "﻿" + body;
    }

    // 6) output/ 配下に .dat を UTF-8 で書き出す（同名なら上書き）
    //    writeAllText は WriteAllText 同様、既存ファイルがあれば上書き＝truncate
    const writeOk = $ps.file.writeAllText(SECTION, outDatPath, body, "UTF-8");
    if (!writeOk) {
        throw new Error(".dat ファイルの書き出しに失敗しました: " + outDatPath);
    }

    // 7) 中間CSVを削除（失敗しても本処理は成功扱いだがログには残す）
    const deleteOk = $ps.file.deleteFile(SECTION, tmpCsvPath);
    if (!deleteOk) {
        context.Log("中間CSVの削除に失敗しました（処理は継続）: " + tmpCsvPath);
    }

    // 8) 成功ログ
    context.Log("エクスポート成功: " + outDatPath);

} catch (e) {
    // 失敗時はサーバログに詳細を残しつつ、画面に通知
    const msg = "エクスポート処理でエラーが発生しました: " + (e && e.message ? e.message : e);
    context.Log(msg);
    context.Error(msg);
}

// 数値を2桁ゼロ埋め文字列にする
function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}
