"use strict";

/**
 * 住所処理スクリプトのUI部品。
 * - 複数候補のドロップダウン表示
 * - 警告 / エラーメッセージ表示
 */
const AddressResolverUI = (() => {

  const DROPDOWN_CLASS = "addr-resolver-dropdown";
  const MESSAGE_CLASS  = "addr-resolver-message";

  let _outsideClickHandler = null;
  let _escKeyHandler = null;

  /**
   * 既存のドロップダウンを破棄する。
   */
  function removeDropdown() {
    document.querySelectorAll(`.${DROPDOWN_CLASS}`).forEach((el) => el.remove());
    if (_outsideClickHandler) {
      document.removeEventListener("mousedown", _outsideClickHandler, true);
      _outsideClickHandler = null;
    }
    if (_escKeyHandler) {
      document.removeEventListener("keydown", _escKeyHandler, true);
      _escKeyHandler = null;
    }
  }

  /**
   * 候補ドロップダウンを表示する。
   * @param {HTMLElement} anchorEl - 住所入力欄要素
   * @param {Array<{postalCode:string, address:string, raw:object}>} candidates
   * @param {number} maxBeforeWarn
   * @param {(candidate:object)=>void} onSelect
   */
  function showCandidateDropdown(anchorEl, candidates, maxBeforeWarn, onSelect) {
    removeDropdown();
    if (!anchorEl || !candidates || candidates.length === 0) return;

    const tooMany = candidates.length > maxBeforeWarn;
    const visible = tooMany ? candidates.slice(0, maxBeforeWarn) : candidates;

    const dd = document.createElement("div");
    dd.className = DROPDOWN_CLASS;
    Object.assign(dd.style, {
      position: "absolute",
      background: "#fff",
      border: "1px solid #ccc",
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      zIndex: "1000",
      maxHeight: "320px",
      overflowY: "auto",
      boxSizing: "border-box",
    });

    if (tooMany) {
      const warn = document.createElement("div");
      warn.textContent = "該当が多すぎます。住所をより具体的に入力してください";
      Object.assign(warn.style, {
        color: "#c00",
        padding: "6px 10px",
        borderBottom: "1px solid #eee",
        fontSize: "0.9em",
      });
      dd.appendChild(warn);
    }

    visible.forEach((c) => {
      const row = document.createElement("div");
      row.textContent = `${c.postalCode} ${c.address}`;
      Object.assign(row.style, {
        padding: "6px 10px",
        height: "32px",
        lineHeight: "20px",
        cursor: "pointer",
        boxSizing: "border-box",
      });
      row.addEventListener("mouseenter", () => { row.style.background = "#eef5ff"; });
      row.addEventListener("mouseleave", () => { row.style.background = "#fff"; });
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        try { onSelect(c); } finally { removeDropdown(); }
      });
      dd.appendChild(row);
    });

    // 位置決め: anchorEl の直下、同じ幅
    const rect = anchorEl.getBoundingClientRect();
    dd.style.left = `${rect.left + window.scrollX}px`;
    dd.style.top  = `${rect.bottom + window.scrollY}px`;
    dd.style.width = `${rect.width}px`;

    document.body.appendChild(dd);

    _outsideClickHandler = (ev) => {
      if (!dd.contains(ev.target) && ev.target !== anchorEl) {
        removeDropdown();
      }
    };
    document.addEventListener("mousedown", _outsideClickHandler, true);

    _escKeyHandler = (ev) => {
      if (ev.key === "Escape") removeDropdown();
    };
    document.addEventListener("keydown", _escKeyHandler, true);
  }

  /**
   * メッセージ表示（警告 / エラー）。住所欄直下、ドロップダウンとは独立した領域。
   * @param {HTMLElement} anchorEl
   * @param {string} message
   * @param {"warn"|"error"|"info"} level
   */
  function showMessage(anchorEl, message, level) {
    clearMessage();
    if (!anchorEl || !message) return;
    const el = document.createElement("div");
    el.className = MESSAGE_CLASS;
    el.textContent = message;
    const color = level === "error" ? "#c00" : level === "warn" ? "#b36b00" : "#333";
    Object.assign(el.style, {
      color,
      fontSize: "0.9em",
      marginTop: "4px",
    });
    if (anchorEl.parentNode) {
      anchorEl.parentNode.insertBefore(el, anchorEl.nextSibling);
    }
  }

  function clearMessage() {
    document.querySelectorAll(`.${MESSAGE_CLASS}`).forEach((el) => el.remove());
  }

  return {
    showCandidateDropdown,
    removeDropdown,
    showMessage,
    clearMessage,
  };
})();
