/* SmartFlix — application logic (talks to the Flask hybrid-recommender API) */
(function () {
  "use strict";
  const { $, $$, clamp, lerp } = FX;
  const HUE = { Tamil: 28, Hindi: 340, Telugu: 12, Malayalam: 160, Kannada: 48, Bengali: 200, Marathi: 280, English: 215 };
  const GLYPH = { Tamil: "த", Hindi: "हि", Telugu: "తె", Malayalam: "മ", Kannada: "ಕ", Bengali: "বা", Marathi: "म", English: "En" };
  const RADAR_AXES = ["Action", "Drama", "Comedy", "Romance", "Thriller", "Sci-Fi", "Crime", "Fantasy"];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const S = {
    meta: null, movies: new Map(),
    ratings: store.get("sf_ratings", {}), alpha: store.get("sf_alpha", 0.4), diversity: store.get("sf_div", 0.25),
    deck: [], deckFetching: false, recs: [], recLangs: [], recY: [null, null], recReq: 0,
    uni: { langs: [], genres: [], y0: null, y1: null, sort: "popular", q: "", offset: 0, total: 0, loading: false },
    labData: null, labMode: "methods",
  };
  const api = (p, o) => fetch(p, o).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const remember = list => list.forEach(m => S.movies.set(m.id, m));
  const ratedCount = () => Object.keys(S.ratings).length;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

  /* =============== LOADER =============== */
  function runLoader(getProgress) {
    const num = $("#ldNum"), arc = $("#ldArc"); let n = 3; num.textContent = n;
    const iv = setInterval(() => { n = Math.max(1, n - 1); num.textContent = n; }, 750);
    const t0 = performance.now();
    return { stop() { clearInterval(iv); }, tick() { const p = clamp(Math.max(getProgress(), (performance.now() - t0) / 2400) , 0, 1); arc.style.strokeDashoffset = 754 * (1 - p); return p; } };
  }

  /* =============== HERO WALL / MARQUEE / PIPELINE =============== */
  function buildWall(list) {
    const wall = $("#wall"); const cols = 7; wall.innerHTML = "";
    for (let c = 0; c < cols; c++) {
      const mine = list.filter((_, i) => i % cols === c).slice(0, 9); if (!mine.length) continue;
      const html = mine.map(m => `<div class="wp">${SFposter.html(m)}</div>`).join("");
      const col = document.createElement("div"); col.className = "wcol"; col.innerHTML = html + html; wall.appendChild(col);
    }
  }
  function buildMarquee() {
    const L = S.meta.languages;
    const one = L.map(l => `<span class="mi">${l.name}<sup>${l.count}</sup></span>`).join("");
    const two = [...L].reverse().map(l => `<span class="mi">${l.name}</span>`).join("");
    $("#mrow1").innerHTML = one.repeat(4); $("#mrow2").innerHTML = two.repeat(4);
  }
  function buildPipeline() {
    const cells = n => Array.from({ length: n }, (_, i) => `<i style="--i:${i}"></i>`).join("");
    const bars = Array.from({ length: 8 }, (_, i) => `<i style="--i:${i};--h:${30 + (i * 37) % 60};--g:${95 - (i * 37) % 70}"></i>`).join("");
    const rank = [92, 80, 71, 58, 44].map((w, i) => `<i style="--i:${i};--w:${w}"></i>`).join("");
    const P = [
      ["MovieLens dataset", "Movie metadata and user–movie ratings in MovieLens format. A working subset keeps training light enough for a student laptop — scale up to MovieLens 32M with one script.", `<div class="v-db">${cells(4)}</div>`],
      ["Data preprocessing", "Clean titles and years, join movies with ratings, map ids and build the sparse user × item matrix the collaborative engine needs.", `<div class="v-gear"></div>`],
      ["Feature extraction", "Each film becomes a TF-IDF vector over genres, language, director, cast and plot words. Cosine similarity then measures how alike any two films are.", `<div class="v-tfidf">${cells(36)}</div>`],
      ["Content + collaborative", "Content-based: “more like the films you loved”. Collaborative: item-based CF on mean-centred ratings — “viewers who rated like you also loved…”.", `<div class="v-venn"><i></i><i></i></div>`],
      ["Hybrid recommendation engine", "Both scores are min-max normalised and blended. α slides the engine between pure content (α = 1) and pure collaborative (α = 0). Try the dial in Your Reel.", `<div class="eqbox">H(u,i) = <span>α</span>·<i>C(u,i)</i><br>+ (1 − <span>α</span>)·<u>F(u,i)</u></div>`],
      ["Top-N movie ranking", "Candidates you haven't rated are ranked by hybrid score, then re-ranked with Maximal Marginal Relevance so the list is accurate and varied.", `<div class="v-rank">${rank}</div>`],
      ["SmartFlix interface", "You are here. Every swipe, star and dial turn is sent to the Flask API and the ranking is recomputed instantly.", `<div class="v-ui">${cells(8)}</div>`],
    ];
    const intro = `<div class="panel intro"><p class="serif">A seven-stage pipeline.</p><p>Scroll sideways through the architecture from the project report — from raw MovieLens data to the interface under your cursor.</p></div>`;
    $("#howTrack").innerHTML = intro + P.map((p, i) => `<div class="panel"><div class="pn-n">0${i + 1}</div><div class="pn-v">${p[2]}</div><div><h3 class="pn-t">${p[0]}</h3><p class="pn-b">${p[1]}</p></div></div>`).join("") + `<div style="flex:0 0 12vw"></div>`;
  }

  /* =============== RATINGS STATE =============== */
  const afterRatings = debounce(() => { refreshTaste(); loadRecs(); }, 380);
  function setRating(id, v) {
    if (v == null) delete S.ratings[id]; else S.ratings[id] = v;
    store.set("sf_ratings", S.ratings); updateCounts(); afterRatings();
    $$(`.pc[data-id="${id}"]`).forEach(el => el.classList.toggle("rated", v != null));
  }
  function updateCounts() {
    const n = ratedCount(); $("#dnaCount").textContent = n + " rated";
    $("#igArc").style.strokeDashoffset = 327 * (1 - Math.min(n / 5, 1));
    const ig = $("#ignite"); ig.classList.toggle("lit", n >= 3);
    $("#igTxt").textContent = n < 3 ? `RATE ${3 - n} MORE` : n < 8 ? "IGNITE THE REEL" : "REEL IS HOT";
    $("#igSub").textContent = n < 3 ? "to ignite the engine" : "tap to see your top picks";
  }

  /* =============== TASTE DNA =============== */
  const dna = { cur: RADAR_AXES.map(() => 0), tgt: RADAR_AXES.map(() => 0) };
  function buildRadar() {
    const svg = $("#radar"), R = 100, n = RADAR_AXES.length; let h = "";
    [.25, .5, .75, 1].forEach(k => { h += `<polygon class="rg" points="${RADAR_AXES.map((_, i) => pt(i, n, R * k)).join(" ")}"/>`; });
    RADAR_AXES.forEach((a, i) => { const [x, y] = pt(i, n, R).split(",").map(Number), [lx, ly] = pt(i, n, R + 17).split(",").map(Number);
      h += `<line class="ax" x1="0" y1="0" x2="${x}" y2="${y}"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${a.toUpperCase()}</text>`; });
    svg.innerHTML = h + `<polygon class="shape" id="shape" points="${RADAR_AXES.map(() => "0,0").join(" ")}"/>`;
    FX.onTick(() => {
      let moved = false; dna.cur = dna.cur.map((v, i) => { const nv = lerp(v, dna.tgt[i], .09); if (Math.abs(nv - dna.tgt[i]) > .001) moved = true; return nv; });
      if (moved || dna._d) { $("#shape").setAttribute("points", dna.cur.map((v, i) => pt(i, n, R * (.06 + .94 * v))).join(" ")); dna._d = moved; }
    });
  }
  const pt = (i, n, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; };
  async function refreshTaste() {
    if (!ratedCount()) { dna.tgt = RADAR_AXES.map(() => 0); dna._d = true; $("#langbars").innerHTML = '<span class="mono tiny">no signal yet — swipe a few films</span>'; return; }
    try {
      const t = await post("/api/taste", { ratings: S.ratings });
      dna.tgt = RADAR_AXES.map(a => t.genres[a] || 0); dna._d = true;
      const top = Object.entries(t.languages).slice(0, 4);
      $("#langbars").innerHTML = top.map(([l, v]) => `<div class="lb"><span>${l}</span><u data-w="${Math.round(v * 100)}"></u></div>`).join("");
      requestAnimationFrame(() => requestAnimationFrame(() => $$("#langbars u").forEach(u => u.style.width = u.dataset.w + "%")));
    } catch (e) { /* offline */ }
  }

  /* =============== TASTE ORBIT (personas) =============== */
  function buildOrbit() {
    const orbit = $("#orbit"), core = $("#orbitCore"); $$(".persona", orbit).forEach(e => e.remove());
    const P = S.meta.personas, r = orbit.clientWidth / 2;
    P.forEach((p, i) => {
      const el = document.createElement("div"); el.className = "persona"; el.dataset.key = p.key; el.dataset.cursor = "IGNITE";
      el.style.cssText = `--a:${i * 360 / P.length};--r:${r};--h:${p.hue}`; el.innerHTML = `<div class="pdot"><span>${p.name[0]}</span></div>`;
      el.addEventListener("pointerenter", () => { core.classList.add("show"); core.innerHTML = `<b>${esc(p.name)}</b><span>${esc(p.tagline)}</span>`; });
      el.addEventListener("pointerleave", () => { core.classList.remove("show"); core.innerHTML = "<b>TASTE</b><span>ORBIT</span>"; });
      el.addEventListener("click", () => seedPersona(p, el));
      orbit.appendChild(el);
    });
  }
  async function seedPersona(p, el) {
    el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
    try {
      const d = await api(`/api/personas/${p.key}/seed`); remember(d.items);
      Object.entries(d.ratings).forEach(([id, v]) => { S.ratings[id] = v; });
      store.set("sf_ratings", S.ratings); S.deck = S.deck.filter(m => !(m.id in S.ratings)); resetDeckDom(); updateCounts(); afterRatings();
      toast(`${p.name} · ${Object.keys(d.ratings).length} films added to your taste`);
    } catch (e) { toast("Backend not reachable"); }
  }

  /* =============== SWIPE DECK =============== */
  const deckEl = () => $("#deck");
  function cardEl(m) {
    const el = document.createElement("div"); el.className = "dcard snap"; el.dataset.id = m.id;
    el.innerHTML = `${SFposter.html(m)}<div class="stamp love">LOVE</div><div class="stamp like">LIKE</div><div class="stamp nope">NOPE</div>
      <div class="dc-info"><div><b>${esc(m.title)}</b>${m.year} · ${esc(m.language)}</div><span>${esc(m.genres[0] || "")}</span></div>`;
    return el;
  }
  function layoutDeck() {
    const els = [...deckEl().children].reverse().filter(c => !c._busy);
    els.forEach((el, d) => { el.style.transition = ""; if (d === 0) { el.dataset.top = "1"; } else delete el.dataset.top;
      if (!el._drag) { el.style.transform = `translateY(${d * 16}px) scale(${1 - d * .05})`; el.style.opacity = 1 - d * .18; el.style.filter = `brightness(${1 - d * .18})`; el.style.zIndex = 10 - d; } });
  }
  function fillDeck() {
    const d = deckEl(); while (d.children.length < 4 && S.deck.length > d.children.length) { d.insertBefore(cardEl(S.deck[d.children.length]), d.firstChild); }
    layoutDeck(); if (S.deck.length < 10) topUpDeck();
  }
  function resetDeckDom() { deckEl().innerHTML = ""; fillDeck(); }
  async function topUpDeck() {
    if (S.deckFetching) return; S.deckFetching = true;
    try {
      const d = await api("/api/deck?n=40&seed=" + Math.floor(Math.random() * 1e6)); remember(d.items);
      const have = new Set(S.deck.map(m => m.id));
      S.deck.push(...d.items.filter(m => !(m.id in S.ratings) && !have.has(m.id)));
      if (!deckEl().children.length || deckEl().children.length < 4) fillDeck();
    } catch (e) { /* ignore */ } finally { S.deckFetching = false; }
  }
  const KIND = { love: [5, "Loved"], like: [4, "Liked"], nope: [2, "Not for me"], skip: [null, ""] };
  function commit(kind) {
    const top = [...deckEl().children].reverse().find(c => !c._busy); if (!top) return; top._busy = true; delete top.dataset.top;
    const m = S.deck[0]; const W = innerWidth * 1.3;
    const to = { love: `translate(${W}px,-40px) rotate(28deg)`, like: `translate(0,${-innerHeight}px) rotate(-6deg)`, nope: `translate(${-W}px,-40px) rotate(-28deg)`, skip: `translate(0,${innerHeight}px) rotate(4deg)` }[kind];
    top.classList.remove("snap"); top.classList.add("fly"); top.style.transform = to; top.style.opacity = 0;
    const st = $(".stamp." + kind, top); if (st) st.style.opacity = 1;
    if (KIND[kind][0] != null && m) { setRating(m.id, KIND[kind][0]); }
    S.deck.shift();
    setTimeout(() => { top.remove(); fillDeck(); }, 420);
    layoutDeckAfterShift();
  }
  function layoutDeckAfterShift() { const els = [...deckEl().children].reverse().filter(c => !c._busy); els.forEach((el, k) => { const d = k; if (k === 0) el.dataset.top = "1"; el.classList.add("snap"); el.style.transform = `translateY(${d * 16}px) scale(${1 - d * .05})`; el.style.opacity = 1 - d * .18; el.style.filter = `brightness(${1 - d * .18})`; }); }
  function initDeckDrag() {
    const d = deckEl(); let st = null;
    d.addEventListener("pointerdown", e => {
      const c = e.target.closest(".dcard"); if (!c || c.dataset.top !== "1" || c._busy) return;
      st = { c, x: e.clientX, y: e.clientY, id: e.pointerId }; c._drag = true; c.classList.remove("snap"); c.style.transition = "none"; c.setPointerCapture(e.pointerId);
    });
    d.addEventListener("pointermove", e => {
      if (!st) return; const dx = e.clientX - st.x, dy = e.clientY - st.y;
      st.c.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 16}deg)`;
      const love = dx > 0 && dx > -dy ? clamp(dx / 110, 0, 1) : 0, like = dy < 0 && -dy >= Math.abs(dx) ? clamp(-dy / 110, 0, 1) : 0, nope = dx < 0 && -dx > -dy ? clamp(-dx / 110, 0, 1) : 0;
      $(".stamp.love", st.c).style.opacity = love; $(".stamp.like", st.c).style.opacity = like; $(".stamp.nope", st.c).style.opacity = nope;
    });
    const end = e => {
      if (!st) return; const { c } = st; const dx = e.clientX - st.x, dy = e.clientY - st.y; st = null; c._drag = false;
      if (dx > 110 && dx > -dy) return commit("love"); if (dy < -110 && -dy >= Math.abs(dx)) return commit("like"); if (dx < -110) return commit("nope");
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { openMovie(+c.dataset.id, e); }
      c.classList.add("snap"); c.style.transition = ""; c.style.transform = ""; $$(".stamp", c).forEach(s => s.style.opacity = 0); layoutDeck();
    };
    d.addEventListener("pointerup", end); d.addEventListener("pointercancel", end);
  }

  /* =============== CONTROLS: Dial / Langs / Years =============== */
  function Dial(el, { label, left, right, value, onInput }) {
    const C = 80, R = 62, A0 = 135, SW = 270; let v = value;
    const P = a => { const r = a * Math.PI / 180; return [C + R * Math.cos(r), C + R * Math.sin(r)]; };
    const arc = (a0, a1) => { const [x0, y0] = P(a0), [x1, y1] = P(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    el.setAttribute("role", "slider"); el.tabIndex = 0; el.setAttribute("aria-label", label); el.dataset.cursor = "TURN";
    el.innerHTML = `<svg viewBox="0 0 160 160"><defs><linearGradient id="dg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#35e0ff"/><stop offset=".5" stop-color="#ffb23e"/><stop offset="1" stop-color="#ff3b6b"/></linearGradient></defs>
      <path class="trk" d="${arc(A0, A0 + SW - .01)}"/><path class="val" d=""/><circle class="kn" cx="80" cy="80" r="44"/><line class="nd" x1="80" y1="80" x2="114" y2="80"/></svg>
      <div class="dl"><b>${label}</b><span></span></div><div class="ends"><i>${left}</i><i>${right}</i></div>`;
    const val = $(".val", el), nd = $(".nd", el), out = $(".dl span", el);
    function draw() { const a = A0 + SW * v; val.setAttribute("d", v < .005 ? "" : arc(A0, A0 + Math.max(.5, SW * v))); nd.setAttribute("transform", `rotate(${A0 + SW * v} 80 80)`); out.textContent = v.toFixed(2); el.setAttribute("aria-valuenow", v.toFixed(2)); }
    function set(nv, emit = true) { v = clamp(nv, 0, 1); draw(); if (emit) onInput(v); }
    let drag = false;
    const fromPointer = (e, first) => { const r = $("svg", el).getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      let ang = Math.atan2(dy, dx) * 180 / Math.PI; ang = (ang + 360) % 360; let rel = (ang - A0 + 360) % 360; if (rel > SW) rel = rel - SW < (360 - SW) / 2 ? SW : 0; const nv = rel / SW;
      if (!first && Math.abs(nv - v) > .6) return; set(nv); };
    el.addEventListener("pointerdown", e => { drag = true; el.setPointerCapture(e.pointerId); fromPointer(e, true); });
    el.addEventListener("pointermove", e => { if (drag) fromPointer(e); });
    el.addEventListener("pointerup", () => drag = false);
    el.addEventListener("wheel", e => { if (!el.matches(":hover")) return; e.preventDefault(); set(v - Math.sign(e.deltaY) * .03); }, { passive: false });
    el.addEventListener("keydown", e => { const k = { ArrowRight: .05, ArrowUp: .05, ArrowLeft: -.05, ArrowDown: -.05 }[e.key]; if (k) { e.preventDefault(); set(v + k); } });
    draw(); return { set };
  }
  function LangOrbs(el, langs, selected, onChange) {
    el.innerHTML = langs.map(l => `<div class="orb ${selected.includes(l.name) ? "on" : ""}" tabindex="0" role="button" data-l="${l.name}" data-cursor="${l.name.toUpperCase()}" style="--h:${HUE[l.name] || 30}">${GLYPH[l.name] || l.name[0]}<small>${l.name} · ${l.count}</small></div>`).join("");
    const toggle = o => { o.classList.toggle("on"); onChange($$(".orb.on", el).map(x => x.dataset.l)); };
    el.addEventListener("click", e => { const o = e.target.closest(".orb"); if (o) toggle(o); });
    el.addEventListener("keydown", e => { const o = e.target.closest(".orb"); if (o && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(o); } });
  }
  function YearScrubber(el, { min, max, hist, onChange }) {
    let y0 = min, y1 = max; const hmax = Math.max(...hist.map(h => h.count));
    el.innerHTML = `<div class="hist">${hist.map(h => `<i data-y="${h.year}" style="height:${10 + 90 * h.count / hmax}%"></i>`).join("")}</div><div class="rail"></div><div class="fill"></div><i class="hd" data-k="0" data-cursor="DRAG"></i><i class="hd" data-k="1" data-cursor="DRAG"></i><div class="vals"><span></span><span></span></div>`;
    const hds = $$(".hd", el), fill = $(".fill", el), vals = $$(".vals span", el), bars = $$(".hist i", el);
    const pos = y => (y - min) / (max - min) * 100;
    function draw() { hds[0].style.left = pos(y0) + "%"; hds[1].style.left = pos(y1) + "%"; fill.style.left = pos(y0) + "%"; fill.style.width = (pos(y1) - pos(y0)) + "%"; vals[0].textContent = y0; vals[1].textContent = y1; bars.forEach(b => { const y = +b.dataset.y; b.classList.toggle("in", y + 4 >= y0 && y <= y1); }); }
    let k = null;
    const yFrom = e => { const r = el.getBoundingClientRect(); return Math.round(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min)); };
    el.addEventListener("pointerdown", e => { const y = yFrom(e); k = Math.abs(y - y0) <= Math.abs(y - y1) ? 0 : 1; hds[k].classList.add("drag"); el.setPointerCapture(e.pointerId); move(e); });
    const move = e => { if (k == null) return; const y = yFrom(e); if (k === 0) y0 = Math.min(y, y1 - 1); else y1 = Math.max(y, y0 + 1); draw(); };
    el.addEventListener("pointermove", move);
    const up = () => { if (k == null) return; hds[k].classList.remove("drag"); k = null; onChange(y0 <= min ? null : y0, y1 >= max ? null : y1); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); draw();
  }

  /* =============== REEL (recommendations + coverflow) =============== */
  const CF = { pos: 0, target: 0, shown: -1, els: [] };
  function reelFormula() { const a = S.alpha; $("#formula").innerHTML = `H = <b>${a.toFixed(2)}</b>·<i>Content</i> + <b>${(1 - a).toFixed(2)}</b>·<u>Collab</u>`; }
  const loadRecs = debounce(async function () {
    const req = ++S.recReq; reelFormula();
    try {
      const d = await post("/api/recommend", { ratings: S.ratings, alpha: S.alpha, diversity: S.diversity, n: 14, filters: { languages: S.recLangs, year_min: S.recY[0], year_max: S.recY[1] } });
      if (req !== S.recReq) return; remember(d.items); S.recs = d.items; renderReel(d);
    } catch (e) { $("#lampTxt").textContent = "backend offline — run python run.py"; }
  }, 120);
  function renderReel(d) {
    const lamp = $(".lamp"); lamp.classList.toggle("hot", !d.cold);
    $("#lampTxt").textContent = d.cold ? "cold start · popularity prior" : `personalised · ${d.rated} ratings · α=${(+d.alpha).toFixed(2)}`;
    $("#reelWhy").innerHTML = d.cold ? "No ratings yet, so SmartFlix falls back to the crowd's all-time favourites. <b>Calibrate your taste above</b> to personalise this reel."
      : `Built from your <b>${d.rated}</b> ratings — <code>α · Content + (1 − α) · Collaborative</code> with α = <b>${(+d.alpha).toFixed(2)}</b>. Turn the dials and watch the ranking move.`;
    const cf = $("#cf"); cf.innerHTML = "";
    if (!d.items.length) { cf.innerHTML = '<p class="mono tiny" style="text-align:center;padding-top:30%">no films match these filters</p>'; $("#cfInfo").innerHTML = ""; CF.els = []; return; }
    d.items.forEach((m, i) => {
      const p = clamp(m.hybrid, 0, .99), el = document.createElement("div"); el.className = "cf-card"; el.style.setProperty("--i", i); el.dataset.i = i;
      el.innerHTML = `${SFposter.html(m)}<span class="cf-rk">${String(i + 1).padStart(2, "0")}</span><div class="cf-ring"><svg viewBox="0 0 54 54"><circle class="t" cx="27" cy="27" r="22"/><circle class="v" cx="27" cy="27" r="22" data-p="${p}"/></svg><b>${Math.round(p * 100)}</b></div>`;
      cf.appendChild(el);
    });
    CF.els = $$(".cf-card", cf); CF.pos = CF.target = 0; CF.shown = -1;
    requestAnimationFrame(() => setTimeout(() => $$(".cf-ring .v", cf).forEach(c => c.style.strokeDashoffset = 138 * (1 - c.dataset.p)), 500));
  }
  function infoFor(i) {
    const m = S.recs[i]; if (!m) return; const box = $("#cfInfo");
    const because = (m.because || []).map(b => `<b>${esc(b.title)}</b>`).join(" and ");
    box.innerHTML = `<h3 class="ci-t" data-id="${m.id}" data-cursor="OPEN">${esc(m.title)}</h3><div class="ci-m">${m.year} · ${esc(m.language)} · ${m.genres.slice(0, 3).map(esc).join(" / ")} · dir. ${esc(m.director.split(",")[0])}</div>
      <div class="ci-b"><span>Content</span><u><i style="background:var(--cyan)" data-w="${Math.round(m.content * 100)}"></i></u><span>${Math.round(m.content * 100)}</span>
      <span>Collab.</span><u><i style="background:var(--violet)" data-w="${Math.round(m.cf * 100)}"></i></u><span>${Math.round(m.cf * 100)}</span></div>
      <p class="ci-why">${because ? `Because you rated ${because} highly — ${m.lead === "content" ? "similar in feel and cast" : "loved by viewers with your taste"}.` : "A crowd favourite — rate a few films to personalise this."}</p>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".ci-b i", box).forEach(b => b.style.width = b.dataset.w + "%")));
  }
  function initCF() {
    const cf = $("#cf"); let st = null;
    FX.onTick(() => {
      const n = CF.els.length; if (!n) return; CF.pos = lerp(CF.pos, CF.target, .11); if (Math.abs(CF.pos - CF.target) < .001) CF.pos = CF.target;
      const sp = clamp(cf.clientWidth * .2, 120, 250);
      CF.els.forEach((el, i) => { const d = i - CF.pos, a = Math.abs(d);
        el.style.transform = `translate3d(${d * sp}px,${a * 6}px,${-a * 130}px) rotateY(${clamp(-d * 34, -58, 58)}deg)`; el.style.zIndex = 100 - Math.round(a * 10);
        el.style.opacity = a > 4.2 ? 0 : clamp(1 - a * .17, 0, 1); el.style.pointerEvents = a > 3.4 ? "none" : "auto"; el.classList.toggle("mid", a < .4); });
      const idx = Math.round(CF.target); if (idx !== CF.shown) { CF.shown = idx; infoFor(idx); }
    });
    cf.addEventListener("pointerdown", e => { st = { x: e.clientX, t: CF.target, moved: false, id: e.pointerId, el: e.target.closest(".cf-card") }; });
    cf.addEventListener("pointermove", e => { if (!st) return; const dx = e.clientX - st.x; if (!st.moved && Math.abs(dx) > 7) { st.moved = true; cf.setPointerCapture(st.id); }
      if (st.moved) CF.target = clamp(st.t - dx / 170, 0, CF.els.length - 1); });
    const end = e => { if (!st) return; if (st.moved) CF.target = Math.round(CF.target); else if (st.el) { const i = +st.el.dataset.i; if (i === Math.round(CF.target)) openMovie(S.recs[i].id, e); else CF.target = i; } st = null; };
    cf.addEventListener("pointerup", end); cf.addEventListener("pointercancel", () => st = null);
    cf.addEventListener("wheel", e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 4) { e.preventDefault(); CF.target = clamp(CF.target + Math.sign(e.deltaX) * .35, 0, CF.els.length - 1); } }, { passive: false });
    $("#cfInfo").addEventListener("click", e => { const t = e.target.closest(".ci-t"); if (t) openMovie(+t.dataset.id, e); });
  }

  /* =============== UNIVERSE =============== */
  function gridCard(m, i) {
    return `<article class="pc rvs ${m.id in S.ratings ? "rated" : ""}" data-id="${m.id}" style="--d:${i % 8}"><div class="pc-in">${SFposter.html(m)}<span class="sc">★ ${m.score.toFixed(1)}</span>
      <div class="pc-meta"><b>${esc(m.title)}</b>${m.year} · ${esc(m.language)}<br>${m.genres.slice(0, 3).map(esc).join(" · ")}</div><i class="glare"></i></div></article>`;
  }
  async function loadUniverse(reset) {
    const U = S.uni; if (U.loading) return; U.loading = true; if (reset) { U.offset = 0; $("#grid").innerHTML = ""; }
    const q = new URLSearchParams({ sort: U.sort, limit: 48, offset: U.offset });
    if (U.q) q.set("q", U.q); if (U.langs.length) q.set("lang", U.langs.join(",")); if (U.genres.length) q.set("genre", U.genres.join(","));
    if (U.y0 != null) q.set("year_min", U.y0); if (U.y1 != null) q.set("year_max", U.y1);
    try {
      const d = await api("/api/movies?" + q); remember(d.items); U.total = d.total; const g = $("#grid");
      g.insertAdjacentHTML("beforeend", d.items.map((m, i) => gridCard(m, i)).join("")); U.offset += d.items.length; FX.reveal(g);
      if (reset) FX.count($("#uniCount"), d.total, 700);
      if (!d.total) g.innerHTML = '<p class="mono tiny" style="grid-column:1/-1;text-align:center;padding:6vh 0">nothing in the universe matches — loosen a filter</p>';
    } catch (e) { toast("Could not load films — is the server running?"); } finally { U.loading = false; }
  }
  function initUniverse() {
    const U = S.uni, m = S.meta;
    LangOrbs($("#uniLangs"), m.languages, [], v => { U.langs = v; loadUniverse(true); });
    $("#uniGenres").innerHTML = m.genres.map(g => `<a href="#" data-g="${g.name}">${g.name}<sup>${g.count}</sup></a>`).join("");
    $("#uniGenres").addEventListener("click", e => { const a = e.target.closest("a"); if (!a) return; e.preventDefault(); a.classList.toggle("on"); U.genres = $$("#uniGenres a.on").map(x => x.dataset.g); loadUniverse(true); });
    YearScrubber($("#uniYears"), { min: m.year_min, max: m.year_max, hist: m.histogram, onChange: (a, b) => { U.y0 = a; U.y1 = b; loadUniverse(true); } });
    const sorts = [["popular", "Popular"], ["year", "Newest"], ["score", "Top scored"], ["title", "A–Z"]];
    $("#uniSort").innerHTML = sorts.map(([k, l]) => `<span class="${k === U.sort ? "on" : ""}" data-s="${k}" data-cursor="SORT">${l}</span>`).join("");
    $("#uniSort").addEventListener("click", e => { const s = e.target.closest("span"); if (!s) return; $$("#uniSort span").forEach(x => x.classList.toggle("on", x === s)); U.sort = s.dataset.s; loadUniverse(true); });
    $("#uniQ").addEventListener("input", debounce(e => { U.q = e.target.value.trim(); loadUniverse(true); }, 260));
    $("#grid").addEventListener("click", e => { const c = e.target.closest(".pc"); if (c) openMovie(+c.dataset.id, e); });
    FX.tilt($("#grid"), ".pc");
    new IntersectionObserver(es => { if (es[0].isIntersecting && U.offset < U.total && !U.loading) loadUniverse(false); }, { rootMargin: "600px" }).observe($("#sentinel"));
    loadUniverse(true);
  }

  /* =============== CINEMA (movie detail) =============== */
  const STAR = '<path d="M12 2l3 6.5 7 .9-5.1 4.8 1.3 7L12 17.8 5.8 21.2l1.3-7L2 9.4l7-.9z"/>';
  let cinemaId = null;
  async function openMovie(id, ev) {
    const c = $("#cinema");
    if (ev && ev.clientX != null && !c.classList.contains("open")) { c.style.setProperty("--ox", (ev.clientX / innerWidth * 100) + "%"); c.style.setProperty("--oy", (ev.clientY / innerHeight * 100) + "%"); }
    let d; try { d = await api("/api/movie/" + id); } catch (e) { return toast("Could not load that film"); }
    remember([d.movie, ...d.similar, ...d.fans]); cinemaId = id; const m = d.movie, pal = SFposter.palette(m);
    c.style.setProperty("--c1", pal.c1); c.style.setProperty("--c2", pal.c2);
    const rail = (arr) => arr.map((x, i) => gridCard(x, i)).join("").replace(/rvs/g, "rvs in");
    $("#cnBody").innerHTML = `<div class="cn-hero"><div class="cn-poster">${SFposter.html(m)}</div><div>
      <div class="cn-meta"><span>${m.year}</span><span>${esc(m.language)}</span><span>${m.genres.map(esc).join(" · ")}</span><span>★ ${m.score.toFixed(1)}</span></div>
      <h1 class="cn-t">${esc(m.title)}</h1><p class="cn-ov">${esc(m.overview)}</p>
      <div class="cn-credits"><b>Director</b><span>${esc(m.director)}</span><b>Cast</b><span>${m.cast.map(esc).join(", ")}</span><b>Viewers</b><span>${m.ratings ? `${m.avg.toFixed(2)} / 5 average from ${m.ratings} ratings` : "no ratings yet"}</span></div>
      <div class="stars" id="stars" data-cursor="RATE">${[1, 2, 3, 4, 5].map(v => `<svg viewBox="0 0 24 24" data-v="${v}">${STAR}</svg>`).join("")}<span id="starTxt"></span></div></div></div>
      <div class="theater" id="theater"><div class="th-card"><span class="th-tag">NOW SHOWING · ${m.year}</span><div><h3>${esc(m.title)}</h3>
      <a href="${m.trailer ? "#" : esc(m.yt)}" ${m.trailer ? "" : 'target="_blank" rel="noopener"'} id="playTr" data-cursor="PLAY"><i></i>${m.trailer ? "Play trailer" : "Watch trailer on YouTube"}</a></div></div></div>
      <h3 class="rail-h">Same DNA<span>content-based neighbours</span></h3><div class="rail">${rail(d.similar)}</div>
      <h3 class="rail-h">Fans also rated<span>collaborative neighbours</span></h3><div class="rail">${d.fans.length ? rail(d.fans) : '<p class="mono tiny">not enough co-ratings yet</p>'}</div>`;
    paintStars(); FX.tilt($("#cnBody"), ".pc");
    const play = $("#playTr"); if (m.trailer) play.addEventListener("click", e => { e.preventDefault(); $("#theater").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${m.trailer}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; });
    c.classList.add("open"); c.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; $("#cnScroll").scrollTop = 0;
  }
  function paintStars(hover) {
    const v = hover != null ? hover : (S.ratings[cinemaId] || 0);
    $$("#stars svg").forEach(s => s.classList.toggle("on", +s.dataset.v <= v));
    $("#starTxt").textContent = hover != null ? `rate ${hover}/5` : S.ratings[cinemaId] ? `you rated ${S.ratings[cinemaId]}/5 — your profile is updating` : "rate it to train SmartFlix";
  }
  function closeMovie() { const c = $("#cinema"); c.classList.remove("open"); c.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; const th = $("#theater"); if (th) th.innerHTML = ""; cinemaId = null; }
  function initCinema() {
    $("#cnX").addEventListener("click", e => { e.preventDefault(); closeMovie(); });
    $("#cnScroll").addEventListener("click", e => { if (e.target.id === "cnScroll" || e.target.id === "cnBody") closeMovie(); const pc = e.target.closest(".pc"); if (pc) openMovie(+pc.dataset.id, e);
      const s = e.target.closest("#stars svg"); if (s) { const v = +s.dataset.v; setRating(cinemaId, S.ratings[cinemaId] === v ? null : v); paintStars(); toast(S.ratings[cinemaId] ? `Rated ${v}★ — taste updated` : "Rating removed"); } });
    $("#cnScroll").addEventListener("pointerover", e => { const s = e.target.closest("#stars svg"); if (s) paintStars(+s.dataset.v); });
    $("#cnScroll").addEventListener("pointerout", e => { if (e.target.closest("#stars svg")) paintStars(); });
  }

  /* =============== SEARCH PALETTE =============== */
  let palSel = 0, palItems = [];
  const palOpen = () => $("#palette").classList.contains("open");
  function openPalette() { $("#palette").classList.add("open"); $("#palette").setAttribute("aria-hidden", "false"); $("#palQ").value = ""; $("#palQ").focus(); palSearch(""); }
  function closePalette() { $("#palette").classList.remove("open"); $("#palette").setAttribute("aria-hidden", "true"); $("#palQ").blur(); }
  async function palSearch(q) {
    try { const d = await api("/api/movies?limit=8&sort=popular&q=" + encodeURIComponent(q)); remember(d.items); palItems = d.items; palSel = 0; palRender(); } catch (e) { /* offline */ }
  }
  function palRender() {
    $("#palRes").innerHTML = palItems.length ? palItems.map((m, i) => `<div class="pal-item ${i === palSel ? "sel" : ""}" data-i="${i}"><div class="th">${SFposter.html(m)}</div><div><b>${esc(m.title)}</b><span>${m.year} · ${esc(m.language)} · ${esc(m.director.split(",")[0])}</span></div><em>★ ${m.score.toFixed(1)}</em></div>`).join("") : '<div class="pal-empty">no films found</div>';
  }
  function initPalette() {
    $("#palQ").addEventListener("input", debounce(e => palSearch(e.target.value.trim()), 170));
    $("#palRes").addEventListener("click", e => { const it = e.target.closest(".pal-item"); if (it) { closePalette(); openMovie(palItems[+it.dataset.i].id, e); } });
    $("#palette").addEventListener("click", e => { if (e.target.id === "palette") closePalette(); });
    $("#searchHint").addEventListener("click", openPalette);
  }

  /* =============== LAB =============== */
  const MNAME = { "Popularity": "Popularity", "Content-Based": "Content-based", "Collaborative": "Collaborative", "SmartFlix Hybrid": "SmartFlix hybrid" };
  function renderLabBars() {
    const data = S.labData[S.labMode], mets = [["ndcg", "NDCG@10"], ["precision", "Precision@10"], ["recall", "Recall@10"], ["hit", "Hit-rate@10"]];
    $("#labBars").innerHTML = mets.map(([k, l]) => { const vals = Object.entries(data).map(([n, v]) => [n, v[k]]), mx = Math.max(...vals.map(v => v[1]));
      return `<div class="mgrp"><b>${l}</b>${vals.map(([n, v], i) => `<div class="brow ${v === mx ? "win" : ""}"><span>${MNAME[n]}</span><u><i style="--i:${i}" data-w="${(v / mx * 100).toFixed(1)}"></i></u><span>${v.toFixed(3)}</span></div>`).join("")}</div>`; }).join("");
    requestAnimationFrame(() => requestAnimationFrame(() => $$("#labBars i").forEach(i => i.style.width = i.dataset.w + "%")));
  }
  function renderSweep() {
    const sw = S.labData.alpha_sweep, W = 520, H = 220, x0 = 36, x1 = 500, y0 = 20, y1 = 180, vs = sw.map(s => s.ndcg), lo = Math.min(...vs) - .01, hi = Math.max(...vs) + .01;
    const X = a => x0 + a * (x1 - x0), Y = v => y1 - (v - lo) / (hi - lo) * (y1 - y0);
    const d = sw.map((s, i) => `${i ? "L" : "M"}${X(s.alpha).toFixed(1)} ${Y(s.ndcg).toFixed(1)}`).join(" "), best = sw.reduce((a, b) => b.ndcg > a.ndcg ? b : a);
    const grid = [0, .25, .5, .75, 1].map(t => `<line class="gl" x1="${x0}" x2="${x1}" y1="${y1 - t * (y1 - y0)}" y2="${y1 - t * (y1 - y0)}"/><text x="4" y="${y1 - t * (y1 - y0) + 3}">${(lo + t * (hi - lo)).toFixed(2)}</text>`).join("");
    $("#labSweep").innerHTML = `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb23e" stop-opacity=".35"/><stop offset="1" stop-color="#ffb23e" stop-opacity="0"/></linearGradient></defs>${grid}
      <path class="ar" d="${d} L${x1} ${y1} L${x0} ${y1}Z"/><path class="ln" pathLength="1" d="${d}"/>
      <line class="mk" id="swMk" x1="${X(S.alpha)}" x2="${X(S.alpha)}" y1="${y0 - 6}" y2="${y1}"/><circle cx="${X(best.alpha)}" cy="${Y(best.ndcg)}" r="6" fill="#ff3b6b"/>
      <text x="${x0}" y="${y1 + 18}">α=0 collaborative</text><text x="${x1}" y="${y1 + 18}" text-anchor="end">α=1 content</text><text x="${X(best.alpha)}" y="${Y(best.ndcg) - 12}" text-anchor="middle" style="fill:#ff3b6b">best α=${best.alpha.toFixed(1)}</text></svg>`;
    S.sweepX = X; setTimeout(() => $("#labSweep").classList.add("in"), 150); return best;
  }
  async function loadLab() {
    try {
      const d = await api("/api/metrics"); S.labData = d; const best = renderSweep();
      $("#labNote").innerHTML = `${d.ratings_source === "synthetic" ? "Evaluated on <b>synthetic demo ratings</b> generated from taste personas (swap in real MovieLens with <code>scripts/load_movielens.py</code>)." : "Evaluated on <b>real MovieLens ratings</b>."} ${d.users_evaluated} viewers · ${d.train_ratings.toLocaleString()} train / ${d.test_ratings.toLocaleString()} held-out ratings. On this data the best blend is α ≈ <b>${best.alpha.toFixed(1)}</b>.`;
      renderLabBars(); const e = d.rating_prediction, rows = [["Item-based CF", e.collaborative], ["User-mean baseline", e.user_mean], ["Global-mean baseline", e.global_mean]], mn = Math.min(...rows.map(r => r[1].rmse));
      $("#labErr").innerHTML = `<table><tr><th>Model</th><th>MAE</th><th>RMSE</th></tr>${rows.map(r => `<tr class="${r[1].rmse === mn ? "win" : ""}"><td>${r[0]}</td><td>${r[1].mae.toFixed(3)}</td><td>${r[1].rmse.toFixed(3)}</td></tr>`).join("")}</table>`;
      const seg = $("#labMode"), ind = $("i", seg), place = () => { const on = $("span.on", seg); ind.style.left = on.offsetLeft + "px"; ind.style.width = on.offsetWidth + "px"; }; place(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
      seg.addEventListener("click", e => { const s = e.target.closest("span"); if (!s) return; $$("span", seg).forEach(x => x.classList.toggle("on", x === s)); S.labMode = s.dataset.m; place(); renderLabBars(); });
    } catch (e) { $("#labNote").textContent = "Could not compute metrics — is the backend running?"; }
  }
  function moveSweepMarker() { const mk = $("#swMk"); if (mk && S.sweepX) { mk.setAttribute("x1", S.sweepX(S.alpha)); mk.setAttribute("x2", S.sweepX(S.alpha)); } }

  /* =============== KEYBOARD =============== */
  function initKeys() {
    addEventListener("keydown", e => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (e.key === "Escape") { if (palOpen()) closePalette(); else closeMovie(); return; }
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); openPalette(); return; }
      if (palOpen()) { if (e.key === "ArrowDown") { palSel = Math.min(palSel + 1, palItems.length - 1); palRender(); e.preventDefault(); } else if (e.key === "ArrowUp") { palSel = Math.max(palSel - 1, 0); palRender(); e.preventDefault(); } else if (e.key === "Enter" && palItems[palSel]) { const id = palItems[palSel].id; closePalette(); openMovie(id); } return; }
      if (typing || $("#cinema").classList.contains("open") || /dial/.test(document.activeElement.className)) return;
      const sec = document.body.dataset.sec;
      if (sec === "3") { const k = { ArrowRight: "love", ArrowUp: "like", ArrowLeft: "nope", ArrowDown: "skip" }[e.key]; if (k) { e.preventDefault(); commit(k); } }
      if (sec === "4") { if (e.key === "ArrowRight") CF.target = clamp(Math.round(CF.target) + 1, 0, CF.els.length - 1); if (e.key === "ArrowLeft") CF.target = clamp(Math.round(CF.target) - 1, 0, CF.els.length - 1); if (e.key === "Enter" && S.recs[Math.round(CF.target)]) openMovie(S.recs[Math.round(CF.target)].id); }
    });
  }

  /* =============== BOOT =============== */
  async function boot() {
    FX.init(); let prog = 0; const L = runLoader(() => prog); const raf = setInterval(() => L.tick(), 40); const t0 = performance.now();
    let meta, wall, deck;
    try {
      meta = await api("/api/meta"); prog = .35;
      [wall, deck] = await Promise.all([api("/api/movies?limit=70"), api("/api/deck?n=40&seed=" + Math.floor(Math.random() * 1e6))]); prog = .8;
    } catch (e) { $("#ldMsg").textContent = "backend not reachable — start it with:  python run.py"; clearInterval(raf); L.stop(); return; }
    S.meta = meta; remember(wall.items); remember(deck.items);
    S.deck = deck.items.filter(m => !(m.id in S.ratings));
    buildWall(wall.items); buildMarquee(); buildPipeline(); buildRadar(); buildOrbit(); initDeckDrag(); fillDeck();
    Dial($("#dialAlpha"), { label: "HYBRID α", left: "Collab", right: "Content", value: S.alpha, onInput: v => { S.alpha = v; store.set("sf_alpha", v); reelFormula(); moveSweepMarker(); loadRecs(); } });
    Dial($("#dialDiv"), { label: "VARIETY", left: "Focused", right: "Diverse", value: S.diversity, onInput: v => { S.diversity = v; store.set("sf_div", v); loadRecs(); } });
    LangOrbs($("#reelLangs"), meta.languages, [], v => { S.recLangs = v; loadRecs(); });
    YearScrubber($("#reelYears"), { min: meta.year_min, max: meta.year_max, hist: meta.histogram, onChange: (a, b) => { S.recY = [a, b]; loadRecs(); } });
    initCF(); initUniverse(); initCinema(); initPalette(); initKeys(); updateCounts(); refreshTaste(); reelFormula(); loadRecs();
    $("#hMovies").textContent = meta.movies;
    $("#clearTaste").addEventListener("click", e => { e.preventDefault(); S.ratings = {}; store.set("sf_ratings", S.ratings); S.deck = []; deckEl().innerHTML = ""; updateCounts(); refreshTaste(); loadRecs(); topUpDeck(); toast("Taste profile wiped — cold start"); $$(".pc.rated").forEach(x => x.classList.remove("rated")); });
    $("#ignite").addEventListener("click", () => { if (ratedCount() < 3) toast("Rate at least 3 films first — swipe the deck"); });
    new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); loadLab(); } }, { rootMargin: "400px" }).observe($("#lab"));
    addEventListener("resize", debounce(buildOrbit, 200));
    // finish loader (min 2.4 s of leader for the cinematic feel)
    prog = 1; await sleep(Math.max(0, 2400 - (performance.now() - t0))); clearInterval(raf); L.stop(); $("#ldNum").textContent = "0"; L.tick(); await sleep(350);
    $("#loader").classList.add("done"); document.body.classList.remove("loading"); document.body.classList.add("ready");
    FX.reveal(); setTimeout(() => $("#loader").classList.add("gone"), 1300);
    const st = { movies: meta.movies, languages: meta.languages.length, users: meta.users, ratings: meta.ratings };
    $$("[data-stat]").forEach(el => FX.count(el, st[el.dataset.stat], 2200));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
