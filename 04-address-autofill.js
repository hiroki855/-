"use strict";

/**
 * プリザンター 住所処理スクリプト メインエントリ。
 *
 * 住所欄（ClassH）の onChange を起点に PostcodeJP /parse を呼び、
 * 郵便番号・都道府県・市区群・丁目・番地〜建物名の各フィールドへセットする。
 *
 * 依存:
 *   - config.js : ADDRESS_RESOLVER_CONFIG
 *   - address-resolver-utils.js : AddressResolverUtils
 *   - address-resolver-ui.js    : AddressResolverUI
 *
 * 登録順序: config.js → utils → ui → 本ファイル
 */
(function () {
  const CFG = (typeof ADDRESS_RESOLVER_CONFIG !== "undefined") ? ADDRESS_RESOLVER_CONFIG : null;
  if (!CFG) {
    console.error("[address-resolver] ADDRESS_RESOLVER_CONFIG が見つかりません。config.js の読み込み順を確認してください。");
    return;
  }
  const U = AddressResolverUtils;
  const UI = AddressResolverUI;

  const F = CFG.FIELD;

  /**
   * プリザンターの $p.getControl で取得した jQuery 要素から生 DOM を得る。
   */
  function getControlEl(physicalName) {
    try {
      const $ctrl = $p.getControl(physicalName);
      return ($ctrl && $ctrl.length) ? $ctrl[0] : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * フィールドの現在値を取得する。jQuery の .val() を経由するため、
   * input/textarea/select/hidden いずれの種類でも一貫して取れる。
   */
  function getFieldValue(physicalName) {
    try {
      const $ctrl = (typeof $p !== "undefined") ? $p.getControl(physicalName) : null;
      if (!$ctrl || !$ctrl.length) return "";
      const v = $ctrl.val();
      return v == null ? "" : String(v);
    } catch (_) {
      return "";
    }
  }

  /**
   * プリザンターのフィールド設定。文字列・数値どちらも $p.set で投入できる前提。
   */
  function setField(physicalName, value) {
    try {
      $p.set($p.getControl(physicalName), value == null ? "" : String(value));
    } catch (e) {
      console.error(`[address-resolver] $p.set 失敗: ${physicalName}`, e);
    }
  }

  /**
   * 全関連フィールドをクリアする。
   */
  function clearRelatedFields() {
    [F.POSTAL_CODE, F.PREFECTURE, F.CITY, F.DISTRICT, F.REST].forEach((name) => setField(name, ""));
  }

  /**
   * API 1件の候補から共通フォーマット { postalCode, address, japanese, score, formattedAddress } へ変換。
   */
  function normalizeCandidate(postalCodeRaw, japanese, score, formattedAddress) {
    const postalCode = U.formatPostalCode(postalCodeRaw);
    const v = U.buildFieldValues(japanese);
    const address = U.joinNonEmpty([v.prefecture, v.city, v.district, v.rest], "");
    return { postalCode, address, japanese, score, formattedAddress: formattedAddress || "" };
  }

  /**
   * PostcodeJP /parse 呼び出し。
   * @param {string} address
   * @returns {Promise<{status:"ok"|"http_error"|"network"|"timeout", httpStatus?:number, body?:object, error?:Error}>}
   */
  async function callParseApi(address) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(CFG.API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": CFG.API_KEY,
        },
        body: JSON.stringify({ address }),
        signal: ctrl.signal,
      });
      // レート残数監視
      const remain = res.headers.get("x-ratelimit-remaining-day");
      if (remain != null && Number(remain) < 10) {
        console.warn(`[address-resolver] レート残数低下: x-ratelimit-remaining-day=${remain}`);
      }
      if (!res.ok) {
        return { status: "http_error", httpStatus: res.status };
      }
      const body = await res.json();
      return { status: "ok", body };
    } catch (e) {
      if (e.name === "AbortError") return { status: "timeout", error: e };
      return { status: "network", error: e };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * /parse が postal_code を返さなかった場合のフォールバック検索。
   * 構造化済み住所要素から検索キーを組み立て、/postcodes に問い合わせる。
   * @param {object} japanese - /parse の japanese オブジェクト
   * @param {string} [formattedAddress] - /parse の meta.formatted_address があれば優先
   * @returns {Promise<string|null>} 7桁数字の郵便番号、見つからなければ null
   */
  async function lookupPostalCodeByAddress(japanese, formattedAddress) {
    if (!CFG.ENABLE_POSTCODE_FALLBACK) return null;
    if (!CFG.POSTCODES_ENDPOINT) return null;

    // 検索文字列: formatted_address を優先、なければ japanese から構築
    let q = (formattedAddress || "").trim();
    if (!q && japanese) {
      const j = japanese;
      const chomePart = j.chome ? `${j.chome}丁目` : "";
      q = [j.prefecture, j.county, j.city, j.ward, j.district, chomePart]
        .map((p) => (p == null ? "" : String(p)))
        .filter(Boolean)
        .join("");
    }
    if (!q) return null;

    // Free プラン (1req/sec) に当たらないよう /parse 直後を避ける
    await new Promise((r) => setTimeout(r, CFG.POSTCODE_FALLBACK_DELAY_MS || 1100));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS);
    try {
      const url = `${CFG.POSTCODES_ENDPOINT}?q=${encodeURIComponent(q)}&limit=1`;
      const res = await fetch(url, {
        method: "GET",
        headers: { "apikey": CFG.API_KEY },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.warn(`[address-resolver] /postcodes フォールバック失敗: HTTP ${res.status}`);
        return null;
      }
      const body = await res.json();
      if (!lookupPostalCodeByAddress._logged) {
        console.debug("[address-resolver] /postcodes レスポンス（最初の1回のみ表示）:", body);
        lookupPostalCodeByAddress._logged = true;
      }
      return extractFirstPostcode(body);
    } catch (e) {
      console.warn("[address-resolver] /postcodes フォールバック例外:", e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * /postcodes レスポンスから先頭1件の郵便番号を抽出する。
   * レスポンスの構造揺れに耐えるよう複数経路を試す。
   * @returns {string|null} 7桁数字 or null
   */
  function extractFirstPostcode(body) {
    if (!body) return null;
    let arr = null;
    if (Array.isArray(body)) arr = body;
    else if (Array.isArray(body.data)) arr = body.data;
    else if (Array.isArray(body.results)) arr = body.results;
    else if (Array.isArray(body.addresses)) arr = body.addresses;
    else if (Array.isArray(body.postcodes)) arr = body.postcodes;

    if (!arr || arr.length === 0) return null;
    const first = arr[0];
    if (!first) return null;
    const raw = first.postcode || first.postal_code
      || (first.meta && first.meta.postal_code)
      || first.zipcode || null;
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, "");
    return digits.length === 7 ? digits : null;
  }

  /**
   * /parse のレスポンスから郵便番号配列を抽出する。
   * API のレスポンス構造が以下のいずれかに揺れる可能性があるため、複数経路を試す:
   *   - body.meta.postal_code: 配列 or 文字列
   *   - body.postal_code: 配列 or 文字列
   *   - body.japanese.postal_code: 文字列
   *   - body.addresses[].postal_code: 各候補が持つ
   * @returns {string[]}
   */
  function extractPostalCodes(body) {
    if (!body) return [];
    const candidates = [
      body.meta && body.meta.postal_code,
      body.postal_code,
      body.japanese && body.japanese.postal_code,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c.map(String);
      if (typeof c === "string" && c) return [c];
    }
    // addresses 配列形式
    if (Array.isArray(body.addresses) && body.addresses.length > 0) {
      const out = body.addresses
        .map((a) => a && (a.postal_code || (a.meta && a.meta.postal_code)))
        .filter((v) => typeof v === "string" && v);
      if (out.length > 0) return out;
    }
    return [];
  }

  /**
   * /parse のレスポンスから japanese オブジェクト配列を抽出する。
   */
  function extractJapaneseList(body) {
    if (!body) return [];
    if (Array.isArray(body.japanese)) return body.japanese;
    if (body.japanese && typeof body.japanese === "object") return [body.japanese];
    if (Array.isArray(body.addresses)) {
      return body.addresses.map((a) => a && a.japanese).filter((j) => j && typeof j === "object");
    }
    return [];
  }

  /**
   * /parse のレスポンスから候補一覧を生成する。
   * 候補が複数のときは japanese・postal_code とも要素数が揃う想定だが、
   * 揺れに備え長い方に合わせて対で取り出す。
   */
  function extractCandidates(body) {
    if (!body) return [];

    if (!extractCandidates._logged) {
      console.debug("[address-resolver] API レスポンス（最初の1回のみ表示）:", body);
      extractCandidates._logged = true;
    }

    const codes = extractPostalCodes(body);
    const japaneseList = extractJapaneseList(body);

    let score = null;
    if (body.meta && typeof body.meta.score === "number") score = body.meta.score;
    else if (typeof body.score === "number") score = body.score;

    const formattedAddress = (body.meta && body.meta.formatted_address) || body.formatted_address || "";

    if (codes.length === 0 && japaneseList.length === 0) return [];

    const len = Math.max(codes.length, japaneseList.length, 1);
    const out = [];
    for (let i = 0; i < len; i++) {
      const code = codes[i] != null ? codes[i] : codes[0];
      const jp = japaneseList[i] != null ? japaneseList[i] : japaneseList[0];
      if (code == null && jp == null) continue;
      out.push(normalizeCandidate(code, jp, score, formattedAddress));
    }
    return out;
  }

  /**
   * 1候補を確定として全フィールドへセットする。
   */
  function applyCandidate(candidate) {
    const v = U.buildFieldValues(candidate.japanese || {});
    setField(F.POSTAL_CODE, candidate.postalCode);
    setField(F.PREFECTURE,  v.prefecture);
    setField(F.CITY,        v.city);
    setField(F.DISTRICT,    v.district);
    setField(F.REST,        v.rest);
  }

  /**
   * HTTP ステータスをユーザー向けメッセージへ。
   */
  function messageForHttp(status) {
    if (status === 401 || status === 403) return "住所検索に失敗しました（管理者へ連絡）";
    if (status === 429) return "アクセスが集中しています。少し待ってから再入力してください";
    if (status === 400) return "住所が正しく解析できませんでした";
    if (status === 500 || status === 502 || status === 503) return "住所検索サービスが一時停止しています";
    return "住所検索に失敗しました";
  }

  // 連続呼び出し防止用の状態
  let _lastFiredValue = null;
  let _inflight = false;

  /**
   * 住所欄の値変更時のメイン処理。
   */
  async function handleAddressChange() {
    const addrEl = getControlEl(F.ADDRESS_FULL);
    if (!addrEl) return;

    const raw = addrEl.value || "";
    const normalized = U.normalizeInput(raw);

    if (!normalized) {
      UI.clearMessage();
      UI.removeDropdown();
      _lastFiredValue = "";
      clearRelatedFields();
      return;
    }

    // 直前に処理したのと同じ値なら何もしない（input/change 重複・再フォーカス対策）
    if (normalized === _lastFiredValue) return;
    if (_inflight) return;

    _lastFiredValue = normalized;
    UI.clearMessage();
    UI.removeDropdown();

    let candidates;
    if (U.cacheHas(normalized)) {
      candidates = U.cacheGet(normalized);
    } else {
      _inflight = true;
      let result;
      try {
        result = await callParseApi(normalized);
      } finally {
        _inflight = false;
      }
      if (result.status === "timeout") {
        UI.showMessage(addrEl, "住所検索がタイムアウトしました", "error");
        _lastFiredValue = null; // 再試行可能にする
        return;
      }
      if (result.status === "network") {
        UI.showMessage(addrEl, "住所検索サービスが一時停止しています", "error");
        _lastFiredValue = null;
        return;
      }
      if (result.status === "http_error") {
        UI.showMessage(addrEl, messageForHttp(result.httpStatus), "error");
        _lastFiredValue = null;
        return;
      }
      candidates = extractCandidates(result.body);
      U.cacheSet(normalized, candidates);
    }

    if (!candidates || candidates.length === 0) {
      UI.showMessage(addrEl, "住所が正しく解析できませんでした", "error");
      return;
    }

    // /parse が郵便番号を返さなかった場合は /postcodes でフォールバック検索
    if (candidates[0] && !candidates[0].postalCode && candidates[0].japanese) {
      console.debug("[address-resolver] /parse の郵便番号が null。/postcodes でフォールバック検索します");
      const fallbackRaw = await lookupPostalCodeByAddress(
        candidates[0].japanese,
        candidates[0].formattedAddress
      );
      if (fallbackRaw) {
        candidates[0].postalCode = U.formatPostalCode(fallbackRaw);
        console.debug("[address-resolver] フォールバックで郵便番号を取得:", candidates[0].postalCode);
      } else {
        console.debug("[address-resolver] フォールバックでも郵便番号が見つかりませんでした");
      }
    }

    // スコア判定（先頭候補のスコアで判断）
    const score = candidates[0].score;
    if (score != null && score < CFG.SCORE_THRESHOLD_WARN) {
      UI.showMessage(addrEl, "住所を正確に再入力してください", "error");
      return;
    }

    if (candidates.length === 1) {
      applyCandidate(candidates[0]);
      if (score != null && score < CFG.SCORE_THRESHOLD_OK) {
        UI.showMessage(addrEl, "住所が一部推測されています。ご確認ください", "warn");
      }
      return;
    }

    // 複数候補
    UI.showCandidateDropdown(addrEl, candidates, CFG.MAX_CANDIDATES_BEFORE_WARN, (chosen) => {
      applyCandidate(chosen);
      if (chosen.score != null && chosen.score < CFG.SCORE_THRESHOLD_OK) {
        UI.showMessage(addrEl, "住所が一部推測されています。ご確認ください", "warn");
      }
    });
  }

  const debouncedHandler = U.debounce(handleAddressChange, CFG.DEBOUNCE_MS);

  /**
   * 編集画面ロード時、住所欄に値があり分割フィールドのいずれかが空ならインポート扱いで自動解析する。
   * CSV インポート直後にレコードを開いた場合、change イベントが発火しないため必要。
   *
   * Pleasanter はフォーム値のポピュレートが on_editor_load の後ろにずれるケースがあるため、
   * 住所欄が空に見えても最大 ATTEMPTS 回までリトライする。
   */
  function autoResolveIfImported() {
    const ATTEMPTS = 8;
    const INTERVAL_MS = 250;
    const SPLIT_FIELDS = [F.POSTAL_CODE, F.PREFECTURE, F.CITY, F.DISTRICT, F.REST];

    const tryOnce = (left) => {
      const addr = getFieldValue(F.ADDRESS_FULL).trim();
      if (!addr) {
        if (left > 0) {
          setTimeout(() => tryOnce(left - 1), INTERVAL_MS);
        } else {
          console.debug("[address-resolver] 自動解析: 住所欄が空のため終了");
        }
        return;
      }
      const anyEmpty = SPLIT_FIELDS.some((name) => !getFieldValue(name).trim());
      if (anyEmpty) {
        console.debug("[address-resolver] 自動解析を実行:", addr);
        handleAddressChange();
      } else {
        console.debug("[address-resolver] 自動解析スキップ: 分割フィールドは全て埋まっています");
      }
    };

    tryOnce(ATTEMPTS);
  }

  /**
   * プリザンター編集画面のロード時にイベント登録。
   */
  function register() {
    const $ctrl = (typeof $p !== "undefined") ? $p.getControl(F.ADDRESS_FULL) : null;
    if (!$ctrl || !$ctrl.length) {
      console.warn(`[address-resolver] ${F.ADDRESS_FULL} 入力欄が見つかりません`);
      return;
    }
    $ctrl.off("change.addrResolver input.addrResolver blur.addrResolver");
    // change のみ採用（input は連発するため Free プランのレート制限に抵触しやすい）
    $ctrl.on("change.addrResolver", debouncedHandler);
    console.debug("[address-resolver] イベント登録完了");

    autoResolveIfImported();
  }

  if (typeof $p !== "undefined" && $p.events) {
    // プリザンター標準のロードフック
    const prev = $p.events.on_editor_load;
    $p.events.on_editor_load = function () {
      if (typeof prev === "function") { try { prev.apply(this, arguments); } catch (e) { console.error(e); } }
      register();
    };
  } else if (typeof $ !== "undefined") {
    $(function () { register(); });
  } else {
    document.addEventListener("DOMContentLoaded", register);
  }
})();
