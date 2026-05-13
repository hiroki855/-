# コード読み方ガイド

このスクリプト群を初見で読むときの道筋と、各部のポイントをまとめたもの。
最初に **§1 全体像** → **§2 データの流れ** を読むと、各ファイルが何をやっているか位置づけられる。

---

## 1. 全体像

4ファイル構成で、責務をはっきり分けている。

```
┌──────────────────────────────────────────────────────────┐
│ config.js                                                │
│   ・APIキー、エンドポイント、フィールド物理名、閾値などの定数  │
│   ・グローバル定数 ADDRESS_RESOLVER_CONFIG を1つだけ公開    │
└──────────────────────────────────────────────────────────┘
                       ↓ 参照
┌──────────────────────────────────────────────────────────┐
│ address-resolver-utils.js                                │
│   ・入力正規化、郵便番号フォーマット、4区分の組み立て         │
│   ・debounce、セッションキャッシュ                          │
│   ・グローバル AddressResolverUtils を1つだけ公開           │
└──────────────────────────────────────────────────────────┘
                       ↓ 参照
┌──────────────────────────────────────────────────────────┐
│ address-resolver-ui.js                                   │
│   ・候補ドロップダウン、警告/エラーメッセージ                 │
│   ・DOM 操作はここに閉じ込める                              │
│   ・グローバル AddressResolverUI を1つだけ公開              │
└──────────────────────────────────────────────────────────┘
                       ↓ 参照
┌──────────────────────────────────────────────────────────┐
│ address-resolver.js（エントリ）                           │
│   ・プリザンターの onChange を拾う                         │
│   ・PostcodeJP API を fetch                              │
│   ・レスポンスで分岐 → UI 呼び出し or フィールドセット        │
└──────────────────────────────────────────────────────────┘
```

**読む順序**: `config.sample.js` → `address-resolver-utils.js` → `address-resolver-ui.js` → `address-resolver.js`

`address-resolver.js` が一番上位の「指揮者」で、下の3つを呼び出す側。最初にエントリから読むより、**下から積み上げて読む方が理解しやすい**。

---

## 2. データの流れ（1リクエストの旅）

ユーザーが住所欄に文字を入れてフォーカスを外すまでの流れ。

```
[1] ユーザー入力:
    "神奈川県横浜市鶴見区平安町1丁目60番地2号"
        │
        │ change イベント発火
        ▼
[2] address-resolver.js のハンドラ起動
        │
        │ debounce(500ms) で1本化
        ▼
[3] handleAddressChange()
        │
        ├─ normalizeInput()  ←  utils
        │     "神奈川県横浜市鶴見区平安町1丁目60番地2号"
        │
        ├─ cacheHas() で重複チェック  ←  utils
        │
        ├─ callParseApi()  →  PostcodeJP /parse
        │     fetch + AbortController(5秒タイムアウト)
        │
        ├─ extractCandidates()  ←  レスポンス整形
        │
        ├─ スコア判定
        │     score >= 0.9 → 通常セット
        │     0.7 <= score < 0.9 → セット + 警告
        │     score < 0.7 → セットせず警告
        │
        └─ 候補数で分岐
              1件 → applyCandidate() で各フィールドへ
              2件以上 → UI.showCandidateDropdown()
                          ユーザーがクリック → applyCandidate()
        │
        ▼
[4] プリザンターのフィールドが書き換わる
    ClassN: 230-0023
    ClassY: 神奈川県
    ClassX: 横浜市鶴見区
    ClassS: 平安町
    ClassQ: 1-60 2号
```

---

## 3. 各ファイルの読み解き

### 3.1 config.sample.js（雛形）

```javascript
"use strict";
const ADDRESS_RESOLVER_CONFIG = {
  API_ENDPOINT: "...",
  API_KEY: "...",
  SITE_ID: 44884,
  FIELD: { ADDRESS_FULL: "ClassH", ... },
  DEBOUNCE_MS: 500,
  ...
};
```

- **「すべての設定をここに集約する」** がコンセプト
- 他のファイルからは `ADDRESS_RESOLVER_CONFIG.FIELD.POSTAL_CODE` のように参照
- サイト横展開時はこのファイルだけ書き換えればOK
- `config.js` は `.gitignore` 対象なので、ローカルでコピー＆書き換えする運用

### 3.2 address-resolver-utils.js

**IIFE モジュールパターン** で書かれている。

```javascript
const AddressResolverUtils = (() => {
  // 内側はクロージャ。_cache などの "内部状態" は外から見えない
  const _cache = new Map();

  function normalizeInput(text) { ... }
  function formatPostalCode(code) { ... }
  // ...

  // return オブジェクトに入れた関数だけが外部公開される
  return {
    normalizeInput,
    formatPostalCode,
    // ...
  };
})();
```

ES Modules が使えない環境（プリザンターの script タグ直挿し）で **名前空間を1つに絞る** ためのイディオム。

