"use strict";

/**
 * 住所処理ユーティリティ群。
 * - 入力正規化
 * - 郵便番号フォーマット
 * - API レスポンスからの4区分組み立て
 * - セッション内キャッシュ
 * - debounce
 */
const AddressResolverUtils = (() => {

  /**
   * 入力文字列を正規化する。
   * 全角英数 → 半角、全角スペース → 半角、連続スペース圧縮、トリム、改行・タブ除去。
   * @param {string} text
   * @returns {string}
   */
  function normalizeInput(text) {
    if (text == null) return "";
    let s = String(text);
    // 改行・タブを削除
    s = s.replace(/[\r\n\t]+/g, " ");
    // 全角英数記号 → 半角
    s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // 全角ハイフン類 → 半角ハイフン
    s = s.replace(/[ーｰ−–—―‐]/g, "-");
    // 全角スペース → 半角
    s = s.replace(/　/g, " ");
    // 連続スペース圧縮
    s = s.replace(/ +/g, " ");
    return s.trim();
  }

  /**
   * 7桁数字文字列を XXX-XXXX 形式へ。
   * @param {string} code
   * @returns {string}
   */
  function formatPostalCode(code) {
    if (!code) return "";
    const digits = String(code).replace(/\D/g, "");
    if (digits.length !== 7) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  /**
   * 配列要素を空/null をスキップしつつ結合する。
   * @param {Array<string|null|undefined>} parts
   * @param {string} sep
   * @returns {string}
   */
  function joinNonEmpty(parts, sep) {
    return parts
      .map((p) => (p == null ? "" : String(p)))
      .filter((p) => p.length > 0)
      .join(sep)
      .trim();
  }

  const KANJI_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

  /**
   * 0〜99 の整数を漢数字へ変換する。
   * 10→"十", 12→"十二", 20→"二十", 25→"二十五"。
   * 100以上は対応外（そのまま数字を返す）。
   * @param {number} n
   * @returns {string}
   */
  function toKanjiNumeral(n) {
    if (!Number.isFinite(n) || n < 0) return String(n);
    if (n < 10) return KANJI_DIGITS[n];
    if (n === 10) return "十";
    if (n < 20) return `十${KANJI_DIGITS[n - 10]}`;
    if (n < 100) {
      const tens = Math.floor(n / 10);
      const ones = n % 10;
      return `${KANJI_DIGITS[tens]}十${ones === 0 ? "" : KANJI_DIGITS[ones]}`;
    }
    return String(n);
  }

  /**
   * 丁目の値を表記用に整える。
   * - 算用数字は漢数字へ変換（"1" → "一丁目"）
   * - 既に "丁目" を含む場合は数字部分のみ抽出して再構成
   * - 既に漢数字の場合はそのまま末尾に "丁目" を付与
   * @param {*} chome
   * @returns {string}
   */
  function formatChome(chome) {
    if (chome == null) return "";
    let s = String(chome).trim();
    if (!s) return "";
    if (s.endsWith("丁目")) s = s.slice(0, -2);
    if (/^\d+$/.test(s)) s = toKanjiNumeral(parseInt(s, 10));
    return `${s}丁目`;
  }

  /**
   * PostcodeJP の japanese オブジェクトから 4 区分を生成する。
   * 連結ルールは要件 §4.1 参照。
   * @param {object} japanese
   * @returns {{prefecture:string, city:string, district:string, rest:string}}
   */
  function buildFieldValues(japanese) {
    const j = japanese || {};
    const prefecture = (j.prefecture || "").trim();
    const city = joinNonEmpty([j.county, j.city, j.ward], "");
    const district = joinNonEmpty([j.district, formatChome(j.chome)], "");

    const blockHouse = joinNonEmpty([j.block, j.house_num], "-");
    const rest = joinNonEmpty([blockHouse, j.building, j.room], " ");

    return { prefecture, city, district, rest };
  }

  /**
   * 単純な debounce。
   * @param {Function} fn
   * @param {number} wait
   */
  function debounce(fn, wait) {
    let timer = null;
    const debounced = function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, wait);
    };
    debounced.cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    return debounced;
  }

  /**
   * セッション内キャッシュ。キー＝正規化済み住所文字列。
   */
  const _cache = new Map();
  function cacheGet(key) { return _cache.get(key); }
  function cacheSet(key, value) { _cache.set(key, value); }
  function cacheHas(key) { return _cache.has(key); }
  function cacheClear() { _cache.clear(); }

  return {
    normalizeInput,
    formatPostalCode,
    formatChome,
    toKanjiNumeral,
    joinNonEmpty,
    buildFieldValues,
    debounce,
    cacheGet,
    cacheSet,
    cacheHas,
    cacheClear,
  };
})();
