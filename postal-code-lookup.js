/* =======================================================================
 * Pleasanter クライアントスクリプト：郵便番号 → 住所カナ自動入力
 * -----------------------------------------------------------------------
 * 【なぜサーバスクリプト（C#）ではなくクライアントスクリプトを採用するか】
 *   本処理は「分類A（郵便番号入力欄）からフォーカスが外れた瞬間に
 *   住所カナを取得して反映する」という “画面イベント駆動” である。
 *   サーバスクリプトは Create / Update / BeforeFormula など
 *   サーバ側の CRUD イベント駆動なので、
 *   入力途中の blur というブラウザ側イベントでは発火させられない。
 *   また zipcloud は CORS 対応済みの公開Web APIで、
 *   ブラウザから直接 fetch でき、UIをブロックせず非同期に反映できるため、
 *   クライアントスクリプトの方が要件に明確に適合する。
 *
 * 【処理の流れ】
 *   (1) 編集画面が開いたとき、分類A の入力欄に blur ハンドラを仕込む
 *   (2) フォーカスが外れたら値を取り出し、ハイフン等を除去して
 *       「半角数字7桁」かを検証
 *   (3) zipcloud API を fetch で非同期呼び出し
 *   (4) 取得できた kana1 + kana2 + kana3 を連結して 分類M に上書き
 *   (5) 形式不正・該当なし・通信エラー時は 分類M を空にし、
 *       コンソールに警告を出す
 *
 * 【対象画面】
 *   レコード新規作成画面 / 編集ダイアログ（一覧画面では発火しない）
 *
 * 【使用する Pleasanter API】
 *   $p.events.on_editor_load … 編集画面ロード時のフック
 *   $p.getControl(コードID) … 項目に対応する jQuery 要素を取得
 *   $p.set(jQuery要素, 値)   … 項目に値をセット（変更検知含む）
 * ======================================================================= */

(function () {
    'use strict';

    // -------------------------------------------------------------------
    // 設定値（必要に応じてこの3つを書き換えれば他項目にも流用可能）
    // -------------------------------------------------------------------
    var INPUT_ID  = 'ClassA';   // 入力源：分類A（郵便番号を文字列で入力する欄）
    var OUTPUT_ID = 'ClassM';   // 出力先：分類M（住所カナを書き込む欄）
    var ZIPCLOUD_URL = 'https://zipcloud.ibsnet.co.jp/api/search';

    // -------------------------------------------------------------------
    // 編集画面のロード完了時に1度だけ呼ばれるフック
    //  ※ Pleasanter が DOM を組み立て終わった後に実行されるため、
    //     ここで getControl すれば確実に要素が取れる。
    // -------------------------------------------------------------------
    $p.events.on_editor_load = function () {

        // 入力欄（分類A）の jQuery 要素を取得
        var $input = $p.getControl(INPUT_ID);
        if (!$input || $input.length === 0) {
            // 項目を非表示にしている等で取得できないケース
            console.warn('[zipcloud] 入力欄 ' + INPUT_ID + ' が見つかりません。');
            return;
        }

        // 同じスクリプトが二重に読み込まれてもハンドラが多重登録されないよう、
        // 自前の名前空間 ".zipcloud" をつけて off → on の順で安全に張り替える。
        $input
            .off('blur.zipcloud')
            .on('blur.zipcloud', function () {
                handleBlur($input.val());
            });
    };

    /**
     * 入力欄のフォーカスアウト時に呼ばれる本体処理
     * @param {string} rawValue - 入力欄に入っている生の文字列
     */
    function handleBlur(rawValue) {

        // 値が空の場合は出力もクリアして終了（警告は出さない＝通常運用）
        if (rawValue === undefined || rawValue === null
            || String(rawValue).trim() === '') {
            setOutput('');
            return;
        }

        // ハイフン・半角空白・全角空白を除去
        //   例) "100-0001" → "1000001", "100 0001" → "1000001"
        var zip = String(rawValue).replace(/[-\s　]/g, '');

        // 半角数字7桁の厳密チェック
        if (!/^\d{7}$/.test(zip)) {
            console.warn('[zipcloud] 郵便番号の形式が不正です: ' + rawValue);
            setOutput('');
            return;
        }

        // zipcloud API を fetch で非同期呼び出し
        //   ※ async/await ではなく Promise チェーンで書いており、
        //     VBA経験者でも「.then で続きの処理」と読み下せる。
        var url = ZIPCLOUD_URL + '?zipcode=' + encodeURIComponent(zip);

        fetch(url, { method: 'GET' })
            .then(function (res) {
                // HTTP ステータスが 2xx 以外なら通信レベルの異常
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status);
                }
                return res.json();
            })
            .then(function (data) {
                // zipcloud 自身のステータスコード（200=正常、それ以外=異常）
                if (!data || data.status !== 200) {
                    var msg = (data && data.message) ? data.message : 'unknown error';
                    console.warn('[zipcloud] APIエラー: ' + msg);
                    setOutput('');
                    return;
                }

                // results が null または空配列 → その郵便番号は存在しない
                if (!data.results || data.results.length === 0) {
                    console.warn('[zipcloud] 該当する住所がありません: ' + zip);
                    setOutput('');
                    return;
                }

                // 先頭の候補を採用し、カナ住所を連結
                //   kana1 = 都道府県カナ
                //   kana2 = 市区町村カナ
                //   kana3 = 町域カナ
                var r = data.results[0];
                var kana = (r.kana1 || '') + (r.kana2 || '') + (r.kana3 || '');

                // 分類M に上書きセット（既存値の有無は問わず常に上書き）
                setOutput(kana);
            })
            .catch(function (err) {
                // ネットワーク断・CORS違反・JSONパース失敗などはここに来る
                console.warn('[zipcloud] 通信エラー: ' + (err && err.message));
                setOutput('');
            });
    }

    /**
     * 出力欄（分類M）に値をセットするユーティリティ
     * @param {string} value - セットする値（空文字を渡すとクリア）
     */
    function setOutput(value) {
        var $out = $p.getControl(OUTPUT_ID);
        if (!$out || $out.length === 0) {
            console.warn('[zipcloud] 出力欄 ' + OUTPUT_ID + ' が見つかりません。');
            return;
        }
        // $p.set は Pleasanter 標準のセッタ。
        // 単に .val(value) するだけでは内部の変更検知が走らないため、
        // 必ず $p.set 経由で書き込むこと。
        $p.set($out, value);
    }
})();
