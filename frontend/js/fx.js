/* SmartFlix FX layer: cursor, projector beam, smooth scroll physics, reveals, magnetism, tilt. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fine = matchMedia("(pointer:fine)").matches;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
  const ticks = [];
  const FX = { $, $$, clamp, lerp, mouse, fine, reduce, sy: 0, vel: 0, onTick: fn => ticks.push(fn) };
  window.FX = FX;

  /* ---------- cursor ---------- */
  function cursor() {
    if (!fine) return;
    document.documentElement.classList.add("fine");
    const dot = $("#cur"), ring = $("#curRing"), label = $("#curRing span");
    let rx = mouse.x, ry = mouse.y;
    addEventListener("pointermove", e => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      mouse.nx = e.clientX / innerWidth - .5; mouse.ny = e.clientY / innerHeight - .5;
      dot.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    }, { passive: true });
    FX.onTick(() => { rx = lerp(rx, mouse.x, .16); ry = lerp(ry, mouse.y, .16); ring.style.transform = `translate(${rx}px,${ry}px)`; });
    document.addEventListener("pointerover", e => {
      const t = e.target.closest("[data-cursor],a,.orb,.pc,.dcard,.cf-card,.persona");
      if (!t) { ring.classList.remove("big"); label.textContent = ""; return; }
      ring.classList.add("big");
      label.textContent = t.dataset.cursor || (t.matches(".pc,.cf-card") ? "OPEN" : t.matches(".dcard") ? "DRAG" : "");
    });
    document.addEventListener("pointerdown", () => ring.classList.add("down"));
    addEventListener("pointerup", () => ring.classList.remove("down"));
  }

  /* ---------- projector beam + dust (hero) ---------- */
  function beam() {
    const cv = $("#beam"); if (!cv) return;
    const ctx = cv.getContext("2d"); let W, H, dpr = Math.min(devicePixelRatio || 1, 2);
    const dust = []; const resize = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); addEventListener("resize", resize);
    for (let i = 0; i < 90; i++) dust.push({ x: Math.random(), y: Math.random(), z: Math.random(), s: .3 + Math.random() * 1.6, v: .02 + Math.random() * .06 });
    let visible = true; new IntersectionObserver(e => visible = e[0].isIntersecting).observe(cv);
    let t = 0;
    FX.onTick(() => {
      if (!visible || reduce) return; t += .01; ctx.clearRect(0, 0, W, H);
      const ox = W * (.92 + mouse.nx * -.03), oy = -H * .06, sway = Math.sin(t) * .03 + mouse.nx * .1;
      const grd = ctx.createRadialGradient(ox, oy, 10, ox - W * .5, H * .7, W * .9);
      grd.addColorStop(0, "rgba(255,200,120,.55)"); grd.addColorStop(.35, "rgba(255,150,80,.14)"); grd.addColorStop(1, "rgba(255,120,80,0)");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.lineTo(W * (.05 + sway), H * 1.05); ctx.lineTo(W * (.62 + sway), H * 1.05); ctx.closePath(); ctx.fill();
      for (const d of dust) {
        d.y -= d.v * .003; d.x += Math.sin(t + d.z * 9) * .0003; if (d.y < -.02) { d.y = 1.02; d.x = Math.random(); }
        const px = d.x * W + mouse.nx * 40 * d.z, py = d.y * H + mouse.ny * 30 * d.z;
        const inBeam = px > W * (.05 + (1 - py / H) * .3) && px < W * (.95 - (py / H) * .3);
        ctx.fillStyle = `rgba(255,${200 + d.z * 40 | 0},${150 + d.z * 60 | 0},${inBeam ? .55 * d.z : .12})`;
        ctx.beginPath(); ctx.arc(px, py, d.s * (inBeam ? 1.4 : 1), 0, 6.283); ctx.fill();
      }
    });
  }

  /* ---------- split text, counters, reveals ---------- */
  function split() {
    $$("[data-split]").forEach(el => {
      const txt = el.textContent; el.textContent = "";
      [...txt].forEach((ch, i) => { const s = document.createElement("span"); s.className = "ch"; s.style.setProperty("--i", i); s.textContent = ch === " " ? "\u00a0" : ch; el.appendChild(s); });
    });
  }
  function count(el, to, dur = 1600, dec = 0) {
    if (reduce) { el.textContent = to.toFixed(dec); return; }
    const t0 = performance.now();
    (function f(t) { const p = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = (to * e).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }); if (p < 1) requestAnimationFrame(f); })(t0);
  }
  FX.count = count;
  let io;
  function reveal(root = document) {
    io = io || new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    $$(".rv:not(.in),.rvs:not(.in)", root).forEach(el => io.observe(el));
  }
  FX.reveal = reveal; FX.split = split;

  /* ---------- magnetic + tilt ---------- */
  function magnet() {
    if (!fine) return;
    FX.onTick(() => {
      $$("[data-mag]").forEach(el => {
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = mouse.x - cx, dy = mouse.y - cy, d = Math.hypot(dx, dy), R = r.width * .9;
        const tx = d < R ? dx * .28 : 0, ty = d < R ? dy * .28 : 0;
        el._mx = lerp(el._mx || 0, tx, .15); el._my = lerp(el._my || 0, ty, .15);
        el.style.transform = `translate(${el._mx}px,${el._my}px)`;
      });
    });
  }
  function tilt(root, sel) {
    if (!fine) return;
    root.addEventListener("pointermove", e => {
      const el = e.target.closest(sel); if (!el) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty("--rx", ((.5 - y) * 14).toFixed(2) + "deg"); el.style.setProperty("--ry", ((x - .5) * 16).toFixed(2) + "deg");
      el.style.setProperty("--gx", (x * 100).toFixed(1) + "%"); el.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
    });
    root.addEventListener("pointerout", e => { const el = e.target.closest(sel); if (el && !el.contains(e.relatedTarget)) { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); } });
  }
  FX.tilt = tilt;

  /* ---------- scroll physics ---------- */
  function scroll() {
    let sy = scrollY, last = sy;
    const bar = $("#progress i"), secs = ["hero", "langs", "how", "calibrate", "reel", "universe", "lab", "credits"].map(id => $("#" + id));
    const dots = $$("#dots a"), hero = $("#hero .hero-in"), wall = $("#wall"), rows = $$(".mrow"), pin = $("#how"), track = $("#howTrack"), hbar = $("#howBar");
    const pars = $$("[data-par]");
    FX.onTick(() => {
      const target = scrollY; sy = reduce ? target : lerp(sy, target, .1); FX.sy = sy; FX.vel = lerp(FX.vel, target - last, .2); last = target;
      const max = document.documentElement.scrollHeight - innerHeight; if (bar) bar.style.transform = `scaleY(${clamp(target / max, 0, 1)})`;
      if (hero && sy < innerHeight * 1.3) { const p = sy / innerHeight; hero.style.transform = `translateY(${sy * .35}px) scale(${1 - p * .08})`; hero.style.opacity = clamp(1 - p * 1.25, 0, 1); }
      if (wall && sy < innerHeight * 1.4) wall.style.translate = `${mouse.nx * -30}px ${sy * .18 + mouse.ny * -20}px`;
      rows.forEach((r, i) => { const dir = i % 2 ? 1 : -1, base = (performance.now() * .02 * dir) + sy * .35 * dir * -1; const w = r.scrollWidth / 2; r.style.transform = `translateX(${((base % w) - w) % w}px) skewX(${clamp(FX.vel * -.25, -14, 14)}deg)`; });
      pars.forEach(el => { const r = el.getBoundingClientRect(); if (r.bottom < -200 || r.top > innerHeight + 200) return; el.style.translate = `0 ${(r.top + r.height / 2 - innerHeight / 2) * -parseFloat(el.dataset.par)}px`; });
      if (pin && track && innerWidth > 860) {
        const r = pin.getBoundingClientRect(), total = pin.offsetHeight - innerHeight, p = clamp(-r.top / total, 0, 1);
        const dist = track.scrollWidth - innerWidth + innerWidth * .06; track.style.transform = `translateX(${-p * dist}px)`;
        if (hbar) hbar.style.transform = `scaleX(${p})`;
        FX.howP = p; $$(".panel", track).forEach(pn => { const pr = pn.getBoundingClientRect(); pn.classList.toggle("act", pr.left < innerWidth * .62 && pr.right > innerWidth * .3); });
      }
      let cur = 0; secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .5) cur = i; });
      dots.forEach((d, i) => d.classList.toggle("on", i === cur));
      document.body.dataset.sec = cur;
    });
    $$("#dots a, [data-go], .logo, #reelBadge").forEach(a => a.addEventListener("click", e => { const id = (a.dataset.go || a.getAttribute("href") || "").replace("#", ""); const el = id && $("#" + id); if (!el) return; e.preventDefault(); scrollTo({ top: el.offsetTop, behavior: reduce ? "auto" : "smooth" }); }));
  }

  /* ---------- loop ---------- */
  function loop() { for (const f of ticks) f(); requestAnimationFrame(loop); }

  FX.init = function () { cursor(); beam(); split(); magnet(); scroll(); reveal(); requestAnimationFrame(loop); };
})();
