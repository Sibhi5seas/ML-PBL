/* SmartFlix procedural poster engine.
   Every film gets deterministic, genre-aware cover art generated as SVG, so the site
   looks cinematic offline. If data/media.json (TMDB) has a real poster it is used instead. */
(function () {
  const HUES = { Action: 12, "Sci-Fi": 255, Horror: 350, Romance: 335, Drama: 28, Crime: 8, Comedy: 48, Animation: 175,
    Family: 150, War: 95, Fantasy: 285, Adventure: 38, Musical: 310, Thriller: 205, Mystery: 225, History: 40,
    Biography: 195, Sport: 130 };
  const LANG_SHIFT = { Tamil: 0, Hindi: 12, Telugu: -10, Malayalam: 30, Kannada: 20, Bengali: -20, Marathi: 40, English: 0 };
  let uid = 0;

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hsl = (h, s, l, a) => `hsla(${(h % 360 + 360) % 360},${s}%,${l}%,${a == null ? 1 : a})`;

  function palette(m) {
    const r = rng(hash(m.title + m.year));
    const g0 = m.genres[0] || "Drama";
    const base = (HUES[g0] ?? 20) + (LANG_SHIFT[m.language] || 0) + (r() * 36 - 18);
    const dark = g0 === "Horror" || g0 === "Crime" || g0 === "Thriller";
    return { h: base, r, g0,
      c1: hsl(base, 70, dark ? 7 : 11), c2: hsl(base + 18, 75, dark ? 20 : 30), c3: hsl(base + 55, 95, 62), c4: hsl(base - 30, 90, 58) };
  }

  const ART = {
    Action(p, r) { let s = ""; const cx = 150 + (r() * 80 - 40), cy = 190;
      for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, l = 120 + r() * 260, w = .03 + r() * .05;
        s += `<polygon points="${cx},${cy} ${cx + Math.cos(a - w) * l},${cy + Math.sin(a - w) * l} ${cx + Math.cos(a + w) * l},${cy + Math.sin(a + w) * l}" fill="${i % 3 ? p.c3 : p.c4}" opacity="${.18 + r() * .3}"/>`; }
      return s + `<circle cx="${cx}" cy="${cy}" r="${26 + r() * 20}" fill="${p.c3}" opacity=".85"/>`; },
    "Sci-Fi"(p, r) { let s = `<circle cx="${100 + r() * 100}" cy="150" r="${50 + r() * 34}" fill="url(#pl)" />`;
      for (let i = 1; i < 6; i++) s += `<ellipse cx="150" cy="150" rx="${i * 40}" ry="${i * 12}" fill="none" stroke="${p.c3}" stroke-width=".8" opacity="${.5 - i * .06}" transform="rotate(${-16 + r() * 4} 150 150)"/>`;
      for (let i = 0; i < 9; i++) s += `<line x1="0" x2="300" y1="${290 + i * i * 2.4}" y2="${290 + i * i * 2.4}" stroke="${p.c3}" opacity=".18"/>`;
      return s; },
    Horror(p, r) { let s = `<circle cx="${80 + r() * 140}" cy="120" r="${44 + r() * 30}" fill="${p.c3}" opacity=".16"/>`;
      for (let i = 0; i < 18; i++) { const x = 8 + i * 17 + r() * 6, h = 40 + r() * 230; s += `<rect x="${x}" y="0" width="${2 + r() * 5}" height="${h}" rx="3" fill="${p.c4}" opacity="${.12 + r() * .3}"/>`; }
      return s; },
    Romance(p, r) { let s = ""; for (let i = 0; i < 5; i++) s += `<circle cx="${60 + r() * 180}" cy="${90 + r() * 200}" r="${40 + r() * 80}" fill="${i % 2 ? p.c3 : p.c4}" opacity="${.12 + r() * .16}"/>`;
      return s + `<path d="M150 190c-30-34-60-8-40 18 14 18 40 32 40 32s26-14 40-32c20-26-10-52-40-18z" fill="${p.c3}" opacity=".7"/>`; },
    Drama(p, r) { const y = 210 + r() * 20; let s = `<circle cx="${100 + r() * 100}" cy="${y - 50}" r="${64 + r() * 20}" fill="${p.c3}" opacity=".78"/>`;
      s += `<path d="M0 ${y} L60 ${y - 40} L120 ${y - 10} L190 ${y - 56} L300 ${y - 4} V450 H0z" fill="${p.c1}" opacity=".9"/>`;
      return s + `<rect y="${y}" width="300" height="2" fill="${p.c3}" opacity=".5"/>`; },
    Crime(p, r) { let s = ""; for (let i = 0; i < 16; i++) s += `<rect x="-20" y="${i * 24 + r() * 4}" width="340" height="${5 + r() * 9}" fill="${p.c3}" opacity="${.05 + r() * .13}" transform="rotate(-12 150 220)"/>`;
      return s + `<circle cx="${120 + r() * 60}" cy="160" r="48" fill="none" stroke="${p.c4}" stroke-width="3" opacity=".7"/>`; },
    Comedy(p, r) { let s = ""; for (let i = 0; i < 34; i++) { const x = r() * 300, y = r() * 330, c = [p.c3, p.c4, "#fff"][i % 3];
        s += i % 2 ? `<circle cx="${x}" cy="${y}" r="${3 + r() * 9}" fill="${c}" opacity=".7"/>` : `<rect x="${x}" y="${y}" width="${8 + r() * 14}" height="${5 + r() * 8}" fill="${c}" opacity=".65" transform="rotate(${r() * 90} ${x} ${y})"/>`; } return s; },
    Animation(p, r) { let s = ""; for (let i = 0; i < 7; i++) s += `<ellipse cx="${r() * 300}" cy="${r() * 300}" rx="${30 + r() * 60}" ry="${24 + r() * 50}" fill="${[p.c3, p.c4, "#fff"][i % 3]}" opacity="${.14 + r() * .2}"/>`;
      for (let i = 0; i < 12; i++) s += `<circle cx="${r() * 300}" cy="${r() * 330}" r="${1 + r() * 2.4}" fill="#fff" opacity=".8"/>`; return s; },
    War(p, r) { let s = ""; for (let k = 0; k < 3; k++) { let d = `M0 ${230 + k * 36}`; for (let x = 0; x <= 300; x += 30) d += ` L${x} ${210 + k * 36 - r() * 60}`;
        s += `<path d="${d} V450 H0z" fill="${hsl(p.h, 30, 9 + k * 4)}" opacity=".95"/>`; }
      for (let i = 0; i < 5; i++) s += `<circle cx="${r() * 300}" cy="${90 + r() * 120}" r="${20 + r() * 40}" fill="#888" opacity=".1"/>`;
      return s + `<circle cx="215" cy="110" r="30" fill="${p.c3}" opacity=".6"/>`; },
    Fantasy(p, r) { let s = `<circle cx="${r() * 200 + 50}" cy="110" r="${40 + r() * 22}" fill="${p.c3}" opacity=".6"/>`;
      for (let i = 0; i < 30; i++) s += `<circle cx="${r() * 300}" cy="${r() * 260}" r="${.6 + r() * 1.8}" fill="#fff" opacity="${.3 + r() * .6}"/>`;
      let d = "M0 300"; for (let x = 0; x <= 300; x += 25) d += ` L${x} ${250 - r() * 90}`; return s + `<path d="${d} V450 H0z" fill="${p.c1}"/>`; },
    Musical(p, r) { let s = ""; for (let i = 0; i < 8; i++) { let d = `M-10 ${130 + i * 22}`; const a = 12 + r() * 26, f = .02 + r() * .03;
        for (let x = 0; x <= 310; x += 10) d += ` L${x} ${130 + i * 22 + Math.sin(x * f + i) * a}`; s += `<path d="${d}" fill="none" stroke="${i % 2 ? p.c3 : p.c4}" stroke-width="2" opacity="${.25 + r() * .4}"/>`; } return s; },
    Thriller(p, r) { let s = ""; for (let i = 0; i < 8; i++) s += `<rect x="${150 - i * 20}" y="${180 - i * 20}" width="${i * 40}" height="${i * 40}" fill="none" stroke="${p.c3}" stroke-width="1.2" opacity="${.5 - i * .05}" transform="rotate(${i * 7 + r() * 5} 150 180)"/>`;
      return s; },
    History(p, r) { let s = ""; for (let i = 0; i < 5; i++) { const x = 30 + i * 50; s += `<path d="M${x} 330 V${170 + r() * 30} a18 18 0 0 1 36 0 V330z" fill="${p.c3}" opacity="${.12 + r() * .2}"/>`; }
      return s + `<rect y="330" width="300" height="3" fill="${p.c3}" opacity=".6"/>`; },
    Sport(p, r) { let s = ""; for (let i = 0; i < 10; i++) s += `<rect x="${i * 36 - 40}" y="0" width="14" height="450" fill="${p.c3}" opacity=".09" transform="rotate(24 150 220)"/>`;
      return s + `<circle cx="150" cy="170" r="${50 + r() * 14}" fill="none" stroke="${p.c3}" stroke-width="5" opacity=".75"/><path d="M100 170h100M150 120v100" stroke="${p.c3}" stroke-width="2" opacity=".5"/>`; },
  };
  ART.Adventure = ART.Fantasy; ART.Mystery = ART.Thriller; ART.Family = ART.Animation; ART.Biography = ART.History;

  function wrap(title) {
    const words = title.replace(/[:\-–]/g, " ").toUpperCase().split(/\s+/).filter(Boolean);
    const lines = []; let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > 11 && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function svg(m) {
    const p = palette(m), r = p.r, id = "p" + (uid++);
    const art = (ART[p.g0] || ART.Drama)(p, r);
    const lines = wrap(m.title), longest = Math.max(...lines.map(l => l.length));
    const fs = Math.max(20, Math.min(46, 250 / (longest * .66)));
    const ty = 345 - (lines.length - 1) * fs * .98;
    const t = lines.map((l, i) => `<text x="24" y="${ty + i * fs * 1.0}" font-size="${fs}" class="pt">${esc(l)}</text>`).join("");
    const dir = esc((m.director || "").split(",")[0].toUpperCase());
    return `<svg class="psvg" viewBox="0 0 300 450" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(m.title)}">
<defs><linearGradient id="${id}b" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${p.c2}"/><stop offset="1" stop-color="${p.c1}"/></linearGradient>
<radialGradient id="pl" cx=".35" cy=".3"><stop offset="0" stop-color="${p.c3}"/><stop offset="1" stop-color="${p.c4}" stop-opacity=".2"/></radialGradient>
<linearGradient id="${id}s" x1="0" y1=".45" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".88"/></linearGradient></defs>
<rect width="300" height="450" fill="url(#${id}b)"/>${art.replace(/url\(#pl\)/g, `url(#${id}l)`).replace("<circle", `<circle`)}
<radialGradient id="${id}l" cx=".35" cy=".3"><stop offset="0" stop-color="${p.c3}"/><stop offset="1" stop-color="${p.c4}" stop-opacity=".25"/></radialGradient>
<rect width="300" height="450" fill="url(#${id}s)"/>
<text x="24" y="38" font-size="8.5" letter-spacing="2.4" class="pm" opacity=".7">${esc(m.language.toUpperCase())} · ${m.year}</text>${t}
<text x="24" y="${Math.min(430, ty + lines.length * fs + 18)}" font-size="8" letter-spacing="2" class="pm" opacity=".6">A FILM BY ${dir}</text>
<rect x="0" y="0" width="300" height="450" fill="none" stroke="rgba(255,255,255,.08)"/></svg>`;
  }

  const store = {};
  function html(m) {
    store[m.id] = m;
    if (m.poster) return `<img class="pimg" loading="lazy" decoding="async" alt="${esc(m.title)}" src="${m.poster}" data-mid="${m.id}" onerror="SFposter.fallback(this)">`;
    return svg(m);
  }
  function fallback(img) { const m = store[img.dataset.mid]; if (!m) return; const d = document.createElement("div"); d.innerHTML = svg(m); img.replaceWith(d.firstChild); }

  window.SFposter = { html, svg, palette, fallback };
})();
