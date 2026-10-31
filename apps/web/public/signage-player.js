(() => {
  "use strict";
  const VERSION = "0.3.3";
  const CONNECTION_KEY = "smart-church-signage-connection";
  const screen = document.getElementById("screen");
  const status = document.getElementById("status");
  const setup = document.getElementById("setup");
  const pairError = document.getElementById("pair-error");
  const pairButton = document.getElementById("pair-button");
  const pendingKey="smart-church-signage-pending"; let pairingPending=null,pairingBusy=false,pairingTimer;
  const boot = performance.now();
  const memory = new Map();
  const controllers = new Set();
  let credentials = null, plan = null, offset = 0, syncing = false;
  let progress = 0, networkError = "", storageError = "", playbackError = "";
  let currentKey = "", currentShow = null, slideIndex = 0, slideTimer, mediaUrl = "";
  let databasePromise;
  // TV browsers can run async functions but lack newer DOM and Blob methods.
  function replaceScreen(...children) {
    while (screen.firstChild) screen.removeChild(screen.firstChild);
    children.forEach(child => screen.appendChild(child));
  }
  function blobBytes(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not read downloaded media."));
      reader.readAsArrayBuffer(blob);
    });
  }
  try { credentials = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null"); } catch {}
  if (credentials && (!credentials.displayId || !credentials.departmentId || !/^sc_[A-Za-z0-9_-]{40,60}$/.test(credentials.apiKey || ""))) credentials = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/signage-sw.js").catch(() => {});

  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const open = indexedDB.open("smart-church-signage", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("cache");
      open.onsuccess = () => { open.result.onversionchange = () => open.result.close(); resolve(open.result); };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("Close other display tabs and try again."));
    });
    return databasePromise;
  }
  async function cache(operation, key, value) {
    try {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("cache", operation === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore("cache");
        const result = operation === "get" ? store.get(key) : operation === "delete" ? store.delete(key) : store.put(value, key);
        tx.oncomplete = () => resolve(result.result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("Local storage failed."));
      });
    } catch (error) {
      storageError = "Offline storage unavailable: " + error.message;
      return undefined;
    }
  }
  async function prune(displayId, keep = new Set()) {
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("cache", "readwrite"), store = tx.objectStore("cache"), cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (typeof entry.key === "string" && entry.key.startsWith(displayId + ":") && !keep.has(entry.key)) entry.delete();
          entry.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } catch {}
  }
  function text(heading, body = "") {
    screen.className = "";
    const h = document.createElement("h1"), p = document.createElement("p");
    h.textContent = heading; p.textContent = body;
    replaceScreen(h, p);
    requestAnimationFrame(() => {
      if (!h.isConnected) return;
      for (let attempt=0;attempt<24 && (screen.scrollHeight>screen.clientHeight || screen.scrollWidth>screen.clientWidth);attempt++) {
        for (const node of [h,p]) node.style.fontSize=Math.max(10,parseFloat(getComputedStyle(node).fontSize)*0.9)+"px";
      }
    });
  }
  function stopPlayback() {
    clearTimeout(slideTimer);
    currentShow = null; currentKey = ""; slideIndex = 0;
    if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = ""; }
    replaceScreen();
  }
  async function disconnect(reason = "") {
    const previous = credentials;
    credentials = null; plan = null;
    controllers.forEach(controller => controller.abort());
    stopPlayback(); memory.clear();
    try { localStorage.removeItem(CONNECTION_KEY); } catch {}
    setup.hidden = false; pairError.textContent = reason;
    text("Display disconnected"); status.textContent = "Pair this screen to continue";
    if (previous) await prune(previous.displayId);
    void beginPairing();
  }
  document.getElementById("disconnect").onclick = () => { if (confirm("Disconnect this screen?")) void disconnect(); };
  async function fetchTimed(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
      // Keep the timeout active while reading the body, not only until headers arrive.
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      throw new Error(error.name === "AbortError" ? "The connection timed out. Retrying automatically." : error.message);
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function api(path, options = {}, connection = credentials) {
    if (!connection) throw new Error("Display is disconnected.");
    const response = await fetchTimed("/api/signage/device/" + connection.displayId + path, {
      ...options,
      headers: { Authorization: "Bearer " + connection.apiKey, "x-department-id": connection.departmentId,
        ...(options.body ? { "Content-Type": "application/json" } : {}) },
    }, path.startsWith("/media/") ? 120000 : 20000);
    if (response.status === 401 || (response.status === 403 && !path.startsWith("/media/"))) {
      if (credentials === connection) await disconnect("Access was revoked. Generate a new pairing code.");
      throw new Error("Display access revoked.");
    }
    if (response.status === 404 && path === "/plan" && credentials === connection) {
      plan = null; stopPlayback(); text("Display unavailable", "Waiting for the administrator to enable this display.");
      await cache("delete", connection.displayId + ":plan:");
    }
    if (!response.ok) {
      let message = "Server returned " + response.status;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response;
  }
  function validPlan(candidate) {
    try {
    if (!candidate || !Array.isArray(candidate.shows) || !Array.isArray(candidate.schedules) ||
        !Number.isFinite(Date.parse(candidate.validUntil)) || !Number.isFinite(Date.parse(candidate.serverTime))) return false;
    const media = new Map((candidate.media || []).map(item => [item.id, item]));
    return candidate.shows.every(show => typeof show.id === "string" && Array.isArray(show.slides) &&
      show.slides.length > 0 && show.slides.length <= 50 && show.slides.every(slide =>
        (!slide.duration || Number.isInteger(slide.duration) && slide.duration >= 3 && slide.duration <= 600) &&
        (!slide.mediaId || media.has(slide.mediaId)))) &&
      [...media.values()].every(item => Number.isInteger(item.size) && item.size > 0 && item.size <= 104857600 && /^[a-f0-9]{64}$/.test(item.sha256));
    } catch { return false; }
  }
  async function verified(blob, asset) {
    if (!(blob instanceof Blob) || blob.size !== asset.size) return false;
    if (window.crypto && window.crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", await blobBytes(blob));
      if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") !== asset.sha256) return false;
    }
    return true;
  }
  async function synchronize() {
    if (!credentials || syncing) return;
    const connection = credentials;
    syncing = true;
    try {
      const next = await (await api("/plan", {}, connection)).json();
      const nextOffset = Date.parse(next.serverTime) - Date.now();
      if (!validPlan(next)) throw new Error("The playback plan is invalid. Retrying automatically.");
      if (credentials !== connection) return;
      const assets = next.media || [];
      let persisted = true;
      if (assets.reduce((total, asset) => total + asset.size, 0) > 512 * 1024 * 1024)
        throw new Error("This display's seven-day media plan exceeds 512 MB. Reduce its scheduled media.");
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i], key = connection.displayId + ":media:" + asset.id;
        if (credentials !== connection) return;
        let cached = memory.get(key);
        if (!cached || cached.sha256 !== asset.sha256) {
          cached = await cache("get", key);
          let blob = cached instanceof Blob ? cached : (cached && cached.blob);
          if (!await verified(blob, asset)) {
            progress = Math.round(i / Math.max(1, assets.length) * 100);
            blob = await (await api("/media/" + asset.id, {}, connection)).blob();
            if (!await verified(blob, asset)) throw new Error("A media download failed its integrity check. Retrying automatically.");
          }
          if (credentials !== connection) return;
          cached = { blob, sha256: asset.sha256 };
          memory.set(key, cached);
          cached.persisted = await cache("set", key, cached) !== undefined;
        }
        if (!cached.persisted) { cached.persisted = await cache("set", key, cached) !== undefined; }
        persisted = persisted && cached.persisted;
        progress = Math.round((i + 1) / Math.max(1, assets.length) * 100);
      }
      if (credentials !== connection) return;
      const record = { plan: next, offset: nextOffset };
      if (persisted) persisted = await cache("set", connection.displayId + ":plan:", record) !== undefined;
      if (credentials !== connection) return;
      plan = next; offset = nextOffset; progress = 100; networkError = "";
      status.textContent = storageError ? "Connected · offline storage unavailable" : "Connected";
      await selectPlayback();
      const keep = new Set([connection.displayId + ":plan:", ...assets.map(asset => connection.displayId + ":media:" + asset.id)]);
      if (persisted) await prune(connection.displayId, keep);
      for (const key of memory.keys()) if (!keep.has(key)) memory.delete(key);
    } catch (error) {
      if (credentials !== connection) return;
      networkError = error.message;
      status.textContent = plan ? "Offline · playing downloaded content" : "Waiting for connection";
    } finally { syncing = false; }
  }
  async function selectPlayback() {
    if (!credentials || !plan) return;
    const now = Date.now() + offset;
    if (now >= Date.parse(plan.validUntil)) {
      stopPlayback(); text("Waiting for an updated schedule"); return;
    }
    const schedule = plan.schedules.find(item => Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now);
    const show = plan.shows.find(item => item.id === (schedule ? schedule.showId : plan.defaultShowId));
    const key = show ? show.id + ":" + show.revision : "blank";
    if (key === currentKey) return;
    stopPlayback(); currentKey = key; currentShow = show || null;
    if (show) await renderSlide(); else text("", "");
  }
  async function renderSlide() {
    clearTimeout(slideTimer);
    if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = ""; }
    const show = currentShow, connection = credentials;
    if (!show || !connection) return;
    const slide = show.slides[slideIndex];
    if (!slide) return;
    try {
      if (slide.mediaId) {
        const key = connection.displayId + ":media:" + slide.mediaId;
        const cached = memory.get(key) || await cache("get", key);
        const blob = cached instanceof Blob ? cached : (cached && cached.blob);
        if (currentShow !== show || credentials !== connection) return;
        const asset = (plan.media || []).find(item => item.id === slide.mediaId);
        if (!asset || ((memory.get(key) && memory.get(key).sha256) !== asset.sha256 && !await verified(blob, asset))) throw new Error("A cached media file is missing or corrupt. Waiting for a new download.");
        if (!memory.has(key)) memory.set(key, { blob, sha256: asset.sha256, persisted: true });
        mediaUrl = URL.createObjectURL(blob);
        const element = document.createElement(slide.kind === "video" ? "video" : "img");
        element.src = mediaUrl;
        if (slide.kind === "video") {
          element.muted = true; element.autoplay = true; element.loop = true; element.playsInline = true;
          element.onerror = () => { playbackError = "This video cannot be played by this browser."; };
        } else { element.alt = slide.heading || ""; element.onerror = () => { playbackError = "This image cannot be displayed."; }; }
        screen.className = "media"; replaceScreen(element);
      } else text(slide.heading || "", slide.body || "");
      playbackError = "";
    } catch (error) { playbackError = error.message; text("Content is downloading", "Playback will resume automatically."); }
    slideTimer = setTimeout(() => {
      if (currentShow === show) { slideIndex = (slideIndex + 1) % show.slides.length; void renderSlide(); }
    }, (slide.duration || 12) * 1000);
  }
  let reporting = false;
  async function heartbeat() {
    if (!credentials || reporting) return;
    reporting = true;
    try {
      await api("/heartbeat", { method: "POST", body: JSON.stringify({
        installationType: /Electron/i.test(navigator.userAgent) ? "Windows app" : matchMedia("(display-mode: standalone)").matches ? "Installed browser" : "Browser",
        uptimeSeconds: Math.floor((performance.now() - boot) / 1000), playerVersion: VERSION,
        currentShowId: (currentShow && currentShow.id) || "", playbackError: [playbackError, storageError, networkError].filter(Boolean).join(" · ").slice(0, 1000),
        downloadProgress: progress,
      }) });
    } catch {} finally { reporting = false; }
  }
  function showPairing() {
    setup.hidden=false;
    if (/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test((pairingPending && pairingPending.code) || "")) {
      const bookmarkPath = "/signage-display.html/" + pairingPending.code;
      try { if (location.pathname !== bookmarkPath) history.replaceState(null, "", bookmarkPath); } catch {}
    }
    document.getElementById("pair-code").textContent=(pairingPending && pairingPending.code) || "Connecting…";
    const minutes=pairingPending?Math.max(0,Math.ceil((Date.parse(pairingPending.expiresAt)-Date.now())/60000)):0;
    document.getElementById("pair-expiry").textContent=minutes?"Code expires in "+minutes+" minute"+(minutes===1?"":"s")+".":"Waiting for a new code.";
  }
  async function beginPairing() {
    if(credentials||pairingBusy)return;
    clearTimeout(pairingTimer);pairingBusy=true;pairButton.disabled=true;
    try{
      if(!pairingPending){try{pairingPending=JSON.parse(localStorage.getItem(pendingKey)||"null");}catch{}}
      if(!pairingPending || !/^[A-Za-z0-9_-]{43}$/.test(pairingPending.pairingToken||'') || !/^sc_[A-Za-z0-9_-]{43}$/.test(pairingPending.apiKey||'') || !Number.isFinite(Date.parse(pairingPending.expiresAt)) || Date.parse(pairingPending.expiresAt)<=Date.now()){
        const response=await fetchTimed("/api/public/signage/pairing/start",{method:"POST"});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not create a screen code.");
        pairingPending=result;
        try{localStorage.setItem(pendingKey,JSON.stringify(result));}catch{storageError="This browser cannot save its connection. Enable site storage.";}
      }
      pairError.textContent="";showPairing();
    }catch(error){pairError.textContent=error.message;showPairing();}
    finally{pairingBusy=false;pairButton.disabled=false;pairingTimer=setTimeout(pollPairing,3000);}
  }
  async function pollPairing(){
    if(credentials||pairingBusy)return;
    if(!pairingPending||Date.parse(pairingPending.expiresAt)<=Date.now()){pairingPending=null;return beginPairing();}
    pairingBusy=true;
    try{
      const response=await fetchTimed("/api/public/signage/pairing/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pairingToken:pairingPending.pairingToken})});
      if(response.status===410){pairingPending=null;try{localStorage.removeItem(pendingKey);}catch{}return;}
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Waiting for connection.");
      if(result.status==="connected"){
        const connection={displayId:result.displayId,departmentId:result.departmentId,apiKey:pairingPending.apiKey};
        try { localStorage.setItem(CONNECTION_KEY,JSON.stringify(connection));localStorage.removeItem(pendingKey); }
        catch { storageError="This browser cannot save its connection. Enable site storage. Pair again after restarting."; }
        credentials=connection;pairingPending=null;plan=null;currentKey="";setup.hidden=true;pairError.textContent="";
        if((navigator.storage && navigator.storage.persist))void navigator.storage.persist().catch(()=>{});
        await synchronize();void heartbeat();return;
      }
      pairError.textContent="";
    }catch(error){pairError.textContent=error.message;}
    finally{pairingBusy=false;if(!credentials)pairingTimer=setTimeout(()=>pairingPending?pollPairing():beginPairing(),3000);}
  }
  pairButton.onclick=()=>{if(pairingBusy)return;pairingPending=null;try{localStorage.removeItem(pendingKey);}catch{}void beginPairing();};
  async function start() {
    text("Connecting…");
    if (!credentials) {void beginPairing();return;}
    setup.hidden = true;
    const saved = await cache("get", credentials.displayId + ":plan:");
    if (saved && validPlan(saved.plan) && Number.isFinite(saved.offset)) {
      plan = saved.plan; offset = saved.offset;
      await selectPlayback();
    }
    await synchronize(); void heartbeat();
  }
  addEventListener("online", () => { void synchronize(); void heartbeat(); });
  addEventListener("resize", () => { if(currentShow && !(currentShow.slides[slideIndex] && currentShow.slides[slideIndex].mediaId))void renderSlide(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { void selectPlayback(); void synchronize(); } });
  void start();
  setInterval(() => void synchronize(), 30000);
  setInterval(() => void heartbeat(), 30000);
  setInterval(() => {void selectPlayback();if(!credentials)showPairing();}, 1000);
})();
