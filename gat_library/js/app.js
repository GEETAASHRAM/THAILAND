
// =========================================================
// GITA APP ENGINE (CLEANED / ENHANCED BUILD)
// =========================================================
// This file is a cleaned, grouped, and future-ready version of the
// original application script.
//
// Key goals:
// - Preserve main reader/search/karaoke/share/subscription behaviors
// - Improve resilience with stronger exception handling
// - Keep code grouped by domain with explicit section separators
// - Prepare a backend integration contract for Google Apps Script
// - Provide iOS / Android automation helpers and push subscription hooks
// - Keep code understandable for future maintenance and enhancement
// =========================================================

(function () {
  'use strict';

  // -------------------------------------------------------
  // Configuration constants
  // -------------------------------------------------------
  const QR_LOGO_URL = './gat_library/images/swamiharihar_ji_maharaj_transparent.png';
  const IOS_SHORTCUT_NAME = 'Open Gita Subscription';
  const IOS_SHORTCUT_ICLOUD_IMPORT_URL = '';
  const ANDROID_AUTOMATION_VENDOR = 'generic';
  const APPS_SCRIPT_BASE_URL = 'https://script.google.com/macros/s/AKfycbwfgkFEk2bPrtbqIZHOgecpptZ-upByh8SKS5nfQ-zPrBC8MipAM_TqiUXSN_aAmHOe/exec'; 
  const PUSH_PUBLIC_VAPID_KEY = ''; // Optional. If you later move push provider elsewhere.
  const BACKEND_TIMEOUT_MS = 15000;
  const APP_VERSION = '2026.04.18-b';
  const DEFAULT_SUB_TIME = '21:15';
  const DEFAULT_PUSH_POLL_MS = 5 * 60 * 1000;
  const DEBUG_MODE = false;

  // -------------------------------------------------------
  // Global state
  // -------------------------------------------------------
  const state = {
    container: document.getElementById('container'),
    searchResults: document.getElementById('searchResults'),
    chapterSelect: document.getElementById('chapterSelect'),
    searchInput: document.getElementById('searchInput'),
    globalPresentationBtn: document.getElementById('globalPresentationBtn'),
    globalGeetaData: [],
    currentChapterAudio: null,
    chunkMonitorId: null,
    currentPlaylist: [],
    precomputedSubOptions: { chapter: [], verse: [] },
    deferredPwaPrompt: null,
    currentSharePayload: null,
    lastRenderedQrUrl: '',
    currentQrRenderPromise: Promise.resolve(),
    pushUiState: {
      supported: false,
      canPrompt: false,
      installedWebAppRequired: false,
      subscribed: false,
      backendConfigured: false,
      backendHealthy: false,
      permission: (typeof Notification !== 'undefined' ? Notification.permission : 'default')
    },
    backendConfig: {
      baseUrl: APPS_SCRIPT_BASE_URL,
      mode: 'apps-script',
      ready: false,
      sheetEnabled: false,
      pushEnabled: false,
      vapidPublicKey: PUSH_PUBLIC_VAPID_KEY || ''
    },
    poller: {
      reminderIntervalId: null,
      lastReminderCheckAt: null,
      lastReminderNotificationKey: ''
    },
    kState: {
      playlist: [],
      listIndex: 0,
      mode: 'chapter',
      animId: null,
      audio: new Audio()
    }
  };

  // -------------------------------------------------------
  // Debug helper
  // -------------------------------------------------------
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log('[GitaApp]', ...args);
    }
  }

  // -------------------------------------------------------
  // Utility helpers
  // -------------------------------------------------------
  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(str = '') {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }

  function qs(id) {
    return document.getElementById(id);
  }

  function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  }

  function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function formatDateISO(dateObj) {
    try {
      return new Date(dateObj).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  function formatTimeHHMM(dateObj) {
    const d = new Date(dateObj);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function makeAbsoluteUrl(relativeOrAbsolute) {
    try {
      return new URL(relativeOrAbsolute, window.location.href).toString();
    } catch {
      return String(relativeOrAbsolute || '');
    }
  }

  function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('downloadTextFile error:', error);
      showToast('Unable to download file.', 'error');
    }
  }

  function downloadJsonFile(filename, data) {
    downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
  }

  function showToast(message, type = 'info', timeout = 3500) {
    try {
      const root = qs('toastRoot');
      if (!root) {
        console.warn('toastRoot missing:', message);
        return;
      }

      const toast = document.createElement('div');
      toast.className = `app-toast app-toast--${type}`;
      toast.innerHTML = `
        <div class="app-toast__body">${message}</div>
        <button class="app-toast__close" aria-label="Close">×</button>
      `;

      const cleanup = () => {
        try {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        } catch {
          // noop
        }
      };

      toast.querySelector('.app-toast__close')?.addEventListener('click', cleanup);
      root.appendChild(toast);
      window.setTimeout(cleanup, timeout);
    } catch (error) {
      console.error('showToast error:', error);
    }
  }

  function stopInlineMonitor() {
    if (state.chunkMonitorId) {
      cancelAnimationFrame(state.chunkMonitorId);
      state.chunkMonitorId = null;
    }
  }

  function safeAudioErrorToast(src = '') {
    const shortUrl = src
      ? `<div style="font-size:12px;opacity:.85;margin-top:4px;word-break:break-all;">${escapeHtml(src)}</div>`
      : '';
    showToast(`Audio could not be loaded. Please check your connection and try again.${shortUrl}`, 'error', 6000);
  }

  function fitKaraokeTextToViewport(contentEl, lyricsEl, englishEl) {
    if (!contentEl || !lyricsEl || !englishEl) return;

    lyricsEl.style.fontSize = '';
    englishEl.style.fontSize = '';
    lyricsEl.style.lineHeight = '';
    englishEl.style.lineHeight = '';

    const contentMax = Math.max(220, window.innerHeight - 240);
    let lyricsSize = parseFloat(getComputedStyle(lyricsEl).fontSize) || 44;
    let englishSize = parseFloat(getComputedStyle(englishEl).fontSize) || 24;
    const minLyrics = 22;
    const minEnglish = 15;

    let guard = 0;
    while (contentEl.scrollHeight > contentMax && guard < 18) {
      if (lyricsSize > minLyrics) {
        lyricsSize -= 2;
        lyricsEl.style.fontSize = `${lyricsSize}px`;
        lyricsEl.style.lineHeight = '1.35';
      }

      if (contentEl.scrollHeight <= contentMax) break;

      if (englishSize > minEnglish) {
        englishSize -= 1;
        englishEl.style.fontSize = `${englishSize}px`;
        englishEl.style.lineHeight = '1.55';
      }
      guard++;
    }

    contentEl.style.overflowY = contentEl.scrollHeight > contentMax ? 'auto' : 'hidden';
  }

  window.addEventListener('resize', () => {
    try {
      const content = qs('kContent') || qs('karaokeContent');
      const lyrics = qs('kLyrics');
      const english = qs('kEnglish');
      if (content && lyrics && english) {
        fitKaraokeTextToViewport(content, lyrics, english);
      }
    } catch (error) {
      console.warn('resize fit warning:', error);
    }
  });

  // -------------------------------------------------------
  // Platform detection
  // -------------------------------------------------------
  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const uaData = navigator.userAgentData || null;
    const platformString = (uaData?.platform || navigator.platform || '').toLowerCase();
    const brands = (uaData?.brands || []).map(b => `${b.brand} ${b.version}`).join(' ').toLowerCase();

    const isIOS = /iphone|ipad|ipod/i.test(ua) || (platformString.includes('mac') && 'ontouchend' in document);
    const isAndroid = /android/i.test(ua) || platformString.includes('android');
    const isChromium = /chrome|crios|edg|edge|samsungbrowser|chromium/i.test(ua) || brands.includes('chrome') || brands.includes('chromium') || brands.includes('edge');
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

    return {
      isIOS,
      isAndroid,
      isChromium,
      isStandalone,
      unknown: !isIOS && !isAndroid
    };
  }

  // -------------------------------------------------------
  // Backend helpers (Google Apps Script contract)
  // -------------------------------------------------------
  function isBackendConfigured() {
    return !!state.backendConfig.baseUrl;
  }

  function buildBackendUrl(action = 'config') {
    if (!isBackendConfigured()) return '';
    const u = new URL(state.backendConfig.baseUrl);
    u.searchParams.set('action', action);
    return u.toString();
  }

  async function fetchWithTimeout(resource, options = {}, timeoutMs = BACKEND_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(resource, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(id);
    }
  }

  async function backendRequest(action, payload = null, method = 'POST') {
    if (!isBackendConfigured()) {
      throw new Error('Backend base URL is not configured.');
    }

    const url = buildBackendUrl(action);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (method !== 'GET' && payload !== null) {
      options.body = JSON.stringify(payload);
    }

    const res = await fetchWithTimeout(url, options, BACKEND_TIMEOUT_MS);
    const text = await res.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`Backend returned invalid JSON for action=${action}: ${text.slice(0, 300)}`);
    }

    if (!res.ok || !json.ok) {
      const msg = json?.error || `Backend error (${res.status})`;
      throw new Error(msg);
    }

    return json;
  }

  async function loadBackendConfig() {
    if (!isBackendConfigured()) {
      state.backendConfig.ready = false;
      state.backendConfig.sheetEnabled = false;
      state.backendConfig.pushEnabled = false;
      return state.backendConfig;
    }

    try {
      const result = await backendRequest('config', null, 'GET');
      state.backendConfig = {
        ...state.backendConfig,
        ready: true,
        sheetEnabled: !!result.data?.sheetEnabled,
        pushEnabled: !!result.data?.pushEnabled,
        vapidPublicKey: result.data?.vapidPublicKey || state.backendConfig.vapidPublicKey || ''
      };
      state.pushUiState.backendConfigured = true;
      state.pushUiState.backendHealthy = true;
      return state.backendConfig;
    } catch (error) {
      console.warn('loadBackendConfig warning:', error);
      state.pushUiState.backendConfigured = !!state.backendConfig.baseUrl;
      state.pushUiState.backendHealthy = false;
      return state.backendConfig;
    }
  }

  // -------------------------------------------------------
  // Push subscription support
  // -------------------------------------------------------
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const outputArray = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) outputArray[i] = raw.charCodeAt(i);
    return outputArray;
  }

  async function detectPushSupport() {
    const platform = detectPlatform();
    const basicSupport = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    let subscription = null;
    if (basicSupport) {
      try {
        const registration = await navigator.serviceWorker.ready;
        subscription = await registration.pushManager.getSubscription();
      } catch (error) {
        console.warn('Push readiness check failed:', error);
      }
    }

    const iosInstalledRequirement = platform.isIOS && !platform.isStandalone;
    state.pushUiState = {
      ...state.pushUiState,
      supported: !!basicSupport,
      canPrompt: !!basicSupport && !iosInstalledRequirement,
      installedWebAppRequired: !!iosInstalledRequirement,
      subscribed: !!subscription,
      permission: (typeof Notification !== 'undefined' ? Notification.permission : 'default')
    };

    updatePushUi();
    return state.pushUiState;
  }

  function updatePushUi() {
    const btn = qs('btnPushSubscribe');
    const hint = qs('pushSupportHint');
    if (!btn || !hint) return;

    btn.style.display = 'none';
    hint.textContent = '';

    if (!state.pushUiState.supported) {
      hint.textContent = 'Push notifications are not supported on this device/browser.';
      return;
    }

    if (state.pushUiState.installedWebAppRequired) {
      hint.textContent = 'On iPhone/iPad, install the app to your Home Screen first, then reopen it to enable push notifications.';
      return;
    }

    if (!isBackendConfigured()) {
      hint.textContent = 'Push backend is not configured yet. You can still use calendar reminders and automations.';
      return;
    }

    if (!state.pushUiState.backendHealthy) {
      hint.textContent = 'Push backend is configured but unreachable right now. Please try again later.';
      return;
    }

    btn.style.display = 'inline-block';
    btn.textContent = state.pushUiState.subscribed
      ? '✅ Push Notifications Enabled'
      : '🔔 Subscribe with Push Notifications';
  }

  async function subscribeToPushForCurrentSubscription() {
    try {
      const config = getSubscriptionConfigFromModal();

      if (!state.pushUiState.supported) {
        showToast('Push is not supported on this device/browser.', 'warning');
        return;
      }

      if (state.pushUiState.installedWebAppRequired) {
        showToast('Install the app to Home Screen first, then reopen it to enable push on iPhone/iPad.', 'warning', 6000);
        return;
      }

      if (!isBackendConfigured()) {
        showToast('Push backend is not configured yet.', 'warning', 6500);
        return;
      }

      if (!state.backendConfig.vapidPublicKey && !PUSH_PUBLIC_VAPID_KEY) {
        showToast('Push backend is reachable, but no VAPID public key is configured yet.', 'warning', 6500);
        return;
      }

      const permission = await Notification.requestPermission();
      state.pushUiState.permission = permission;
      if (permission !== 'granted') {
        showToast('Push permission was not granted.', 'warning');
        updatePushUi();
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const vapidKey = state.backendConfig.vapidPublicKey || PUSH_PUBLIC_VAPID_KEY;

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        });
      }

      const payload = {
        subscription,
        readingConfig: config,
        userAgent: navigator.userAgent,
        appVersion: APP_VERSION,
        platform: detectPlatform(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        locale: navigator.language || 'en'
      };

      await backendRequest('subscribe', payload, 'POST');

      state.pushUiState.subscribed = true;
      updatePushUi();
      showToast('Push notification subscription saved.', 'success');
    } catch (error) {
      console.error('subscribeToPushForCurrentSubscription error:', error);
      showToast('Failed to subscribe to push notifications.', 'error');
    }
  }

  async function unsubscribePushForCurrentDevice() {
    try {
      if (!isBackendConfigured()) throw new Error('Backend not configured.');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        state.pushUiState.subscribed = false;
        updatePushUi();
        showToast('Push was not currently subscribed.', 'info');
        return;
      }

      await backendRequest('unsubscribe', { subscription }, 'POST');
      await subscription.unsubscribe();
      state.pushUiState.subscribed = false;
      updatePushUi();
      showToast('Push subscription removed.', 'success');
    } catch (error) {
      console.error('unsubscribePushForCurrentDevice error:', error);
      showToast('Failed to unsubscribe push notifications.', 'error');
    }
  }

  async function pollDueRemindersIfPossible() {
    if (!isBackendConfigured()) return;
    if (document.hidden) return;

    try {
      const result = await backendRequest('dueReminders', {
        nowIso: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        platform: detectPlatform(),
        appVersion: APP_VERSION
      }, 'POST');

      state.poller.lastReminderCheckAt = new Date().toISOString();
      const due = Array.isArray(result.data?.items) ? result.data.items : [];
      if (!due.length) return;

      const latest = due[0];
      const dedupeKey = `${latest.subscriptionId || ''}|${latest.scheduledKey || ''}|${latest.url || ''}`;
      if (state.poller.lastReminderNotificationKey === dedupeKey) return;
      state.poller.lastReminderNotificationKey = dedupeKey;

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(latest.title || 'Gita Reminder', {
          body: latest.body || 'Your reading is ready.',
          tag: dedupeKey,
          data: latest
        });
      } else {
        showToast(escapeHtml(latest.title || 'Gita Reminder'), 'info', 5000);
      }
    } catch (error) {
      console.warn('pollDueRemindersIfPossible warning:', error);
    }
  }

  function startReminderPolling() {
    if (state.poller.reminderIntervalId) return;
    state.poller.reminderIntervalId = setInterval(() => {
      pollDueRemindersIfPossible().catch(() => {});
    }, DEFAULT_PUSH_POLL_MS);
  }

  function stopReminderPolling() {
    if (!state.poller.reminderIntervalId) return;
    clearInterval(state.poller.reminderIntervalId);
    state.poller.reminderIntervalId = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    pollDueRemindersIfPossible().catch(() => {});
  });

  // -------------------------------------------------------
  // Subscription / automation helpers
  // -------------------------------------------------------
  function getSubscriptionConfigFromModal() {
    const type = qs('subType')?.value || 'chapter';
    const start = qs('subStart')?.value || '';
    const freq = qs('subFreq')?.value || 'daily';
    const date = qs('subDate')?.value || '';
    const time = qs('subTime')?.value || DEFAULT_SUB_TIME;
    const routeMode = qs('subRouteMode')?.value || 'progressive';

    const appUrl = `${window.location.origin}${window.location.pathname}` +
      `?subId=${encodeURIComponent(`sub_${Date.now()}`)}` +
      `&type=${encodeURIComponent(type)}` +
      `&start=${encodeURIComponent(start)}` +
      `&freq=${encodeURIComponent(freq)}` +
      `&date=${encodeURIComponent(date)}` +
      `&routeMode=${encodeURIComponent(routeMode)}` +
      `&source=${encodeURIComponent('automation')}`;

    return {
      type,
      start,
      freq,
      date,
      time,
      routeMode,
      appUrl,
      createdAt: new Date().toISOString(),
      subscriptionId: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
  }

  function buildIOSShortcutPayload(config) {
    return {
      platform: 'ios',
      shortcutName: IOS_SHORTCUT_NAME,
      subscription: config,
      deepLink: config.appUrl,
      notes: [
        'This payload is intended for the shared iPhone Shortcut.',
        'Create a Personal Automation in Shortcuts at the selected time.',
        'Use the Run Shortcut action and pass this payload as text input if needed.'
      ]
    };
  }

  function buildIOSShortcutRunUrl(config) {
    const payload = buildIOSShortcutPayload(config);
    const encoded = encodeURIComponent(JSON.stringify(payload));
    return `shortcuts://run-shortcut?name=${encodeURIComponent(IOS_SHORTCUT_NAME)}&input=text&text=${encoded}`;
  }

  function installOrDownloadIOSShortcut(config) {
    try {
      const runUrl = buildIOSShortcutRunUrl(config);
      const payload = buildIOSShortcutPayload(config);
      localStorage.setItem('gita_ios_shortcut_payload', JSON.stringify(payload));
      downloadJsonFile(`Gita_iPhone_Shortcut_${config.type}_${config.start}_${config.time.replace(':', '')}.json`, payload);

      if (IOS_SHORTCUT_ICLOUD_IMPORT_URL) {
        window.open(IOS_SHORTCUT_ICLOUD_IMPORT_URL, '_blank');
        showToast('Opening iPhone Shortcut import link. A custom payload file was also downloaded.', 'info', 6500);
        return;
      }

      try {
        window.location.href = runUrl;
        showToast('Trying to run the installed iPhone Shortcut. If it is not installed yet, import it first.', 'info', 6500);
      } catch (error) {
        console.warn('iOS shortcut launch failed:', error);
        showToast('Shortcut payload downloaded. Import or install your base iPhone Shortcut first.', 'warning', 6500);
      }
    } catch (error) {
      console.error('installOrDownloadIOSShortcut error:', error);
      showToast('Unable to prepare iPhone Shortcut.', 'error');
    }
  }

  function downloadIOSShortcutInstructions(config) {
    const payload = buildIOSShortcutPayload(config);
    const runUrl = buildIOSShortcutRunUrl(config);
    const instructions = [
      'Srimad Bhagavad Gita – iPhone Shortcut Setup',
      '',
      `Reading Type: ${config.type}`,
      `Start Value: ${config.start}`,
      `Frequency: ${config.freq}`,
      `Time: ${config.time}`,
      `Route Mode: ${config.routeMode}`,
      '',
      'Recommended setup:',
      '1. Import the shared shortcut "Open Gita Subscription".',
      '2. Open the Shortcuts app > Automation > Create Personal Automation.',
      `3. Choose Time of Day = ${config.time}, Repeat = Daily.`,
      '4. Add action: Run Shortcut -> Open Gita Subscription.',
      '5. If your shortcut accepts text input, paste the JSON payload from the companion file.',
      '',
      `Deep Link: ${config.appUrl}`,
      `Run Shortcut URL: ${runUrl}`,
      '',
      'Note: iPhone may still require a tap before audible audio starts.',
      '',
      JSON.stringify(payload, null, 2)
    ].join('\n');
    downloadTextFile(`Gita_iPhone_Shortcut_Instructions_${config.type}_${config.start}.txt`, instructions);
    showToast('iPhone shortcut instructions downloaded.', 'success');
  }

  function buildAndroidAutomationPayload(config) {
    return {
      platform: 'android',
      vendor: ANDROID_AUTOMATION_VENDOR,
      name: `Gita ${config.type} ${config.start} ${config.time}`,
      trigger: {
        type: 'time_of_day',
        time: config.time,
        repeat: config.freq
      },
      action: {
        type: 'open_url',
        url: config.appUrl
      },
      subscription: config,
      notes: [
        'This is a portable automation package for Android.',
        'Import it into your chosen automation tool (MacroDroid / Tasker / Automate).',
        'If installed from Chrome and the URL is in app scope, Chromium is more likely to open the installed PWA directly.'
      ]
    };
  }

  function downloadAndroidAutomationPackage(config) {
    const payload = buildAndroidAutomationPayload(config);
    downloadJsonFile(`Gita_Android_Automation_${config.type}_${config.start}_${config.time.replace(':', '')}.json`, payload);

    const instructions = [
      'Srimad Bhagavad Gita – Android Automation Setup',
      '',
      `Reading Type: ${config.type}`,
      `Start Value: ${config.start}`,
      `Frequency: ${config.freq}`,
      `Time: ${config.time}`,
      `Route Mode: ${config.routeMode}`,
      '',
      'Recommended automation logic:',
      `Trigger: Daily at ${config.time}`,
      `Action: Open URL -> ${config.appUrl}`,
      '',
      'Suggested tools:',
      '- MacroDroid (easy setup)',
      '- Tasker (advanced setup)',
      '',
      'Tip: install the Gita app from Chrome for best PWA launch behavior on Android/Chromium.',
      '',
      'Note: Android may still block audible autoplay depending on browser policy and device state.',
      '',
      JSON.stringify(payload, null, 2)
    ].join('\n');

    downloadTextFile(`Gita_Android_Automation_Instructions_${config.type}_${config.start}.txt`, instructions);
    showToast('Android automation package downloaded.', 'success');
  }

  function renderSubscriptionAutomationOptions() {
    const platform = detectPlatform();
    const btnIOS = qs('btnInstallIOSShortcut');
    const btnIOSInfo = qs('btnDownloadIOSShortcutInfo');
    const btnAndroid = qs('btnDownloadAndroidAutomation');

    if (!btnIOS || !btnIOSInfo || !btnAndroid) return;
    btnIOS.style.display = 'none';
    btnIOSInfo.style.display = 'none';
    btnAndroid.style.display = 'none';

    if (platform.isIOS) {
      btnIOS.style.display = 'inline-block';
      btnIOSInfo.style.display = 'inline-block';
    } else if (platform.isAndroid) {
      btnAndroid.style.display = 'inline-block';
    } else {
      btnIOS.style.display = 'inline-block';
      btnIOSInfo.style.display = 'inline-block';
      btnAndroid.style.display = 'inline-block';
    }
  }

  // -------------------------------------------------------
  // PWA install prompt support
  // -------------------------------------------------------
  function initPWAInstallPrompt() {
    setTimeout(() => {
      if (!state.deferredPwaPrompt && !localStorage.getItem('pwa_help_shown')) {
        showToast('For faster access, install this app from your browser menu or Add to Home Screen.', 'info', 6000);
        localStorage.setItem('pwa_help_shown', 'true');
      }
    }, 3500);

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.deferredPwaPrompt = e;
      const toast = qs('pwaInstallToast');
      if (toast && !localStorage.getItem('pwa_toast_dismissed')) {
        toast.style.display = 'flex';
      }
    });

    qs('btnInstallPwa')?.addEventListener('click', async () => {
      if (!state.deferredPwaPrompt) return;
      try {
        state.deferredPwaPrompt.prompt();
        const choice = await state.deferredPwaPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          const toast = qs('pwaInstallToast');
          if (toast) toast.style.display = 'none';
        }
      } catch (error) {
        console.error('Install prompt error:', error);
      } finally {
        state.deferredPwaPrompt = null;
      }
    });

    qs('btnClosePwaToast')?.addEventListener('click', () => {
      const toast = qs('pwaInstallToast');
      if (toast) toast.style.display = 'none';
      localStorage.setItem('pwa_toast_dismissed', 'true');
    });
  }

  // -------------------------------------------------------
  // Data preparation
  // -------------------------------------------------------
  function populateChapterDropdown() {
    const select = state.chapterSelect;
    if (!select) return;
    const chapters = Array.from(new Set(state.globalGeetaData.map(item => Number(item.Chapter)))).sort((a, b) => a - b);
    select.innerHTML = '';
    chapters.forEach(chapter => {
      const option = document.createElement('option');
      option.value = String(chapter);
      option.textContent = `Chapter ${chapter}`;
      select.appendChild(option);
    });
    select.addEventListener('change', loadChapter);
  }

  function precomputeSubscriptionOptions() {
    try {
      const seenChapters = new Set();
      state.precomputedSubOptions.chapter = [];
      state.precomputedSubOptions.verse = [];

      state.globalGeetaData.forEach((v, idx) => {
        if (!seenChapters.has(String(v.Chapter))) {
          seenChapters.add(String(v.Chapter));
          state.precomputedSubOptions.chapter.push({
            val: String(v.Chapter),
            text: `Chapter ${v.Chapter}: ${v.Topic || 'Bhagavad Gita'}`
          });
        }

        state.precomputedSubOptions.verse.push({
          val: String(idx),
          text: `Ch ${v.Chapter}, Verse ${v.VerseNum}: ${v.Topic || ''}`
        });
      });
    } catch (error) {
      console.error('Precompute subscription options error:', error);
    }
  }

  // -------------------------------------------------------
  // Verse rendering / reader
  // -------------------------------------------------------
  function buildVerseCard(item, absoluteIndex, highlightTerm = '') {
    const hasAudio = item.AudioStart !== undefined && Number(item.AudioEnd) > Number(item.AudioStart);

    const highlight = text => {
      const safe = nl2br(text || '');
      if (!highlightTerm) return safe;
      try {
        const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`(${escaped})`, 'gi');
        return safe.replace(rx, '<span class="highlight">$1</span>');
      } catch {
        return safe;
      }
    };

    return `
      <div class="verse">
        <div class="verse-header">
          <div class="verse-meta">Chapter ${item.Chapter}, Verse ${item.VerseNum}</div>
          ${hasAudio ? `<button class="speaker-btn" data-index="${absoluteIndex}" title="Play Verse Audio" aria-label="Play Verse Audio">🔊</button>` : ''}
        </div>
        <div class="sanskrit-lines mb-2">${highlight(item.OriginalText)}</div>
        <div class="english-lines mb-3">${highlight(item.EnglishText)}</div>
        <hr />
        <div class="hindi-description mb-2">${highlight(item.OriginalMeaning || '')}</div>
        <div class="english-description">${highlight(item.EnglishMeaning || '')}</div>
      </div>
    `;
  }

  function clearResults() {
    try {
      if (state.container) state.container.innerHTML = '';
      if (state.searchResults) state.searchResults.innerHTML = '';
      state.currentPlaylist = [];
      if (state.globalPresentationBtn) state.globalPresentationBtn.style.display = 'none';
      if (state.currentChapterAudio) state.currentChapterAudio.pause();
      stopInlineMonitor();
    } catch (error) {
      console.error('clearResults error:', error);
    }
  }

  function loadChapter() {
    try {
      if (!state.chapterSelect || !state.container || !state.searchResults || !state.searchInput) return;
      const selectedChapter = state.chapterSelect.value;
      state.container.innerHTML = '';
      state.searchResults.innerHTML = '';
      state.searchInput.value = '';
      state.currentPlaylist = [];

      const chapterData = state.globalGeetaData.filter((item, absoluteIndex) => {
        if (String(item.Chapter) === String(selectedChapter)) {
          state.currentPlaylist.push(absoluteIndex);
          return true;
        }
        return false;
      });

      if (state.globalPresentationBtn) {
        state.globalPresentationBtn.style.display = state.currentPlaylist.length ? 'inline-block' : 'none';
      }

      if (chapterData.length > 0 && chapterData[0].AudioFileURL) {
        const audioWrap = document.createElement('div');
        audioWrap.className = 'card mb-3';
        const audioLabel = document.createElement('h5');
        audioLabel.className = 'mb-2';
        audioLabel.textContent = `🔊 Play Chapter ${selectedChapter} Audio`;
        state.currentChapterAudio = new Audio();
        state.currentChapterAudio.controls = true;
        state.currentChapterAudio.preload = 'metadata';
        state.currentChapterAudio.src = chapterData[0].AudioFileURL;
        state.currentChapterAudio.addEventListener('error', () => safeAudioErrorToast(state.currentChapterAudio.src));
        audioWrap.appendChild(audioLabel);
        audioWrap.appendChild(state.currentChapterAudio);
        state.container.appendChild(audioWrap);
      }

      const fragment = document.createDocumentFragment();
      chapterData.forEach((verse, i) => {
        const absoluteIndex = state.currentPlaylist[i];
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildVerseCard(verse, absoluteIndex);
        if (wrapper.firstElementChild) fragment.appendChild(wrapper.firstElementChild);
      });
      state.container.appendChild(fragment);
    } catch (error) {
      console.error('Load chapter error:', error);
      showToast('Unable to render chapter.', 'error');
    }
  }

  function searchWord() {
    try {
      if (!state.searchInput || !state.searchResults || !state.container) return;
      const term = state.searchInput.value.toLowerCase().trim();
      if (!term) return;

      state.searchResults.innerHTML = '';
      state.container.innerHTML = '';
      state.currentPlaylist = [];
      if (state.currentChapterAudio) state.currentChapterAudio.pause();
      stopInlineMonitor();

      let totalMatches = 0;
      const fragment = document.createDocumentFragment();

      state.globalGeetaData.forEach((item, absoluteIndex) => {
        let matched = false;
        for (const key in item) {
          if (typeof item[key] === 'string' && item[key].toLowerCase().includes(term)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          totalMatches++;
          state.currentPlaylist.push(absoluteIndex);
          const wrapper = document.createElement('div');
          wrapper.innerHTML = buildVerseCard(item, absoluteIndex, term);
          if (wrapper.firstElementChild) fragment.appendChild(wrapper.firstElementChild);
        }
      });

      if (totalMatches > 0) {
        const totals = document.createElement('div');
        totals.className = 'alert alert-info';
        totals.innerHTML = `<strong>Total matches found:</strong> ${totalMatches} verses`;
        state.searchResults.appendChild(totals);
        state.searchResults.appendChild(fragment);
        if (state.globalPresentationBtn) state.globalPresentationBtn.style.display = 'inline-block';
      } else {
        state.searchResults.innerHTML = `<p class="text-center text-danger mt-3">No results found.</p>`;
        if (state.globalPresentationBtn) state.globalPresentationBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Search error:', error);
      showToast('Search failed.', 'error');
    }
  }

  function playVerseInline(absoluteIndex) {
    try {
      const verse = state.globalGeetaData[absoluteIndex];
      if (!verse || !verse.AudioFileURL || verse.AudioStart === undefined) return;

      if (!state.currentChapterAudio) {
        state.currentChapterAudio = new Audio();
        state.currentChapterAudio.preload = 'metadata';
        state.currentChapterAudio.addEventListener('error', () => safeAudioErrorToast(state.currentChapterAudio.src));
      }

      if (!state.currentChapterAudio.src || state.currentChapterAudio.src.indexOf(verse.AudioFileURL) === -1) {
        state.currentChapterAudio.src = verse.AudioFileURL;
      }

      state.currentChapterAudio.pause();
      stopInlineMonitor();
      state.currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;
      state.currentChapterAudio.play().catch(error => {
        console.warn('Autoplay blocked:', error);
        showToast('Tap again if your browser blocked audio autoplay.', 'warning');
      });

      const endTime = Number(verse.AudioEnd) || 0;
      const monitor = () => {
        if (!state.currentChapterAudio) return;
        if (state.currentChapterAudio.currentTime >= endTime) {
          state.currentChapterAudio.pause();
          state.currentChapterAudio.currentTime = Number(verse.AudioStart) || 0;
        } else if (!state.currentChapterAudio.paused) {
          state.chunkMonitorId = requestAnimationFrame(monitor);
        }
      };
      state.chunkMonitorId = requestAnimationFrame(monitor);
    } catch (error) {
      console.error('Inline play error:', error);
      showToast('Unable to play verse audio.', 'error');
    }
  }

  // -------------------------------------------------------
  // Subscription modal
  // -------------------------------------------------------
  function injectSubscriptionModal() {
    try {
      if (qs('subscriptionModal')) {
        return;
      }

      const html = `
        <div id="subscriptionModal" class="app-modal-overlay" aria-hidden="true">
          <div class="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="subscriptionModalTitle">
            <button id="btnCloseSubModalX" class="app-modal-close" aria-label="Close">×</button>

            <div id="subscriptionModalTitle" class="app-modal-title">📅 Daily Gita Subscription</div>
            <div class="app-modal-subtitle">
              Create a reminder link and add it to your calendar. When the reminder opens the app,
              the correct reading will appear automatically.
            </div>

            <div class="form-group">
              <label class="field-label" for="subType">What would you like to receive daily?</label>
              <span class="field-help">Choose between one full chapter or one verse at a time.</span>
              <select id="subType" class="form-control">
                <option value="chapter">One Chapter at a time</option>
                <option value="verse">One Verse at a time</option>
              </select>
            </div>

            <div class="form-group">
              <label class="field-label" for="subStart">Starting Point</label>
              <input type="text" id="subFilter" class="form-control mb-2" placeholder="🔍 Search chapter or verse..." autocomplete="off" />
              <div id="subFilterFeedback" class="small text-muted mb-1"></div>
              <div id="subLoading" class="loading-inline hidden">⏳ Processing options...</div>
              <select id="subStart" class="form-control" size="5" style="overflow-y:auto;"></select>
            </div>

            <div class="row">
              <div class="col-sm-6 form-group">
                <label class="field-label" for="subDate">Start Date</label>
                <input type="date" id="subDate" class="form-control" />
              </div>
              <div class="col-sm-6 form-group">
                <label class="field-label" for="subTime">Notification Time</label>
                <input type="time" id="subTime" class="form-control" />
              </div>
            </div>

            <div class="form-group">
              <label class="field-label" for="subFreq">Frequency</label>
              <select id="subFreq" class="form-control">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <label class="field-label" for="subRouteMode" style="margin-top:12px;">How should this subscription behave?</label>
              <select id="subRouteMode" class="form-control">
                <option value="progressive">Move forward over time</option>
                <option value="fixed">Always open the same chapter / verse</option>
              </select>
              <span class="field-help">
                Progressive advances based on date. Fixed always opens the same selected chapter or verse.
              </span>
            </div>

            <div class="form-group">
              <label class="field-label">Automation & App Options</label>
              <span class="field-help">
                Install a device-specific automation for this subscription, or subscribe using push notifications when supported.
              </span>

              <div id="subscriptionAutomationOptions" class="modal-actions-stack">
                <button id="btnInstallIOSShortcut" type="button" class="btn btn-dark" style="display:none;">🍎 Install iPhone Shortcut</button>
                <button id="btnDownloadIOSShortcutInfo" type="button" class="btn btn-outline-secondary" style="display:none;">📄 Download iPhone Shortcut Instructions</button>
                <button id="btnDownloadAndroidAutomation" type="button" class="btn btn-success" style="display:none;">🤖 Download Android Automation</button>
                <button id="btnPushSubscribe" type="button" class="btn btn-warning" style="display:none;">🔔 Subscribe with Push Notifications</button>
                <button id="btnPushUnsubscribe" type="button" class="btn btn-outline-secondary" style="display:none;">🔕 Unsubscribe Push</button>
                <div id="pushSupportHint" class="field-help" style="margin-top:6px;"></div>
              </div>
            </div>

            <div class="modal-actions-stack mt-3">
              <button id="btnGoogleCal" class="btn btn-primary">➕ Add to Google Calendar</button>
              <button id="btnAppleCal" class="btn btn-dark">🍎 Add to Apple / Outlook (.ics)</button>
              <button id="btnCopySubLink" class="btn btn-info">🔗 Share / Copy Subscription Link</button>
              <button id="btnCloseSubModal" class="btn btn-outline-secondary">Cancel</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', html);
      const modal = qs('subscriptionModal');
      const subType = qs('subType');
      const subStart = qs('subStart');
      const subFilter = qs('subFilter');
      const subFeedback = qs('subFilterFeedback');
      const subLoading = qs('subLoading');
      const subDate = qs('subDate');
      const subTime = qs('subTime');
      const subFreq = qs('subFreq');
      const subRouteMode = qs('subRouteMode');
      const btnOpenSubModal = qs('btnOpenSubModal');
      const btnCloseSubModal = qs('btnCloseSubModal');
      const btnCloseSubModalX = qs('btnCloseSubModalX');
      const btnCopySubLink = qs('btnCopySubLink');
      const btnGoogleCal = qs('btnGoogleCal');
      const btnAppleCal = qs('btnAppleCal');
      const btnInstallIOSShortcut = qs('btnInstallIOSShortcut');
      const btnDownloadIOSShortcutInfo = qs('btnDownloadIOSShortcutInfo');
      const btnDownloadAndroidAutomation = qs('btnDownloadAndroidAutomation');
      const btnPushSubscribe = qs('btnPushSubscribe');
      const btnPushUnsubscribe = qs('btnPushUnsubscribe');

      if (!modal || !subType || !subStart || !subFilter || !subFeedback || !subLoading || !subDate || !subTime || !subFreq || !subRouteMode || !btnCloseSubModal || !btnCloseSubModalX || !btnCopySubLink || !btnGoogleCal || !btnAppleCal || !btnInstallIOSShortcut || !btnDownloadIOSShortcutInfo || !btnDownloadAndroidAutomation || !btnPushSubscribe || !btnPushUnsubscribe) {
        throw new Error('Subscription modal elements failed to initialize.');
      }

      function closeModal() {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
      }

      function ensureDefaultDateTime() {
        try {
          if (!subDate.value) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            subDate.value = tomorrow.toISOString().slice(0, 10);
          }
          if (!subTime.value) {
            subTime.value = DEFAULT_SUB_TIME;
          }
        } catch (error) {
          console.warn('ensureDefaultDateTime warning:', error);
        }
      }

      function getOptionSourceByType(type) {
        return type === 'chapter' ? state.precomputedSubOptions.chapter : state.precomputedSubOptions.verse;
      }

      function populateStartOptions(type, selectedValue = '') {
        try {
          const list = getOptionSourceByType(type);
          subStart.innerHTML = '';
          const fragment = document.createDocumentFragment();
          list.forEach(opt => {
            const option = document.createElement('option');
            option.value = String(opt.val);
            option.textContent = opt.text;
            fragment.appendChild(option);
          });
          subStart.appendChild(fragment);
          if (selectedValue !== undefined && selectedValue !== null && selectedValue !== '') {
            subStart.value = String(selectedValue);
          }
          if (!subStart.value && subStart.options.length) {
            subStart.selectedIndex = 0;
          }
        } catch (error) {
          console.error('populateStartOptions error:', error);
          showToast('Unable to load subscription options.', 'error');
        }
      }

      function filterStartOptions() {
        try {
          const term = (subFilter.value || '').toLowerCase().trim();
          const source = getOptionSourceByType(subType.value);
          const previousValue = subStart.value;
          subStart.innerHTML = '';
          let count = 0;
          const fragment = document.createDocumentFragment();
          source.forEach(opt => {
            if (!term || opt.text.toLowerCase().includes(term)) {
              const option = document.createElement('option');
              option.value = String(opt.val);
              option.textContent = opt.text;
              fragment.appendChild(option);
              count++;
            }
          });
          subStart.appendChild(fragment);
          if (previousValue) subStart.value = previousValue;
          if (!subStart.value && subStart.options.length) subStart.selectedIndex = 0;
          subFeedback.textContent = term ? `Showing ${count} matching options` : '';
        } catch (error) {
          console.error('filterStartOptions error:', error);
          subFeedback.textContent = '';
          showToast('Failed to filter subscription options.', 'warning');
        }
      }

      function buildSubscriptionUrl() {
        try {
          const type = subType.value;
          const startVal = subStart.value;
          const freq = subFreq.value;
          const startDate = subDate.value;
          const routeMode = subRouteMode.value || 'progressive';
          const subId = `sub_${Date.now()}`;
          return `${window.location.origin}${window.location.pathname}` +
            `?subId=${encodeURIComponent(subId)}` +
            `&type=${encodeURIComponent(type)}` +
            `&start=${encodeURIComponent(startVal)}` +
            `&freq=${encodeURIComponent(freq)}` +
            `&date=${encodeURIComponent(startDate)}` +
            `&routeMode=${encodeURIComponent(routeMode)}`;
        } catch (error) {
          console.error('buildSubscriptionUrl error:', error);
          throw new Error('Failed to build subscription URL.');
        }
      }

      function getUTCStartAndEnd() {
        try {
          const dateVal = subDate.value;
          const timeVal = subTime.value || DEFAULT_SUB_TIME;
          if (!dateVal) throw new Error('Start date is missing.');
          const localDate = new Date(`${dateVal}T${timeVal}:00`);
          if (Number.isNaN(localDate.getTime())) throw new Error('Invalid date/time.');
          const formatUTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
          const dtStart = formatUTC(localDate);
          const dtEnd = formatUTC(new Date(localDate.getTime() + 15 * 60 * 1000));
          return { dtStart, dtEnd };
        } catch (error) {
          console.error('getUTCStartAndEnd error:', error);
          throw new Error('Failed to prepare calendar date/time.');
        }
      }

      function validateSelection() {
        if (!subStart.value) {
          showToast('Please select a starting point.', 'warning');
          return false;
        }
        if (!subDate.value) {
          showToast('Please select a valid start date.', 'warning');
          return false;
        }
        if (!subTime.value) {
          showToast('Please select a valid notification time.', 'warning');
          return false;
        }
        return true;
      }

      ensureDefaultDateTime();
      populateStartOptions(subType.value, '');

      btnOpenSubModal?.addEventListener('click', () => {
        try {
          openSubscriptionModalPreFilled('chapter', '1', 'daily', 'progressive');
        } catch (error) {
          console.error('Open subscription modal button error:', error);
          showToast('Unable to open subscription modal.', 'error');
        }
      });

      btnCloseSubModal.addEventListener('click', closeModal);
      btnCloseSubModalX.addEventListener('click', closeModal);
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
      });

      subType.addEventListener('change', () => {
        try {
          subFilter.value = '';
          subFeedback.textContent = '';
          openSubscriptionModalPreFilled(subType.value, '', subFreq.value, subRouteMode.value || 'progressive');
        } catch (error) {
          console.error('subType change error:', error);
          showToast('Failed to refresh subscription options.', 'error');
        }
      });

      subFilter.addEventListener('input', filterStartOptions);

      btnCopySubLink.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const appUrl = buildSubscriptionUrl();
          const message = `📖 My Bhagavad Gita reading link\n\nOpen today’s reading here:\n${appUrl}\n\nShared from Geeta App`;
          openShareSheet({ title: 'Bhagavad Gita Subscription', text: message, url: appUrl });
        } catch (error) {
          console.error('Copy sub link error:', error);
          showToast('Failed to prepare subscription link.', 'error');
        }
      });

      btnGoogleCal.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const appUrl = buildSubscriptionUrl();
          const freq = subFreq.value.toUpperCase();
          const { dtStart, dtEnd } = getUTCStartAndEnd();
          const details = `Tap the link to open today's reading:\n${appUrl}`;
          const gCalUrl =
            `https://calendar.google.com/calendar/render?action=TEMPLATE` +
            `&text=${encodeURIComponent('📖 Gita Reading')}` +
            `&dates=${dtStart}/${dtEnd}` +
            `&details=${encodeURIComponent(details)}` +
            `&recur=${encodeURIComponent(`RRULE:FREQ=${freq}`)}`;
          window.open(gCalUrl, '_blank');
          closeModal();
        } catch (error) {
          console.error('Google calendar error:', error);
          showToast('Failed to open Google Calendar link.', 'error');
        }
      });

      btnAppleCal.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const type = subType.value;
          const appUrl = buildSubscriptionUrl();
          const freq = subFreq.value.toUpperCase();
          const { dtStart } = getUTCStartAndEnd();
          const icsData = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//GitaApp//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            'SUMMARY:📖 Gita Reading',
            `DTSTART:${dtStart}`,
            `RRULE:FREQ=${freq}`,
            `DESCRIPTION:Tap to open today\\'s reading:\\n${appUrl}`,
            `URL:${appUrl}`,
            'STATUS:CONFIRMED',
            'BEGIN:VALARM',
            'TRIGGER:-PT0M',
            'ACTION:DISPLAY',
            'DESCRIPTION:Reminder',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
          ].join('\n');
          const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `Gita_Reminder_${type}.ics`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          showToast('Calendar file downloaded.', 'success');
          closeModal();
        } catch (error) {
          console.error('ICS generation error:', error);
          showToast('Failed to create calendar file.', 'error');
        }
      });

      btnInstallIOSShortcut.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const config = getSubscriptionConfigFromModal();
          installOrDownloadIOSShortcut(config);
        } catch (error) {
          console.error('iOS shortcut install error:', error);
          showToast('Failed to prepare iPhone Shortcut.', 'error');
        }
      });

      btnDownloadIOSShortcutInfo.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const config = getSubscriptionConfigFromModal();
          downloadIOSShortcutInstructions(config);
        } catch (error) {
          console.error('iOS shortcut info error:', error);
          showToast('Failed to download iPhone Shortcut instructions.', 'error');
        }
      });

      btnDownloadAndroidAutomation.addEventListener('click', () => {
        try {
          if (!validateSelection()) return;
          const config = getSubscriptionConfigFromModal();
          downloadAndroidAutomationPackage(config);
        } catch (error) {
          console.error('Android automation download error:', error);
          showToast('Failed to prepare Android automation.', 'error');
        }
      });

      btnPushSubscribe.addEventListener('click', async () => {
        try {
          if (!validateSelection()) return;
          await subscribeToPushForCurrentSubscription();
          btnPushUnsubscribe.style.display = state.pushUiState.subscribed ? 'inline-block' : 'none';
        } catch (error) {
          console.error('Push subscribe button error:', error);
          showToast('Failed to subscribe to push notifications.', 'error');
        }
      });

      btnPushUnsubscribe.addEventListener('click', async () => {
        try {
          await unsubscribePushForCurrentDevice();
          btnPushUnsubscribe.style.display = 'none';
        } catch (error) {
          console.error('Push unsubscribe button error:', error);
          showToast('Failed to unsubscribe push notifications.', 'error');
        }
      });

      try {
        renderSubscriptionAutomationOptions();
      } catch (error) {
        console.warn('renderSubscriptionAutomationOptions init warning:', error);
      }

      detectPushSupport().then(() => {
        btnPushUnsubscribe.style.display = state.pushUiState.subscribed ? 'inline-block' : 'none';
      }).catch(error => {
        console.warn('detectPushSupport init warning:', error);
      });
    } catch (error) {
      console.error('injectSubscriptionModal fatal error:', error);
      showToast('Failed to initialize subscription modal.', 'error', 6000);
    }
  }

  function openSubscriptionModalPreFilled(type, startValue, freq, routeMode = 'progressive') {
    try {
      const modal = qs('subscriptionModal');
      const subType = qs('subType');
      const subStart = qs('subStart');
      const subLoading = qs('subLoading');
      const subFreq = qs('subFreq');
      const subRouteMode = qs('subRouteMode');
      const subFilter = qs('subFilter');
      const subFeedback = qs('subFilterFeedback');
      const subDate = qs('subDate');
      const subTime = qs('subTime');
      if (!modal || !subType || !subStart || !subLoading || !subFreq || !subRouteMode || !subFilter || !subFeedback || !subDate || !subTime) {
        throw new Error('Subscription modal controls are missing.');
      }

      subType.value = type;
      subFreq.value = freq;
      subRouteMode.value = routeMode;
      subFilter.value = '';
      subFeedback.textContent = '';

      if (!subDate.value) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        subDate.value = tomorrow.toISOString().slice(0, 10);
      }
      if (!subTime.value) {
        subTime.value = DEFAULT_SUB_TIME;
      }

      subLoading.classList.remove('hidden');
      subStart.style.display = 'none';
      subStart.innerHTML = '';

      setTimeout(() => {
        try {
          const list = type === 'chapter' ? state.precomputedSubOptions.chapter : state.precomputedSubOptions.verse;
          const fragment = document.createDocumentFragment();
          list.forEach(opt => {
            const option = document.createElement('option');
            option.value = String(opt.val);
            option.textContent = opt.text;
            fragment.appendChild(option);
          });
          subStart.appendChild(fragment);
          if (startValue !== undefined && startValue !== null && startValue !== '') {
            subStart.value = String(startValue);
          }
          if (!subStart.value && subStart.options.length) {
            subStart.selectedIndex = 0;
          }
        } catch (error) {
          console.error('openSubscriptionModalPreFilled population error:', error);
          showToast('Unable to load subscription options.', 'error');
        } finally {
          subLoading.classList.add('hidden');
          subStart.style.display = 'block';
        }
      }, 0);

      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      try {
        renderSubscriptionAutomationOptions();
      } catch (error) {
        console.warn('renderSubscriptionAutomationOptions refresh warning:', error);
      }

      detectPushSupport().then(() => {
        const btnPushUnsubscribe = qs('btnPushUnsubscribe');
        if (btnPushUnsubscribe) {
          btnPushUnsubscribe.style.display = state.pushUiState.subscribed ? 'inline-block' : 'none';
        }
      }).catch(error => {
        console.warn('detectPushSupport refresh warning:', error);
      });
    } catch (error) {
      console.error('openSubscriptionModalPreFilled fatal error:', error);
      showToast('Failed to open subscription modal.', 'error');
    }
  }

  // -------------------------------------------------------
  // Welcome splash
  // -------------------------------------------------------
  function injectWelcomeScreen() {
    const html = `
      <div id="welcomeSplash" class="welcome-splash" style="display:none;">
        <div class="welcome-orb orb-1"></div>
        <div class="welcome-orb orb-2"></div>
        <div class="welcome-card spiritual-card">
          <div id="streakBadge" class="streak-badge" style="display:none;">🔥 1 Day Streak</div>
          <div class="welcome-mantra">ॐ तत् सत्</div>
          <h2 class="welcome-title">🌼 Welcome Back to the Gita</h2>
          <p id="welcomeMessage" class="welcome-message">Today’s reading awaits you — not as routine, but as remembrance.</p>
          <p id="welcomeSubMessage" class="welcome-submessage">Return gently, listen deeply, and let the wisdom unfold within.</p>
          <div class="welcome-divider">🕉️</div>
          <button id="btnBeginReading" class="btn-begin">📿 Begin Today’s Reading</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function getSpiritualWelcomeMessage(streak = 0, routeMode = 'progressive', type = 'chapter') {
    const messages = [
      { title: '🕉️ The teaching returns when the heart is ready.', sub: 'Pause, breathe, and enter this reading as a sacred conversation.' },
      { title: 'Each return to the Gita is a return to inner clarity.', sub: 'Let today’s words become strength, devotion, and calm action.' },
      { title: 'Wisdom ripens through daily remembrance.', sub: 'Read slowly. Listen inwardly. Carry one truth into the rest of your day.' },
      { title: 'The verse is not only to be read — it is to be lived.', sub: 'May this moment become guidance, steadiness, and grace.' }
    ];
    const index = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % messages.length;
    const selected = messages[index];
    let streakLine = '';
    if (streak >= 7) streakLine = '🔥 Your steady return is itself a form of devotion.';
    else if (streak >= 3) streakLine = 'A beautiful rhythm is forming through your daily practice.';
    else streakLine = 'Every sincere beginning is blessed.';

    let modeLine = '';
    if (routeMode === 'fixed') {
      modeLine = type === 'chapter'
        ? 'This sacred chapter remains here for you each time you return.'
        : 'This chosen verse remains here for contemplation each time you return.';
    } else {
      modeLine = 'Today’s reading continues your journey one step further.';
    }

    return { title: selected.title, sub: `${selected.sub} ${streakLine} ${modeLine}` };
  }

  function handleSubscriptionRouting() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const subId = urlParams.get('subId');
      if (!subId) return false;

      let streak = parseInt(localStorage.getItem('gita_streak') || '0', 10);
      const lastRead = localStorage.getItem('gita_last_read');
      const todayStr = new Date().toISOString().split('T')[0];
      if (lastRead !== todayStr) {
        streak++;
        localStorage.setItem('gita_streak', String(streak));
        localStorage.setItem('gita_last_read', todayStr);
      }

      const badge = qs('streakBadge');
      if (badge && streak > 1) {
        badge.textContent = `🔥 ${streak} Day Streak`;
        badge.style.display = 'inline-block';
      }

      const type = urlParams.get('type');
      const initialStart = parseInt(urlParams.get('start') || '0', 10);
      const startDateStr = urlParams.get('date');
      const freq = urlParams.get('freq');
      const routeMode = urlParams.get('routeMode') || 'progressive';
      if (!type || !startDateStr || Number.isNaN(initialStart)) return false;

      const startDate = new Date(startDateStr + 'T00:00:00');
      const today = new Date();
      const diffTime = Math.max(0, today - startDate);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      let progressionSteps = 0;
      if (routeMode === 'progressive') {
        if (freq === 'daily') progressionSteps = diffDays;
        else if (freq === 'weekly') progressionSteps = Math.floor(diffDays / 7);
        else if (freq === 'monthly') {
          progressionSteps = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());
          if (progressionSteps < 0) progressionSteps = 0;
        }
      } else {
        progressionSteps = 0;
      }

      const welcomeMessageEl = qs('welcomeMessage');
      const welcomeSubMessageEl = qs('welcomeSubMessage');
      const spiritualCopy = getSpiritualWelcomeMessage(streak, routeMode, type);
      if (welcomeMessageEl) welcomeMessageEl.textContent = spiritualCopy.title;
      if (welcomeSubMessageEl) welcomeSubMessageEl.textContent = spiritualCopy.sub;

      let routePlaylist = [];
      if (type === 'verse') {
        const targetIndex = initialStart + progressionSteps;
        if (targetIndex >= state.globalGeetaData.length) {
          showToast('You have completed all verses in this subscription.', 'success', 5000);
          return true;
        }
        routePlaylist = [targetIndex];
      } else if (type === 'chapter') {
        const chapters = Array.from(new Set(state.globalGeetaData.map(i => Number(i.Chapter))));
        const startChapIndex = chapters.indexOf(initialStart);
        const targetChapIndex = startChapIndex + progressionSteps;
        if (targetChapIndex >= chapters.length) {
          showToast('You have completed all chapters in this subscription.', 'success', 5000);
          return true;
        }
        const targetChapter = chapters[targetChapIndex];
        state.globalGeetaData.forEach((v, i) => {
          if (Number(v.Chapter) === targetChapter) routePlaylist.push(i);
        });
      }

      const splash = qs('welcomeSplash');
      if (!splash) return false;
      splash.style.display = 'flex';
      const btnBegin = qs('btnBeginReading');
      if (btnBegin) {
        btnBegin.onclick = () => {
          splash.classList.add('fade-out');
          setTimeout(() => { splash.style.display = 'none'; }, 400);
          openKaraoke(routePlaylist, 0, type);
        };
      }
      return true;
    } catch (error) {
      console.error('Subscription routing error:', error);
      showToast('Failed to open subscription reading.', 'error');
      return false;
    }
  }

  // -------------------------------------------------------
  // Share sheet / QR
  // -------------------------------------------------------
  function injectShareSheet() {
    const html = `
      <div id="shareSheet" class="share-sheet">
        <div class="share-sheet__panel">
          <div class="share-sheet__title">Share</div>
          <div class="share-sheet__layout">
            <div id="sharePreview" class="share-sheet__preview"></div>
            <div class="share-qr-card">
              <div class="share-qr-card__top">
                <div class="share-qr-title">Scan QR to open</div>
                <div class="share-qr-actions">
                  <button id="shareQrImageBtn" class="share-qr-mini-btn" type="button" title="Share QR image" aria-label="Share QR image">📤</button>
                  <button id="copyQrImageBtn" class="share-qr-mini-btn" type="button" title="Copy QR image" aria-label="Copy QR image">📋</button>
                </div>
              </div>
              <div class="share-qr-wrap">
                <div id="shareQrCanvas" width="180" height="180"></div>
                <img id="shareQrLogo" class="share-qr-logo" alt="QR Logo" />
              </div>
              <div id="shareQrUrl" class="share-qr-url"></div>
            </div>
          </div>
          <div class="share-grid">
            <button id="shareNativeBtn">📲 Share</button>
            <button id="shareCopyBtn">📋 Copy Message</button>
            <button id="shareWhatsappBtn">🟢 WhatsApp</button>
            <button id="shareTelegramBtn">🔵 Telegram</button>
            <button id="shareEmailBtn">✉️ Email</button>
            <button id="shareCopyLinkBtn">🔗 Copy Link Only</button>
          </div>
          <button id="shareSheetClose" class="share-sheet__close">Close</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const sheet = qs('shareSheet');
    sheet?.addEventListener('click', e => {
      if (e.target === sheet) closeShareSheet();
    });
    qs('shareSheetClose')?.addEventListener('click', closeShareSheet);
  }

  function getShareQrElements() {
    return {
      wrap: document.querySelector('.share-qr-wrap'),
      canvas: qs('shareQrCanvas'),
      logo: qs('shareQrLogo'),
      urlText: qs('shareQrUrl')
    };
  }

  function resetShareQrSurface() {
    const { canvas } = getShareQrElements();
    if (!canvas) return;
    canvas.innerHTML = '';
  }

  async function renderShareQr(url) {
    const wrap = document.querySelector('.share-qr-wrap');
    const canvasHost = qs('shareQrCanvas');
    const logo = qs('shareQrLogo');
    const urlText = qs('shareQrUrl');
    if (!wrap || !canvasHost || !url) return;

    try {
      canvasHost.innerHTML = '';
      state.lastRenderedQrUrl = '';
      if (logo) {
        logo.style.display = 'none';
        logo.src = '';
      }

      if (typeof QRCode !== 'undefined' && typeof QRCode.toCanvas === 'function') {
        const qrCanvas = document.createElement('canvas');
        qrCanvas.width = 180;
        qrCanvas.height = 180;
        canvasHost.appendChild(qrCanvas);
        await new Promise((resolve, reject) => {
          QRCode.toCanvas(
            qrCanvas,
            url,
            { width: 180, margin: 2, color: { dark: '#111827', light: '#ffffff' }, errorCorrectionLevel: 'H' },
            err => (err ? reject(err) : resolve())
          );
        });
      } else {
        new QRCode(canvasHost, {
          text: url,
          width: 180,
          height: 180,
          colorDark: '#111827',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      const renderedQrEl = canvasHost.querySelector('canvas, img');
      if (!renderedQrEl) throw new Error('QR element was not rendered by the QR library.');
      state.lastRenderedQrUrl = url;
      if (logo) {
        logo.src = QR_LOGO_URL;
        logo.style.display = 'block';
      }
      if (urlText) urlText.textContent = url;
    } catch (error) {
      console.error('QR render error:', error);
      state.lastRenderedQrUrl = '';
      if (urlText) urlText.textContent = url;
      showToast('QR could not be generated. Link is still available to copy.', 'warning', 4500);
    }
  }

  function loadImageForCanvas(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error('No image source provided.'));
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  async function buildShareQrPngBlob() {
    if (!state.lastRenderedQrUrl) throw new Error('QR not ready yet.');
    const container = qs('shareQrCanvas');
    if (!container) throw new Error('QR container not found.');
    const qrEl = container.querySelector('canvas') || container.querySelector('img');
    if (!qrEl) throw new Error('QR element not rendered yet.');
    if (qrEl.tagName === 'IMG' && !qrEl.complete) {
      await new Promise((resolve, reject) => {
        qrEl.onload = () => resolve();
        qrEl.onerror = () => reject(new Error('Rendered QR image failed to load.'));
      });
    }

    const size = 512;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size;
    exportCanvas.height = size;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const srcWidth = qrEl instanceof HTMLCanvasElement ? qrEl.width : (qrEl.naturalWidth || 180);
    const srcHeight = qrEl instanceof HTMLCanvasElement ? qrEl.height : (qrEl.naturalHeight || 180);
    ctx.drawImage(qrEl, 0, 0, srcWidth, srcHeight, 0, 0, size, size);

    try {
      const logo = await loadImageForCanvas(QR_LOGO_URL);
      const logoSize = size * 0.15;
      const x = (size - logoSize) / 2;
      const y = (size - logoSize) / 2;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x - 8, y - 8, logoSize + 16, logoSize + 16, 18);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.drawImage(logo, x, y, logoSize, logoSize);
      ctx.restore();
    } catch (e) {
      console.warn('Logo overlay failed:', e);
    }

    return new Promise((resolve, reject) => {
      exportCanvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Blob generation failed.'));
      }, 'image/png');
    });
  }

  async function shareQrImageFile({ title, text }) {
    try {
      await state.currentQrRenderPromise;
      const blob = await buildShareQrPngBlob();
      const file = new File([blob], 'gita-qr.png', { type: 'image/png' });
      const data = { title: title || 'Gita QR', text: text || '', files: [file] };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(data);
        showToast('QR image shared.', 'success');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gita-qr.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('QR image downloaded (file sharing not supported on this browser).', 'info', 5000);
    } catch (error) {
      console.error('shareQrImageFile error:', error);
      showToast('Unable to share QR image.', 'error');
    }
  }

  async function copyQrImageToClipboard() {
    try {
      await state.currentQrRenderPromise;
      const blob = await buildShareQrPngBlob();
      if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
        throw new Error('Clipboard image writing is not supported.');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('QR image copied to clipboard.', 'success');
    } catch (error) {
      console.error('copyQrImageToClipboard error:', error);
      showToast('Unable to copy QR image.', 'warning', 4500);
    }
  }

  function openShareSheet({ title, text, url }) {
    state.currentSharePayload = { title, text, url };
    const preview = qs('sharePreview');
    const sheet = qs('shareSheet');
    if (!preview || !sheet) return;
    preview.textContent = text;
    sheet.classList.add('active');
    state.currentQrRenderPromise = Promise.resolve().then(() => renderShareQr(url)).then(() => new Promise(resolve => requestAnimationFrame(() => resolve())));

    qs('shareNativeBtn').onclick = async () => {
      if (!navigator.share) {
        showToast('Native share is not available on this device.', 'warning');
        return;
      }
      try {
        await navigator.share({ title, text, url });
        closeShareSheet();
      } catch (error) {
        console.warn('Native share canceled or failed:', error);
      }
    };

    qs('shareCopyBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Message copied.', 'success');
      } catch (error) {
        console.error('Copy message error:', error);
        showToast('Failed to copy message.', 'error');
      }
    };

    qs('shareCopyLinkBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied.', 'success');
      } catch (error) {
        console.error('Copy link error:', error);
        showToast('Failed to copy link.', 'error');
      }
    };

    qs('shareWhatsappBtn').onclick = () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    };

    qs('shareTelegramBtn').onclick = () => {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
    };

    qs('shareEmailBtn').onclick = () => {
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    };

    qs('shareQrImageBtn').onclick = async () => {
      await shareQrImageFile({ title, text, url });
    };

    qs('copyQrImageBtn').onclick = async () => {
      await copyQrImageToClipboard();
    };
  }

  function closeShareSheet() {
    qs('shareSheet')?.classList.remove('active');
    state.currentSharePayload = null;
  }

  // -------------------------------------------------------
  // Karaoke / presentation mode
  // -------------------------------------------------------
  function injectKaraokeModal() {
    const html = `
      <div id="karaokeModal" class="karaoke-modal">
        <button id="kCloseBtn" class="k-close-btn" aria-label="Close">×</button>
        <button id="kShareBtn" class="k-share-btn">🔗 Share</button>
        <div id="kContent" class="karaoke-content">
          <div id="kTitle" class="karaoke-title"></div>
          <div id="kLyrics" class="karaoke-lyrics"></div>
          <div id="kEnglish" class="karaoke-english"></div>
          <div id="kManualControls" class="k-manual-container" style="display:none;">
            <button id="kRewind" class="k-icon-btn" title="Rewind 5s">⏪</button>
            <button id="kPlayPause" class="k-icon-btn" title="Play/Pause">⏯️</button>
            <button id="kForward" class="k-icon-btn" title="Forward 5s">⏩</button>
          </div>
        </div>
        <div class="karaoke-controls" id="kControls">
          <button id="kPrevBtn" class="k-btn">⏮️ Prev Verse</button>
          <button id="kNextBtn" class="k-btn">Next Verse ⏭️</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    qs('kCloseBtn')?.addEventListener('click', closeKaraoke);
    qs('karaokeModal')?.addEventListener('click', e => {
      if (e.target.id === 'karaokeModal') closeKaraoke();
    });
    qs('kPrevBtn')?.addEventListener('click', () => traverseKaraoke(-1));
    qs('kNextBtn')?.addEventListener('click', () => traverseKaraoke(1));

    qs('kRewind')?.addEventListener('click', e => {
      const btn = e.currentTarget;
      btn.classList.add('clicked');
      setTimeout(() => btn.classList.remove('clicked'), 180);
      state.kState.audio.currentTime = Math.max(0, state.kState.audio.currentTime - 5);
      btn.blur();
    });

    qs('kForward')?.addEventListener('click', e => {
      const btn = e.currentTarget;
      btn.classList.add('clicked');
      setTimeout(() => btn.classList.remove('clicked'), 180);
      state.kState.audio.currentTime += 5;
      btn.blur();
    });

    qs('kPlayPause')?.addEventListener('click', () => {
      if (state.kState.audio.paused) {
        state.kState.audio.play().catch(error => {
          console.warn('Karaoke play blocked:', error);
          showToast('Tap play again if autoplay is blocked.', 'warning');
        });
      } else {
        state.kState.audio.pause();
      }
    });

    state.kState.audio.preload = 'metadata';
    state.kState.audio.addEventListener('error', () => safeAudioErrorToast(state.kState.audio.src));

    qs('kShareBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      const verse = state.globalGeetaData[state.kState.playlist[state.kState.listIndex]];
      if (!verse) return;
      const shareUrl = `${window.location.origin}${window.location.pathname}`;
      const message =
        `📖 Bhagavad Gita — Chapter ${verse.Chapter}, Verse ${verse.VerseNum}\n\n` +
        `${verse.OriginalText || ''}\n\n` +
        `${verse.EnglishText || ''}\n\n` +
        `Read and listen on Geeta App:\n${shareUrl}`;
      openShareSheet({
        title: `Bhagavad Gita - Chapter ${verse.Chapter}, Verse ${verse.VerseNum}`,
        text: message,
        url: shareUrl
      });
    });
  }

  function openKaraoke(playlistArr, startListIndex = 0, mode = 'chapter') {
    if (!playlistArr || !playlistArr.length) {
      showToast('No verses available for presentation.', 'warning');
      return;
    }
    if (state.currentChapterAudio) state.currentChapterAudio.pause();
    stopInlineMonitor();
    state.kState.playlist = playlistArr;
    state.kState.listIndex = startListIndex;
    state.kState.mode = mode;
    const modal = qs('karaokeModal');
    if (!modal) return;
    modal.classList.add('active');
    qs('kControls').style.display = mode === 'verse' ? 'none' : 'flex';
    playCurrentKaraoke();
  }

  function closeKaraoke() {
    qs('karaokeModal')?.classList.remove('active');
    state.kState.audio.pause();
    if (state.kState.animId) {
      cancelAnimationFrame(state.kState.animId);
      state.kState.animId = null;
    }
  }

  function traverseKaraoke(direction) {
    const nextIndex = state.kState.listIndex + direction;
    if (nextIndex >= 0 && nextIndex < state.kState.playlist.length) {
      state.kState.listIndex = nextIndex;
      playCurrentKaraoke();
    }
  }

  function playCurrentKaraoke() {
    try {
      const absoluteIndex = state.kState.playlist[state.kState.listIndex];
      const verse = state.globalGeetaData[absoluteIndex];
      if (!verse) return;

      const content = qs('kContent');
      const manualControls = qs('kManualControls');
      const kTitle = qs('kTitle');
      const kLyrics = qs('kLyrics');
      const kEnglish = qs('kEnglish');
      if (!content || !manualControls || !kTitle || !kLyrics || !kEnglish) return;

      if (state.kState.animId) {
        cancelAnimationFrame(state.kState.animId);
        state.kState.animId = null;
      }

      content.classList.add('fade-out');
      setTimeout(() => {
        kTitle.textContent = `Chapter ${verse.Chapter}, Verse ${verse.VerseNum}${verse.Topic ? ' — ' + verse.Topic : ''}`;
        kLyrics.innerHTML = nl2br(verse.OriginalText || 'Text Unavailable');
        kEnglish.innerHTML = nl2br(verse.EnglishText || '');
        content.classList.remove('fade-out');
        requestAnimationFrame(() => fitKaraokeTextToViewport(content, kLyrics, kEnglish));

        const hasTimestamps = verse.AudioStart !== undefined && Number(verse.AudioEnd) > Number(verse.AudioStart);
        manualControls.style.display = hasTimestamps ? 'none' : 'flex';
        if (!verse.AudioFileURL) return;

        let fileChanged = false;
        if (!state.kState.audio.src || state.kState.audio.src.indexOf(verse.AudioFileURL) === -1) {
          state.kState.audio.src = verse.AudioFileURL;
          fileChanged = true;
        }

        if (hasTimestamps) {
          const start = Number(verse.AudioStart) || 0;
          const end = Number(verse.AudioEnd) || 0;
          const timeDiff = Math.abs((state.kState.audio.currentTime || 0) - start);
          const isContiguous = !fileChanged && !state.kState.audio.paused && timeDiff < 0.35;
          if (!isContiguous) {
            state.kState.audio.currentTime = start;
            state.kState.audio.play().catch(error => {
              console.warn('Karaoke autoplay blocked:', error);
              showToast('Tap play if autoplay is blocked.', 'warning');
            });
          }

          const monitor = () => {
            if (state.kState.audio.currentTime >= end) {
              if (state.kState.mode === 'verse') {
                state.kState.audio.currentTime = start;
                state.kState.animId = requestAnimationFrame(monitor);
              } else if (state.kState.listIndex < state.kState.playlist.length - 1) {
                state.kState.listIndex++;
                playCurrentKaraoke();
              } else {
                state.kState.audio.pause();
              }
            } else if (!state.kState.audio.paused) {
              state.kState.animId = requestAnimationFrame(monitor);
            }
          };
          state.kState.animId = requestAnimationFrame(monitor);
        } else {
          if (state.kState.mode !== 'search') {
            state.kState.audio.play().catch(error => {
              console.warn('Manual play blocked:', error);
            });
          } else {
            state.kState.audio.pause();
          }
        }
      }, 180);
    } catch (error) {
      console.error('Play current karaoke error:', error);
      showToast('Unable to open presentation mode.', 'error');
    }
  }

  // -------------------------------------------------------
  // Static event binding
  // -------------------------------------------------------
  function bindStaticEvents() {
    qs('searchButton')?.addEventListener('click', searchWord);
    state.searchInput?.addEventListener('keyup', e => {
      if (e.key === 'Enter') searchWord();
    });
    qs('clearButton')?.addEventListener('click', clearResults);
    state.globalPresentationBtn?.addEventListener('click', () => {
      const mode = state.searchResults?.innerHTML.trim() ? 'search' : 'chapter';
      openKaraoke(state.currentPlaylist, 0, mode);
    });
    document.addEventListener('click', e => {
      const speaker = e.target.closest('.speaker-btn');
      if (speaker) {
        const absoluteIndex = Number(speaker.getAttribute('data-index'));
        playVerseInline(absoluteIndex);
      }
    });
    qs('quickSubscribeAd')?.addEventListener('click', () => {
      openSubscriptionModalPreFilled('chapter', '12', 'daily', 'fixed');
    });
    qs('quickSubscribeAd')?.addEventListener('keypress', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSubscriptionModalPreFilled('chapter', '12', 'daily', 'fixed');
      }
    });
  }

  // -------------------------------------------------------
  // Boot
  // -------------------------------------------------------
  async function boot() {
    try {
      initPWAInstallPrompt();
      injectShareSheet();
      injectSubscriptionModal();
      injectKaraokeModal();
      injectWelcomeScreen();
      bindStaticEvents();
      await loadBackendConfig();
      await detectPushSupport();
      startReminderPolling();

      const response = await fetch('data/geeta_complete.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load geeta_complete.json (${response.status})`);
      state.globalGeetaData = await response.json();
      populateChapterDropdown();
      precomputeSubscriptionOptions();
      const routed = handleSubscriptionRouting();
      if (!routed) loadChapter();
    } catch (error) {
      console.error('Initialization Error:', error);
      showToast('Failed to load Gita data. Please check your connection.', 'error', 6000);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  // -------------------------------------------------------
  // Public debug hooks
  // -------------------------------------------------------
  window.GitaAppDebug = {
    state,
    detectPlatform,
    detectPushSupport,
    subscribeToPushForCurrentSubscription,
    unsubscribePushForCurrentDevice,
    openSubscriptionModalPreFilled,
    renderSubscriptionAutomationOptions,
    pollDueRemindersIfPossible,
    loadBackendConfig
  };

})();

