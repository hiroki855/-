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
    const district = joinNonEmpty([j.district, j.chome], "");

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
    joinNonEmpty,
    buildFieldValues,
    debounce,
    cacheGet,
    cacheSet,
    cacheHas,
    cacheClear,
  };
})();
