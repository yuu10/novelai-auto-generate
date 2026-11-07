// NovelAI 自動生成 — 停止したときのブラウザ通知を出すバックグラウンドスクリプト
// コンテンツスクリプトからは chrome.notifications を使えないので、ここで代わりに出す
'use strict';

// 通知 ID にタブとウィンドウの番号を入れておき、通知を押したらそのタブを前に出す
// （service worker は止まることがあるので、メモリには覚えておかない）
const PREFIX = 'nai-auto-stop:';

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'nai-auto-stopped') return;
  const tab = sender.tab || {};
  const id = `${PREFIX}${tab.id ?? ''}:${tab.windowId ?? ''}:${Date.now()}`;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title: 'NovelAI 自動生成が止まりました',
    message: String(msg.message || '').slice(0, 300),
  });
});

chrome.notifications.onClicked.addListener(id => {
  if (!id.startsWith(PREFIX)) return;
  const [tabId, windowId] = id.slice(PREFIX.length).split(':').map(Number);
  if (Number.isInteger(tabId)) chrome.tabs.update(tabId, { active: true }).catch(() => {});
  if (Number.isInteger(windowId)) chrome.windows.update(windowId, { focused: true }).catch(() => {});
  chrome.notifications.clear(id);
});