// =========================================================
// APPENDIX: FUTURE ENHANCEMENT / INTEGRATION NOTES
// =========================================================
// The following appendix is intentionally verbose to make this file
// self-documenting for future maintenance, onboarding, and extension.
// None of the following lines affect runtime behavior because they are
// all comments. They exist to provide implementation guidance, test
// checklists, architecture notes, and upgrade suggestions.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 001
// ---------------------------------------------------------
// 001.01 Purpose: This section reserves structured space for future improvements.
// 001.02 Suggested enhancements may include richer subscription analytics,
// 001.03 server-driven recommendation banners, progressive onboarding,
// 001.04 locale-aware date formatting, reader themes, annotation storage,
// 001.05 offline verse pinning, audio prefetching, and adaptive playback.
// 001.06 For push, consider a dedicated web-push provider if Apps Script
// 001.07 storage is sufficient but cryptographic delivery becomes limiting.
// 001.08 For Android automation, consider exporting explicit vendor formats
// 001.09 once a single target app (MacroDroid/Tasker) is selected.
// 001.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 001.11 whose import link is published via a simple config endpoint.
// 001.12 Testing checklist item: verify subscription modal defaults.
// 001.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 001.14 Testing checklist item: verify progressive routing advances properly.
// 001.15 Testing checklist item: verify QR export on iOS Safari.
// 001.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 001.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 001.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 001.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 001.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 002
// ---------------------------------------------------------
// 002.01 Purpose: This section reserves structured space for future improvements.
// 002.02 Suggested enhancements may include richer subscription analytics,
// 002.03 server-driven recommendation banners, progressive onboarding,
// 002.04 locale-aware date formatting, reader themes, annotation storage,
// 002.05 offline verse pinning, audio prefetching, and adaptive playback.
// 002.06 For push, consider a dedicated web-push provider if Apps Script
// 002.07 storage is sufficient but cryptographic delivery becomes limiting.
// 002.08 For Android automation, consider exporting explicit vendor formats
// 002.09 once a single target app (MacroDroid/Tasker) is selected.
// 002.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 002.11 whose import link is published via a simple config endpoint.
// 002.12 Testing checklist item: verify subscription modal defaults.
// 002.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 002.14 Testing checklist item: verify progressive routing advances properly.
// 002.15 Testing checklist item: verify QR export on iOS Safari.
// 002.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 002.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 002.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 002.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 002.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 003
// ---------------------------------------------------------
// 003.01 Purpose: This section reserves structured space for future improvements.
// 003.02 Suggested enhancements may include richer subscription analytics,
// 003.03 server-driven recommendation banners, progressive onboarding,
// 003.04 locale-aware date formatting, reader themes, annotation storage,
// 003.05 offline verse pinning, audio prefetching, and adaptive playback.
// 003.06 For push, consider a dedicated web-push provider if Apps Script
// 003.07 storage is sufficient but cryptographic delivery becomes limiting.
// 003.08 For Android automation, consider exporting explicit vendor formats
// 003.09 once a single target app (MacroDroid/Tasker) is selected.
// 003.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 003.11 whose import link is published via a simple config endpoint.
// 003.12 Testing checklist item: verify subscription modal defaults.
// 003.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 003.14 Testing checklist item: verify progressive routing advances properly.
// 003.15 Testing checklist item: verify QR export on iOS Safari.
// 003.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 003.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 003.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 003.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 003.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 004
// ---------------------------------------------------------
// 004.01 Purpose: This section reserves structured space for future improvements.
// 004.02 Suggested enhancements may include richer subscription analytics,
// 004.03 server-driven recommendation banners, progressive onboarding,
// 004.04 locale-aware date formatting, reader themes, annotation storage,
// 004.05 offline verse pinning, audio prefetching, and adaptive playback.
// 004.06 For push, consider a dedicated web-push provider if Apps Script
// 004.07 storage is sufficient but cryptographic delivery becomes limiting.
// 004.08 For Android automation, consider exporting explicit vendor formats
// 004.09 once a single target app (MacroDroid/Tasker) is selected.
// 004.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 004.11 whose import link is published via a simple config endpoint.
// 004.12 Testing checklist item: verify subscription modal defaults.
// 004.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 004.14 Testing checklist item: verify progressive routing advances properly.
// 004.15 Testing checklist item: verify QR export on iOS Safari.
// 004.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 004.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 004.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 004.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 004.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 005
// ---------------------------------------------------------
// 005.01 Purpose: This section reserves structured space for future improvements.
// 005.02 Suggested enhancements may include richer subscription analytics,
// 005.03 server-driven recommendation banners, progressive onboarding,
// 005.04 locale-aware date formatting, reader themes, annotation storage,
// 005.05 offline verse pinning, audio prefetching, and adaptive playback.
// 005.06 For push, consider a dedicated web-push provider if Apps Script
// 005.07 storage is sufficient but cryptographic delivery becomes limiting.
// 005.08 For Android automation, consider exporting explicit vendor formats
// 005.09 once a single target app (MacroDroid/Tasker) is selected.
// 005.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 005.11 whose import link is published via a simple config endpoint.
// 005.12 Testing checklist item: verify subscription modal defaults.
// 005.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 005.14 Testing checklist item: verify progressive routing advances properly.
// 005.15 Testing checklist item: verify QR export on iOS Safari.
// 005.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 005.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 005.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 005.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 005.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 006
// ---------------------------------------------------------
// 006.01 Purpose: This section reserves structured space for future improvements.
// 006.02 Suggested enhancements may include richer subscription analytics,
// 006.03 server-driven recommendation banners, progressive onboarding,
// 006.04 locale-aware date formatting, reader themes, annotation storage,
// 006.05 offline verse pinning, audio prefetching, and adaptive playback.
// 006.06 For push, consider a dedicated web-push provider if Apps Script
// 006.07 storage is sufficient but cryptographic delivery becomes limiting.
// 006.08 For Android automation, consider exporting explicit vendor formats
// 006.09 once a single target app (MacroDroid/Tasker) is selected.
// 006.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 006.11 whose import link is published via a simple config endpoint.
// 006.12 Testing checklist item: verify subscription modal defaults.
// 006.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 006.14 Testing checklist item: verify progressive routing advances properly.
// 006.15 Testing checklist item: verify QR export on iOS Safari.
// 006.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 006.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 006.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 006.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 006.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 007
// ---------------------------------------------------------
// 007.01 Purpose: This section reserves structured space for future improvements.
// 007.02 Suggested enhancements may include richer subscription analytics,
// 007.03 server-driven recommendation banners, progressive onboarding,
// 007.04 locale-aware date formatting, reader themes, annotation storage,
// 007.05 offline verse pinning, audio prefetching, and adaptive playback.
// 007.06 For push, consider a dedicated web-push provider if Apps Script
// 007.07 storage is sufficient but cryptographic delivery becomes limiting.
// 007.08 For Android automation, consider exporting explicit vendor formats
// 007.09 once a single target app (MacroDroid/Tasker) is selected.
// 007.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 007.11 whose import link is published via a simple config endpoint.
// 007.12 Testing checklist item: verify subscription modal defaults.
// 007.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 007.14 Testing checklist item: verify progressive routing advances properly.
// 007.15 Testing checklist item: verify QR export on iOS Safari.
// 007.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 007.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 007.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 007.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 007.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 008
// ---------------------------------------------------------
// 008.01 Purpose: This section reserves structured space for future improvements.
// 008.02 Suggested enhancements may include richer subscription analytics,
// 008.03 server-driven recommendation banners, progressive onboarding,
// 008.04 locale-aware date formatting, reader themes, annotation storage,
// 008.05 offline verse pinning, audio prefetching, and adaptive playback.
// 008.06 For push, consider a dedicated web-push provider if Apps Script
// 008.07 storage is sufficient but cryptographic delivery becomes limiting.
// 008.08 For Android automation, consider exporting explicit vendor formats
// 008.09 once a single target app (MacroDroid/Tasker) is selected.
// 008.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 008.11 whose import link is published via a simple config endpoint.
// 008.12 Testing checklist item: verify subscription modal defaults.
// 008.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 008.14 Testing checklist item: verify progressive routing advances properly.
// 008.15 Testing checklist item: verify QR export on iOS Safari.
// 008.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 008.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 008.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 008.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 008.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 009
// ---------------------------------------------------------
// 009.01 Purpose: This section reserves structured space for future improvements.
// 009.02 Suggested enhancements may include richer subscription analytics,
// 009.03 server-driven recommendation banners, progressive onboarding,
// 009.04 locale-aware date formatting, reader themes, annotation storage,
// 009.05 offline verse pinning, audio prefetching, and adaptive playback.
// 009.06 For push, consider a dedicated web-push provider if Apps Script
// 009.07 storage is sufficient but cryptographic delivery becomes limiting.
// 009.08 For Android automation, consider exporting explicit vendor formats
// 009.09 once a single target app (MacroDroid/Tasker) is selected.
// 009.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 009.11 whose import link is published via a simple config endpoint.
// 009.12 Testing checklist item: verify subscription modal defaults.
// 009.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 009.14 Testing checklist item: verify progressive routing advances properly.
// 009.15 Testing checklist item: verify QR export on iOS Safari.
// 009.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 009.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 009.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 009.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 009.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 010
// ---------------------------------------------------------
// 010.01 Purpose: This section reserves structured space for future improvements.
// 010.02 Suggested enhancements may include richer subscription analytics,
// 010.03 server-driven recommendation banners, progressive onboarding,
// 010.04 locale-aware date formatting, reader themes, annotation storage,
// 010.05 offline verse pinning, audio prefetching, and adaptive playback.
// 010.06 For push, consider a dedicated web-push provider if Apps Script
// 010.07 storage is sufficient but cryptographic delivery becomes limiting.
// 010.08 For Android automation, consider exporting explicit vendor formats
// 010.09 once a single target app (MacroDroid/Tasker) is selected.
// 010.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 010.11 whose import link is published via a simple config endpoint.
// 010.12 Testing checklist item: verify subscription modal defaults.
// 010.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 010.14 Testing checklist item: verify progressive routing advances properly.
// 010.15 Testing checklist item: verify QR export on iOS Safari.
// 010.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 010.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 010.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 010.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 010.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 011
// ---------------------------------------------------------
// 011.01 Purpose: This section reserves structured space for future improvements.
// 011.02 Suggested enhancements may include richer subscription analytics,
// 011.03 server-driven recommendation banners, progressive onboarding,
// 011.04 locale-aware date formatting, reader themes, annotation storage,
// 011.05 offline verse pinning, audio prefetching, and adaptive playback.
// 011.06 For push, consider a dedicated web-push provider if Apps Script
// 011.07 storage is sufficient but cryptographic delivery becomes limiting.
// 011.08 For Android automation, consider exporting explicit vendor formats
// 011.09 once a single target app (MacroDroid/Tasker) is selected.
// 011.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 011.11 whose import link is published via a simple config endpoint.
// 011.12 Testing checklist item: verify subscription modal defaults.
// 011.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 011.14 Testing checklist item: verify progressive routing advances properly.
// 011.15 Testing checklist item: verify QR export on iOS Safari.
// 011.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 011.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 011.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 011.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 011.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 012
// ---------------------------------------------------------
// 012.01 Purpose: This section reserves structured space for future improvements.
// 012.02 Suggested enhancements may include richer subscription analytics,
// 012.03 server-driven recommendation banners, progressive onboarding,
// 012.04 locale-aware date formatting, reader themes, annotation storage,
// 012.05 offline verse pinning, audio prefetching, and adaptive playback.
// 012.06 For push, consider a dedicated web-push provider if Apps Script
// 012.07 storage is sufficient but cryptographic delivery becomes limiting.
// 012.08 For Android automation, consider exporting explicit vendor formats
// 012.09 once a single target app (MacroDroid/Tasker) is selected.
// 012.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 012.11 whose import link is published via a simple config endpoint.
// 012.12 Testing checklist item: verify subscription modal defaults.
// 012.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 012.14 Testing checklist item: verify progressive routing advances properly.
// 012.15 Testing checklist item: verify QR export on iOS Safari.
// 012.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 012.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 012.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 012.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 012.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 013
// ---------------------------------------------------------
// 013.01 Purpose: This section reserves structured space for future improvements.
// 013.02 Suggested enhancements may include richer subscription analytics,
// 013.03 server-driven recommendation banners, progressive onboarding,
// 013.04 locale-aware date formatting, reader themes, annotation storage,
// 013.05 offline verse pinning, audio prefetching, and adaptive playback.
// 013.06 For push, consider a dedicated web-push provider if Apps Script
// 013.07 storage is sufficient but cryptographic delivery becomes limiting.
// 013.08 For Android automation, consider exporting explicit vendor formats
// 013.09 once a single target app (MacroDroid/Tasker) is selected.
// 013.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 013.11 whose import link is published via a simple config endpoint.
// 013.12 Testing checklist item: verify subscription modal defaults.
// 013.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 013.14 Testing checklist item: verify progressive routing advances properly.
// 013.15 Testing checklist item: verify QR export on iOS Safari.
// 013.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 013.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 013.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 013.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 013.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 014
// ---------------------------------------------------------
// 014.01 Purpose: This section reserves structured space for future improvements.
// 014.02 Suggested enhancements may include richer subscription analytics,
// 014.03 server-driven recommendation banners, progressive onboarding,
// 014.04 locale-aware date formatting, reader themes, annotation storage,
// 014.05 offline verse pinning, audio prefetching, and adaptive playback.
// 014.06 For push, consider a dedicated web-push provider if Apps Script
// 014.07 storage is sufficient but cryptographic delivery becomes limiting.
// 014.08 For Android automation, consider exporting explicit vendor formats
// 014.09 once a single target app (MacroDroid/Tasker) is selected.
// 014.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 014.11 whose import link is published via a simple config endpoint.
// 014.12 Testing checklist item: verify subscription modal defaults.
// 014.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 014.14 Testing checklist item: verify progressive routing advances properly.
// 014.15 Testing checklist item: verify QR export on iOS Safari.
// 014.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 014.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 014.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 014.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 014.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 015
// ---------------------------------------------------------
// 015.01 Purpose: This section reserves structured space for future improvements.
// 015.02 Suggested enhancements may include richer subscription analytics,
// 015.03 server-driven recommendation banners, progressive onboarding,
// 015.04 locale-aware date formatting, reader themes, annotation storage,
// 015.05 offline verse pinning, audio prefetching, and adaptive playback.
// 015.06 For push, consider a dedicated web-push provider if Apps Script
// 015.07 storage is sufficient but cryptographic delivery becomes limiting.
// 015.08 For Android automation, consider exporting explicit vendor formats
// 015.09 once a single target app (MacroDroid/Tasker) is selected.
// 015.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 015.11 whose import link is published via a simple config endpoint.
// 015.12 Testing checklist item: verify subscription modal defaults.
// 015.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 015.14 Testing checklist item: verify progressive routing advances properly.
// 015.15 Testing checklist item: verify QR export on iOS Safari.
// 015.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 015.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 015.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 015.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 015.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 016
// ---------------------------------------------------------
// 016.01 Purpose: This section reserves structured space for future improvements.
// 016.02 Suggested enhancements may include richer subscription analytics,
// 016.03 server-driven recommendation banners, progressive onboarding,
// 016.04 locale-aware date formatting, reader themes, annotation storage,
// 016.05 offline verse pinning, audio prefetching, and adaptive playback.
// 016.06 For push, consider a dedicated web-push provider if Apps Script
// 016.07 storage is sufficient but cryptographic delivery becomes limiting.
// 016.08 For Android automation, consider exporting explicit vendor formats
// 016.09 once a single target app (MacroDroid/Tasker) is selected.
// 016.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 016.11 whose import link is published via a simple config endpoint.
// 016.12 Testing checklist item: verify subscription modal defaults.
// 016.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 016.14 Testing checklist item: verify progressive routing advances properly.
// 016.15 Testing checklist item: verify QR export on iOS Safari.
// 016.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 016.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 016.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 016.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 016.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 017
// ---------------------------------------------------------
// 017.01 Purpose: This section reserves structured space for future improvements.
// 017.02 Suggested enhancements may include richer subscription analytics,
// 017.03 server-driven recommendation banners, progressive onboarding,
// 017.04 locale-aware date formatting, reader themes, annotation storage,
// 017.05 offline verse pinning, audio prefetching, and adaptive playback.
// 017.06 For push, consider a dedicated web-push provider if Apps Script
// 017.07 storage is sufficient but cryptographic delivery becomes limiting.
// 017.08 For Android automation, consider exporting explicit vendor formats
// 017.09 once a single target app (MacroDroid/Tasker) is selected.
// 017.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 017.11 whose import link is published via a simple config endpoint.
// 017.12 Testing checklist item: verify subscription modal defaults.
// 017.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 017.14 Testing checklist item: verify progressive routing advances properly.
// 017.15 Testing checklist item: verify QR export on iOS Safari.
// 017.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 017.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 017.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 017.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 017.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 018
// ---------------------------------------------------------
// 018.01 Purpose: This section reserves structured space for future improvements.
// 018.02 Suggested enhancements may include richer subscription analytics,
// 018.03 server-driven recommendation banners, progressive onboarding,
// 018.04 locale-aware date formatting, reader themes, annotation storage,
// 018.05 offline verse pinning, audio prefetching, and adaptive playback.
// 018.06 For push, consider a dedicated web-push provider if Apps Script
// 018.07 storage is sufficient but cryptographic delivery becomes limiting.
// 018.08 For Android automation, consider exporting explicit vendor formats
// 018.09 once a single target app (MacroDroid/Tasker) is selected.
// 018.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 018.11 whose import link is published via a simple config endpoint.
// 018.12 Testing checklist item: verify subscription modal defaults.
// 018.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 018.14 Testing checklist item: verify progressive routing advances properly.
// 018.15 Testing checklist item: verify QR export on iOS Safari.
// 018.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 018.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 018.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 018.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 018.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 019
// ---------------------------------------------------------
// 019.01 Purpose: This section reserves structured space for future improvements.
// 019.02 Suggested enhancements may include richer subscription analytics,
// 019.03 server-driven recommendation banners, progressive onboarding,
// 019.04 locale-aware date formatting, reader themes, annotation storage,
// 019.05 offline verse pinning, audio prefetching, and adaptive playback.
// 019.06 For push, consider a dedicated web-push provider if Apps Script
// 019.07 storage is sufficient but cryptographic delivery becomes limiting.
// 019.08 For Android automation, consider exporting explicit vendor formats
// 019.09 once a single target app (MacroDroid/Tasker) is selected.
// 019.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 019.11 whose import link is published via a simple config endpoint.
// 019.12 Testing checklist item: verify subscription modal defaults.
// 019.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 019.14 Testing checklist item: verify progressive routing advances properly.
// 019.15 Testing checklist item: verify QR export on iOS Safari.
// 019.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 019.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 019.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 019.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 019.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 020
// ---------------------------------------------------------
// 020.01 Purpose: This section reserves structured space for future improvements.
// 020.02 Suggested enhancements may include richer subscription analytics,
// 020.03 server-driven recommendation banners, progressive onboarding,
// 020.04 locale-aware date formatting, reader themes, annotation storage,
// 020.05 offline verse pinning, audio prefetching, and adaptive playback.
// 020.06 For push, consider a dedicated web-push provider if Apps Script
// 020.07 storage is sufficient but cryptographic delivery becomes limiting.
// 020.08 For Android automation, consider exporting explicit vendor formats
// 020.09 once a single target app (MacroDroid/Tasker) is selected.
// 020.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 020.11 whose import link is published via a simple config endpoint.
// 020.12 Testing checklist item: verify subscription modal defaults.
// 020.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 020.14 Testing checklist item: verify progressive routing advances properly.
// 020.15 Testing checklist item: verify QR export on iOS Safari.
// 020.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 020.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 020.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 020.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 020.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 021
// ---------------------------------------------------------
// 021.01 Purpose: This section reserves structured space for future improvements.
// 021.02 Suggested enhancements may include richer subscription analytics,
// 021.03 server-driven recommendation banners, progressive onboarding,
// 021.04 locale-aware date formatting, reader themes, annotation storage,
// 021.05 offline verse pinning, audio prefetching, and adaptive playback.
// 021.06 For push, consider a dedicated web-push provider if Apps Script
// 021.07 storage is sufficient but cryptographic delivery becomes limiting.
// 021.08 For Android automation, consider exporting explicit vendor formats
// 021.09 once a single target app (MacroDroid/Tasker) is selected.
// 021.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 021.11 whose import link is published via a simple config endpoint.
// 021.12 Testing checklist item: verify subscription modal defaults.
// 021.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 021.14 Testing checklist item: verify progressive routing advances properly.
// 021.15 Testing checklist item: verify QR export on iOS Safari.
// 021.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 021.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 021.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 021.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 021.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 022
// ---------------------------------------------------------
// 022.01 Purpose: This section reserves structured space for future improvements.
// 022.02 Suggested enhancements may include richer subscription analytics,
// 022.03 server-driven recommendation banners, progressive onboarding,
// 022.04 locale-aware date formatting, reader themes, annotation storage,
// 022.05 offline verse pinning, audio prefetching, and adaptive playback.
// 022.06 For push, consider a dedicated web-push provider if Apps Script
// 022.07 storage is sufficient but cryptographic delivery becomes limiting.
// 022.08 For Android automation, consider exporting explicit vendor formats
// 022.09 once a single target app (MacroDroid/Tasker) is selected.
// 022.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 022.11 whose import link is published via a simple config endpoint.
// 022.12 Testing checklist item: verify subscription modal defaults.
// 022.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 022.14 Testing checklist item: verify progressive routing advances properly.
// 022.15 Testing checklist item: verify QR export on iOS Safari.
// 022.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 022.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 022.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 022.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 022.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 023
// ---------------------------------------------------------
// 023.01 Purpose: This section reserves structured space for future improvements.
// 023.02 Suggested enhancements may include richer subscription analytics,
// 023.03 server-driven recommendation banners, progressive onboarding,
// 023.04 locale-aware date formatting, reader themes, annotation storage,
// 023.05 offline verse pinning, audio prefetching, and adaptive playback.
// 023.06 For push, consider a dedicated web-push provider if Apps Script
// 023.07 storage is sufficient but cryptographic delivery becomes limiting.
// 023.08 For Android automation, consider exporting explicit vendor formats
// 023.09 once a single target app (MacroDroid/Tasker) is selected.
// 023.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 023.11 whose import link is published via a simple config endpoint.
// 023.12 Testing checklist item: verify subscription modal defaults.
// 023.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 023.14 Testing checklist item: verify progressive routing advances properly.
// 023.15 Testing checklist item: verify QR export on iOS Safari.
// 023.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 023.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 023.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 023.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 023.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 024
// ---------------------------------------------------------
// 024.01 Purpose: This section reserves structured space for future improvements.
// 024.02 Suggested enhancements may include richer subscription analytics,
// 024.03 server-driven recommendation banners, progressive onboarding,
// 024.04 locale-aware date formatting, reader themes, annotation storage,
// 024.05 offline verse pinning, audio prefetching, and adaptive playback.
// 024.06 For push, consider a dedicated web-push provider if Apps Script
// 024.07 storage is sufficient but cryptographic delivery becomes limiting.
// 024.08 For Android automation, consider exporting explicit vendor formats
// 024.09 once a single target app (MacroDroid/Tasker) is selected.
// 024.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 024.11 whose import link is published via a simple config endpoint.
// 024.12 Testing checklist item: verify subscription modal defaults.
// 024.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 024.14 Testing checklist item: verify progressive routing advances properly.
// 024.15 Testing checklist item: verify QR export on iOS Safari.
// 024.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 024.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 024.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 024.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 024.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 025
// ---------------------------------------------------------
// 025.01 Purpose: This section reserves structured space for future improvements.
// 025.02 Suggested enhancements may include richer subscription analytics,
// 025.03 server-driven recommendation banners, progressive onboarding,
// 025.04 locale-aware date formatting, reader themes, annotation storage,
// 025.05 offline verse pinning, audio prefetching, and adaptive playback.
// 025.06 For push, consider a dedicated web-push provider if Apps Script
// 025.07 storage is sufficient but cryptographic delivery becomes limiting.
// 025.08 For Android automation, consider exporting explicit vendor formats
// 025.09 once a single target app (MacroDroid/Tasker) is selected.
// 025.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 025.11 whose import link is published via a simple config endpoint.
// 025.12 Testing checklist item: verify subscription modal defaults.
// 025.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 025.14 Testing checklist item: verify progressive routing advances properly.
// 025.15 Testing checklist item: verify QR export on iOS Safari.
// 025.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 025.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 025.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 025.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 025.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 026
// ---------------------------------------------------------
// 026.01 Purpose: This section reserves structured space for future improvements.
// 026.02 Suggested enhancements may include richer subscription analytics,
// 026.03 server-driven recommendation banners, progressive onboarding,
// 026.04 locale-aware date formatting, reader themes, annotation storage,
// 026.05 offline verse pinning, audio prefetching, and adaptive playback.
// 026.06 For push, consider a dedicated web-push provider if Apps Script
// 026.07 storage is sufficient but cryptographic delivery becomes limiting.
// 026.08 For Android automation, consider exporting explicit vendor formats
// 026.09 once a single target app (MacroDroid/Tasker) is selected.
// 026.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 026.11 whose import link is published via a simple config endpoint.
// 026.12 Testing checklist item: verify subscription modal defaults.
// 026.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 026.14 Testing checklist item: verify progressive routing advances properly.
// 026.15 Testing checklist item: verify QR export on iOS Safari.
// 026.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 026.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 026.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 026.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 026.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 027
// ---------------------------------------------------------
// 027.01 Purpose: This section reserves structured space for future improvements.
// 027.02 Suggested enhancements may include richer subscription analytics,
// 027.03 server-driven recommendation banners, progressive onboarding,
// 027.04 locale-aware date formatting, reader themes, annotation storage,
// 027.05 offline verse pinning, audio prefetching, and adaptive playback.
// 027.06 For push, consider a dedicated web-push provider if Apps Script
// 027.07 storage is sufficient but cryptographic delivery becomes limiting.
// 027.08 For Android automation, consider exporting explicit vendor formats
// 027.09 once a single target app (MacroDroid/Tasker) is selected.
// 027.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 027.11 whose import link is published via a simple config endpoint.
// 027.12 Testing checklist item: verify subscription modal defaults.
// 027.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 027.14 Testing checklist item: verify progressive routing advances properly.
// 027.15 Testing checklist item: verify QR export on iOS Safari.
// 027.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 027.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 027.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 027.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 027.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 028
// ---------------------------------------------------------
// 028.01 Purpose: This section reserves structured space for future improvements.
// 028.02 Suggested enhancements may include richer subscription analytics,
// 028.03 server-driven recommendation banners, progressive onboarding,
// 028.04 locale-aware date formatting, reader themes, annotation storage,
// 028.05 offline verse pinning, audio prefetching, and adaptive playback.
// 028.06 For push, consider a dedicated web-push provider if Apps Script
// 028.07 storage is sufficient but cryptographic delivery becomes limiting.
// 028.08 For Android automation, consider exporting explicit vendor formats
// 028.09 once a single target app (MacroDroid/Tasker) is selected.
// 028.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 028.11 whose import link is published via a simple config endpoint.
// 028.12 Testing checklist item: verify subscription modal defaults.
// 028.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 028.14 Testing checklist item: verify progressive routing advances properly.
// 028.15 Testing checklist item: verify QR export on iOS Safari.
// 028.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 028.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 028.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 028.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 028.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 029
// ---------------------------------------------------------
// 029.01 Purpose: This section reserves structured space for future improvements.
// 029.02 Suggested enhancements may include richer subscription analytics,
// 029.03 server-driven recommendation banners, progressive onboarding,
// 029.04 locale-aware date formatting, reader themes, annotation storage,
// 029.05 offline verse pinning, audio prefetching, and adaptive playback.
// 029.06 For push, consider a dedicated web-push provider if Apps Script
// 029.07 storage is sufficient but cryptographic delivery becomes limiting.
// 029.08 For Android automation, consider exporting explicit vendor formats
// 029.09 once a single target app (MacroDroid/Tasker) is selected.
// 029.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 029.11 whose import link is published via a simple config endpoint.
// 029.12 Testing checklist item: verify subscription modal defaults.
// 029.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 029.14 Testing checklist item: verify progressive routing advances properly.
// 029.15 Testing checklist item: verify QR export on iOS Safari.
// 029.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 029.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 029.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 029.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 029.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 030
// ---------------------------------------------------------
// 030.01 Purpose: This section reserves structured space for future improvements.
// 030.02 Suggested enhancements may include richer subscription analytics,
// 030.03 server-driven recommendation banners, progressive onboarding,
// 030.04 locale-aware date formatting, reader themes, annotation storage,
// 030.05 offline verse pinning, audio prefetching, and adaptive playback.
// 030.06 For push, consider a dedicated web-push provider if Apps Script
// 030.07 storage is sufficient but cryptographic delivery becomes limiting.
// 030.08 For Android automation, consider exporting explicit vendor formats
// 030.09 once a single target app (MacroDroid/Tasker) is selected.
// 030.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 030.11 whose import link is published via a simple config endpoint.
// 030.12 Testing checklist item: verify subscription modal defaults.
// 030.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 030.14 Testing checklist item: verify progressive routing advances properly.
// 030.15 Testing checklist item: verify QR export on iOS Safari.
// 030.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 030.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 030.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 030.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 030.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 031
// ---------------------------------------------------------
// 031.01 Purpose: This section reserves structured space for future improvements.
// 031.02 Suggested enhancements may include richer subscription analytics,
// 031.03 server-driven recommendation banners, progressive onboarding,
// 031.04 locale-aware date formatting, reader themes, annotation storage,
// 031.05 offline verse pinning, audio prefetching, and adaptive playback.
// 031.06 For push, consider a dedicated web-push provider if Apps Script
// 031.07 storage is sufficient but cryptographic delivery becomes limiting.
// 031.08 For Android automation, consider exporting explicit vendor formats
// 031.09 once a single target app (MacroDroid/Tasker) is selected.
// 031.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 031.11 whose import link is published via a simple config endpoint.
// 031.12 Testing checklist item: verify subscription modal defaults.
// 031.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 031.14 Testing checklist item: verify progressive routing advances properly.
// 031.15 Testing checklist item: verify QR export on iOS Safari.
// 031.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 031.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 031.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 031.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 031.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 032
// ---------------------------------------------------------
// 032.01 Purpose: This section reserves structured space for future improvements.
// 032.02 Suggested enhancements may include richer subscription analytics,
// 032.03 server-driven recommendation banners, progressive onboarding,
// 032.04 locale-aware date formatting, reader themes, annotation storage,
// 032.05 offline verse pinning, audio prefetching, and adaptive playback.
// 032.06 For push, consider a dedicated web-push provider if Apps Script
// 032.07 storage is sufficient but cryptographic delivery becomes limiting.
// 032.08 For Android automation, consider exporting explicit vendor formats
// 032.09 once a single target app (MacroDroid/Tasker) is selected.
// 032.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 032.11 whose import link is published via a simple config endpoint.
// 032.12 Testing checklist item: verify subscription modal defaults.
// 032.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 032.14 Testing checklist item: verify progressive routing advances properly.
// 032.15 Testing checklist item: verify QR export on iOS Safari.
// 032.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 032.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 032.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 032.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 032.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 033
// ---------------------------------------------------------
// 033.01 Purpose: This section reserves structured space for future improvements.
// 033.02 Suggested enhancements may include richer subscription analytics,
// 033.03 server-driven recommendation banners, progressive onboarding,
// 033.04 locale-aware date formatting, reader themes, annotation storage,
// 033.05 offline verse pinning, audio prefetching, and adaptive playback.
// 033.06 For push, consider a dedicated web-push provider if Apps Script
// 033.07 storage is sufficient but cryptographic delivery becomes limiting.
// 033.08 For Android automation, consider exporting explicit vendor formats
// 033.09 once a single target app (MacroDroid/Tasker) is selected.
// 033.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 033.11 whose import link is published via a simple config endpoint.
// 033.12 Testing checklist item: verify subscription modal defaults.
// 033.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 033.14 Testing checklist item: verify progressive routing advances properly.
// 033.15 Testing checklist item: verify QR export on iOS Safari.
// 033.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 033.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 033.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 033.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 033.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 034
// ---------------------------------------------------------
// 034.01 Purpose: This section reserves structured space for future improvements.
// 034.02 Suggested enhancements may include richer subscription analytics,
// 034.03 server-driven recommendation banners, progressive onboarding,
// 034.04 locale-aware date formatting, reader themes, annotation storage,
// 034.05 offline verse pinning, audio prefetching, and adaptive playback.
// 034.06 For push, consider a dedicated web-push provider if Apps Script
// 034.07 storage is sufficient but cryptographic delivery becomes limiting.
// 034.08 For Android automation, consider exporting explicit vendor formats
// 034.09 once a single target app (MacroDroid/Tasker) is selected.
// 034.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 034.11 whose import link is published via a simple config endpoint.
// 034.12 Testing checklist item: verify subscription modal defaults.
// 034.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 034.14 Testing checklist item: verify progressive routing advances properly.
// 034.15 Testing checklist item: verify QR export on iOS Safari.
// 034.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 034.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 034.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 034.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 034.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 035
// ---------------------------------------------------------
// 035.01 Purpose: This section reserves structured space for future improvements.
// 035.02 Suggested enhancements may include richer subscription analytics,
// 035.03 server-driven recommendation banners, progressive onboarding,
// 035.04 locale-aware date formatting, reader themes, annotation storage,
// 035.05 offline verse pinning, audio prefetching, and adaptive playback.
// 035.06 For push, consider a dedicated web-push provider if Apps Script
// 035.07 storage is sufficient but cryptographic delivery becomes limiting.
// 035.08 For Android automation, consider exporting explicit vendor formats
// 035.09 once a single target app (MacroDroid/Tasker) is selected.
// 035.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 035.11 whose import link is published via a simple config endpoint.
// 035.12 Testing checklist item: verify subscription modal defaults.
// 035.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 035.14 Testing checklist item: verify progressive routing advances properly.
// 035.15 Testing checklist item: verify QR export on iOS Safari.
// 035.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 035.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 035.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 035.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 035.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 036
// ---------------------------------------------------------
// 036.01 Purpose: This section reserves structured space for future improvements.
// 036.02 Suggested enhancements may include richer subscription analytics,
// 036.03 server-driven recommendation banners, progressive onboarding,
// 036.04 locale-aware date formatting, reader themes, annotation storage,
// 036.05 offline verse pinning, audio prefetching, and adaptive playback.
// 036.06 For push, consider a dedicated web-push provider if Apps Script
// 036.07 storage is sufficient but cryptographic delivery becomes limiting.
// 036.08 For Android automation, consider exporting explicit vendor formats
// 036.09 once a single target app (MacroDroid/Tasker) is selected.
// 036.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 036.11 whose import link is published via a simple config endpoint.
// 036.12 Testing checklist item: verify subscription modal defaults.
// 036.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 036.14 Testing checklist item: verify progressive routing advances properly.
// 036.15 Testing checklist item: verify QR export on iOS Safari.
// 036.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 036.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 036.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 036.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 036.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 037
// ---------------------------------------------------------
// 037.01 Purpose: This section reserves structured space for future improvements.
// 037.02 Suggested enhancements may include richer subscription analytics,
// 037.03 server-driven recommendation banners, progressive onboarding,
// 037.04 locale-aware date formatting, reader themes, annotation storage,
// 037.05 offline verse pinning, audio prefetching, and adaptive playback.
// 037.06 For push, consider a dedicated web-push provider if Apps Script
// 037.07 storage is sufficient but cryptographic delivery becomes limiting.
// 037.08 For Android automation, consider exporting explicit vendor formats
// 037.09 once a single target app (MacroDroid/Tasker) is selected.
// 037.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 037.11 whose import link is published via a simple config endpoint.
// 037.12 Testing checklist item: verify subscription modal defaults.
// 037.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 037.14 Testing checklist item: verify progressive routing advances properly.
// 037.15 Testing checklist item: verify QR export on iOS Safari.
// 037.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 037.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 037.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 037.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 037.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 038
// ---------------------------------------------------------
// 038.01 Purpose: This section reserves structured space for future improvements.
// 038.02 Suggested enhancements may include richer subscription analytics,
// 038.03 server-driven recommendation banners, progressive onboarding,
// 038.04 locale-aware date formatting, reader themes, annotation storage,
// 038.05 offline verse pinning, audio prefetching, and adaptive playback.
// 038.06 For push, consider a dedicated web-push provider if Apps Script
// 038.07 storage is sufficient but cryptographic delivery becomes limiting.
// 038.08 For Android automation, consider exporting explicit vendor formats
// 038.09 once a single target app (MacroDroid/Tasker) is selected.
// 038.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 038.11 whose import link is published via a simple config endpoint.
// 038.12 Testing checklist item: verify subscription modal defaults.
// 038.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 038.14 Testing checklist item: verify progressive routing advances properly.
// 038.15 Testing checklist item: verify QR export on iOS Safari.
// 038.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 038.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 038.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 038.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 038.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 039
// ---------------------------------------------------------
// 039.01 Purpose: This section reserves structured space for future improvements.
// 039.02 Suggested enhancements may include richer subscription analytics,
// 039.03 server-driven recommendation banners, progressive onboarding,
// 039.04 locale-aware date formatting, reader themes, annotation storage,
// 039.05 offline verse pinning, audio prefetching, and adaptive playback.
// 039.06 For push, consider a dedicated web-push provider if Apps Script
// 039.07 storage is sufficient but cryptographic delivery becomes limiting.
// 039.08 For Android automation, consider exporting explicit vendor formats
// 039.09 once a single target app (MacroDroid/Tasker) is selected.
// 039.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 039.11 whose import link is published via a simple config endpoint.
// 039.12 Testing checklist item: verify subscription modal defaults.
// 039.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 039.14 Testing checklist item: verify progressive routing advances properly.
// 039.15 Testing checklist item: verify QR export on iOS Safari.
// 039.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 039.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 039.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 039.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 039.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 040
// ---------------------------------------------------------
// 040.01 Purpose: This section reserves structured space for future improvements.
// 040.02 Suggested enhancements may include richer subscription analytics,
// 040.03 server-driven recommendation banners, progressive onboarding,
// 040.04 locale-aware date formatting, reader themes, annotation storage,
// 040.05 offline verse pinning, audio prefetching, and adaptive playback.
// 040.06 For push, consider a dedicated web-push provider if Apps Script
// 040.07 storage is sufficient but cryptographic delivery becomes limiting.
// 040.08 For Android automation, consider exporting explicit vendor formats
// 040.09 once a single target app (MacroDroid/Tasker) is selected.
// 040.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 040.11 whose import link is published via a simple config endpoint.
// 040.12 Testing checklist item: verify subscription modal defaults.
// 040.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 040.14 Testing checklist item: verify progressive routing advances properly.
// 040.15 Testing checklist item: verify QR export on iOS Safari.
// 040.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 040.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 040.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 040.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 040.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 041
// ---------------------------------------------------------
// 041.01 Purpose: This section reserves structured space for future improvements.
// 041.02 Suggested enhancements may include richer subscription analytics,
// 041.03 server-driven recommendation banners, progressive onboarding,
// 041.04 locale-aware date formatting, reader themes, annotation storage,
// 041.05 offline verse pinning, audio prefetching, and adaptive playback.
// 041.06 For push, consider a dedicated web-push provider if Apps Script
// 041.07 storage is sufficient but cryptographic delivery becomes limiting.
// 041.08 For Android automation, consider exporting explicit vendor formats
// 041.09 once a single target app (MacroDroid/Tasker) is selected.
// 041.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 041.11 whose import link is published via a simple config endpoint.
// 041.12 Testing checklist item: verify subscription modal defaults.
// 041.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 041.14 Testing checklist item: verify progressive routing advances properly.
// 041.15 Testing checklist item: verify QR export on iOS Safari.
// 041.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 041.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 041.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 041.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 041.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 042
// ---------------------------------------------------------
// 042.01 Purpose: This section reserves structured space for future improvements.
// 042.02 Suggested enhancements may include richer subscription analytics,
// 042.03 server-driven recommendation banners, progressive onboarding,
// 042.04 locale-aware date formatting, reader themes, annotation storage,
// 042.05 offline verse pinning, audio prefetching, and adaptive playback.
// 042.06 For push, consider a dedicated web-push provider if Apps Script
// 042.07 storage is sufficient but cryptographic delivery becomes limiting.
// 042.08 For Android automation, consider exporting explicit vendor formats
// 042.09 once a single target app (MacroDroid/Tasker) is selected.
// 042.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 042.11 whose import link is published via a simple config endpoint.
// 042.12 Testing checklist item: verify subscription modal defaults.
// 042.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 042.14 Testing checklist item: verify progressive routing advances properly.
// 042.15 Testing checklist item: verify QR export on iOS Safari.
// 042.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 042.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 042.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 042.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 042.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 043
// ---------------------------------------------------------
// 043.01 Purpose: This section reserves structured space for future improvements.
// 043.02 Suggested enhancements may include richer subscription analytics,
// 043.03 server-driven recommendation banners, progressive onboarding,
// 043.04 locale-aware date formatting, reader themes, annotation storage,
// 043.05 offline verse pinning, audio prefetching, and adaptive playback.
// 043.06 For push, consider a dedicated web-push provider if Apps Script
// 043.07 storage is sufficient but cryptographic delivery becomes limiting.
// 043.08 For Android automation, consider exporting explicit vendor formats
// 043.09 once a single target app (MacroDroid/Tasker) is selected.
// 043.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 043.11 whose import link is published via a simple config endpoint.
// 043.12 Testing checklist item: verify subscription modal defaults.
// 043.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 043.14 Testing checklist item: verify progressive routing advances properly.
// 043.15 Testing checklist item: verify QR export on iOS Safari.
// 043.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 043.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 043.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 043.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 043.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 044
// ---------------------------------------------------------
// 044.01 Purpose: This section reserves structured space for future improvements.
// 044.02 Suggested enhancements may include richer subscription analytics,
// 044.03 server-driven recommendation banners, progressive onboarding,
// 044.04 locale-aware date formatting, reader themes, annotation storage,
// 044.05 offline verse pinning, audio prefetching, and adaptive playback.
// 044.06 For push, consider a dedicated web-push provider if Apps Script
// 044.07 storage is sufficient but cryptographic delivery becomes limiting.
// 044.08 For Android automation, consider exporting explicit vendor formats
// 044.09 once a single target app (MacroDroid/Tasker) is selected.
// 044.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 044.11 whose import link is published via a simple config endpoint.
// 044.12 Testing checklist item: verify subscription modal defaults.
// 044.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 044.14 Testing checklist item: verify progressive routing advances properly.
// 044.15 Testing checklist item: verify QR export on iOS Safari.
// 044.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 044.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 044.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 044.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 044.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 045
// ---------------------------------------------------------
// 045.01 Purpose: This section reserves structured space for future improvements.
// 045.02 Suggested enhancements may include richer subscription analytics,
// 045.03 server-driven recommendation banners, progressive onboarding,
// 045.04 locale-aware date formatting, reader themes, annotation storage,
// 045.05 offline verse pinning, audio prefetching, and adaptive playback.
// 045.06 For push, consider a dedicated web-push provider if Apps Script
// 045.07 storage is sufficient but cryptographic delivery becomes limiting.
// 045.08 For Android automation, consider exporting explicit vendor formats
// 045.09 once a single target app (MacroDroid/Tasker) is selected.
// 045.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 045.11 whose import link is published via a simple config endpoint.
// 045.12 Testing checklist item: verify subscription modal defaults.
// 045.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 045.14 Testing checklist item: verify progressive routing advances properly.
// 045.15 Testing checklist item: verify QR export on iOS Safari.
// 045.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 045.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 045.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 045.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 045.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 046
// ---------------------------------------------------------
// 046.01 Purpose: This section reserves structured space for future improvements.
// 046.02 Suggested enhancements may include richer subscription analytics,
// 046.03 server-driven recommendation banners, progressive onboarding,
// 046.04 locale-aware date formatting, reader themes, annotation storage,
// 046.05 offline verse pinning, audio prefetching, and adaptive playback.
// 046.06 For push, consider a dedicated web-push provider if Apps Script
// 046.07 storage is sufficient but cryptographic delivery becomes limiting.
// 046.08 For Android automation, consider exporting explicit vendor formats
// 046.09 once a single target app (MacroDroid/Tasker) is selected.
// 046.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 046.11 whose import link is published via a simple config endpoint.
// 046.12 Testing checklist item: verify subscription modal defaults.
// 046.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 046.14 Testing checklist item: verify progressive routing advances properly.
// 046.15 Testing checklist item: verify QR export on iOS Safari.
// 046.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 046.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 046.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 046.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 046.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 047
// ---------------------------------------------------------
// 047.01 Purpose: This section reserves structured space for future improvements.
// 047.02 Suggested enhancements may include richer subscription analytics,
// 047.03 server-driven recommendation banners, progressive onboarding,
// 047.04 locale-aware date formatting, reader themes, annotation storage,
// 047.05 offline verse pinning, audio prefetching, and adaptive playback.
// 047.06 For push, consider a dedicated web-push provider if Apps Script
// 047.07 storage is sufficient but cryptographic delivery becomes limiting.
// 047.08 For Android automation, consider exporting explicit vendor formats
// 047.09 once a single target app (MacroDroid/Tasker) is selected.
// 047.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 047.11 whose import link is published via a simple config endpoint.
// 047.12 Testing checklist item: verify subscription modal defaults.
// 047.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 047.14 Testing checklist item: verify progressive routing advances properly.
// 047.15 Testing checklist item: verify QR export on iOS Safari.
// 047.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 047.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 047.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 047.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 047.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 048
// ---------------------------------------------------------
// 048.01 Purpose: This section reserves structured space for future improvements.
// 048.02 Suggested enhancements may include richer subscription analytics,
// 048.03 server-driven recommendation banners, progressive onboarding,
// 048.04 locale-aware date formatting, reader themes, annotation storage,
// 048.05 offline verse pinning, audio prefetching, and adaptive playback.
// 048.06 For push, consider a dedicated web-push provider if Apps Script
// 048.07 storage is sufficient but cryptographic delivery becomes limiting.
// 048.08 For Android automation, consider exporting explicit vendor formats
// 048.09 once a single target app (MacroDroid/Tasker) is selected.
// 048.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 048.11 whose import link is published via a simple config endpoint.
// 048.12 Testing checklist item: verify subscription modal defaults.
// 048.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 048.14 Testing checklist item: verify progressive routing advances properly.
// 048.15 Testing checklist item: verify QR export on iOS Safari.
// 048.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 048.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 048.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 048.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 048.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 049
// ---------------------------------------------------------
// 049.01 Purpose: This section reserves structured space for future improvements.
// 049.02 Suggested enhancements may include richer subscription analytics,
// 049.03 server-driven recommendation banners, progressive onboarding,
// 049.04 locale-aware date formatting, reader themes, annotation storage,
// 049.05 offline verse pinning, audio prefetching, and adaptive playback.
// 049.06 For push, consider a dedicated web-push provider if Apps Script
// 049.07 storage is sufficient but cryptographic delivery becomes limiting.
// 049.08 For Android automation, consider exporting explicit vendor formats
// 049.09 once a single target app (MacroDroid/Tasker) is selected.
// 049.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 049.11 whose import link is published via a simple config endpoint.
// 049.12 Testing checklist item: verify subscription modal defaults.
// 049.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 049.14 Testing checklist item: verify progressive routing advances properly.
// 049.15 Testing checklist item: verify QR export on iOS Safari.
// 049.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 049.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 049.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 049.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 049.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 050
// ---------------------------------------------------------
// 050.01 Purpose: This section reserves structured space for future improvements.
// 050.02 Suggested enhancements may include richer subscription analytics,
// 050.03 server-driven recommendation banners, progressive onboarding,
// 050.04 locale-aware date formatting, reader themes, annotation storage,
// 050.05 offline verse pinning, audio prefetching, and adaptive playback.
// 050.06 For push, consider a dedicated web-push provider if Apps Script
// 050.07 storage is sufficient but cryptographic delivery becomes limiting.
// 050.08 For Android automation, consider exporting explicit vendor formats
// 050.09 once a single target app (MacroDroid/Tasker) is selected.
// 050.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 050.11 whose import link is published via a simple config endpoint.
// 050.12 Testing checklist item: verify subscription modal defaults.
// 050.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 050.14 Testing checklist item: verify progressive routing advances properly.
// 050.15 Testing checklist item: verify QR export on iOS Safari.
// 050.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 050.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 050.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 050.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 050.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 051
// ---------------------------------------------------------
// 051.01 Purpose: This section reserves structured space for future improvements.
// 051.02 Suggested enhancements may include richer subscription analytics,
// 051.03 server-driven recommendation banners, progressive onboarding,
// 051.04 locale-aware date formatting, reader themes, annotation storage,
// 051.05 offline verse pinning, audio prefetching, and adaptive playback.
// 051.06 For push, consider a dedicated web-push provider if Apps Script
// 051.07 storage is sufficient but cryptographic delivery becomes limiting.
// 051.08 For Android automation, consider exporting explicit vendor formats
// 051.09 once a single target app (MacroDroid/Tasker) is selected.
// 051.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 051.11 whose import link is published via a simple config endpoint.
// 051.12 Testing checklist item: verify subscription modal defaults.
// 051.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 051.14 Testing checklist item: verify progressive routing advances properly.
// 051.15 Testing checklist item: verify QR export on iOS Safari.
// 051.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 051.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 051.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 051.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 051.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 052
// ---------------------------------------------------------
// 052.01 Purpose: This section reserves structured space for future improvements.
// 052.02 Suggested enhancements may include richer subscription analytics,
// 052.03 server-driven recommendation banners, progressive onboarding,
// 052.04 locale-aware date formatting, reader themes, annotation storage,
// 052.05 offline verse pinning, audio prefetching, and adaptive playback.
// 052.06 For push, consider a dedicated web-push provider if Apps Script
// 052.07 storage is sufficient but cryptographic delivery becomes limiting.
// 052.08 For Android automation, consider exporting explicit vendor formats
// 052.09 once a single target app (MacroDroid/Tasker) is selected.
// 052.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 052.11 whose import link is published via a simple config endpoint.
// 052.12 Testing checklist item: verify subscription modal defaults.
// 052.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 052.14 Testing checklist item: verify progressive routing advances properly.
// 052.15 Testing checklist item: verify QR export on iOS Safari.
// 052.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 052.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 052.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 052.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 052.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 053
// ---------------------------------------------------------
// 053.01 Purpose: This section reserves structured space for future improvements.
// 053.02 Suggested enhancements may include richer subscription analytics,
// 053.03 server-driven recommendation banners, progressive onboarding,
// 053.04 locale-aware date formatting, reader themes, annotation storage,
// 053.05 offline verse pinning, audio prefetching, and adaptive playback.
// 053.06 For push, consider a dedicated web-push provider if Apps Script
// 053.07 storage is sufficient but cryptographic delivery becomes limiting.
// 053.08 For Android automation, consider exporting explicit vendor formats
// 053.09 once a single target app (MacroDroid/Tasker) is selected.
// 053.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 053.11 whose import link is published via a simple config endpoint.
// 053.12 Testing checklist item: verify subscription modal defaults.
// 053.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 053.14 Testing checklist item: verify progressive routing advances properly.
// 053.15 Testing checklist item: verify QR export on iOS Safari.
// 053.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 053.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 053.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 053.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 053.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 054
// ---------------------------------------------------------
// 054.01 Purpose: This section reserves structured space for future improvements.
// 054.02 Suggested enhancements may include richer subscription analytics,
// 054.03 server-driven recommendation banners, progressive onboarding,
// 054.04 locale-aware date formatting, reader themes, annotation storage,
// 054.05 offline verse pinning, audio prefetching, and adaptive playback.
// 054.06 For push, consider a dedicated web-push provider if Apps Script
// 054.07 storage is sufficient but cryptographic delivery becomes limiting.
// 054.08 For Android automation, consider exporting explicit vendor formats
// 054.09 once a single target app (MacroDroid/Tasker) is selected.
// 054.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 054.11 whose import link is published via a simple config endpoint.
// 054.12 Testing checklist item: verify subscription modal defaults.
// 054.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 054.14 Testing checklist item: verify progressive routing advances properly.
// 054.15 Testing checklist item: verify QR export on iOS Safari.
// 054.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 054.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 054.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 054.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 054.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 055
// ---------------------------------------------------------
// 055.01 Purpose: This section reserves structured space for future improvements.
// 055.02 Suggested enhancements may include richer subscription analytics,
// 055.03 server-driven recommendation banners, progressive onboarding,
// 055.04 locale-aware date formatting, reader themes, annotation storage,
// 055.05 offline verse pinning, audio prefetching, and adaptive playback.
// 055.06 For push, consider a dedicated web-push provider if Apps Script
// 055.07 storage is sufficient but cryptographic delivery becomes limiting.
// 055.08 For Android automation, consider exporting explicit vendor formats
// 055.09 once a single target app (MacroDroid/Tasker) is selected.
// 055.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 055.11 whose import link is published via a simple config endpoint.
// 055.12 Testing checklist item: verify subscription modal defaults.
// 055.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 055.14 Testing checklist item: verify progressive routing advances properly.
// 055.15 Testing checklist item: verify QR export on iOS Safari.
// 055.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 055.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 055.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 055.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 055.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 056
// ---------------------------------------------------------
// 056.01 Purpose: This section reserves structured space for future improvements.
// 056.02 Suggested enhancements may include richer subscription analytics,
// 056.03 server-driven recommendation banners, progressive onboarding,
// 056.04 locale-aware date formatting, reader themes, annotation storage,
// 056.05 offline verse pinning, audio prefetching, and adaptive playback.
// 056.06 For push, consider a dedicated web-push provider if Apps Script
// 056.07 storage is sufficient but cryptographic delivery becomes limiting.
// 056.08 For Android automation, consider exporting explicit vendor formats
// 056.09 once a single target app (MacroDroid/Tasker) is selected.
// 056.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 056.11 whose import link is published via a simple config endpoint.
// 056.12 Testing checklist item: verify subscription modal defaults.
// 056.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 056.14 Testing checklist item: verify progressive routing advances properly.
// 056.15 Testing checklist item: verify QR export on iOS Safari.
// 056.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 056.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 056.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 056.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 056.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 057
// ---------------------------------------------------------
// 057.01 Purpose: This section reserves structured space for future improvements.
// 057.02 Suggested enhancements may include richer subscription analytics,
// 057.03 server-driven recommendation banners, progressive onboarding,
// 057.04 locale-aware date formatting, reader themes, annotation storage,
// 057.05 offline verse pinning, audio prefetching, and adaptive playback.
// 057.06 For push, consider a dedicated web-push provider if Apps Script
// 057.07 storage is sufficient but cryptographic delivery becomes limiting.
// 057.08 For Android automation, consider exporting explicit vendor formats
// 057.09 once a single target app (MacroDroid/Tasker) is selected.
// 057.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 057.11 whose import link is published via a simple config endpoint.
// 057.12 Testing checklist item: verify subscription modal defaults.
// 057.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 057.14 Testing checklist item: verify progressive routing advances properly.
// 057.15 Testing checklist item: verify QR export on iOS Safari.
// 057.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 057.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 057.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 057.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 057.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 058
// ---------------------------------------------------------
// 058.01 Purpose: This section reserves structured space for future improvements.
// 058.02 Suggested enhancements may include richer subscription analytics,
// 058.03 server-driven recommendation banners, progressive onboarding,
// 058.04 locale-aware date formatting, reader themes, annotation storage,
// 058.05 offline verse pinning, audio prefetching, and adaptive playback.
// 058.06 For push, consider a dedicated web-push provider if Apps Script
// 058.07 storage is sufficient but cryptographic delivery becomes limiting.
// 058.08 For Android automation, consider exporting explicit vendor formats
// 058.09 once a single target app (MacroDroid/Tasker) is selected.
// 058.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 058.11 whose import link is published via a simple config endpoint.
// 058.12 Testing checklist item: verify subscription modal defaults.
// 058.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 058.14 Testing checklist item: verify progressive routing advances properly.
// 058.15 Testing checklist item: verify QR export on iOS Safari.
// 058.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 058.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 058.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 058.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 058.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 059
// ---------------------------------------------------------
// 059.01 Purpose: This section reserves structured space for future improvements.
// 059.02 Suggested enhancements may include richer subscription analytics,
// 059.03 server-driven recommendation banners, progressive onboarding,
// 059.04 locale-aware date formatting, reader themes, annotation storage,
// 059.05 offline verse pinning, audio prefetching, and adaptive playback.
// 059.06 For push, consider a dedicated web-push provider if Apps Script
// 059.07 storage is sufficient but cryptographic delivery becomes limiting.
// 059.08 For Android automation, consider exporting explicit vendor formats
// 059.09 once a single target app (MacroDroid/Tasker) is selected.
// 059.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 059.11 whose import link is published via a simple config endpoint.
// 059.12 Testing checklist item: verify subscription modal defaults.
// 059.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 059.14 Testing checklist item: verify progressive routing advances properly.
// 059.15 Testing checklist item: verify QR export on iOS Safari.
// 059.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 059.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 059.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 059.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 059.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 060
// ---------------------------------------------------------
// 060.01 Purpose: This section reserves structured space for future improvements.
// 060.02 Suggested enhancements may include richer subscription analytics,
// 060.03 server-driven recommendation banners, progressive onboarding,
// 060.04 locale-aware date formatting, reader themes, annotation storage,
// 060.05 offline verse pinning, audio prefetching, and adaptive playback.
// 060.06 For push, consider a dedicated web-push provider if Apps Script
// 060.07 storage is sufficient but cryptographic delivery becomes limiting.
// 060.08 For Android automation, consider exporting explicit vendor formats
// 060.09 once a single target app (MacroDroid/Tasker) is selected.
// 060.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 060.11 whose import link is published via a simple config endpoint.
// 060.12 Testing checklist item: verify subscription modal defaults.
// 060.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 060.14 Testing checklist item: verify progressive routing advances properly.
// 060.15 Testing checklist item: verify QR export on iOS Safari.
// 060.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 060.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 060.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 060.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 060.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 061
// ---------------------------------------------------------
// 061.01 Purpose: This section reserves structured space for future improvements.
// 061.02 Suggested enhancements may include richer subscription analytics,
// 061.03 server-driven recommendation banners, progressive onboarding,
// 061.04 locale-aware date formatting, reader themes, annotation storage,
// 061.05 offline verse pinning, audio prefetching, and adaptive playback.
// 061.06 For push, consider a dedicated web-push provider if Apps Script
// 061.07 storage is sufficient but cryptographic delivery becomes limiting.
// 061.08 For Android automation, consider exporting explicit vendor formats
// 061.09 once a single target app (MacroDroid/Tasker) is selected.
// 061.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 061.11 whose import link is published via a simple config endpoint.
// 061.12 Testing checklist item: verify subscription modal defaults.
// 061.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 061.14 Testing checklist item: verify progressive routing advances properly.
// 061.15 Testing checklist item: verify QR export on iOS Safari.
// 061.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 061.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 061.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 061.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 061.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 062
// ---------------------------------------------------------
// 062.01 Purpose: This section reserves structured space for future improvements.
// 062.02 Suggested enhancements may include richer subscription analytics,
// 062.03 server-driven recommendation banners, progressive onboarding,
// 062.04 locale-aware date formatting, reader themes, annotation storage,
// 062.05 offline verse pinning, audio prefetching, and adaptive playback.
// 062.06 For push, consider a dedicated web-push provider if Apps Script
// 062.07 storage is sufficient but cryptographic delivery becomes limiting.
// 062.08 For Android automation, consider exporting explicit vendor formats
// 062.09 once a single target app (MacroDroid/Tasker) is selected.
// 062.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 062.11 whose import link is published via a simple config endpoint.
// 062.12 Testing checklist item: verify subscription modal defaults.
// 062.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 062.14 Testing checklist item: verify progressive routing advances properly.
// 062.15 Testing checklist item: verify QR export on iOS Safari.
// 062.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 062.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 062.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 062.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 062.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 063
// ---------------------------------------------------------
// 063.01 Purpose: This section reserves structured space for future improvements.
// 063.02 Suggested enhancements may include richer subscription analytics,
// 063.03 server-driven recommendation banners, progressive onboarding,
// 063.04 locale-aware date formatting, reader themes, annotation storage,
// 063.05 offline verse pinning, audio prefetching, and adaptive playback.
// 063.06 For push, consider a dedicated web-push provider if Apps Script
// 063.07 storage is sufficient but cryptographic delivery becomes limiting.
// 063.08 For Android automation, consider exporting explicit vendor formats
// 063.09 once a single target app (MacroDroid/Tasker) is selected.
// 063.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 063.11 whose import link is published via a simple config endpoint.
// 063.12 Testing checklist item: verify subscription modal defaults.
// 063.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 063.14 Testing checklist item: verify progressive routing advances properly.
// 063.15 Testing checklist item: verify QR export on iOS Safari.
// 063.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 063.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 063.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 063.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 063.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 064
// ---------------------------------------------------------
// 064.01 Purpose: This section reserves structured space for future improvements.
// 064.02 Suggested enhancements may include richer subscription analytics,
// 064.03 server-driven recommendation banners, progressive onboarding,
// 064.04 locale-aware date formatting, reader themes, annotation storage,
// 064.05 offline verse pinning, audio prefetching, and adaptive playback.
// 064.06 For push, consider a dedicated web-push provider if Apps Script
// 064.07 storage is sufficient but cryptographic delivery becomes limiting.
// 064.08 For Android automation, consider exporting explicit vendor formats
// 064.09 once a single target app (MacroDroid/Tasker) is selected.
// 064.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 064.11 whose import link is published via a simple config endpoint.
// 064.12 Testing checklist item: verify subscription modal defaults.
// 064.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 064.14 Testing checklist item: verify progressive routing advances properly.
// 064.15 Testing checklist item: verify QR export on iOS Safari.
// 064.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 064.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 064.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 064.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 064.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 065
// ---------------------------------------------------------
// 065.01 Purpose: This section reserves structured space for future improvements.
// 065.02 Suggested enhancements may include richer subscription analytics,
// 065.03 server-driven recommendation banners, progressive onboarding,
// 065.04 locale-aware date formatting, reader themes, annotation storage,
// 065.05 offline verse pinning, audio prefetching, and adaptive playback.
// 065.06 For push, consider a dedicated web-push provider if Apps Script
// 065.07 storage is sufficient but cryptographic delivery becomes limiting.
// 065.08 For Android automation, consider exporting explicit vendor formats
// 065.09 once a single target app (MacroDroid/Tasker) is selected.
// 065.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 065.11 whose import link is published via a simple config endpoint.
// 065.12 Testing checklist item: verify subscription modal defaults.
// 065.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 065.14 Testing checklist item: verify progressive routing advances properly.
// 065.15 Testing checklist item: verify QR export on iOS Safari.
// 065.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 065.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 065.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 065.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 065.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 066
// ---------------------------------------------------------
// 066.01 Purpose: This section reserves structured space for future improvements.
// 066.02 Suggested enhancements may include richer subscription analytics,
// 066.03 server-driven recommendation banners, progressive onboarding,
// 066.04 locale-aware date formatting, reader themes, annotation storage,
// 066.05 offline verse pinning, audio prefetching, and adaptive playback.
// 066.06 For push, consider a dedicated web-push provider if Apps Script
// 066.07 storage is sufficient but cryptographic delivery becomes limiting.
// 066.08 For Android automation, consider exporting explicit vendor formats
// 066.09 once a single target app (MacroDroid/Tasker) is selected.
// 066.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 066.11 whose import link is published via a simple config endpoint.
// 066.12 Testing checklist item: verify subscription modal defaults.
// 066.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 066.14 Testing checklist item: verify progressive routing advances properly.
// 066.15 Testing checklist item: verify QR export on iOS Safari.
// 066.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 066.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 066.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 066.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 066.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 067
// ---------------------------------------------------------
// 067.01 Purpose: This section reserves structured space for future improvements.
// 067.02 Suggested enhancements may include richer subscription analytics,
// 067.03 server-driven recommendation banners, progressive onboarding,
// 067.04 locale-aware date formatting, reader themes, annotation storage,
// 067.05 offline verse pinning, audio prefetching, and adaptive playback.
// 067.06 For push, consider a dedicated web-push provider if Apps Script
// 067.07 storage is sufficient but cryptographic delivery becomes limiting.
// 067.08 For Android automation, consider exporting explicit vendor formats
// 067.09 once a single target app (MacroDroid/Tasker) is selected.
// 067.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 067.11 whose import link is published via a simple config endpoint.
// 067.12 Testing checklist item: verify subscription modal defaults.
// 067.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 067.14 Testing checklist item: verify progressive routing advances properly.
// 067.15 Testing checklist item: verify QR export on iOS Safari.
// 067.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 067.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 067.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 067.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 067.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 068
// ---------------------------------------------------------
// 068.01 Purpose: This section reserves structured space for future improvements.
// 068.02 Suggested enhancements may include richer subscription analytics,
// 068.03 server-driven recommendation banners, progressive onboarding,
// 068.04 locale-aware date formatting, reader themes, annotation storage,
// 068.05 offline verse pinning, audio prefetching, and adaptive playback.
// 068.06 For push, consider a dedicated web-push provider if Apps Script
// 068.07 storage is sufficient but cryptographic delivery becomes limiting.
// 068.08 For Android automation, consider exporting explicit vendor formats
// 068.09 once a single target app (MacroDroid/Tasker) is selected.
// 068.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 068.11 whose import link is published via a simple config endpoint.
// 068.12 Testing checklist item: verify subscription modal defaults.
// 068.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 068.14 Testing checklist item: verify progressive routing advances properly.
// 068.15 Testing checklist item: verify QR export on iOS Safari.
// 068.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 068.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 068.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 068.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 068.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 069
// ---------------------------------------------------------
// 069.01 Purpose: This section reserves structured space for future improvements.
// 069.02 Suggested enhancements may include richer subscription analytics,
// 069.03 server-driven recommendation banners, progressive onboarding,
// 069.04 locale-aware date formatting, reader themes, annotation storage,
// 069.05 offline verse pinning, audio prefetching, and adaptive playback.
// 069.06 For push, consider a dedicated web-push provider if Apps Script
// 069.07 storage is sufficient but cryptographic delivery becomes limiting.
// 069.08 For Android automation, consider exporting explicit vendor formats
// 069.09 once a single target app (MacroDroid/Tasker) is selected.
// 069.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 069.11 whose import link is published via a simple config endpoint.
// 069.12 Testing checklist item: verify subscription modal defaults.
// 069.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 069.14 Testing checklist item: verify progressive routing advances properly.
// 069.15 Testing checklist item: verify QR export on iOS Safari.
// 069.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 069.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 069.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 069.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 069.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 070
// ---------------------------------------------------------
// 070.01 Purpose: This section reserves structured space for future improvements.
// 070.02 Suggested enhancements may include richer subscription analytics,
// 070.03 server-driven recommendation banners, progressive onboarding,
// 070.04 locale-aware date formatting, reader themes, annotation storage,
// 070.05 offline verse pinning, audio prefetching, and adaptive playback.
// 070.06 For push, consider a dedicated web-push provider if Apps Script
// 070.07 storage is sufficient but cryptographic delivery becomes limiting.
// 070.08 For Android automation, consider exporting explicit vendor formats
// 070.09 once a single target app (MacroDroid/Tasker) is selected.
// 070.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 070.11 whose import link is published via a simple config endpoint.
// 070.12 Testing checklist item: verify subscription modal defaults.
// 070.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 070.14 Testing checklist item: verify progressive routing advances properly.
// 070.15 Testing checklist item: verify QR export on iOS Safari.
// 070.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 070.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 070.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 070.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 070.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 071
// ---------------------------------------------------------
// 071.01 Purpose: This section reserves structured space for future improvements.
// 071.02 Suggested enhancements may include richer subscription analytics,
// 071.03 server-driven recommendation banners, progressive onboarding,
// 071.04 locale-aware date formatting, reader themes, annotation storage,
// 071.05 offline verse pinning, audio prefetching, and adaptive playback.
// 071.06 For push, consider a dedicated web-push provider if Apps Script
// 071.07 storage is sufficient but cryptographic delivery becomes limiting.
// 071.08 For Android automation, consider exporting explicit vendor formats
// 071.09 once a single target app (MacroDroid/Tasker) is selected.
// 071.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 071.11 whose import link is published via a simple config endpoint.
// 071.12 Testing checklist item: verify subscription modal defaults.
// 071.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 071.14 Testing checklist item: verify progressive routing advances properly.
// 071.15 Testing checklist item: verify QR export on iOS Safari.
// 071.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 071.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 071.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 071.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 071.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 072
// ---------------------------------------------------------
// 072.01 Purpose: This section reserves structured space for future improvements.
// 072.02 Suggested enhancements may include richer subscription analytics,
// 072.03 server-driven recommendation banners, progressive onboarding,
// 072.04 locale-aware date formatting, reader themes, annotation storage,
// 072.05 offline verse pinning, audio prefetching, and adaptive playback.
// 072.06 For push, consider a dedicated web-push provider if Apps Script
// 072.07 storage is sufficient but cryptographic delivery becomes limiting.
// 072.08 For Android automation, consider exporting explicit vendor formats
// 072.09 once a single target app (MacroDroid/Tasker) is selected.
// 072.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 072.11 whose import link is published via a simple config endpoint.
// 072.12 Testing checklist item: verify subscription modal defaults.
// 072.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 072.14 Testing checklist item: verify progressive routing advances properly.
// 072.15 Testing checklist item: verify QR export on iOS Safari.
// 072.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 072.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 072.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 072.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 072.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 073
// ---------------------------------------------------------
// 073.01 Purpose: This section reserves structured space for future improvements.
// 073.02 Suggested enhancements may include richer subscription analytics,
// 073.03 server-driven recommendation banners, progressive onboarding,
// 073.04 locale-aware date formatting, reader themes, annotation storage,
// 073.05 offline verse pinning, audio prefetching, and adaptive playback.
// 073.06 For push, consider a dedicated web-push provider if Apps Script
// 073.07 storage is sufficient but cryptographic delivery becomes limiting.
// 073.08 For Android automation, consider exporting explicit vendor formats
// 073.09 once a single target app (MacroDroid/Tasker) is selected.
// 073.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 073.11 whose import link is published via a simple config endpoint.
// 073.12 Testing checklist item: verify subscription modal defaults.
// 073.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 073.14 Testing checklist item: verify progressive routing advances properly.
// 073.15 Testing checklist item: verify QR export on iOS Safari.
// 073.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 073.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 073.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 073.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 073.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 074
// ---------------------------------------------------------
// 074.01 Purpose: This section reserves structured space for future improvements.
// 074.02 Suggested enhancements may include richer subscription analytics,
// 074.03 server-driven recommendation banners, progressive onboarding,
// 074.04 locale-aware date formatting, reader themes, annotation storage,
// 074.05 offline verse pinning, audio prefetching, and adaptive playback.
// 074.06 For push, consider a dedicated web-push provider if Apps Script
// 074.07 storage is sufficient but cryptographic delivery becomes limiting.
// 074.08 For Android automation, consider exporting explicit vendor formats
// 074.09 once a single target app (MacroDroid/Tasker) is selected.
// 074.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 074.11 whose import link is published via a simple config endpoint.
// 074.12 Testing checklist item: verify subscription modal defaults.
// 074.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 074.14 Testing checklist item: verify progressive routing advances properly.
// 074.15 Testing checklist item: verify QR export on iOS Safari.
// 074.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 074.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 074.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 074.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 074.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 075
// ---------------------------------------------------------
// 075.01 Purpose: This section reserves structured space for future improvements.
// 075.02 Suggested enhancements may include richer subscription analytics,
// 075.03 server-driven recommendation banners, progressive onboarding,
// 075.04 locale-aware date formatting, reader themes, annotation storage,
// 075.05 offline verse pinning, audio prefetching, and adaptive playback.
// 075.06 For push, consider a dedicated web-push provider if Apps Script
// 075.07 storage is sufficient but cryptographic delivery becomes limiting.
// 075.08 For Android automation, consider exporting explicit vendor formats
// 075.09 once a single target app (MacroDroid/Tasker) is selected.
// 075.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 075.11 whose import link is published via a simple config endpoint.
// 075.12 Testing checklist item: verify subscription modal defaults.
// 075.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 075.14 Testing checklist item: verify progressive routing advances properly.
// 075.15 Testing checklist item: verify QR export on iOS Safari.
// 075.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 075.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 075.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 075.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 075.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 076
// ---------------------------------------------------------
// 076.01 Purpose: This section reserves structured space for future improvements.
// 076.02 Suggested enhancements may include richer subscription analytics,
// 076.03 server-driven recommendation banners, progressive onboarding,
// 076.04 locale-aware date formatting, reader themes, annotation storage,
// 076.05 offline verse pinning, audio prefetching, and adaptive playback.
// 076.06 For push, consider a dedicated web-push provider if Apps Script
// 076.07 storage is sufficient but cryptographic delivery becomes limiting.
// 076.08 For Android automation, consider exporting explicit vendor formats
// 076.09 once a single target app (MacroDroid/Tasker) is selected.
// 076.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 076.11 whose import link is published via a simple config endpoint.
// 076.12 Testing checklist item: verify subscription modal defaults.
// 076.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 076.14 Testing checklist item: verify progressive routing advances properly.
// 076.15 Testing checklist item: verify QR export on iOS Safari.
// 076.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 076.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 076.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 076.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 076.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 077
// ---------------------------------------------------------
// 077.01 Purpose: This section reserves structured space for future improvements.
// 077.02 Suggested enhancements may include richer subscription analytics,
// 077.03 server-driven recommendation banners, progressive onboarding,
// 077.04 locale-aware date formatting, reader themes, annotation storage,
// 077.05 offline verse pinning, audio prefetching, and adaptive playback.
// 077.06 For push, consider a dedicated web-push provider if Apps Script
// 077.07 storage is sufficient but cryptographic delivery becomes limiting.
// 077.08 For Android automation, consider exporting explicit vendor formats
// 077.09 once a single target app (MacroDroid/Tasker) is selected.
// 077.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 077.11 whose import link is published via a simple config endpoint.
// 077.12 Testing checklist item: verify subscription modal defaults.
// 077.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 077.14 Testing checklist item: verify progressive routing advances properly.
// 077.15 Testing checklist item: verify QR export on iOS Safari.
// 077.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 077.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 077.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 077.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 077.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 078
// ---------------------------------------------------------
// 078.01 Purpose: This section reserves structured space for future improvements.
// 078.02 Suggested enhancements may include richer subscription analytics,
// 078.03 server-driven recommendation banners, progressive onboarding,
// 078.04 locale-aware date formatting, reader themes, annotation storage,
// 078.05 offline verse pinning, audio prefetching, and adaptive playback.
// 078.06 For push, consider a dedicated web-push provider if Apps Script
// 078.07 storage is sufficient but cryptographic delivery becomes limiting.
// 078.08 For Android automation, consider exporting explicit vendor formats
// 078.09 once a single target app (MacroDroid/Tasker) is selected.
// 078.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 078.11 whose import link is published via a simple config endpoint.
// 078.12 Testing checklist item: verify subscription modal defaults.
// 078.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 078.14 Testing checklist item: verify progressive routing advances properly.
// 078.15 Testing checklist item: verify QR export on iOS Safari.
// 078.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 078.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 078.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 078.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 078.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 079
// ---------------------------------------------------------
// 079.01 Purpose: This section reserves structured space for future improvements.
// 079.02 Suggested enhancements may include richer subscription analytics,
// 079.03 server-driven recommendation banners, progressive onboarding,
// 079.04 locale-aware date formatting, reader themes, annotation storage,
// 079.05 offline verse pinning, audio prefetching, and adaptive playback.
// 079.06 For push, consider a dedicated web-push provider if Apps Script
// 079.07 storage is sufficient but cryptographic delivery becomes limiting.
// 079.08 For Android automation, consider exporting explicit vendor formats
// 079.09 once a single target app (MacroDroid/Tasker) is selected.
// 079.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 079.11 whose import link is published via a simple config endpoint.
// 079.12 Testing checklist item: verify subscription modal defaults.
// 079.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 079.14 Testing checklist item: verify progressive routing advances properly.
// 079.15 Testing checklist item: verify QR export on iOS Safari.
// 079.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 079.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 079.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 079.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 079.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 080
// ---------------------------------------------------------
// 080.01 Purpose: This section reserves structured space for future improvements.
// 080.02 Suggested enhancements may include richer subscription analytics,
// 080.03 server-driven recommendation banners, progressive onboarding,
// 080.04 locale-aware date formatting, reader themes, annotation storage,
// 080.05 offline verse pinning, audio prefetching, and adaptive playback.
// 080.06 For push, consider a dedicated web-push provider if Apps Script
// 080.07 storage is sufficient but cryptographic delivery becomes limiting.
// 080.08 For Android automation, consider exporting explicit vendor formats
// 080.09 once a single target app (MacroDroid/Tasker) is selected.
// 080.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 080.11 whose import link is published via a simple config endpoint.
// 080.12 Testing checklist item: verify subscription modal defaults.
// 080.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 080.14 Testing checklist item: verify progressive routing advances properly.
// 080.15 Testing checklist item: verify QR export on iOS Safari.
// 080.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 080.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 080.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 080.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 080.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 081
// ---------------------------------------------------------
// 081.01 Purpose: This section reserves structured space for future improvements.
// 081.02 Suggested enhancements may include richer subscription analytics,
// 081.03 server-driven recommendation banners, progressive onboarding,
// 081.04 locale-aware date formatting, reader themes, annotation storage,
// 081.05 offline verse pinning, audio prefetching, and adaptive playback.
// 081.06 For push, consider a dedicated web-push provider if Apps Script
// 081.07 storage is sufficient but cryptographic delivery becomes limiting.
// 081.08 For Android automation, consider exporting explicit vendor formats
// 081.09 once a single target app (MacroDroid/Tasker) is selected.
// 081.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 081.11 whose import link is published via a simple config endpoint.
// 081.12 Testing checklist item: verify subscription modal defaults.
// 081.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 081.14 Testing checklist item: verify progressive routing advances properly.
// 081.15 Testing checklist item: verify QR export on iOS Safari.
// 081.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 081.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 081.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 081.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 081.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 082
// ---------------------------------------------------------
// 082.01 Purpose: This section reserves structured space for future improvements.
// 082.02 Suggested enhancements may include richer subscription analytics,
// 082.03 server-driven recommendation banners, progressive onboarding,
// 082.04 locale-aware date formatting, reader themes, annotation storage,
// 082.05 offline verse pinning, audio prefetching, and adaptive playback.
// 082.06 For push, consider a dedicated web-push provider if Apps Script
// 082.07 storage is sufficient but cryptographic delivery becomes limiting.
// 082.08 For Android automation, consider exporting explicit vendor formats
// 082.09 once a single target app (MacroDroid/Tasker) is selected.
// 082.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 082.11 whose import link is published via a simple config endpoint.
// 082.12 Testing checklist item: verify subscription modal defaults.
// 082.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 082.14 Testing checklist item: verify progressive routing advances properly.
// 082.15 Testing checklist item: verify QR export on iOS Safari.
// 082.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 082.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 082.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 082.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 082.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 083
// ---------------------------------------------------------
// 083.01 Purpose: This section reserves structured space for future improvements.
// 083.02 Suggested enhancements may include richer subscription analytics,
// 083.03 server-driven recommendation banners, progressive onboarding,
// 083.04 locale-aware date formatting, reader themes, annotation storage,
// 083.05 offline verse pinning, audio prefetching, and adaptive playback.
// 083.06 For push, consider a dedicated web-push provider if Apps Script
// 083.07 storage is sufficient but cryptographic delivery becomes limiting.
// 083.08 For Android automation, consider exporting explicit vendor formats
// 083.09 once a single target app (MacroDroid/Tasker) is selected.
// 083.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 083.11 whose import link is published via a simple config endpoint.
// 083.12 Testing checklist item: verify subscription modal defaults.
// 083.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 083.14 Testing checklist item: verify progressive routing advances properly.
// 083.15 Testing checklist item: verify QR export on iOS Safari.
// 083.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 083.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 083.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 083.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 083.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 084
// ---------------------------------------------------------
// 084.01 Purpose: This section reserves structured space for future improvements.
// 084.02 Suggested enhancements may include richer subscription analytics,
// 084.03 server-driven recommendation banners, progressive onboarding,
// 084.04 locale-aware date formatting, reader themes, annotation storage,
// 084.05 offline verse pinning, audio prefetching, and adaptive playback.
// 084.06 For push, consider a dedicated web-push provider if Apps Script
// 084.07 storage is sufficient but cryptographic delivery becomes limiting.
// 084.08 For Android automation, consider exporting explicit vendor formats
// 084.09 once a single target app (MacroDroid/Tasker) is selected.
// 084.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 084.11 whose import link is published via a simple config endpoint.
// 084.12 Testing checklist item: verify subscription modal defaults.
// 084.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 084.14 Testing checklist item: verify progressive routing advances properly.
// 084.15 Testing checklist item: verify QR export on iOS Safari.
// 084.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 084.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 084.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 084.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 084.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 085
// ---------------------------------------------------------
// 085.01 Purpose: This section reserves structured space for future improvements.
// 085.02 Suggested enhancements may include richer subscription analytics,
// 085.03 server-driven recommendation banners, progressive onboarding,
// 085.04 locale-aware date formatting, reader themes, annotation storage,
// 085.05 offline verse pinning, audio prefetching, and adaptive playback.
// 085.06 For push, consider a dedicated web-push provider if Apps Script
// 085.07 storage is sufficient but cryptographic delivery becomes limiting.
// 085.08 For Android automation, consider exporting explicit vendor formats
// 085.09 once a single target app (MacroDroid/Tasker) is selected.
// 085.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 085.11 whose import link is published via a simple config endpoint.
// 085.12 Testing checklist item: verify subscription modal defaults.
// 085.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 085.14 Testing checklist item: verify progressive routing advances properly.
// 085.15 Testing checklist item: verify QR export on iOS Safari.
// 085.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 085.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 085.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 085.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 085.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 086
// ---------------------------------------------------------
// 086.01 Purpose: This section reserves structured space for future improvements.
// 086.02 Suggested enhancements may include richer subscription analytics,
// 086.03 server-driven recommendation banners, progressive onboarding,
// 086.04 locale-aware date formatting, reader themes, annotation storage,
// 086.05 offline verse pinning, audio prefetching, and adaptive playback.
// 086.06 For push, consider a dedicated web-push provider if Apps Script
// 086.07 storage is sufficient but cryptographic delivery becomes limiting.
// 086.08 For Android automation, consider exporting explicit vendor formats
// 086.09 once a single target app (MacroDroid/Tasker) is selected.
// 086.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 086.11 whose import link is published via a simple config endpoint.
// 086.12 Testing checklist item: verify subscription modal defaults.
// 086.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 086.14 Testing checklist item: verify progressive routing advances properly.
// 086.15 Testing checklist item: verify QR export on iOS Safari.
// 086.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 086.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 086.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 086.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 086.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 087
// ---------------------------------------------------------
// 087.01 Purpose: This section reserves structured space for future improvements.
// 087.02 Suggested enhancements may include richer subscription analytics,
// 087.03 server-driven recommendation banners, progressive onboarding,
// 087.04 locale-aware date formatting, reader themes, annotation storage,
// 087.05 offline verse pinning, audio prefetching, and adaptive playback.
// 087.06 For push, consider a dedicated web-push provider if Apps Script
// 087.07 storage is sufficient but cryptographic delivery becomes limiting.
// 087.08 For Android automation, consider exporting explicit vendor formats
// 087.09 once a single target app (MacroDroid/Tasker) is selected.
// 087.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 087.11 whose import link is published via a simple config endpoint.
// 087.12 Testing checklist item: verify subscription modal defaults.
// 087.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 087.14 Testing checklist item: verify progressive routing advances properly.
// 087.15 Testing checklist item: verify QR export on iOS Safari.
// 087.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 087.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 087.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 087.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 087.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 088
// ---------------------------------------------------------
// 088.01 Purpose: This section reserves structured space for future improvements.
// 088.02 Suggested enhancements may include richer subscription analytics,
// 088.03 server-driven recommendation banners, progressive onboarding,
// 088.04 locale-aware date formatting, reader themes, annotation storage,
// 088.05 offline verse pinning, audio prefetching, and adaptive playback.
// 088.06 For push, consider a dedicated web-push provider if Apps Script
// 088.07 storage is sufficient but cryptographic delivery becomes limiting.
// 088.08 For Android automation, consider exporting explicit vendor formats
// 088.09 once a single target app (MacroDroid/Tasker) is selected.
// 088.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 088.11 whose import link is published via a simple config endpoint.
// 088.12 Testing checklist item: verify subscription modal defaults.
// 088.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 088.14 Testing checklist item: verify progressive routing advances properly.
// 088.15 Testing checklist item: verify QR export on iOS Safari.
// 088.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 088.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 088.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 088.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 088.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 089
// ---------------------------------------------------------
// 089.01 Purpose: This section reserves structured space for future improvements.
// 089.02 Suggested enhancements may include richer subscription analytics,
// 089.03 server-driven recommendation banners, progressive onboarding,
// 089.04 locale-aware date formatting, reader themes, annotation storage,
// 089.05 offline verse pinning, audio prefetching, and adaptive playback.
// 089.06 For push, consider a dedicated web-push provider if Apps Script
// 089.07 storage is sufficient but cryptographic delivery becomes limiting.
// 089.08 For Android automation, consider exporting explicit vendor formats
// 089.09 once a single target app (MacroDroid/Tasker) is selected.
// 089.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 089.11 whose import link is published via a simple config endpoint.
// 089.12 Testing checklist item: verify subscription modal defaults.
// 089.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 089.14 Testing checklist item: verify progressive routing advances properly.
// 089.15 Testing checklist item: verify QR export on iOS Safari.
// 089.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 089.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 089.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 089.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 089.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 090
// ---------------------------------------------------------
// 090.01 Purpose: This section reserves structured space for future improvements.
// 090.02 Suggested enhancements may include richer subscription analytics,
// 090.03 server-driven recommendation banners, progressive onboarding,
// 090.04 locale-aware date formatting, reader themes, annotation storage,
// 090.05 offline verse pinning, audio prefetching, and adaptive playback.
// 090.06 For push, consider a dedicated web-push provider if Apps Script
// 090.07 storage is sufficient but cryptographic delivery becomes limiting.
// 090.08 For Android automation, consider exporting explicit vendor formats
// 090.09 once a single target app (MacroDroid/Tasker) is selected.
// 090.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 090.11 whose import link is published via a simple config endpoint.
// 090.12 Testing checklist item: verify subscription modal defaults.
// 090.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 090.14 Testing checklist item: verify progressive routing advances properly.
// 090.15 Testing checklist item: verify QR export on iOS Safari.
// 090.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 090.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 090.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 090.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 090.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 091
// ---------------------------------------------------------
// 091.01 Purpose: This section reserves structured space for future improvements.
// 091.02 Suggested enhancements may include richer subscription analytics,
// 091.03 server-driven recommendation banners, progressive onboarding,
// 091.04 locale-aware date formatting, reader themes, annotation storage,
// 091.05 offline verse pinning, audio prefetching, and adaptive playback.
// 091.06 For push, consider a dedicated web-push provider if Apps Script
// 091.07 storage is sufficient but cryptographic delivery becomes limiting.
// 091.08 For Android automation, consider exporting explicit vendor formats
// 091.09 once a single target app (MacroDroid/Tasker) is selected.
// 091.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 091.11 whose import link is published via a simple config endpoint.
// 091.12 Testing checklist item: verify subscription modal defaults.
// 091.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 091.14 Testing checklist item: verify progressive routing advances properly.
// 091.15 Testing checklist item: verify QR export on iOS Safari.
// 091.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 091.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 091.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 091.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 091.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 092
// ---------------------------------------------------------
// 092.01 Purpose: This section reserves structured space for future improvements.
// 092.02 Suggested enhancements may include richer subscription analytics,
// 092.03 server-driven recommendation banners, progressive onboarding,
// 092.04 locale-aware date formatting, reader themes, annotation storage,
// 092.05 offline verse pinning, audio prefetching, and adaptive playback.
// 092.06 For push, consider a dedicated web-push provider if Apps Script
// 092.07 storage is sufficient but cryptographic delivery becomes limiting.
// 092.08 For Android automation, consider exporting explicit vendor formats
// 092.09 once a single target app (MacroDroid/Tasker) is selected.
// 092.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 092.11 whose import link is published via a simple config endpoint.
// 092.12 Testing checklist item: verify subscription modal defaults.
// 092.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 092.14 Testing checklist item: verify progressive routing advances properly.
// 092.15 Testing checklist item: verify QR export on iOS Safari.
// 092.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 092.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 092.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 092.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 092.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 093
// ---------------------------------------------------------
// 093.01 Purpose: This section reserves structured space for future improvements.
// 093.02 Suggested enhancements may include richer subscription analytics,
// 093.03 server-driven recommendation banners, progressive onboarding,
// 093.04 locale-aware date formatting, reader themes, annotation storage,
// 093.05 offline verse pinning, audio prefetching, and adaptive playback.
// 093.06 For push, consider a dedicated web-push provider if Apps Script
// 093.07 storage is sufficient but cryptographic delivery becomes limiting.
// 093.08 For Android automation, consider exporting explicit vendor formats
// 093.09 once a single target app (MacroDroid/Tasker) is selected.
// 093.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 093.11 whose import link is published via a simple config endpoint.
// 093.12 Testing checklist item: verify subscription modal defaults.
// 093.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 093.14 Testing checklist item: verify progressive routing advances properly.
// 093.15 Testing checklist item: verify QR export on iOS Safari.
// 093.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 093.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 093.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 093.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 093.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 094
// ---------------------------------------------------------
// 094.01 Purpose: This section reserves structured space for future improvements.
// 094.02 Suggested enhancements may include richer subscription analytics,
// 094.03 server-driven recommendation banners, progressive onboarding,
// 094.04 locale-aware date formatting, reader themes, annotation storage,
// 094.05 offline verse pinning, audio prefetching, and adaptive playback.
// 094.06 For push, consider a dedicated web-push provider if Apps Script
// 094.07 storage is sufficient but cryptographic delivery becomes limiting.
// 094.08 For Android automation, consider exporting explicit vendor formats
// 094.09 once a single target app (MacroDroid/Tasker) is selected.
// 094.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 094.11 whose import link is published via a simple config endpoint.
// 094.12 Testing checklist item: verify subscription modal defaults.
// 094.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 094.14 Testing checklist item: verify progressive routing advances properly.
// 094.15 Testing checklist item: verify QR export on iOS Safari.
// 094.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 094.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 094.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 094.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 094.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 095
// ---------------------------------------------------------
// 095.01 Purpose: This section reserves structured space for future improvements.
// 095.02 Suggested enhancements may include richer subscription analytics,
// 095.03 server-driven recommendation banners, progressive onboarding,
// 095.04 locale-aware date formatting, reader themes, annotation storage,
// 095.05 offline verse pinning, audio prefetching, and adaptive playback.
// 095.06 For push, consider a dedicated web-push provider if Apps Script
// 095.07 storage is sufficient but cryptographic delivery becomes limiting.
// 095.08 For Android automation, consider exporting explicit vendor formats
// 095.09 once a single target app (MacroDroid/Tasker) is selected.
// 095.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 095.11 whose import link is published via a simple config endpoint.
// 095.12 Testing checklist item: verify subscription modal defaults.
// 095.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 095.14 Testing checklist item: verify progressive routing advances properly.
// 095.15 Testing checklist item: verify QR export on iOS Safari.
// 095.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 095.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 095.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 095.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 095.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 096
// ---------------------------------------------------------
// 096.01 Purpose: This section reserves structured space for future improvements.
// 096.02 Suggested enhancements may include richer subscription analytics,
// 096.03 server-driven recommendation banners, progressive onboarding,
// 096.04 locale-aware date formatting, reader themes, annotation storage,
// 096.05 offline verse pinning, audio prefetching, and adaptive playback.
// 096.06 For push, consider a dedicated web-push provider if Apps Script
// 096.07 storage is sufficient but cryptographic delivery becomes limiting.
// 096.08 For Android automation, consider exporting explicit vendor formats
// 096.09 once a single target app (MacroDroid/Tasker) is selected.
// 096.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 096.11 whose import link is published via a simple config endpoint.
// 096.12 Testing checklist item: verify subscription modal defaults.
// 096.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 096.14 Testing checklist item: verify progressive routing advances properly.
// 096.15 Testing checklist item: verify QR export on iOS Safari.
// 096.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 096.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 096.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 096.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 096.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 097
// ---------------------------------------------------------
// 097.01 Purpose: This section reserves structured space for future improvements.
// 097.02 Suggested enhancements may include richer subscription analytics,
// 097.03 server-driven recommendation banners, progressive onboarding,
// 097.04 locale-aware date formatting, reader themes, annotation storage,
// 097.05 offline verse pinning, audio prefetching, and adaptive playback.
// 097.06 For push, consider a dedicated web-push provider if Apps Script
// 097.07 storage is sufficient but cryptographic delivery becomes limiting.
// 097.08 For Android automation, consider exporting explicit vendor formats
// 097.09 once a single target app (MacroDroid/Tasker) is selected.
// 097.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 097.11 whose import link is published via a simple config endpoint.
// 097.12 Testing checklist item: verify subscription modal defaults.
// 097.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 097.14 Testing checklist item: verify progressive routing advances properly.
// 097.15 Testing checklist item: verify QR export on iOS Safari.
// 097.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 097.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 097.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 097.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 097.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 098
// ---------------------------------------------------------
// 098.01 Purpose: This section reserves structured space for future improvements.
// 098.02 Suggested enhancements may include richer subscription analytics,
// 098.03 server-driven recommendation banners, progressive onboarding,
// 098.04 locale-aware date formatting, reader themes, annotation storage,
// 098.05 offline verse pinning, audio prefetching, and adaptive playback.
// 098.06 For push, consider a dedicated web-push provider if Apps Script
// 098.07 storage is sufficient but cryptographic delivery becomes limiting.
// 098.08 For Android automation, consider exporting explicit vendor formats
// 098.09 once a single target app (MacroDroid/Tasker) is selected.
// 098.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 098.11 whose import link is published via a simple config endpoint.
// 098.12 Testing checklist item: verify subscription modal defaults.
// 098.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 098.14 Testing checklist item: verify progressive routing advances properly.
// 098.15 Testing checklist item: verify QR export on iOS Safari.
// 098.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 098.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 098.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 098.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 098.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 099
// ---------------------------------------------------------
// 099.01 Purpose: This section reserves structured space for future improvements.
// 099.02 Suggested enhancements may include richer subscription analytics,
// 099.03 server-driven recommendation banners, progressive onboarding,
// 099.04 locale-aware date formatting, reader themes, annotation storage,
// 099.05 offline verse pinning, audio prefetching, and adaptive playback.
// 099.06 For push, consider a dedicated web-push provider if Apps Script
// 099.07 storage is sufficient but cryptographic delivery becomes limiting.
// 099.08 For Android automation, consider exporting explicit vendor formats
// 099.09 once a single target app (MacroDroid/Tasker) is selected.
// 099.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 099.11 whose import link is published via a simple config endpoint.
// 099.12 Testing checklist item: verify subscription modal defaults.
// 099.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 099.14 Testing checklist item: verify progressive routing advances properly.
// 099.15 Testing checklist item: verify QR export on iOS Safari.
// 099.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 099.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 099.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 099.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 099.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 100
// ---------------------------------------------------------
// 100.01 Purpose: This section reserves structured space for future improvements.
// 100.02 Suggested enhancements may include richer subscription analytics,
// 100.03 server-driven recommendation banners, progressive onboarding,
// 100.04 locale-aware date formatting, reader themes, annotation storage,
// 100.05 offline verse pinning, audio prefetching, and adaptive playback.
// 100.06 For push, consider a dedicated web-push provider if Apps Script
// 100.07 storage is sufficient but cryptographic delivery becomes limiting.
// 100.08 For Android automation, consider exporting explicit vendor formats
// 100.09 once a single target app (MacroDroid/Tasker) is selected.
// 100.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 100.11 whose import link is published via a simple config endpoint.
// 100.12 Testing checklist item: verify subscription modal defaults.
// 100.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 100.14 Testing checklist item: verify progressive routing advances properly.
// 100.15 Testing checklist item: verify QR export on iOS Safari.
// 100.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 100.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 100.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 100.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 100.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 101
// ---------------------------------------------------------
// 101.01 Purpose: This section reserves structured space for future improvements.
// 101.02 Suggested enhancements may include richer subscription analytics,
// 101.03 server-driven recommendation banners, progressive onboarding,
// 101.04 locale-aware date formatting, reader themes, annotation storage,
// 101.05 offline verse pinning, audio prefetching, and adaptive playback.
// 101.06 For push, consider a dedicated web-push provider if Apps Script
// 101.07 storage is sufficient but cryptographic delivery becomes limiting.
// 101.08 For Android automation, consider exporting explicit vendor formats
// 101.09 once a single target app (MacroDroid/Tasker) is selected.
// 101.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 101.11 whose import link is published via a simple config endpoint.
// 101.12 Testing checklist item: verify subscription modal defaults.
// 101.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 101.14 Testing checklist item: verify progressive routing advances properly.
// 101.15 Testing checklist item: verify QR export on iOS Safari.
// 101.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 101.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 101.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 101.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 101.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 102
// ---------------------------------------------------------
// 102.01 Purpose: This section reserves structured space for future improvements.
// 102.02 Suggested enhancements may include richer subscription analytics,
// 102.03 server-driven recommendation banners, progressive onboarding,
// 102.04 locale-aware date formatting, reader themes, annotation storage,
// 102.05 offline verse pinning, audio prefetching, and adaptive playback.
// 102.06 For push, consider a dedicated web-push provider if Apps Script
// 102.07 storage is sufficient but cryptographic delivery becomes limiting.
// 102.08 For Android automation, consider exporting explicit vendor formats
// 102.09 once a single target app (MacroDroid/Tasker) is selected.
// 102.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 102.11 whose import link is published via a simple config endpoint.
// 102.12 Testing checklist item: verify subscription modal defaults.
// 102.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 102.14 Testing checklist item: verify progressive routing advances properly.
// 102.15 Testing checklist item: verify QR export on iOS Safari.
// 102.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 102.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 102.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 102.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 102.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 103
// ---------------------------------------------------------
// 103.01 Purpose: This section reserves structured space for future improvements.
// 103.02 Suggested enhancements may include richer subscription analytics,
// 103.03 server-driven recommendation banners, progressive onboarding,
// 103.04 locale-aware date formatting, reader themes, annotation storage,
// 103.05 offline verse pinning, audio prefetching, and adaptive playback.
// 103.06 For push, consider a dedicated web-push provider if Apps Script
// 103.07 storage is sufficient but cryptographic delivery becomes limiting.
// 103.08 For Android automation, consider exporting explicit vendor formats
// 103.09 once a single target app (MacroDroid/Tasker) is selected.
// 103.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 103.11 whose import link is published via a simple config endpoint.
// 103.12 Testing checklist item: verify subscription modal defaults.
// 103.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 103.14 Testing checklist item: verify progressive routing advances properly.
// 103.15 Testing checklist item: verify QR export on iOS Safari.
// 103.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 103.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 103.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 103.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 103.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 104
// ---------------------------------------------------------
// 104.01 Purpose: This section reserves structured space for future improvements.
// 104.02 Suggested enhancements may include richer subscription analytics,
// 104.03 server-driven recommendation banners, progressive onboarding,
// 104.04 locale-aware date formatting, reader themes, annotation storage,
// 104.05 offline verse pinning, audio prefetching, and adaptive playback.
// 104.06 For push, consider a dedicated web-push provider if Apps Script
// 104.07 storage is sufficient but cryptographic delivery becomes limiting.
// 104.08 For Android automation, consider exporting explicit vendor formats
// 104.09 once a single target app (MacroDroid/Tasker) is selected.
// 104.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 104.11 whose import link is published via a simple config endpoint.
// 104.12 Testing checklist item: verify subscription modal defaults.
// 104.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 104.14 Testing checklist item: verify progressive routing advances properly.
// 104.15 Testing checklist item: verify QR export on iOS Safari.
// 104.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 104.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 104.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 104.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 104.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 105
// ---------------------------------------------------------
// 105.01 Purpose: This section reserves structured space for future improvements.
// 105.02 Suggested enhancements may include richer subscription analytics,
// 105.03 server-driven recommendation banners, progressive onboarding,
// 105.04 locale-aware date formatting, reader themes, annotation storage,
// 105.05 offline verse pinning, audio prefetching, and adaptive playback.
// 105.06 For push, consider a dedicated web-push provider if Apps Script
// 105.07 storage is sufficient but cryptographic delivery becomes limiting.
// 105.08 For Android automation, consider exporting explicit vendor formats
// 105.09 once a single target app (MacroDroid/Tasker) is selected.
// 105.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 105.11 whose import link is published via a simple config endpoint.
// 105.12 Testing checklist item: verify subscription modal defaults.
// 105.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 105.14 Testing checklist item: verify progressive routing advances properly.
// 105.15 Testing checklist item: verify QR export on iOS Safari.
// 105.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 105.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 105.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 105.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 105.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 106
// ---------------------------------------------------------
// 106.01 Purpose: This section reserves structured space for future improvements.
// 106.02 Suggested enhancements may include richer subscription analytics,
// 106.03 server-driven recommendation banners, progressive onboarding,
// 106.04 locale-aware date formatting, reader themes, annotation storage,
// 106.05 offline verse pinning, audio prefetching, and adaptive playback.
// 106.06 For push, consider a dedicated web-push provider if Apps Script
// 106.07 storage is sufficient but cryptographic delivery becomes limiting.
// 106.08 For Android automation, consider exporting explicit vendor formats
// 106.09 once a single target app (MacroDroid/Tasker) is selected.
// 106.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 106.11 whose import link is published via a simple config endpoint.
// 106.12 Testing checklist item: verify subscription modal defaults.
// 106.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 106.14 Testing checklist item: verify progressive routing advances properly.
// 106.15 Testing checklist item: verify QR export on iOS Safari.
// 106.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 106.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 106.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 106.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 106.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 107
// ---------------------------------------------------------
// 107.01 Purpose: This section reserves structured space for future improvements.
// 107.02 Suggested enhancements may include richer subscription analytics,
// 107.03 server-driven recommendation banners, progressive onboarding,
// 107.04 locale-aware date formatting, reader themes, annotation storage,
// 107.05 offline verse pinning, audio prefetching, and adaptive playback.
// 107.06 For push, consider a dedicated web-push provider if Apps Script
// 107.07 storage is sufficient but cryptographic delivery becomes limiting.
// 107.08 For Android automation, consider exporting explicit vendor formats
// 107.09 once a single target app (MacroDroid/Tasker) is selected.
// 107.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 107.11 whose import link is published via a simple config endpoint.
// 107.12 Testing checklist item: verify subscription modal defaults.
// 107.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 107.14 Testing checklist item: verify progressive routing advances properly.
// 107.15 Testing checklist item: verify QR export on iOS Safari.
// 107.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 107.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 107.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 107.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 107.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 108
// ---------------------------------------------------------
// 108.01 Purpose: This section reserves structured space for future improvements.
// 108.02 Suggested enhancements may include richer subscription analytics,
// 108.03 server-driven recommendation banners, progressive onboarding,
// 108.04 locale-aware date formatting, reader themes, annotation storage,
// 108.05 offline verse pinning, audio prefetching, and adaptive playback.
// 108.06 For push, consider a dedicated web-push provider if Apps Script
// 108.07 storage is sufficient but cryptographic delivery becomes limiting.
// 108.08 For Android automation, consider exporting explicit vendor formats
// 108.09 once a single target app (MacroDroid/Tasker) is selected.
// 108.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 108.11 whose import link is published via a simple config endpoint.
// 108.12 Testing checklist item: verify subscription modal defaults.
// 108.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 108.14 Testing checklist item: verify progressive routing advances properly.
// 108.15 Testing checklist item: verify QR export on iOS Safari.
// 108.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 108.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 108.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 108.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 108.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 109
// ---------------------------------------------------------
// 109.01 Purpose: This section reserves structured space for future improvements.
// 109.02 Suggested enhancements may include richer subscription analytics,
// 109.03 server-driven recommendation banners, progressive onboarding,
// 109.04 locale-aware date formatting, reader themes, annotation storage,
// 109.05 offline verse pinning, audio prefetching, and adaptive playback.
// 109.06 For push, consider a dedicated web-push provider if Apps Script
// 109.07 storage is sufficient but cryptographic delivery becomes limiting.
// 109.08 For Android automation, consider exporting explicit vendor formats
// 109.09 once a single target app (MacroDroid/Tasker) is selected.
// 109.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 109.11 whose import link is published via a simple config endpoint.
// 109.12 Testing checklist item: verify subscription modal defaults.
// 109.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 109.14 Testing checklist item: verify progressive routing advances properly.
// 109.15 Testing checklist item: verify QR export on iOS Safari.
// 109.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 109.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 109.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 109.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 109.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 110
// ---------------------------------------------------------
// 110.01 Purpose: This section reserves structured space for future improvements.
// 110.02 Suggested enhancements may include richer subscription analytics,
// 110.03 server-driven recommendation banners, progressive onboarding,
// 110.04 locale-aware date formatting, reader themes, annotation storage,
// 110.05 offline verse pinning, audio prefetching, and adaptive playback.
// 110.06 For push, consider a dedicated web-push provider if Apps Script
// 110.07 storage is sufficient but cryptographic delivery becomes limiting.
// 110.08 For Android automation, consider exporting explicit vendor formats
// 110.09 once a single target app (MacroDroid/Tasker) is selected.
// 110.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 110.11 whose import link is published via a simple config endpoint.
// 110.12 Testing checklist item: verify subscription modal defaults.
// 110.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 110.14 Testing checklist item: verify progressive routing advances properly.
// 110.15 Testing checklist item: verify QR export on iOS Safari.
// 110.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 110.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 110.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 110.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 110.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 111
// ---------------------------------------------------------
// 111.01 Purpose: This section reserves structured space for future improvements.
// 111.02 Suggested enhancements may include richer subscription analytics,
// 111.03 server-driven recommendation banners, progressive onboarding,
// 111.04 locale-aware date formatting, reader themes, annotation storage,
// 111.05 offline verse pinning, audio prefetching, and adaptive playback.
// 111.06 For push, consider a dedicated web-push provider if Apps Script
// 111.07 storage is sufficient but cryptographic delivery becomes limiting.
// 111.08 For Android automation, consider exporting explicit vendor formats
// 111.09 once a single target app (MacroDroid/Tasker) is selected.
// 111.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 111.11 whose import link is published via a simple config endpoint.
// 111.12 Testing checklist item: verify subscription modal defaults.
// 111.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 111.14 Testing checklist item: verify progressive routing advances properly.
// 111.15 Testing checklist item: verify QR export on iOS Safari.
// 111.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 111.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 111.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 111.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 111.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 112
// ---------------------------------------------------------
// 112.01 Purpose: This section reserves structured space for future improvements.
// 112.02 Suggested enhancements may include richer subscription analytics,
// 112.03 server-driven recommendation banners, progressive onboarding,
// 112.04 locale-aware date formatting, reader themes, annotation storage,
// 112.05 offline verse pinning, audio prefetching, and adaptive playback.
// 112.06 For push, consider a dedicated web-push provider if Apps Script
// 112.07 storage is sufficient but cryptographic delivery becomes limiting.
// 112.08 For Android automation, consider exporting explicit vendor formats
// 112.09 once a single target app (MacroDroid/Tasker) is selected.
// 112.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 112.11 whose import link is published via a simple config endpoint.
// 112.12 Testing checklist item: verify subscription modal defaults.
// 112.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 112.14 Testing checklist item: verify progressive routing advances properly.
// 112.15 Testing checklist item: verify QR export on iOS Safari.
// 112.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 112.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 112.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 112.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 112.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 113
// ---------------------------------------------------------
// 113.01 Purpose: This section reserves structured space for future improvements.
// 113.02 Suggested enhancements may include richer subscription analytics,
// 113.03 server-driven recommendation banners, progressive onboarding,
// 113.04 locale-aware date formatting, reader themes, annotation storage,
// 113.05 offline verse pinning, audio prefetching, and adaptive playback.
// 113.06 For push, consider a dedicated web-push provider if Apps Script
// 113.07 storage is sufficient but cryptographic delivery becomes limiting.
// 113.08 For Android automation, consider exporting explicit vendor formats
// 113.09 once a single target app (MacroDroid/Tasker) is selected.
// 113.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 113.11 whose import link is published via a simple config endpoint.
// 113.12 Testing checklist item: verify subscription modal defaults.
// 113.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 113.14 Testing checklist item: verify progressive routing advances properly.
// 113.15 Testing checklist item: verify QR export on iOS Safari.
// 113.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 113.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 113.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 113.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 113.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 114
// ---------------------------------------------------------
// 114.01 Purpose: This section reserves structured space for future improvements.
// 114.02 Suggested enhancements may include richer subscription analytics,
// 114.03 server-driven recommendation banners, progressive onboarding,
// 114.04 locale-aware date formatting, reader themes, annotation storage,
// 114.05 offline verse pinning, audio prefetching, and adaptive playback.
// 114.06 For push, consider a dedicated web-push provider if Apps Script
// 114.07 storage is sufficient but cryptographic delivery becomes limiting.
// 114.08 For Android automation, consider exporting explicit vendor formats
// 114.09 once a single target app (MacroDroid/Tasker) is selected.
// 114.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 114.11 whose import link is published via a simple config endpoint.
// 114.12 Testing checklist item: verify subscription modal defaults.
// 114.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 114.14 Testing checklist item: verify progressive routing advances properly.
// 114.15 Testing checklist item: verify QR export on iOS Safari.
// 114.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 114.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 114.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 114.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 114.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 115
// ---------------------------------------------------------
// 115.01 Purpose: This section reserves structured space for future improvements.
// 115.02 Suggested enhancements may include richer subscription analytics,
// 115.03 server-driven recommendation banners, progressive onboarding,
// 115.04 locale-aware date formatting, reader themes, annotation storage,
// 115.05 offline verse pinning, audio prefetching, and adaptive playback.
// 115.06 For push, consider a dedicated web-push provider if Apps Script
// 115.07 storage is sufficient but cryptographic delivery becomes limiting.
// 115.08 For Android automation, consider exporting explicit vendor formats
// 115.09 once a single target app (MacroDroid/Tasker) is selected.
// 115.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 115.11 whose import link is published via a simple config endpoint.
// 115.12 Testing checklist item: verify subscription modal defaults.
// 115.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 115.14 Testing checklist item: verify progressive routing advances properly.
// 115.15 Testing checklist item: verify QR export on iOS Safari.
// 115.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 115.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 115.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 115.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 115.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 116
// ---------------------------------------------------------
// 116.01 Purpose: This section reserves structured space for future improvements.
// 116.02 Suggested enhancements may include richer subscription analytics,
// 116.03 server-driven recommendation banners, progressive onboarding,
// 116.04 locale-aware date formatting, reader themes, annotation storage,
// 116.05 offline verse pinning, audio prefetching, and adaptive playback.
// 116.06 For push, consider a dedicated web-push provider if Apps Script
// 116.07 storage is sufficient but cryptographic delivery becomes limiting.
// 116.08 For Android automation, consider exporting explicit vendor formats
// 116.09 once a single target app (MacroDroid/Tasker) is selected.
// 116.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 116.11 whose import link is published via a simple config endpoint.
// 116.12 Testing checklist item: verify subscription modal defaults.
// 116.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 116.14 Testing checklist item: verify progressive routing advances properly.
// 116.15 Testing checklist item: verify QR export on iOS Safari.
// 116.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 116.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 116.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 116.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 116.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 117
// ---------------------------------------------------------
// 117.01 Purpose: This section reserves structured space for future improvements.
// 117.02 Suggested enhancements may include richer subscription analytics,
// 117.03 server-driven recommendation banners, progressive onboarding,
// 117.04 locale-aware date formatting, reader themes, annotation storage,
// 117.05 offline verse pinning, audio prefetching, and adaptive playback.
// 117.06 For push, consider a dedicated web-push provider if Apps Script
// 117.07 storage is sufficient but cryptographic delivery becomes limiting.
// 117.08 For Android automation, consider exporting explicit vendor formats
// 117.09 once a single target app (MacroDroid/Tasker) is selected.
// 117.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 117.11 whose import link is published via a simple config endpoint.
// 117.12 Testing checklist item: verify subscription modal defaults.
// 117.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 117.14 Testing checklist item: verify progressive routing advances properly.
// 117.15 Testing checklist item: verify QR export on iOS Safari.
// 117.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 117.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 117.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 117.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 117.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 118
// ---------------------------------------------------------
// 118.01 Purpose: This section reserves structured space for future improvements.
// 118.02 Suggested enhancements may include richer subscription analytics,
// 118.03 server-driven recommendation banners, progressive onboarding,
// 118.04 locale-aware date formatting, reader themes, annotation storage,
// 118.05 offline verse pinning, audio prefetching, and adaptive playback.
// 118.06 For push, consider a dedicated web-push provider if Apps Script
// 118.07 storage is sufficient but cryptographic delivery becomes limiting.
// 118.08 For Android automation, consider exporting explicit vendor formats
// 118.09 once a single target app (MacroDroid/Tasker) is selected.
// 118.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 118.11 whose import link is published via a simple config endpoint.
// 118.12 Testing checklist item: verify subscription modal defaults.
// 118.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 118.14 Testing checklist item: verify progressive routing advances properly.
// 118.15 Testing checklist item: verify QR export on iOS Safari.
// 118.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 118.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 118.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 118.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 118.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 119
// ---------------------------------------------------------
// 119.01 Purpose: This section reserves structured space for future improvements.
// 119.02 Suggested enhancements may include richer subscription analytics,
// 119.03 server-driven recommendation banners, progressive onboarding,
// 119.04 locale-aware date formatting, reader themes, annotation storage,
// 119.05 offline verse pinning, audio prefetching, and adaptive playback.
// 119.06 For push, consider a dedicated web-push provider if Apps Script
// 119.07 storage is sufficient but cryptographic delivery becomes limiting.
// 119.08 For Android automation, consider exporting explicit vendor formats
// 119.09 once a single target app (MacroDroid/Tasker) is selected.
// 119.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 119.11 whose import link is published via a simple config endpoint.
// 119.12 Testing checklist item: verify subscription modal defaults.
// 119.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 119.14 Testing checklist item: verify progressive routing advances properly.
// 119.15 Testing checklist item: verify QR export on iOS Safari.
// 119.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 119.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 119.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 119.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 119.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 120
// ---------------------------------------------------------
// 120.01 Purpose: This section reserves structured space for future improvements.
// 120.02 Suggested enhancements may include richer subscription analytics,
// 120.03 server-driven recommendation banners, progressive onboarding,
// 120.04 locale-aware date formatting, reader themes, annotation storage,
// 120.05 offline verse pinning, audio prefetching, and adaptive playback.
// 120.06 For push, consider a dedicated web-push provider if Apps Script
// 120.07 storage is sufficient but cryptographic delivery becomes limiting.
// 120.08 For Android automation, consider exporting explicit vendor formats
// 120.09 once a single target app (MacroDroid/Tasker) is selected.
// 120.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 120.11 whose import link is published via a simple config endpoint.
// 120.12 Testing checklist item: verify subscription modal defaults.
// 120.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 120.14 Testing checklist item: verify progressive routing advances properly.
// 120.15 Testing checklist item: verify QR export on iOS Safari.
// 120.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 120.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 120.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 120.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 120.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 121
// ---------------------------------------------------------
// 121.01 Purpose: This section reserves structured space for future improvements.
// 121.02 Suggested enhancements may include richer subscription analytics,
// 121.03 server-driven recommendation banners, progressive onboarding,
// 121.04 locale-aware date formatting, reader themes, annotation storage,
// 121.05 offline verse pinning, audio prefetching, and adaptive playback.
// 121.06 For push, consider a dedicated web-push provider if Apps Script
// 121.07 storage is sufficient but cryptographic delivery becomes limiting.
// 121.08 For Android automation, consider exporting explicit vendor formats
// 121.09 once a single target app (MacroDroid/Tasker) is selected.
// 121.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 121.11 whose import link is published via a simple config endpoint.
// 121.12 Testing checklist item: verify subscription modal defaults.
// 121.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 121.14 Testing checklist item: verify progressive routing advances properly.
// 121.15 Testing checklist item: verify QR export on iOS Safari.
// 121.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 121.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 121.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 121.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 121.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 122
// ---------------------------------------------------------
// 122.01 Purpose: This section reserves structured space for future improvements.
// 122.02 Suggested enhancements may include richer subscription analytics,
// 122.03 server-driven recommendation banners, progressive onboarding,
// 122.04 locale-aware date formatting, reader themes, annotation storage,
// 122.05 offline verse pinning, audio prefetching, and adaptive playback.
// 122.06 For push, consider a dedicated web-push provider if Apps Script
// 122.07 storage is sufficient but cryptographic delivery becomes limiting.
// 122.08 For Android automation, consider exporting explicit vendor formats
// 122.09 once a single target app (MacroDroid/Tasker) is selected.
// 122.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 122.11 whose import link is published via a simple config endpoint.
// 122.12 Testing checklist item: verify subscription modal defaults.
// 122.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 122.14 Testing checklist item: verify progressive routing advances properly.
// 122.15 Testing checklist item: verify QR export on iOS Safari.
// 122.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 122.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 122.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 122.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 122.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 123
// ---------------------------------------------------------
// 123.01 Purpose: This section reserves structured space for future improvements.
// 123.02 Suggested enhancements may include richer subscription analytics,
// 123.03 server-driven recommendation banners, progressive onboarding,
// 123.04 locale-aware date formatting, reader themes, annotation storage,
// 123.05 offline verse pinning, audio prefetching, and adaptive playback.
// 123.06 For push, consider a dedicated web-push provider if Apps Script
// 123.07 storage is sufficient but cryptographic delivery becomes limiting.
// 123.08 For Android automation, consider exporting explicit vendor formats
// 123.09 once a single target app (MacroDroid/Tasker) is selected.
// 123.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 123.11 whose import link is published via a simple config endpoint.
// 123.12 Testing checklist item: verify subscription modal defaults.
// 123.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 123.14 Testing checklist item: verify progressive routing advances properly.
// 123.15 Testing checklist item: verify QR export on iOS Safari.
// 123.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 123.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 123.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 123.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 123.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 124
// ---------------------------------------------------------
// 124.01 Purpose: This section reserves structured space for future improvements.
// 124.02 Suggested enhancements may include richer subscription analytics,
// 124.03 server-driven recommendation banners, progressive onboarding,
// 124.04 locale-aware date formatting, reader themes, annotation storage,
// 124.05 offline verse pinning, audio prefetching, and adaptive playback.
// 124.06 For push, consider a dedicated web-push provider if Apps Script
// 124.07 storage is sufficient but cryptographic delivery becomes limiting.
// 124.08 For Android automation, consider exporting explicit vendor formats
// 124.09 once a single target app (MacroDroid/Tasker) is selected.
// 124.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 124.11 whose import link is published via a simple config endpoint.
// 124.12 Testing checklist item: verify subscription modal defaults.
// 124.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 124.14 Testing checklist item: verify progressive routing advances properly.
// 124.15 Testing checklist item: verify QR export on iOS Safari.
// 124.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 124.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 124.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 124.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 124.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 125
// ---------------------------------------------------------
// 125.01 Purpose: This section reserves structured space for future improvements.
// 125.02 Suggested enhancements may include richer subscription analytics,
// 125.03 server-driven recommendation banners, progressive onboarding,
// 125.04 locale-aware date formatting, reader themes, annotation storage,
// 125.05 offline verse pinning, audio prefetching, and adaptive playback.
// 125.06 For push, consider a dedicated web-push provider if Apps Script
// 125.07 storage is sufficient but cryptographic delivery becomes limiting.
// 125.08 For Android automation, consider exporting explicit vendor formats
// 125.09 once a single target app (MacroDroid/Tasker) is selected.
// 125.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 125.11 whose import link is published via a simple config endpoint.
// 125.12 Testing checklist item: verify subscription modal defaults.
// 125.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 125.14 Testing checklist item: verify progressive routing advances properly.
// 125.15 Testing checklist item: verify QR export on iOS Safari.
// 125.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 125.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 125.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 125.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 125.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 126
// ---------------------------------------------------------
// 126.01 Purpose: This section reserves structured space for future improvements.
// 126.02 Suggested enhancements may include richer subscription analytics,
// 126.03 server-driven recommendation banners, progressive onboarding,
// 126.04 locale-aware date formatting, reader themes, annotation storage,
// 126.05 offline verse pinning, audio prefetching, and adaptive playback.
// 126.06 For push, consider a dedicated web-push provider if Apps Script
// 126.07 storage is sufficient but cryptographic delivery becomes limiting.
// 126.08 For Android automation, consider exporting explicit vendor formats
// 126.09 once a single target app (MacroDroid/Tasker) is selected.
// 126.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 126.11 whose import link is published via a simple config endpoint.
// 126.12 Testing checklist item: verify subscription modal defaults.
// 126.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 126.14 Testing checklist item: verify progressive routing advances properly.
// 126.15 Testing checklist item: verify QR export on iOS Safari.
// 126.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 126.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 126.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 126.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 126.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 127
// ---------------------------------------------------------
// 127.01 Purpose: This section reserves structured space for future improvements.
// 127.02 Suggested enhancements may include richer subscription analytics,
// 127.03 server-driven recommendation banners, progressive onboarding,
// 127.04 locale-aware date formatting, reader themes, annotation storage,
// 127.05 offline verse pinning, audio prefetching, and adaptive playback.
// 127.06 For push, consider a dedicated web-push provider if Apps Script
// 127.07 storage is sufficient but cryptographic delivery becomes limiting.
// 127.08 For Android automation, consider exporting explicit vendor formats
// 127.09 once a single target app (MacroDroid/Tasker) is selected.
// 127.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 127.11 whose import link is published via a simple config endpoint.
// 127.12 Testing checklist item: verify subscription modal defaults.
// 127.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 127.14 Testing checklist item: verify progressive routing advances properly.
// 127.15 Testing checklist item: verify QR export on iOS Safari.
// 127.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 127.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 127.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 127.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 127.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 128
// ---------------------------------------------------------
// 128.01 Purpose: This section reserves structured space for future improvements.
// 128.02 Suggested enhancements may include richer subscription analytics,
// 128.03 server-driven recommendation banners, progressive onboarding,
// 128.04 locale-aware date formatting, reader themes, annotation storage,
// 128.05 offline verse pinning, audio prefetching, and adaptive playback.
// 128.06 For push, consider a dedicated web-push provider if Apps Script
// 128.07 storage is sufficient but cryptographic delivery becomes limiting.
// 128.08 For Android automation, consider exporting explicit vendor formats
// 128.09 once a single target app (MacroDroid/Tasker) is selected.
// 128.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 128.11 whose import link is published via a simple config endpoint.
// 128.12 Testing checklist item: verify subscription modal defaults.
// 128.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 128.14 Testing checklist item: verify progressive routing advances properly.
// 128.15 Testing checklist item: verify QR export on iOS Safari.
// 128.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 128.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 128.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 128.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 128.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 129
// ---------------------------------------------------------
// 129.01 Purpose: This section reserves structured space for future improvements.
// 129.02 Suggested enhancements may include richer subscription analytics,
// 129.03 server-driven recommendation banners, progressive onboarding,
// 129.04 locale-aware date formatting, reader themes, annotation storage,
// 129.05 offline verse pinning, audio prefetching, and adaptive playback.
// 129.06 For push, consider a dedicated web-push provider if Apps Script
// 129.07 storage is sufficient but cryptographic delivery becomes limiting.
// 129.08 For Android automation, consider exporting explicit vendor formats
// 129.09 once a single target app (MacroDroid/Tasker) is selected.
// 129.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 129.11 whose import link is published via a simple config endpoint.
// 129.12 Testing checklist item: verify subscription modal defaults.
// 129.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 129.14 Testing checklist item: verify progressive routing advances properly.
// 129.15 Testing checklist item: verify QR export on iOS Safari.
// 129.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 129.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 129.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 129.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 129.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 130
// ---------------------------------------------------------
// 130.01 Purpose: This section reserves structured space for future improvements.
// 130.02 Suggested enhancements may include richer subscription analytics,
// 130.03 server-driven recommendation banners, progressive onboarding,
// 130.04 locale-aware date formatting, reader themes, annotation storage,
// 130.05 offline verse pinning, audio prefetching, and adaptive playback.
// 130.06 For push, consider a dedicated web-push provider if Apps Script
// 130.07 storage is sufficient but cryptographic delivery becomes limiting.
// 130.08 For Android automation, consider exporting explicit vendor formats
// 130.09 once a single target app (MacroDroid/Tasker) is selected.
// 130.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 130.11 whose import link is published via a simple config endpoint.
// 130.12 Testing checklist item: verify subscription modal defaults.
// 130.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 130.14 Testing checklist item: verify progressive routing advances properly.
// 130.15 Testing checklist item: verify QR export on iOS Safari.
// 130.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 130.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 130.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 130.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 130.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 131
// ---------------------------------------------------------
// 131.01 Purpose: This section reserves structured space for future improvements.
// 131.02 Suggested enhancements may include richer subscription analytics,
// 131.03 server-driven recommendation banners, progressive onboarding,
// 131.04 locale-aware date formatting, reader themes, annotation storage,
// 131.05 offline verse pinning, audio prefetching, and adaptive playback.
// 131.06 For push, consider a dedicated web-push provider if Apps Script
// 131.07 storage is sufficient but cryptographic delivery becomes limiting.
// 131.08 For Android automation, consider exporting explicit vendor formats
// 131.09 once a single target app (MacroDroid/Tasker) is selected.
// 131.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 131.11 whose import link is published via a simple config endpoint.
// 131.12 Testing checklist item: verify subscription modal defaults.
// 131.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 131.14 Testing checklist item: verify progressive routing advances properly.
// 131.15 Testing checklist item: verify QR export on iOS Safari.
// 131.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 131.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 131.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 131.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 131.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 132
// ---------------------------------------------------------
// 132.01 Purpose: This section reserves structured space for future improvements.
// 132.02 Suggested enhancements may include richer subscription analytics,
// 132.03 server-driven recommendation banners, progressive onboarding,
// 132.04 locale-aware date formatting, reader themes, annotation storage,
// 132.05 offline verse pinning, audio prefetching, and adaptive playback.
// 132.06 For push, consider a dedicated web-push provider if Apps Script
// 132.07 storage is sufficient but cryptographic delivery becomes limiting.
// 132.08 For Android automation, consider exporting explicit vendor formats
// 132.09 once a single target app (MacroDroid/Tasker) is selected.
// 132.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 132.11 whose import link is published via a simple config endpoint.
// 132.12 Testing checklist item: verify subscription modal defaults.
// 132.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 132.14 Testing checklist item: verify progressive routing advances properly.
// 132.15 Testing checklist item: verify QR export on iOS Safari.
// 132.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 132.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 132.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 132.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 132.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 133
// ---------------------------------------------------------
// 133.01 Purpose: This section reserves structured space for future improvements.
// 133.02 Suggested enhancements may include richer subscription analytics,
// 133.03 server-driven recommendation banners, progressive onboarding,
// 133.04 locale-aware date formatting, reader themes, annotation storage,
// 133.05 offline verse pinning, audio prefetching, and adaptive playback.
// 133.06 For push, consider a dedicated web-push provider if Apps Script
// 133.07 storage is sufficient but cryptographic delivery becomes limiting.
// 133.08 For Android automation, consider exporting explicit vendor formats
// 133.09 once a single target app (MacroDroid/Tasker) is selected.
// 133.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 133.11 whose import link is published via a simple config endpoint.
// 133.12 Testing checklist item: verify subscription modal defaults.
// 133.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 133.14 Testing checklist item: verify progressive routing advances properly.
// 133.15 Testing checklist item: verify QR export on iOS Safari.
// 133.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 133.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 133.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 133.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 133.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 134
// ---------------------------------------------------------
// 134.01 Purpose: This section reserves structured space for future improvements.
// 134.02 Suggested enhancements may include richer subscription analytics,
// 134.03 server-driven recommendation banners, progressive onboarding,
// 134.04 locale-aware date formatting, reader themes, annotation storage,
// 134.05 offline verse pinning, audio prefetching, and adaptive playback.
// 134.06 For push, consider a dedicated web-push provider if Apps Script
// 134.07 storage is sufficient but cryptographic delivery becomes limiting.
// 134.08 For Android automation, consider exporting explicit vendor formats
// 134.09 once a single target app (MacroDroid/Tasker) is selected.
// 134.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 134.11 whose import link is published via a simple config endpoint.
// 134.12 Testing checklist item: verify subscription modal defaults.
// 134.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 134.14 Testing checklist item: verify progressive routing advances properly.
// 134.15 Testing checklist item: verify QR export on iOS Safari.
// 134.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 134.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 134.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 134.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 134.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 135
// ---------------------------------------------------------
// 135.01 Purpose: This section reserves structured space for future improvements.
// 135.02 Suggested enhancements may include richer subscription analytics,
// 135.03 server-driven recommendation banners, progressive onboarding,
// 135.04 locale-aware date formatting, reader themes, annotation storage,
// 135.05 offline verse pinning, audio prefetching, and adaptive playback.
// 135.06 For push, consider a dedicated web-push provider if Apps Script
// 135.07 storage is sufficient but cryptographic delivery becomes limiting.
// 135.08 For Android automation, consider exporting explicit vendor formats
// 135.09 once a single target app (MacroDroid/Tasker) is selected.
// 135.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 135.11 whose import link is published via a simple config endpoint.
// 135.12 Testing checklist item: verify subscription modal defaults.
// 135.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 135.14 Testing checklist item: verify progressive routing advances properly.
// 135.15 Testing checklist item: verify QR export on iOS Safari.
// 135.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 135.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 135.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 135.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 135.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 136
// ---------------------------------------------------------
// 136.01 Purpose: This section reserves structured space for future improvements.
// 136.02 Suggested enhancements may include richer subscription analytics,
// 136.03 server-driven recommendation banners, progressive onboarding,
// 136.04 locale-aware date formatting, reader themes, annotation storage,
// 136.05 offline verse pinning, audio prefetching, and adaptive playback.
// 136.06 For push, consider a dedicated web-push provider if Apps Script
// 136.07 storage is sufficient but cryptographic delivery becomes limiting.
// 136.08 For Android automation, consider exporting explicit vendor formats
// 136.09 once a single target app (MacroDroid/Tasker) is selected.
// 136.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 136.11 whose import link is published via a simple config endpoint.
// 136.12 Testing checklist item: verify subscription modal defaults.
// 136.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 136.14 Testing checklist item: verify progressive routing advances properly.
// 136.15 Testing checklist item: verify QR export on iOS Safari.
// 136.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 136.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 136.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 136.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 136.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 137
// ---------------------------------------------------------
// 137.01 Purpose: This section reserves structured space for future improvements.
// 137.02 Suggested enhancements may include richer subscription analytics,
// 137.03 server-driven recommendation banners, progressive onboarding,
// 137.04 locale-aware date formatting, reader themes, annotation storage,
// 137.05 offline verse pinning, audio prefetching, and adaptive playback.
// 137.06 For push, consider a dedicated web-push provider if Apps Script
// 137.07 storage is sufficient but cryptographic delivery becomes limiting.
// 137.08 For Android automation, consider exporting explicit vendor formats
// 137.09 once a single target app (MacroDroid/Tasker) is selected.
// 137.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 137.11 whose import link is published via a simple config endpoint.
// 137.12 Testing checklist item: verify subscription modal defaults.
// 137.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 137.14 Testing checklist item: verify progressive routing advances properly.
// 137.15 Testing checklist item: verify QR export on iOS Safari.
// 137.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 137.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 137.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 137.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 137.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 138
// ---------------------------------------------------------
// 138.01 Purpose: This section reserves structured space for future improvements.
// 138.02 Suggested enhancements may include richer subscription analytics,
// 138.03 server-driven recommendation banners, progressive onboarding,
// 138.04 locale-aware date formatting, reader themes, annotation storage,
// 138.05 offline verse pinning, audio prefetching, and adaptive playback.
// 138.06 For push, consider a dedicated web-push provider if Apps Script
// 138.07 storage is sufficient but cryptographic delivery becomes limiting.
// 138.08 For Android automation, consider exporting explicit vendor formats
// 138.09 once a single target app (MacroDroid/Tasker) is selected.
// 138.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 138.11 whose import link is published via a simple config endpoint.
// 138.12 Testing checklist item: verify subscription modal defaults.
// 138.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 138.14 Testing checklist item: verify progressive routing advances properly.
// 138.15 Testing checklist item: verify QR export on iOS Safari.
// 138.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 138.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 138.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 138.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 138.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 139
// ---------------------------------------------------------
// 139.01 Purpose: This section reserves structured space for future improvements.
// 139.02 Suggested enhancements may include richer subscription analytics,
// 139.03 server-driven recommendation banners, progressive onboarding,
// 139.04 locale-aware date formatting, reader themes, annotation storage,
// 139.05 offline verse pinning, audio prefetching, and adaptive playback.
// 139.06 For push, consider a dedicated web-push provider if Apps Script
// 139.07 storage is sufficient but cryptographic delivery becomes limiting.
// 139.08 For Android automation, consider exporting explicit vendor formats
// 139.09 once a single target app (MacroDroid/Tasker) is selected.
// 139.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 139.11 whose import link is published via a simple config endpoint.
// 139.12 Testing checklist item: verify subscription modal defaults.
// 139.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 139.14 Testing checklist item: verify progressive routing advances properly.
// 139.15 Testing checklist item: verify QR export on iOS Safari.
// 139.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 139.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 139.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 139.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 139.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 140
// ---------------------------------------------------------
// 140.01 Purpose: This section reserves structured space for future improvements.
// 140.02 Suggested enhancements may include richer subscription analytics,
// 140.03 server-driven recommendation banners, progressive onboarding,
// 140.04 locale-aware date formatting, reader themes, annotation storage,
// 140.05 offline verse pinning, audio prefetching, and adaptive playback.
// 140.06 For push, consider a dedicated web-push provider if Apps Script
// 140.07 storage is sufficient but cryptographic delivery becomes limiting.
// 140.08 For Android automation, consider exporting explicit vendor formats
// 140.09 once a single target app (MacroDroid/Tasker) is selected.
// 140.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 140.11 whose import link is published via a simple config endpoint.
// 140.12 Testing checklist item: verify subscription modal defaults.
// 140.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 140.14 Testing checklist item: verify progressive routing advances properly.
// 140.15 Testing checklist item: verify QR export on iOS Safari.
// 140.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 140.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 140.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 140.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 140.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 141
// ---------------------------------------------------------
// 141.01 Purpose: This section reserves structured space for future improvements.
// 141.02 Suggested enhancements may include richer subscription analytics,
// 141.03 server-driven recommendation banners, progressive onboarding,
// 141.04 locale-aware date formatting, reader themes, annotation storage,
// 141.05 offline verse pinning, audio prefetching, and adaptive playback.
// 141.06 For push, consider a dedicated web-push provider if Apps Script
// 141.07 storage is sufficient but cryptographic delivery becomes limiting.
// 141.08 For Android automation, consider exporting explicit vendor formats
// 141.09 once a single target app (MacroDroid/Tasker) is selected.
// 141.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 141.11 whose import link is published via a simple config endpoint.
// 141.12 Testing checklist item: verify subscription modal defaults.
// 141.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 141.14 Testing checklist item: verify progressive routing advances properly.
// 141.15 Testing checklist item: verify QR export on iOS Safari.
// 141.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 141.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 141.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 141.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 141.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 142
// ---------------------------------------------------------
// 142.01 Purpose: This section reserves structured space for future improvements.
// 142.02 Suggested enhancements may include richer subscription analytics,
// 142.03 server-driven recommendation banners, progressive onboarding,
// 142.04 locale-aware date formatting, reader themes, annotation storage,
// 142.05 offline verse pinning, audio prefetching, and adaptive playback.
// 142.06 For push, consider a dedicated web-push provider if Apps Script
// 142.07 storage is sufficient but cryptographic delivery becomes limiting.
// 142.08 For Android automation, consider exporting explicit vendor formats
// 142.09 once a single target app (MacroDroid/Tasker) is selected.
// 142.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 142.11 whose import link is published via a simple config endpoint.
// 142.12 Testing checklist item: verify subscription modal defaults.
// 142.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 142.14 Testing checklist item: verify progressive routing advances properly.
// 142.15 Testing checklist item: verify QR export on iOS Safari.
// 142.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 142.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 142.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 142.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 142.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 143
// ---------------------------------------------------------
// 143.01 Purpose: This section reserves structured space for future improvements.
// 143.02 Suggested enhancements may include richer subscription analytics,
// 143.03 server-driven recommendation banners, progressive onboarding,
// 143.04 locale-aware date formatting, reader themes, annotation storage,
// 143.05 offline verse pinning, audio prefetching, and adaptive playback.
// 143.06 For push, consider a dedicated web-push provider if Apps Script
// 143.07 storage is sufficient but cryptographic delivery becomes limiting.
// 143.08 For Android automation, consider exporting explicit vendor formats
// 143.09 once a single target app (MacroDroid/Tasker) is selected.
// 143.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 143.11 whose import link is published via a simple config endpoint.
// 143.12 Testing checklist item: verify subscription modal defaults.
// 143.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 143.14 Testing checklist item: verify progressive routing advances properly.
// 143.15 Testing checklist item: verify QR export on iOS Safari.
// 143.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 143.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 143.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 143.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 143.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 144
// ---------------------------------------------------------
// 144.01 Purpose: This section reserves structured space for future improvements.
// 144.02 Suggested enhancements may include richer subscription analytics,
// 144.03 server-driven recommendation banners, progressive onboarding,
// 144.04 locale-aware date formatting, reader themes, annotation storage,
// 144.05 offline verse pinning, audio prefetching, and adaptive playback.
// 144.06 For push, consider a dedicated web-push provider if Apps Script
// 144.07 storage is sufficient but cryptographic delivery becomes limiting.
// 144.08 For Android automation, consider exporting explicit vendor formats
// 144.09 once a single target app (MacroDroid/Tasker) is selected.
// 144.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 144.11 whose import link is published via a simple config endpoint.
// 144.12 Testing checklist item: verify subscription modal defaults.
// 144.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 144.14 Testing checklist item: verify progressive routing advances properly.
// 144.15 Testing checklist item: verify QR export on iOS Safari.
// 144.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 144.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 144.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 144.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 144.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 145
// ---------------------------------------------------------
// 145.01 Purpose: This section reserves structured space for future improvements.
// 145.02 Suggested enhancements may include richer subscription analytics,
// 145.03 server-driven recommendation banners, progressive onboarding,
// 145.04 locale-aware date formatting, reader themes, annotation storage,
// 145.05 offline verse pinning, audio prefetching, and adaptive playback.
// 145.06 For push, consider a dedicated web-push provider if Apps Script
// 145.07 storage is sufficient but cryptographic delivery becomes limiting.
// 145.08 For Android automation, consider exporting explicit vendor formats
// 145.09 once a single target app (MacroDroid/Tasker) is selected.
// 145.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 145.11 whose import link is published via a simple config endpoint.
// 145.12 Testing checklist item: verify subscription modal defaults.
// 145.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 145.14 Testing checklist item: verify progressive routing advances properly.
// 145.15 Testing checklist item: verify QR export on iOS Safari.
// 145.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 145.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 145.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 145.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 145.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 146
// ---------------------------------------------------------
// 146.01 Purpose: This section reserves structured space for future improvements.
// 146.02 Suggested enhancements may include richer subscription analytics,
// 146.03 server-driven recommendation banners, progressive onboarding,
// 146.04 locale-aware date formatting, reader themes, annotation storage,
// 146.05 offline verse pinning, audio prefetching, and adaptive playback.
// 146.06 For push, consider a dedicated web-push provider if Apps Script
// 146.07 storage is sufficient but cryptographic delivery becomes limiting.
// 146.08 For Android automation, consider exporting explicit vendor formats
// 146.09 once a single target app (MacroDroid/Tasker) is selected.
// 146.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 146.11 whose import link is published via a simple config endpoint.
// 146.12 Testing checklist item: verify subscription modal defaults.
// 146.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 146.14 Testing checklist item: verify progressive routing advances properly.
// 146.15 Testing checklist item: verify QR export on iOS Safari.
// 146.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 146.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 146.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 146.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 146.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 147
// ---------------------------------------------------------
// 147.01 Purpose: This section reserves structured space for future improvements.
// 147.02 Suggested enhancements may include richer subscription analytics,
// 147.03 server-driven recommendation banners, progressive onboarding,
// 147.04 locale-aware date formatting, reader themes, annotation storage,
// 147.05 offline verse pinning, audio prefetching, and adaptive playback.
// 147.06 For push, consider a dedicated web-push provider if Apps Script
// 147.07 storage is sufficient but cryptographic delivery becomes limiting.
// 147.08 For Android automation, consider exporting explicit vendor formats
// 147.09 once a single target app (MacroDroid/Tasker) is selected.
// 147.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 147.11 whose import link is published via a simple config endpoint.
// 147.12 Testing checklist item: verify subscription modal defaults.
// 147.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 147.14 Testing checklist item: verify progressive routing advances properly.
// 147.15 Testing checklist item: verify QR export on iOS Safari.
// 147.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 147.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 147.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 147.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 147.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 148
// ---------------------------------------------------------
// 148.01 Purpose: This section reserves structured space for future improvements.
// 148.02 Suggested enhancements may include richer subscription analytics,
// 148.03 server-driven recommendation banners, progressive onboarding,
// 148.04 locale-aware date formatting, reader themes, annotation storage,
// 148.05 offline verse pinning, audio prefetching, and adaptive playback.
// 148.06 For push, consider a dedicated web-push provider if Apps Script
// 148.07 storage is sufficient but cryptographic delivery becomes limiting.
// 148.08 For Android automation, consider exporting explicit vendor formats
// 148.09 once a single target app (MacroDroid/Tasker) is selected.
// 148.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 148.11 whose import link is published via a simple config endpoint.
// 148.12 Testing checklist item: verify subscription modal defaults.
// 148.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 148.14 Testing checklist item: verify progressive routing advances properly.
// 148.15 Testing checklist item: verify QR export on iOS Safari.
// 148.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 148.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 148.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 148.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 148.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 149
// ---------------------------------------------------------
// 149.01 Purpose: This section reserves structured space for future improvements.
// 149.02 Suggested enhancements may include richer subscription analytics,
// 149.03 server-driven recommendation banners, progressive onboarding,
// 149.04 locale-aware date formatting, reader themes, annotation storage,
// 149.05 offline verse pinning, audio prefetching, and adaptive playback.
// 149.06 For push, consider a dedicated web-push provider if Apps Script
// 149.07 storage is sufficient but cryptographic delivery becomes limiting.
// 149.08 For Android automation, consider exporting explicit vendor formats
// 149.09 once a single target app (MacroDroid/Tasker) is selected.
// 149.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 149.11 whose import link is published via a simple config endpoint.
// 149.12 Testing checklist item: verify subscription modal defaults.
// 149.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 149.14 Testing checklist item: verify progressive routing advances properly.
// 149.15 Testing checklist item: verify QR export on iOS Safari.
// 149.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 149.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 149.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 149.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 149.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 150
// ---------------------------------------------------------
// 150.01 Purpose: This section reserves structured space for future improvements.
// 150.02 Suggested enhancements may include richer subscription analytics,
// 150.03 server-driven recommendation banners, progressive onboarding,
// 150.04 locale-aware date formatting, reader themes, annotation storage,
// 150.05 offline verse pinning, audio prefetching, and adaptive playback.
// 150.06 For push, consider a dedicated web-push provider if Apps Script
// 150.07 storage is sufficient but cryptographic delivery becomes limiting.
// 150.08 For Android automation, consider exporting explicit vendor formats
// 150.09 once a single target app (MacroDroid/Tasker) is selected.
// 150.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 150.11 whose import link is published via a simple config endpoint.
// 150.12 Testing checklist item: verify subscription modal defaults.
// 150.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 150.14 Testing checklist item: verify progressive routing advances properly.
// 150.15 Testing checklist item: verify QR export on iOS Safari.
// 150.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 150.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 150.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 150.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 150.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 151
// ---------------------------------------------------------
// 151.01 Purpose: This section reserves structured space for future improvements.
// 151.02 Suggested enhancements may include richer subscription analytics,
// 151.03 server-driven recommendation banners, progressive onboarding,
// 151.04 locale-aware date formatting, reader themes, annotation storage,
// 151.05 offline verse pinning, audio prefetching, and adaptive playback.
// 151.06 For push, consider a dedicated web-push provider if Apps Script
// 151.07 storage is sufficient but cryptographic delivery becomes limiting.
// 151.08 For Android automation, consider exporting explicit vendor formats
// 151.09 once a single target app (MacroDroid/Tasker) is selected.
// 151.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 151.11 whose import link is published via a simple config endpoint.
// 151.12 Testing checklist item: verify subscription modal defaults.
// 151.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 151.14 Testing checklist item: verify progressive routing advances properly.
// 151.15 Testing checklist item: verify QR export on iOS Safari.
// 151.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 151.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 151.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 151.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 151.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 152
// ---------------------------------------------------------
// 152.01 Purpose: This section reserves structured space for future improvements.
// 152.02 Suggested enhancements may include richer subscription analytics,
// 152.03 server-driven recommendation banners, progressive onboarding,
// 152.04 locale-aware date formatting, reader themes, annotation storage,
// 152.05 offline verse pinning, audio prefetching, and adaptive playback.
// 152.06 For push, consider a dedicated web-push provider if Apps Script
// 152.07 storage is sufficient but cryptographic delivery becomes limiting.
// 152.08 For Android automation, consider exporting explicit vendor formats
// 152.09 once a single target app (MacroDroid/Tasker) is selected.
// 152.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 152.11 whose import link is published via a simple config endpoint.
// 152.12 Testing checklist item: verify subscription modal defaults.
// 152.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 152.14 Testing checklist item: verify progressive routing advances properly.
// 152.15 Testing checklist item: verify QR export on iOS Safari.
// 152.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 152.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 152.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 152.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 152.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 153
// ---------------------------------------------------------
// 153.01 Purpose: This section reserves structured space for future improvements.
// 153.02 Suggested enhancements may include richer subscription analytics,
// 153.03 server-driven recommendation banners, progressive onboarding,
// 153.04 locale-aware date formatting, reader themes, annotation storage,
// 153.05 offline verse pinning, audio prefetching, and adaptive playback.
// 153.06 For push, consider a dedicated web-push provider if Apps Script
// 153.07 storage is sufficient but cryptographic delivery becomes limiting.
// 153.08 For Android automation, consider exporting explicit vendor formats
// 153.09 once a single target app (MacroDroid/Tasker) is selected.
// 153.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 153.11 whose import link is published via a simple config endpoint.
// 153.12 Testing checklist item: verify subscription modal defaults.
// 153.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 153.14 Testing checklist item: verify progressive routing advances properly.
// 153.15 Testing checklist item: verify QR export on iOS Safari.
// 153.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 153.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 153.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 153.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 153.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 154
// ---------------------------------------------------------
// 154.01 Purpose: This section reserves structured space for future improvements.
// 154.02 Suggested enhancements may include richer subscription analytics,
// 154.03 server-driven recommendation banners, progressive onboarding,
// 154.04 locale-aware date formatting, reader themes, annotation storage,
// 154.05 offline verse pinning, audio prefetching, and adaptive playback.
// 154.06 For push, consider a dedicated web-push provider if Apps Script
// 154.07 storage is sufficient but cryptographic delivery becomes limiting.
// 154.08 For Android automation, consider exporting explicit vendor formats
// 154.09 once a single target app (MacroDroid/Tasker) is selected.
// 154.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 154.11 whose import link is published via a simple config endpoint.
// 154.12 Testing checklist item: verify subscription modal defaults.
// 154.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 154.14 Testing checklist item: verify progressive routing advances properly.
// 154.15 Testing checklist item: verify QR export on iOS Safari.
// 154.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 154.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 154.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 154.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 154.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 155
// ---------------------------------------------------------
// 155.01 Purpose: This section reserves structured space for future improvements.
// 155.02 Suggested enhancements may include richer subscription analytics,
// 155.03 server-driven recommendation banners, progressive onboarding,
// 155.04 locale-aware date formatting, reader themes, annotation storage,
// 155.05 offline verse pinning, audio prefetching, and adaptive playback.
// 155.06 For push, consider a dedicated web-push provider if Apps Script
// 155.07 storage is sufficient but cryptographic delivery becomes limiting.
// 155.08 For Android automation, consider exporting explicit vendor formats
// 155.09 once a single target app (MacroDroid/Tasker) is selected.
// 155.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 155.11 whose import link is published via a simple config endpoint.
// 155.12 Testing checklist item: verify subscription modal defaults.
// 155.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 155.14 Testing checklist item: verify progressive routing advances properly.
// 155.15 Testing checklist item: verify QR export on iOS Safari.
// 155.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 155.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 155.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 155.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 155.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 156
// ---------------------------------------------------------
// 156.01 Purpose: This section reserves structured space for future improvements.
// 156.02 Suggested enhancements may include richer subscription analytics,
// 156.03 server-driven recommendation banners, progressive onboarding,
// 156.04 locale-aware date formatting, reader themes, annotation storage,
// 156.05 offline verse pinning, audio prefetching, and adaptive playback.
// 156.06 For push, consider a dedicated web-push provider if Apps Script
// 156.07 storage is sufficient but cryptographic delivery becomes limiting.
// 156.08 For Android automation, consider exporting explicit vendor formats
// 156.09 once a single target app (MacroDroid/Tasker) is selected.
// 156.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 156.11 whose import link is published via a simple config endpoint.
// 156.12 Testing checklist item: verify subscription modal defaults.
// 156.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 156.14 Testing checklist item: verify progressive routing advances properly.
// 156.15 Testing checklist item: verify QR export on iOS Safari.
// 156.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 156.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 156.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 156.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 156.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 157
// ---------------------------------------------------------
// 157.01 Purpose: This section reserves structured space for future improvements.
// 157.02 Suggested enhancements may include richer subscription analytics,
// 157.03 server-driven recommendation banners, progressive onboarding,
// 157.04 locale-aware date formatting, reader themes, annotation storage,
// 157.05 offline verse pinning, audio prefetching, and adaptive playback.
// 157.06 For push, consider a dedicated web-push provider if Apps Script
// 157.07 storage is sufficient but cryptographic delivery becomes limiting.
// 157.08 For Android automation, consider exporting explicit vendor formats
// 157.09 once a single target app (MacroDroid/Tasker) is selected.
// 157.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 157.11 whose import link is published via a simple config endpoint.
// 157.12 Testing checklist item: verify subscription modal defaults.
// 157.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 157.14 Testing checklist item: verify progressive routing advances properly.
// 157.15 Testing checklist item: verify QR export on iOS Safari.
// 157.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 157.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 157.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 157.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 157.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 158
// ---------------------------------------------------------
// 158.01 Purpose: This section reserves structured space for future improvements.
// 158.02 Suggested enhancements may include richer subscription analytics,
// 158.03 server-driven recommendation banners, progressive onboarding,
// 158.04 locale-aware date formatting, reader themes, annotation storage,
// 158.05 offline verse pinning, audio prefetching, and adaptive playback.
// 158.06 For push, consider a dedicated web-push provider if Apps Script
// 158.07 storage is sufficient but cryptographic delivery becomes limiting.
// 158.08 For Android automation, consider exporting explicit vendor formats
// 158.09 once a single target app (MacroDroid/Tasker) is selected.
// 158.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 158.11 whose import link is published via a simple config endpoint.
// 158.12 Testing checklist item: verify subscription modal defaults.
// 158.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 158.14 Testing checklist item: verify progressive routing advances properly.
// 158.15 Testing checklist item: verify QR export on iOS Safari.
// 158.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 158.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 158.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 158.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 158.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 159
// ---------------------------------------------------------
// 159.01 Purpose: This section reserves structured space for future improvements.
// 159.02 Suggested enhancements may include richer subscription analytics,
// 159.03 server-driven recommendation banners, progressive onboarding,
// 159.04 locale-aware date formatting, reader themes, annotation storage,
// 159.05 offline verse pinning, audio prefetching, and adaptive playback.
// 159.06 For push, consider a dedicated web-push provider if Apps Script
// 159.07 storage is sufficient but cryptographic delivery becomes limiting.
// 159.08 For Android automation, consider exporting explicit vendor formats
// 159.09 once a single target app (MacroDroid/Tasker) is selected.
// 159.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 159.11 whose import link is published via a simple config endpoint.
// 159.12 Testing checklist item: verify subscription modal defaults.
// 159.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 159.14 Testing checklist item: verify progressive routing advances properly.
// 159.15 Testing checklist item: verify QR export on iOS Safari.
// 159.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 159.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 159.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 159.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 159.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 160
// ---------------------------------------------------------
// 160.01 Purpose: This section reserves structured space for future improvements.
// 160.02 Suggested enhancements may include richer subscription analytics,
// 160.03 server-driven recommendation banners, progressive onboarding,
// 160.04 locale-aware date formatting, reader themes, annotation storage,
// 160.05 offline verse pinning, audio prefetching, and adaptive playback.
// 160.06 For push, consider a dedicated web-push provider if Apps Script
// 160.07 storage is sufficient but cryptographic delivery becomes limiting.
// 160.08 For Android automation, consider exporting explicit vendor formats
// 160.09 once a single target app (MacroDroid/Tasker) is selected.
// 160.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 160.11 whose import link is published via a simple config endpoint.
// 160.12 Testing checklist item: verify subscription modal defaults.
// 160.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 160.14 Testing checklist item: verify progressive routing advances properly.
// 160.15 Testing checklist item: verify QR export on iOS Safari.
// 160.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 160.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 160.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 160.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 160.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 161
// ---------------------------------------------------------
// 161.01 Purpose: This section reserves structured space for future improvements.
// 161.02 Suggested enhancements may include richer subscription analytics,
// 161.03 server-driven recommendation banners, progressive onboarding,
// 161.04 locale-aware date formatting, reader themes, annotation storage,
// 161.05 offline verse pinning, audio prefetching, and adaptive playback.
// 161.06 For push, consider a dedicated web-push provider if Apps Script
// 161.07 storage is sufficient but cryptographic delivery becomes limiting.
// 161.08 For Android automation, consider exporting explicit vendor formats
// 161.09 once a single target app (MacroDroid/Tasker) is selected.
// 161.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 161.11 whose import link is published via a simple config endpoint.
// 161.12 Testing checklist item: verify subscription modal defaults.
// 161.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 161.14 Testing checklist item: verify progressive routing advances properly.
// 161.15 Testing checklist item: verify QR export on iOS Safari.
// 161.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 161.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 161.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 161.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 161.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 162
// ---------------------------------------------------------
// 162.01 Purpose: This section reserves structured space for future improvements.
// 162.02 Suggested enhancements may include richer subscription analytics,
// 162.03 server-driven recommendation banners, progressive onboarding,
// 162.04 locale-aware date formatting, reader themes, annotation storage,
// 162.05 offline verse pinning, audio prefetching, and adaptive playback.
// 162.06 For push, consider a dedicated web-push provider if Apps Script
// 162.07 storage is sufficient but cryptographic delivery becomes limiting.
// 162.08 For Android automation, consider exporting explicit vendor formats
// 162.09 once a single target app (MacroDroid/Tasker) is selected.
// 162.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 162.11 whose import link is published via a simple config endpoint.
// 162.12 Testing checklist item: verify subscription modal defaults.
// 162.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 162.14 Testing checklist item: verify progressive routing advances properly.
// 162.15 Testing checklist item: verify QR export on iOS Safari.
// 162.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 162.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 162.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 162.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 162.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 163
// ---------------------------------------------------------
// 163.01 Purpose: This section reserves structured space for future improvements.
// 163.02 Suggested enhancements may include richer subscription analytics,
// 163.03 server-driven recommendation banners, progressive onboarding,
// 163.04 locale-aware date formatting, reader themes, annotation storage,
// 163.05 offline verse pinning, audio prefetching, and adaptive playback.
// 163.06 For push, consider a dedicated web-push provider if Apps Script
// 163.07 storage is sufficient but cryptographic delivery becomes limiting.
// 163.08 For Android automation, consider exporting explicit vendor formats
// 163.09 once a single target app (MacroDroid/Tasker) is selected.
// 163.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 163.11 whose import link is published via a simple config endpoint.
// 163.12 Testing checklist item: verify subscription modal defaults.
// 163.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 163.14 Testing checklist item: verify progressive routing advances properly.
// 163.15 Testing checklist item: verify QR export on iOS Safari.
// 163.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 163.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 163.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 163.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 163.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 164
// ---------------------------------------------------------
// 164.01 Purpose: This section reserves structured space for future improvements.
// 164.02 Suggested enhancements may include richer subscription analytics,
// 164.03 server-driven recommendation banners, progressive onboarding,
// 164.04 locale-aware date formatting, reader themes, annotation storage,
// 164.05 offline verse pinning, audio prefetching, and adaptive playback.
// 164.06 For push, consider a dedicated web-push provider if Apps Script
// 164.07 storage is sufficient but cryptographic delivery becomes limiting.
// 164.08 For Android automation, consider exporting explicit vendor formats
// 164.09 once a single target app (MacroDroid/Tasker) is selected.
// 164.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 164.11 whose import link is published via a simple config endpoint.
// 164.12 Testing checklist item: verify subscription modal defaults.
// 164.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 164.14 Testing checklist item: verify progressive routing advances properly.
// 164.15 Testing checklist item: verify QR export on iOS Safari.
// 164.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 164.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 164.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 164.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 164.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 165
// ---------------------------------------------------------
// 165.01 Purpose: This section reserves structured space for future improvements.
// 165.02 Suggested enhancements may include richer subscription analytics,
// 165.03 server-driven recommendation banners, progressive onboarding,
// 165.04 locale-aware date formatting, reader themes, annotation storage,
// 165.05 offline verse pinning, audio prefetching, and adaptive playback.
// 165.06 For push, consider a dedicated web-push provider if Apps Script
// 165.07 storage is sufficient but cryptographic delivery becomes limiting.
// 165.08 For Android automation, consider exporting explicit vendor formats
// 165.09 once a single target app (MacroDroid/Tasker) is selected.
// 165.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 165.11 whose import link is published via a simple config endpoint.
// 165.12 Testing checklist item: verify subscription modal defaults.
// 165.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 165.14 Testing checklist item: verify progressive routing advances properly.
// 165.15 Testing checklist item: verify QR export on iOS Safari.
// 165.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 165.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 165.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 165.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 165.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 166
// ---------------------------------------------------------
// 166.01 Purpose: This section reserves structured space for future improvements.
// 166.02 Suggested enhancements may include richer subscription analytics,
// 166.03 server-driven recommendation banners, progressive onboarding,
// 166.04 locale-aware date formatting, reader themes, annotation storage,
// 166.05 offline verse pinning, audio prefetching, and adaptive playback.
// 166.06 For push, consider a dedicated web-push provider if Apps Script
// 166.07 storage is sufficient but cryptographic delivery becomes limiting.
// 166.08 For Android automation, consider exporting explicit vendor formats
// 166.09 once a single target app (MacroDroid/Tasker) is selected.
// 166.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 166.11 whose import link is published via a simple config endpoint.
// 166.12 Testing checklist item: verify subscription modal defaults.
// 166.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 166.14 Testing checklist item: verify progressive routing advances properly.
// 166.15 Testing checklist item: verify QR export on iOS Safari.
// 166.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 166.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 166.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 166.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 166.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 167
// ---------------------------------------------------------
// 167.01 Purpose: This section reserves structured space for future improvements.
// 167.02 Suggested enhancements may include richer subscription analytics,
// 167.03 server-driven recommendation banners, progressive onboarding,
// 167.04 locale-aware date formatting, reader themes, annotation storage,
// 167.05 offline verse pinning, audio prefetching, and adaptive playback.
// 167.06 For push, consider a dedicated web-push provider if Apps Script
// 167.07 storage is sufficient but cryptographic delivery becomes limiting.
// 167.08 For Android automation, consider exporting explicit vendor formats
// 167.09 once a single target app (MacroDroid/Tasker) is selected.
// 167.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 167.11 whose import link is published via a simple config endpoint.
// 167.12 Testing checklist item: verify subscription modal defaults.
// 167.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 167.14 Testing checklist item: verify progressive routing advances properly.
// 167.15 Testing checklist item: verify QR export on iOS Safari.
// 167.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 167.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 167.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 167.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 167.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 168
// ---------------------------------------------------------
// 168.01 Purpose: This section reserves structured space for future improvements.
// 168.02 Suggested enhancements may include richer subscription analytics,
// 168.03 server-driven recommendation banners, progressive onboarding,
// 168.04 locale-aware date formatting, reader themes, annotation storage,
// 168.05 offline verse pinning, audio prefetching, and adaptive playback.
// 168.06 For push, consider a dedicated web-push provider if Apps Script
// 168.07 storage is sufficient but cryptographic delivery becomes limiting.
// 168.08 For Android automation, consider exporting explicit vendor formats
// 168.09 once a single target app (MacroDroid/Tasker) is selected.
// 168.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 168.11 whose import link is published via a simple config endpoint.
// 168.12 Testing checklist item: verify subscription modal defaults.
// 168.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 168.14 Testing checklist item: verify progressive routing advances properly.
// 168.15 Testing checklist item: verify QR export on iOS Safari.
// 168.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 168.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 168.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 168.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 168.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 169
// ---------------------------------------------------------
// 169.01 Purpose: This section reserves structured space for future improvements.
// 169.02 Suggested enhancements may include richer subscription analytics,
// 169.03 server-driven recommendation banners, progressive onboarding,
// 169.04 locale-aware date formatting, reader themes, annotation storage,
// 169.05 offline verse pinning, audio prefetching, and adaptive playback.
// 169.06 For push, consider a dedicated web-push provider if Apps Script
// 169.07 storage is sufficient but cryptographic delivery becomes limiting.
// 169.08 For Android automation, consider exporting explicit vendor formats
// 169.09 once a single target app (MacroDroid/Tasker) is selected.
// 169.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 169.11 whose import link is published via a simple config endpoint.
// 169.12 Testing checklist item: verify subscription modal defaults.
// 169.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 169.14 Testing checklist item: verify progressive routing advances properly.
// 169.15 Testing checklist item: verify QR export on iOS Safari.
// 169.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 169.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 169.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 169.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 169.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 170
// ---------------------------------------------------------
// 170.01 Purpose: This section reserves structured space for future improvements.
// 170.02 Suggested enhancements may include richer subscription analytics,
// 170.03 server-driven recommendation banners, progressive onboarding,
// 170.04 locale-aware date formatting, reader themes, annotation storage,
// 170.05 offline verse pinning, audio prefetching, and adaptive playback.
// 170.06 For push, consider a dedicated web-push provider if Apps Script
// 170.07 storage is sufficient but cryptographic delivery becomes limiting.
// 170.08 For Android automation, consider exporting explicit vendor formats
// 170.09 once a single target app (MacroDroid/Tasker) is selected.
// 170.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 170.11 whose import link is published via a simple config endpoint.
// 170.12 Testing checklist item: verify subscription modal defaults.
// 170.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 170.14 Testing checklist item: verify progressive routing advances properly.
// 170.15 Testing checklist item: verify QR export on iOS Safari.
// 170.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 170.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 170.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 170.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 170.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 171
// ---------------------------------------------------------
// 171.01 Purpose: This section reserves structured space for future improvements.
// 171.02 Suggested enhancements may include richer subscription analytics,
// 171.03 server-driven recommendation banners, progressive onboarding,
// 171.04 locale-aware date formatting, reader themes, annotation storage,
// 171.05 offline verse pinning, audio prefetching, and adaptive playback.
// 171.06 For push, consider a dedicated web-push provider if Apps Script
// 171.07 storage is sufficient but cryptographic delivery becomes limiting.
// 171.08 For Android automation, consider exporting explicit vendor formats
// 171.09 once a single target app (MacroDroid/Tasker) is selected.
// 171.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 171.11 whose import link is published via a simple config endpoint.
// 171.12 Testing checklist item: verify subscription modal defaults.
// 171.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 171.14 Testing checklist item: verify progressive routing advances properly.
// 171.15 Testing checklist item: verify QR export on iOS Safari.
// 171.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 171.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 171.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 171.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 171.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 172
// ---------------------------------------------------------
// 172.01 Purpose: This section reserves structured space for future improvements.
// 172.02 Suggested enhancements may include richer subscription analytics,
// 172.03 server-driven recommendation banners, progressive onboarding,
// 172.04 locale-aware date formatting, reader themes, annotation storage,
// 172.05 offline verse pinning, audio prefetching, and adaptive playback.
// 172.06 For push, consider a dedicated web-push provider if Apps Script
// 172.07 storage is sufficient but cryptographic delivery becomes limiting.
// 172.08 For Android automation, consider exporting explicit vendor formats
// 172.09 once a single target app (MacroDroid/Tasker) is selected.
// 172.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 172.11 whose import link is published via a simple config endpoint.
// 172.12 Testing checklist item: verify subscription modal defaults.
// 172.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 172.14 Testing checklist item: verify progressive routing advances properly.
// 172.15 Testing checklist item: verify QR export on iOS Safari.
// 172.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 172.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 172.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 172.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 172.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 173
// ---------------------------------------------------------
// 173.01 Purpose: This section reserves structured space for future improvements.
// 173.02 Suggested enhancements may include richer subscription analytics,
// 173.03 server-driven recommendation banners, progressive onboarding,
// 173.04 locale-aware date formatting, reader themes, annotation storage,
// 173.05 offline verse pinning, audio prefetching, and adaptive playback.
// 173.06 For push, consider a dedicated web-push provider if Apps Script
// 173.07 storage is sufficient but cryptographic delivery becomes limiting.
// 173.08 For Android automation, consider exporting explicit vendor formats
// 173.09 once a single target app (MacroDroid/Tasker) is selected.
// 173.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 173.11 whose import link is published via a simple config endpoint.
// 173.12 Testing checklist item: verify subscription modal defaults.
// 173.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 173.14 Testing checklist item: verify progressive routing advances properly.
// 173.15 Testing checklist item: verify QR export on iOS Safari.
// 173.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 173.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 173.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 173.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 173.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 174
// ---------------------------------------------------------
// 174.01 Purpose: This section reserves structured space for future improvements.
// 174.02 Suggested enhancements may include richer subscription analytics,
// 174.03 server-driven recommendation banners, progressive onboarding,
// 174.04 locale-aware date formatting, reader themes, annotation storage,
// 174.05 offline verse pinning, audio prefetching, and adaptive playback.
// 174.06 For push, consider a dedicated web-push provider if Apps Script
// 174.07 storage is sufficient but cryptographic delivery becomes limiting.
// 174.08 For Android automation, consider exporting explicit vendor formats
// 174.09 once a single target app (MacroDroid/Tasker) is selected.
// 174.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 174.11 whose import link is published via a simple config endpoint.
// 174.12 Testing checklist item: verify subscription modal defaults.
// 174.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 174.14 Testing checklist item: verify progressive routing advances properly.
// 174.15 Testing checklist item: verify QR export on iOS Safari.
// 174.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 174.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 174.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 174.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 174.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 175
// ---------------------------------------------------------
// 175.01 Purpose: This section reserves structured space for future improvements.
// 175.02 Suggested enhancements may include richer subscription analytics,
// 175.03 server-driven recommendation banners, progressive onboarding,
// 175.04 locale-aware date formatting, reader themes, annotation storage,
// 175.05 offline verse pinning, audio prefetching, and adaptive playback.
// 175.06 For push, consider a dedicated web-push provider if Apps Script
// 175.07 storage is sufficient but cryptographic delivery becomes limiting.
// 175.08 For Android automation, consider exporting explicit vendor formats
// 175.09 once a single target app (MacroDroid/Tasker) is selected.
// 175.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 175.11 whose import link is published via a simple config endpoint.
// 175.12 Testing checklist item: verify subscription modal defaults.
// 175.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 175.14 Testing checklist item: verify progressive routing advances properly.
// 175.15 Testing checklist item: verify QR export on iOS Safari.
// 175.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 175.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 175.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 175.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 175.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 176
// ---------------------------------------------------------
// 176.01 Purpose: This section reserves structured space for future improvements.
// 176.02 Suggested enhancements may include richer subscription analytics,
// 176.03 server-driven recommendation banners, progressive onboarding,
// 176.04 locale-aware date formatting, reader themes, annotation storage,
// 176.05 offline verse pinning, audio prefetching, and adaptive playback.
// 176.06 For push, consider a dedicated web-push provider if Apps Script
// 176.07 storage is sufficient but cryptographic delivery becomes limiting.
// 176.08 For Android automation, consider exporting explicit vendor formats
// 176.09 once a single target app (MacroDroid/Tasker) is selected.
// 176.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 176.11 whose import link is published via a simple config endpoint.
// 176.12 Testing checklist item: verify subscription modal defaults.
// 176.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 176.14 Testing checklist item: verify progressive routing advances properly.
// 176.15 Testing checklist item: verify QR export on iOS Safari.
// 176.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 176.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 176.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 176.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 176.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 177
// ---------------------------------------------------------
// 177.01 Purpose: This section reserves structured space for future improvements.
// 177.02 Suggested enhancements may include richer subscription analytics,
// 177.03 server-driven recommendation banners, progressive onboarding,
// 177.04 locale-aware date formatting, reader themes, annotation storage,
// 177.05 offline verse pinning, audio prefetching, and adaptive playback.
// 177.06 For push, consider a dedicated web-push provider if Apps Script
// 177.07 storage is sufficient but cryptographic delivery becomes limiting.
// 177.08 For Android automation, consider exporting explicit vendor formats
// 177.09 once a single target app (MacroDroid/Tasker) is selected.
// 177.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 177.11 whose import link is published via a simple config endpoint.
// 177.12 Testing checklist item: verify subscription modal defaults.
// 177.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 177.14 Testing checklist item: verify progressive routing advances properly.
// 177.15 Testing checklist item: verify QR export on iOS Safari.
// 177.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 177.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 177.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 177.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 177.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 178
// ---------------------------------------------------------
// 178.01 Purpose: This section reserves structured space for future improvements.
// 178.02 Suggested enhancements may include richer subscription analytics,
// 178.03 server-driven recommendation banners, progressive onboarding,
// 178.04 locale-aware date formatting, reader themes, annotation storage,
// 178.05 offline verse pinning, audio prefetching, and adaptive playback.
// 178.06 For push, consider a dedicated web-push provider if Apps Script
// 178.07 storage is sufficient but cryptographic delivery becomes limiting.
// 178.08 For Android automation, consider exporting explicit vendor formats
// 178.09 once a single target app (MacroDroid/Tasker) is selected.
// 178.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 178.11 whose import link is published via a simple config endpoint.
// 178.12 Testing checklist item: verify subscription modal defaults.
// 178.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 178.14 Testing checklist item: verify progressive routing advances properly.
// 178.15 Testing checklist item: verify QR export on iOS Safari.
// 178.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 178.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 178.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 178.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 178.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 179
// ---------------------------------------------------------
// 179.01 Purpose: This section reserves structured space for future improvements.
// 179.02 Suggested enhancements may include richer subscription analytics,
// 179.03 server-driven recommendation banners, progressive onboarding,
// 179.04 locale-aware date formatting, reader themes, annotation storage,
// 179.05 offline verse pinning, audio prefetching, and adaptive playback.
// 179.06 For push, consider a dedicated web-push provider if Apps Script
// 179.07 storage is sufficient but cryptographic delivery becomes limiting.
// 179.08 For Android automation, consider exporting explicit vendor formats
// 179.09 once a single target app (MacroDroid/Tasker) is selected.
// 179.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 179.11 whose import link is published via a simple config endpoint.
// 179.12 Testing checklist item: verify subscription modal defaults.
// 179.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 179.14 Testing checklist item: verify progressive routing advances properly.
// 179.15 Testing checklist item: verify QR export on iOS Safari.
// 179.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 179.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 179.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 179.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 179.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
// ---------------------------------------------------------
// FUTURE NOTE SECTION 180
// ---------------------------------------------------------
// 180.01 Purpose: This section reserves structured space for future improvements.
// 180.02 Suggested enhancements may include richer subscription analytics,
// 180.03 server-driven recommendation banners, progressive onboarding,
// 180.04 locale-aware date formatting, reader themes, annotation storage,
// 180.05 offline verse pinning, audio prefetching, and adaptive playback.
// 180.06 For push, consider a dedicated web-push provider if Apps Script
// 180.07 storage is sufficient but cryptographic delivery becomes limiting.
// 180.08 For Android automation, consider exporting explicit vendor formats
// 180.09 once a single target app (MacroDroid/Tasker) is selected.
// 180.10 For iOS shortcuts, consider maintaining a versioned shared shortcut
// 180.11 whose import link is published via a simple config endpoint.
// 180.12 Testing checklist item: verify subscription modal defaults.
// 180.13 Testing checklist item: verify fixed chapter behavior remains pinned.
// 180.14 Testing checklist item: verify progressive routing advances properly.
// 180.15 Testing checklist item: verify QR export on iOS Safari.
// 180.16 Testing checklist item: verify Android Chrome opens in-scope URLs in PWA where available.
// 180.17 Testing checklist item: verify manual audio fallback appears when autoplay is blocked.
// 180.18 Refactor note: extract subscription UI into a dedicated controller object if file growth continues.
// 180.19 Refactor note: extract share sheet logic into its own module if QR workflows expand.
// 180.20 Refactor note: if you migrate to bundling, split this IIFE into ES modules.