#### `normalizeInput()` の中身

```javascript
s = s.replace(/[\r\n\t]+/g, " ");                                        // 改行/タブ → 空白
s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); // 全角英数 → 半角
s = s.replace(/[ーｰ−–—―‐]/g, "-");                                        // 各種ハイフン → -
s = s.replace(/　/g, " ");                                               // 全角空白 → 半角
s = s.replace(/ +/g, " ");                                               // 連続空白を1つに
return s.trim();
```

`0xFEE0` は **全角英数記号と半角の差分** を表す Unicode 上のマジックナンバー。例：
- 全角 `Ａ` (U+FF21) − 0xFEE0 = `A` (U+0041)
- 全角 `１` (U+FF11) − 0xFEE0 = `1` (U+0031)

#### `buildFieldValues()` の中身

API レスポンスの `japanese` オブジェクトを、要件 §4.1 の連結ルールで4区分にまとめる関数。

```javascript
const blockHouse = joinNonEmpty([j.block, j.house_num], "-");  // "1-60"
const rest = joinNonEmpty([blockHouse, j.building, j.room], " ");
// → "1-60 グラネステート9階 205号室"
```

`joinNonEmpty` は **空要素を捨ててから join する** 自前ヘルパ。`["a","","b"].join("-")` が `"a--b"` になるのを避けるため。

#### `debounce()`

```javascript
function debounce(fn, wait) {
  let timer = null;
  const debounced = function (...args) {
    if (timer) clearTimeout(timer);   // 既存タイマーを取り消し
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
  return debounced;
}
```

**「最後の呼び出しから wait ms 静かだったら実行」** という挙動。ハンドラ自身に状態（`timer`）を閉じ込めるため、こちらもクロージャ。

### 3.3 address-resolver-ui.js

DOM 操作だけ集めた部品。ロジックには触れない。

#### ドロップダウンのライフサイクル

```
showCandidateDropdown()
    │
    ├─ removeDropdown()     ← 既存があれば破棄（多重表示防止）
    ├─ <div> を作って中身を組み立て
    ├─ getBoundingClientRect() で住所欄の位置を取り位置決め
    ├─ document.body.appendChild()
    ├─ 外側クリック・Esc キーのリスナを登録
    │
    └─（ユーザー操作）
         ├─ 行 mousedown → onSelect(candidate) → removeDropdown()
         ├─ 外側 mousedown → removeDropdown()
         └─ Esc → removeDropdown()
```

ポイント：
- `position: absolute` + `getBoundingClientRect()` + `scrollX/Y` で **スクロール込みの絶対座標** に固定
- `mousedown` を使うのは、`click` だと「フォーカス移動でドロップダウン側が先に閉じてしまう」問題を避けるため
- `ev.preventDefault()` で住所欄のフォーカス維持
- 外側クリックリスナは **`true`（キャプチャ段階）** で登録 → 他のハンドラより先に検知できる

#### スタイルは JS から `style` 直書き

```javascript
Object.assign(dd.style, {
  position: "absolute",
  background: "#fff",
  border: "1px solid #ccc",
  ...
});
```

プリザンターの CSS と衝突しないよう、クラス指定ではなくインライン style にした（独自プレフィックス `addr-resolver-dropdown` はクラス名として残してある）。

### 3.4 address-resolver.js（エントリ）

ファイル全体が即時実行関数 `(function () { ... })()` で囲まれていて、グローバル汚染ゼロ。

#### モジュール参照の取り出し

```javascript
const CFG = ADDRESS_RESOLVER_CONFIG;
const U = AddressResolverUtils;
const UI = AddressResolverUI;
const F = CFG.FIELD;
```

毎回 `ADDRESS_RESOLVER_CONFIG.FIELD.POSTAL_CODE` と書くと冗長なので、短い別名に束ねている。

#### プリザンターとの接点（3関数）

```javascript
function getControlEl(physicalName)   // jQuery から生 DOM を取る
function setField(physicalName, value) // $p.set で値をセット
function clearRelatedFields()          // 全フィールドを空に
```

**プリザンターの API への依存はこの3関数に集約**。仕様変更があってもここだけ直せば済む設計。

#### `callParseApi()` — fetch の定型パターン

```javascript
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS);
try {
  const res = await fetch(url, { signal: ctrl.signal, ... });
  if (!res.ok) return { status: "http_error", httpStatus: res.status };
  return { status: "ok", body: await res.json() };
} catch (e) {
  if (e.name === "AbortError") return { status: "timeout", error: e };
  return { status: "network", error: e };
} finally {
  clearTimeout(timer);
}
```

イディオムとして覚えると役に立つ：
- `AbortController` + `setTimeout` で **fetch にタイムアウトを付ける**
- `try/catch/finally` の `finally` で **必ずタイマー解除**
- 戻り値を `{ status, ... }` の判別オブジェクトにすると、呼び出し側が `switch` 風に分岐できる

