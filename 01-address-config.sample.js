"use strict";

/**
 * 住所処理スクリプトの設定。
 * 実環境では本ファイルを config.js としてコピーし、API_KEY を書き換えること。
 * config.js は .gitignore 対象。
 */
const ADDRESS_RESOLVER_CONFIG = {
  // PostcodeJP
  API_ENDPOINT: "https://apis.postcode-jp.com/api/v6/parse",
  POSTCODES_ENDPOINT: "https://apis.postcode-jp.com/api/v6/postcodes",
  API_KEY: "bPJ8yVbLib6qqNfzxydYFh9gkVb5GO",

  // 対象サイト
  SITE_ID: 44884,

  // プリザンター フィールド物理名
  FIELD: {
    ADDRESS_FULL: "ClassH",
    POSTAL_CODE:  "ClassN",
    PREFECTURE:   "ClassY",
    CITY:         "ClassX",
    DISTRICT:     "ClassS",
    REST:         "ClassQ",
  },

  // 挙動チューニング
  DEBOUNCE_MS: 500,
  REQUEST_TIMEOUT_MS: 5000,
  SCORE_THRESHOLD_OK: 0.9,
  SCORE_THRESHOLD_WARN: 0.7,
  MAX_CANDIDATES_BEFORE_WARN: 5,

  // /parse が postal_code:null を返した場合に /postcodes でフォールバック検索する
  ENABLE_POSTCODE_FALLBACK: true,
  // /parse 呼び出し直後に /postcodes を呼ぶ際の最小間隔（Freeプランの 1req/sec 制限対策）
  POSTCODE_FALLBACK_DELAY_MS: 1100,
};
