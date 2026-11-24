// 予定の保存と同期。
// ・Firebase 設定あり → Firestore にリアルタイム同期（誰かが保存すると数秒で全員の画面に反映）
// ・設定なし → この端末のブラウザーに保存（同じ端末の別タブには即時反映）
const FB_VER = "10.12.2";
const LOCAL_KEY = "famcal.events.v1";

export function familyCode() {
  try { return localStorage.getItem("famcal.familyCode") || ""; } catch { return ""; }
}
export function setFamilyCode(code) {
  try { localStorage.setItem("famcal.familyCode", code); } catch {}
}
export function newFamilyCode() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const rnd = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(rnd, n => abc[n % abc.length]).join("");
  return `fam-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * @param {{onEvents:(list:object[], changes:object[])=>void, onStatus:(s:{mode:string, state:string, text:string})=>void}} h
 */
export async function createStore(h) {
  const cfg = window.FAMCAL_FIREBASE;
  if (cfg && cfg.projectId) {
    const code = familyCode();
    if (!code) {
      h.onStatus({ mode: "firebase", state: "needs-code", text: "家族コードが未設定です" });
      return localStore(h, true);
    }
    try {
      return await firebaseStore(cfg, code, h);
    } catch (err) {
      console.error(err);
      h.onStatus({ mode: "firebase", state: "error", text: "同期に接続できません（端末に一時保存中）" });
      return localStore(h, true);
    }
  }
  return localStore(h, false);
}

function localStore(h, quiet) {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
  };
  const write = map => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(map)); } catch {} };
  let ch = null;
  try { ch = new BroadcastChannel("famcal"); } catch {}
  const emit = changes => h.onEvents(Object.values(read()).filter(e => !e.deleted), changes || []);
  if (ch) ch.onmessage = e => emit(e.data ? [e.data] : []);
  window.addEventListener("storage", e => { if (e.key === LOCAL_KEY) emit([]); });
  if (!quiet) h.onStatus({ mode: "local", state: "ok", text: "お試しモード（この端末だけ）" });
  emit([]);
  return {
    mode: "local",
    async save(ev) {
      const map = read();
      map[ev.id] = { ...ev, updatedAt: Date.now() };
      write(map); emit([]);
      if (ch) ch.postMessage({ type: "modified", ev: map[ev.id] });
    },
    async remove(id) {
      const map = read();
      delete map[id];
      write(map); emit([]);
      if (ch) ch.postMessage(null);
    },
  };
}

async function firebaseStore(cfg, code, h) {
  h.onStatus({ mode: "firebase", state: "connecting", text: "同期に接続中…" });
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const a = auth.getAuth(app);
  await auth.signInAnonymously(a);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }
  const col = fs.collection(db, "families", code, "events");
  let first = true;
  fs.onSnapshot(col, { includeMetadataChanges: true }, snap => {
    const list = snap.docs.map(d => {
      const v = d.data();
      const t = v.updatedAt && v.updatedAt.toMillis ? v.updatedAt.toMillis() : Date.now();
      return { ...v, id: d.id, updatedAt: t };
    });
    const changes = first ? [] : snap.docChanges()
      .filter(c => !c.doc.metadata.hasPendingWrites)
      .map(c => ({ type: c.type, ev: { ...c.doc.data(), id: c.doc.id } }));
    first = false;
    h.onEvents(list, changes);
    h.onStatus({
      mode: "firebase",
      state: snap.metadata.fromCache ? "offline" : "ok",
      text: snap.metadata.fromCache ? "オフライン（つながると自動で同期）" : "家族と同期中",
    });
  }, err => {
    console.error(err);
    h.onStatus({ mode: "firebase", state: "error", text: "同期エラー：" + (err.code || err.message) });
  });
  return {
    mode: "firebase",
    async save(ev) {
      const { id, updatedAt, ...rest } = ev;
      const data = JSON.parse(JSON.stringify(rest)); // undefined を取り除く
      await fs.setDoc(fs.doc(col, id), { ...data, updatedAt: fs.serverTimestamp() });
    },
    async remove(id) {
      await fs.deleteDoc(fs.doc(col, id));
    },
  };
}