#### `extractCandidates()` — 配列とオブジェクトの両対応

PostcodeJP の `japanese` フィールドは、単数住所では **オブジェクト1個** 、複数候補では **配列** で返ってくる可能性がある。コードはどちらでも動くように両対応：

```javascript
const japaneseList = Array.isArray(body.japanese)
  ? body.japanese
  : (body.japanese ? [body.japanese] : []);
```

#### `handleAddressChange()` — メインの分岐

読みやすいよう、以下の段階で **早期 return** している：

1. 住所欄が見つからない → return
2. 入力が空 → クリアして return
3. 前回と同じ値 → return（連打防止）
4. 進行中の API 呼び出しあり → return（in-flight 防止）
5. 各種エラー → メッセージ表示して return
6. 候補0件 → メッセージ表示して return
7. スコア低すぎ → 警告して return
8. 候補1件 → セットして return
9. 候補2件以上 → ドロップダウン表示

**ネストを深くせず、フラットに条件を並べる**のがコツ。各段階で「ここまで来たらこういう状態」と読めるようにしてある。

#### イベント登録部

```javascript
$ctrl.off("change.addrResolver input.addrResolver blur.addrResolver");
$ctrl.on("change.addrResolver", debouncedHandler);
```

- `.addrResolver` は **jQuery イベント名前空間**。これを付けておくと、`off` で「このスクリプトが登録したぶんだけ」きれいに外せる
- `change` のみリッスン（`input` を入れると Free プランの 1req/sec 制限に抵触しやすい）

```javascript
const prev = $p.events.on_editor_load;
$p.events.on_editor_load = function () {
  if (typeof prev === "function") prev.apply(this, arguments);
  register();
};
```

プリザンターの **既存のロードフックを潰さずに自分のを追加する** 定型。`prev` をクロージャに保存 → 自分の処理の前に呼ぶ。

---

## 4. よく出てくる JS イディオム早見表

| イディオム | 意味 | 例 |
| --- | --- | --- |
| `(() => { ... })()` | 即時実行関数（IIFE）。内側をスコープに閉じ込めて1つだけ公開 | `const Mod = (() => { ... return {...}; })();` |
| `s = s.replace(/.../g, ...)` | 全置換 | `"abc".replace(/b/g, "X") → "aXc"` |
| `Array.isArray(x) ? x : (x ? [x] : [])` | 「単数 or 配列」を配列に正規化 | レスポンス受け取り定番 |
| `try { ... } finally { ... }` | 例外有無に関わらず後始末 | タイマー解除、ロック解放 |
| `await fn()` | Promise を逐次で待つ | `const res = await fetch(...)` |
| `Object.assign(a, b)` | b のプロパティを a にマージ | スタイル一括設定 |
| `el.style.xxx = "..."` | DOM スタイル設定 | `el.style.color = "red"` |
| `addEventListener(ev, fn, true)` | 第3引数 true でキャプチャ段階 | 外側クリック検知 |
| `condition && action()` | if の簡略形 | `flag && doStuff()` |

---

## 5. 拡張するときの当たりどころ

| やりたいこと | 触るファイル |
| --- | --- |
| APIキー差し替え | `config.js` の `API_KEY` |
| 別サイトに展開 | `config.js` の `SITE_ID` と `FIELD` を書き換え |
| デバウンス時間を変える | `config.js` の `DEBOUNCE_MS` |
| 4区分の連結ルールを変える | `address-resolver-utils.js` の `buildFieldValues()` |
| 候補ドロップダウンの見た目 | `address-resolver-ui.js` の `Object.assign(dd.style, ...)` |
| エラーメッセージの文言 | `address-resolver.js` の `messageForHttp()` と各 `showMessage()` 呼び出し |
| 別の API に乗り換える | `address-resolver.js` の `callParseApi()` と `extractCandidates()` |
| プリザンターAPIの呼び出し方を変える | `address-resolver.js` の `getControlEl()` / `setField()` |

「変えたいときにここ1か所」を意識した分割になっているので、修正範囲は狭く保てる。

---

## 6. デバッグの入り口

ブラウザ DevTools の Console で：

```javascript
// 設定が読めているか
ADDRESS_RESOLVER_CONFIG

// ユーティリティを直接叩いてみる
AddressResolverUtils.normalizeInput("東京都　杉並区　阿佐谷南")
AddressResolverUtils.formatPostalCode("1660004")

// キャッシュ状況を見る（_cache は外から見えない設計だが、cacheHas で確認可能）
AddressResolverUtils.cacheHas("東京都杉並区阿佐谷南三丁目1-2")
AddressResolverUtils.cacheClear()  // 全消し

// プリザンターのフィールド取得
$p.getControl("ClassH")
$p.getControl("ClassH").val()
```

`[address-resolver]` プレフィックス付きのログ（`console.debug` / `console.warn` / `console.error`）を流しているので、Console フィルタに `address-resolver` と入れると自分のログだけ追える。
