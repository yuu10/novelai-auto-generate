// NovelAI 自動生成 — 画像生成ボタンを自動でくり返し押すコンテンツスクリプト
(function () {
  'use strict';

  // 間隔の下限（秒）。NovelAI に負荷をかけすぎないよう、これより短くはできない
  const MIN_INTERVAL_SEC = 3;
  const clampInterval = v => Math.max(MIN_INTERVAL_SEC, Number(v) || 0);

  // ---- 設定（パネルから変更でき、chrome.storage に保存されます） ----
  const settings = {
    intervalSec: 3,   // 生成が終わってから次を押すまでの待ち時間（秒）
    maxCount: 10,     // 最大回数（0 = 無制限）
    maxHours: 1,      // 連続上限（時間）。開始からこの時間がたったら止める（最大 24）
    stopIfCost: true, // ボタンに Anlas 消費が表示されたら止める
    stopOnError: true, // NovelAI が生成エラーを表示したら止める
    notifyOnStop: true, // 止まったらブラウザ通知を出す（手動で止めたときは出さない）
  };

  let running = false;
  let count = 0;
  let startedAt = 0; // 開始した時刻（連続上限の判定に使う）
  let timer = null;

  // 生成ボタンを探す（英語・日本語 UI 両対応）
  function findButton() {
    return [...document.querySelectorAll('button')].find(b =>
      /generate|生成/i.test(b.textContent || '') && !b.closest('#nai-auto-panel'));
  }

  function isBusy(btn) {
    return btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  // ボタンの文字（空白をまとめたもの）
  function btnText(btn) {
    return (btn.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ボタンに Anlas のコスト（0 より大きい数字）が表示されているか
  function hasCost(btn) {
    // 「1 Image」「1枚」などの枚数表示は除いてから数字を探す
    const text = btnText(btn)
      .replace(/\d+\s*(images?|枚)/gi, '')
      .replace(/generate|生成/gi, '');
    const nums = text.match(/\d+/g) || [];
    // 「0」は無料生成なので消費とはみなさない
    return nums.some(n => Number(n) > 0);
  }

  function setStatus(msg) {
    const el = document.getElementById('nai-auto-status');
    if (el) el.textContent = msg;
  }

  function stop(reason) {
    running = false;
    clearTimeout(timer);
    stopErrorWatch();
    const t = document.getElementById('nai-auto-toggle');
    if (t) t.textContent = '開始';
    setRunningMark();
    const msg = `停止: ${reason}（${count} 回）`;
    setStatus(msg);
    if (settings.notifyOnStop && reason !== '手動') notify(msg);
  }

  // 裏のタブでも気づけるように、バックグラウンドスクリプトにブラウザ通知を頼む
  function notify(message) {
    try {
      chrome.runtime.sendMessage({ type: 'nai-auto-stopped', message }, () => void chrome.runtime.lastError);
    } catch (e) { /* 拡張機能を更新した直後などは送れないので無視 */ }
  }

  // ---- 生成エラーの検出 ----
  // NovelAI は生成に失敗すると画面の端に通知（トースト）を出す。実行中だけ画面に新しく
  // 追加された要素を見張り、トーストらしい要素の中身がエラーらしければ止める。
  // 開始前から出ていたトーストは「新しく追加された」ものではないので対象にならない。
  const TOAST_SEL = '.Toastify__toast, [class*="toast" i], [role="alert"]';
  const ERROR_WORDS = /error|failed|failure|unable to|could ?n[o']t|too many|concurrent|busy|overloaded|try again|unavailable|timed? ?out|エラー|失敗|できませんでした|混雑|混み合|しばらく|再試行|もう一度/i;
  let errorObserver = null;

  function toastText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isErrorToast(el) {
    if (el.closest('#nai-auto-panel')) return false;
    const text = toastText(el);
    if (!text) return false;
    // react-toastify のエラー用の見た目（Toastify__toast--error など）か、文言がエラーらしいか
    return /(^|[-_\s])error\b/i.test(el.className || '') || ERROR_WORDS.test(text);
  }

  function findErrorToast(nodes) {
    for (const node of nodes) {
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el) continue;
      const candidates = [el.closest(TOAST_SEL), ...(el.querySelectorAll ? el.querySelectorAll(TOAST_SEL) : [])];
      const hit = candidates.find(c => c && isErrorToast(c));
      if (hit) return hit;
    }
    return null;
  }

  function startErrorWatch() {
    stopErrorWatch();
    if (!settings.stopOnError) return;
    errorObserver = new MutationObserver(records => {
      if (!running) return;
      const toast = findErrorToast(records.flatMap(r => [...r.addedNodes, ...(r.type === 'characterData' ? [r.target] : [])]));
      if (!toast) return;
      const text = toastText(toast);
      stop(`エラーが表示されました「${text.length > 80 ? text.slice(0, 80) + '…' : text}」`);
    });
    errorObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopErrorWatch() {
    if (errorObserver) { errorObserver.disconnect(); errorObserver = null; }
  }

  function tick() {
    if (!running) return;
    if (settings.maxCount > 0 && count >= settings.maxCount) return stop('最大回数に到達');
    // 生成中には判定しないので、時間が来ても今の生成が終わってから止まる
    if (Date.now() - startedAt >= settings.maxHours * 3600 * 1000) return stop('連続上限に到達');

    const btn = findButton();
    if (!btn) { setStatus('ボタンが見つかりません…'); timer = setTimeout(tick, 1000); return; }

    // 生成中（ボタン無効）なら終わるまで待つ
    if (isBusy(btn)) {
      setStatus(`生成中… (${count} 回)`);
      timer = setTimeout(tick, 500);
      return;
    }

    if (settings.stopIfCost && hasCost(btn)) return stop(`Anlas を消費する設定になっています。ボタン表示「${btnText(btn)}」`);

    btn.click();
    count++;
    setStatus(`クリック ${count} 回目`);
    // 押した直後はボタンが無効になるまで少し待ってから、生成完了を待つ
    timer = setTimeout(waitDone, 1000);
  }

  function waitDone() {
    if (!running) return;
    const btn = findButton();
    if (btn && isBusy(btn)) {
      setStatus(`生成中… (${count} 回)`);
      timer = setTimeout(waitDone, 500);
    } else {
      setStatus(`待機中 ${settings.intervalSec} 秒… (${count} 回)`);
      timer = setTimeout(tick, clampInterval(settings.intervalSec) * 1000);
    }
  }

  // ---- 操作パネル ----
  // パネルの位置（画面の右端・下端からの距離 px）とたたみ状態。設定とは別に保存する
  const DEFAULT_POS = { right: 16, bottom: 16 };
  const ui = { pos: { ...DEFAULT_POS }, collapsed: false };

  function saveUi() {
    try { chrome.storage.local.set({ ui }); } catch (e) { /* 無視 */ }
  }

  // パネルが画面の外に出ないように位置を直して反映する
  function applyPos(p) {
    const maxRight = Math.max(0, window.innerWidth - p.offsetWidth);
    const maxBottom = Math.max(0, window.innerHeight - p.offsetHeight);
    ui.pos.right = Math.min(Math.max(0, ui.pos.right), maxRight);
    ui.pos.bottom = Math.min(Math.max(0, ui.pos.bottom), maxBottom);
    p.style.right = ui.pos.right + 'px';
    p.style.bottom = ui.pos.bottom + 'px';
  }

  function applyCollapsed(p) {
    p.querySelector('#nai-auto-body').style.display = ui.collapsed ? 'none' : 'block';
    const btn = p.querySelector('#nai-auto-fold');
    btn.textContent = ui.collapsed ? '＋' : '−';
    btn.title = ui.collapsed ? '開く' : 'たたむ';
    applyPos(p);
  }

  // 実行中かどうかをヘッダーの丸で表示（たたんでいても分かるように）
  function setRunningMark() {
    const el = document.getElementById('nai-auto-mark');
    if (el) {
      el.style.color = running ? '#4ade80' : '#888';
      el.title = running ? '実行中' : '停止中';
    }
  }

  function makeDraggable(p, handle) {
    let start = null;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      start = { x: e.clientX, y: e.clientY, right: ui.pos.right, bottom: ui.pos.bottom };
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!start) return;
      ui.pos.right = start.right - (e.clientX - start.x);
      ui.pos.bottom = start.bottom - (e.clientY - start.y);
      applyPos(p);
    });
    const end = () => { if (start) { start = null; saveUi(); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // ダブルクリックで右下の元の位置に戻す
    handle.addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      ui.pos = { ...DEFAULT_POS };
      applyPos(p);
      saveUi();
    });
  }

  function buildPanel() {
    const p = document.createElement('div');
    p.id = 'nai-auto-panel';
    p.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;background:#1e1e2e;' +
      'color:#fff;padding:10px 12px;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px #0008;';
    let version = '?';
    try { version = chrome.runtime.getManifest().version; } catch (e) { /* 無視 */ }
    // 入力欄: 白い枠の中に数字と、右端に薄い補足（「秒」「0=無制限」）を並べる
    const boxCss = 'display:flex !important;align-items:center !important;gap:4px !important;width:110px !important;box-sizing:border-box !important;background:#fff !important;border:1px solid #888 !important;border-radius:3px !important;padding:1px 4px !important';
    const inputCss = 'flex:1 !important;width:100% !important;min-width:0 !important;margin:0 !important;padding:0 !important;border:none !important;outline:none !important;background:transparent !important;color:#000 !important;font:13px sans-serif !important';
    const hintCss = 'color:#888 !important;font-size:11px !important;white-space:nowrap !important';
    // チェックボックスの行: NovelAI 側の CSS で幅が広がったり文字が折り返されたりしないよう、大きさを固定する
    const checkCss = 'display:flex !important;align-items:center !important;justify-content:flex-start !important;gap:4px !important;width:auto !important;margin:6px 0 0 !important;padding:0 !important;font-size:11px !important;opacity:.85 !important';
    const boxInCss = 'flex:none !important;width:13px !important;height:13px !important;min-width:0 !important;margin:0 !important;padding:0 !important';
    const checkTextCss = 'flex:none !important;white-space:nowrap !important';
    p.innerHTML = `
      <div id="nai-auto-head" title="ドラッグで移動／ダブルクリックで右下に戻す" style="display:flex !important;align-items:center !important;gap:6px !important;cursor:move !important;user-select:none !important;touch-action:none !important">
        <span id="nai-auto-mark" style="font-size:10px !important">●</span>
        <span style="font-weight:bold">自動生成 <span style="font-weight:normal;opacity:.6">v${version}</span></span>
        <button id="nai-auto-fold" style="margin-left:auto !important;width:22px !important;height:20px !important;padding:0 !important;line-height:18px !important;background:#333648 !important;color:#fff !important;border:none !important;border-radius:4px !important;cursor:pointer !important">−</button>
      </div>
      <div id="nai-auto-body" style="margin-top:6px">
        <div style="display:grid !important;grid-template-columns:auto auto !important;gap:5px 8px !important;align-items:center !important">
          <label for="nai-auto-int">間隔</label>
          <span style="${boxCss}"><input id="nai-auto-int" type="number" min="${MIN_INTERVAL_SEC}" style="${inputCss}"><span style="${hintCss}">秒</span></span>
          <label for="nai-auto-max">最大回数</label>
          <span style="${boxCss}"><input id="nai-auto-max" type="number" min="0" style="${inputCss}"><span style="${hintCss}">0=無制限</span></span>
          <label for="nai-auto-hours">連続上限</label>
          <span style="${boxCss}"><input id="nai-auto-hours" type="number" min="0.5" max="24" step="0.5" style="${inputCss}"><span style="${hintCss}">時間</span></span>
        </div>
        <label style="${checkCss}"><input id="nai-auto-cost" type="checkbox" style="${boxInCss}"><span style="${checkTextCss}">Anlas 消費時は止める</span></label>
        <label style="${checkCss}"><input id="nai-auto-err" type="checkbox" style="${boxInCss}"><span style="${checkTextCss}">エラー表示で止める</span></label>
        <label style="${checkCss}"><input id="nai-auto-notify" type="checkbox" style="${boxInCss}"><span style="${checkTextCss}">止まったら通知</span><span style="${hintCss};margin-left:auto !important;padding-left:8px !important">手動停止は除く</span></label>
        <button id="nai-auto-toggle" style="margin-top:6px !important;padding:4px 14px !important;background:#4f6bed !important;color:#fff !important;border:none !important;border-radius:4px !important;cursor:pointer !important">開始</button>
        <div id="nai-auto-status" style="margin-top:6px !important;opacity:.8 !important;max-width:260px !important;word-break:break-all !important">待機中</div>
      </div>`;
    document.body.appendChild(p);

    const $ = id => document.getElementById(id);
    if (running) $('nai-auto-toggle').textContent = '停止';
    setRunningMark();
    applyCollapsed(p);
    makeDraggable(p, $('nai-auto-head'));
    $('nai-auto-fold').onclick = () => {
      // ヘッダー（上端）の位置が変わらないように、高さの差だけ下端からの距離を直す
      const top = p.getBoundingClientRect().top;
      ui.collapsed = !ui.collapsed;
      applyCollapsed(p);
      ui.pos.bottom = window.innerHeight - top - p.offsetHeight;
      applyPos(p);
      saveUi();
    };

    const fill = () => {
      $('nai-auto-int').value = settings.intervalSec;
      $('nai-auto-max').value = settings.maxCount;
      $('nai-auto-hours').value = settings.maxHours;
      $('nai-auto-cost').checked = settings.stopIfCost;
      $('nai-auto-err').checked = settings.stopOnError;
      $('nai-auto-notify').checked = settings.notifyOnStop;
    };
    fill();
    // 前回の設定とパネルの位置・たたみ状態を読み込む
    try {
      chrome.storage.local.get({ ...settings, ui }, saved => {
        const { ui: savedUi, ...savedSettings } = saved;
        Object.assign(settings, savedSettings);
        // 下限を設ける前のバージョンで保存した短い間隔も、下限まで引き上げる
        settings.intervalSec = clampInterval(settings.intervalSec);
        if (savedUi) {
          ui.pos = { ...DEFAULT_POS, ...savedUi.pos };
          ui.collapsed = !!savedUi.collapsed;
        }
        fill();
        if (p.isConnected) applyCollapsed(p);
      });
    } catch (e) { /* storage が使えなくても既定値で動く */ }

    $('nai-auto-toggle').onclick = () => {
      if (running) return stop('手動');
      // 下限（3 秒）より短い値や空欄は 3 秒にする
      settings.intervalSec = clampInterval($('nai-auto-int').value);
      $('nai-auto-int').value = settings.intervalSec;
      settings.maxCount = Math.max(0, Number($('nai-auto-max').value) || 0);
      // リミッターなので無制限にはできない。0 以下や空欄は既定の 1 時間、24 時間を超えたら 24 時間にする
      const hours = Number($('nai-auto-hours').value);
      settings.maxHours = hours > 0 ? Math.min(24, hours) : 1;
      $('nai-auto-hours').value = settings.maxHours;
      settings.stopIfCost = $('nai-auto-cost').checked;
      settings.stopOnError = $('nai-auto-err').checked;
      settings.notifyOnStop = $('nai-auto-notify').checked;
      try { chrome.storage.local.set(settings); } catch (e) { /* 無視 */ }
      count = 0;
      startedAt = Date.now();
      running = true;
      $('nai-auto-toggle').textContent = '停止';
      setRunningMark();
      startErrorWatch();
      tick();
    };
  }

  // ウィンドウを小さくしてもパネルが画面の外に出ないようにする
  window.addEventListener('resize', () => {
    const p = document.getElementById('nai-auto-panel');
    if (p) applyPos(p);
  });

  // NovelAI はページ遷移しても読み込み直さないので、画像生成画面のときだけパネルを出す
  setInterval(() => {
    if (!document.body) return;
    const onImage = location.pathname.startsWith('/image');
    const panel = document.getElementById('nai-auto-panel');
    if (onImage && !panel) buildPanel();
    if (!onImage && panel) { if (running) stop('画面を移動'); panel.remove(); }
  }, 500);
})();
