// Thin wrapper over the YouTube Playables SDK (window.ytgame). Every call is guarded so the game
// also runs locally / on any static host, where it falls back to localStorage.
// Outside YouTube the SDK object exists but is inactive (IN_PLAYABLES_ENV is false), so treat it as absent.
const yt = () => {
  const sdk = typeof window !== 'undefined' ? window.ytgame : undefined;
  return sdk && sdk.IN_PLAYABLES_ENV ? sdk : undefined;
};
const KEY = 'nova-skim-save';

const platform = {
  data: {},

  async init() {
    try {
      const raw = yt()?.game?.loadData ? await yt().game.loadData() : localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      this.data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      this.data = {};
    }
  },

  save(patch) {
    Object.assign(this.data, patch);
    const raw = JSON.stringify(this.data);
    try {
      if (yt()?.game?.saveData) yt().game.saveData(raw);
      else localStorage.setItem(KEY, raw);
    } catch { /* saving is best-effort */ }
  },

  firstFrameReady() { try { yt()?.game?.firstFrameReady(); } catch { /* noop */ } },
  gameReady() { try { yt()?.game?.gameReady(); } catch { /* noop */ } },
  sendScore(value) { try { yt()?.engagement?.sendScore({ value: Math.max(0, Math.floor(value)) }); } catch { /* noop */ } },

  isAudioEnabled() {
    try { return yt()?.system?.isAudioEnabled?.() ?? true; } catch { return true; }
  },
  onAudioChange(cb) { try { yt()?.system?.onAudioEnabledChange?.(cb); } catch { /* noop */ } },
  onPause(cb) { try { yt()?.system?.onPause?.(cb); } catch { /* noop */ } },
  onResume(cb) { try { yt()?.system?.onResume?.(cb); } catch { /* noop */ } },
};

export default platform;
