// Esteira 2L — montagem das artes no navegador (camada PNG + foto + textos).
// Sem dependências. Usado pela plataforma (esteira/index.html) e pelo teste local.
(function (global) {
  "use strict";

  // ---------- fontes ----------
  // Fontes que não temos em arquivo, ou variações que faltam: vêm do Google Fonts.
  const GOOGLE_CSS = "https://fonts.googleapis.com/css2?" + [
    "family=Arimo:wght@400..700",
    "family=Archivo+Black",
    "family=DM+Sans:wght@400;500;700",
    "family=Raleway:wght@500",
    "family=Montserrat:ital,wght@1,200;1,800"
  ].join("&") + "&display=block";

  const fontState = { loaded: false, faces: [] };

  // manifest = build/fontes.json ; urlFor(arquivo) -> URL acessível do arquivo
  async function loadFonts(manifest, urlFor) {
    if (fontState.loaded) return;
    if (!document.querySelector('link[data-esteira-fonts]')) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = GOOGLE_CSS; l.dataset.esteiraFonts = "1";
      document.head.appendChild(l);
      await new Promise(r => { l.onload = r; l.onerror = r; });
    }
    const jobs = manifest.arquivos.map(async f => {
      try {
        const url = await urlFor(f.arquivo);
        const desc = { style: f.italico ? "italic" : "normal" };
        desc.weight = f.variavel ? "100 900" : String(f.peso);
        const face = new FontFace(f.familia, `url("${url}")`, desc);
        await face.load();
        document.fonts.add(face);
        fontState.faces.push(face);
      } catch (e) { console.warn("fonte falhou", f.arquivo, e); }
    });
    await Promise.all(jobs);
    fontState.loaded = true;
  }

  function fontCss(run, size) {
    return `${run.italico ? "italic " : ""}${run.peso || 400} ${size}px "${run.fonte}"`;
  }

  async function ensureFonts(tpl) {
    const reqs = new Set();
    for (const cx of tpl.caixas || []) {
      for (const r of cx.trechos || [cx]) reqs.add(fontCss({ ...cx, ...r }, 40));
    }
    await Promise.all([...reqs].map(f => document.fonts.load(f, "AÇãé0123")));
  }

  // ---------- dados -> texto ----------
  const fmtNum = n => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  function valorNum(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^\d,\.]/g, "");
    if (!s) return null;
    // "66.900" / "66.900,00" / "66900"
    const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\./g, "");
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  }
  function campos(d) {
    d = d || {};
    const v = valorNum(d.valor);
    const km = valorNum(d.km);
    return {
      ...d,
      valor: v == null ? "" : fmtNum(v),
      valor_cent: v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      km: km == null ? (d.km || "") : fmtNum(km),
    };
  }
  // Preenche "{marca} {modelo}" e limpa separadores que sobraram de campos vazios.
  function preencher(modelo, dados) {
    if (!modelo) return "";
    const c = campos(dados);
    // campo vazio some junto com o prefixo/unidade ("Ano: {ano}", "{km} km", "KM {km}")
    let s = modelo.replace(/((?:Ano|ANO|Km|KM)(?::\s*|\s+))?\{(\w+)\}(\s*(?:km|Km|KM|m²|m2)(?![A-Za-z]))?/g,
      (all, pre, k, suf) => {
        const v = c[k] == null ? "" : String(c[k]).trim();
        return v ? (pre || "") + v + (suf || "") : "";
      });
    // "2020 |  | 40.000 km" -> "2020 | 40.000 km"
    for (const sep of ["|", "-", "/", "•"]) {
      const e = sep.replace(/[|\-\/]/g, "\\$&");
      s = s.replace(new RegExp(`\\s*${e}\\s*(?=${e})`, "g"), "");
      s = s.replace(new RegExp(`^\\s*${e}\\s*|\\s*${e}\\s*$`, "g"), "");
    }
    return s.replace(/[ \t]{2,}/g, m => (modelo.includes(m) ? m : " ")).replace(/^\s+$/, "");
  }
  // textos da arte a partir dos dados do carro (o que a equipe pode editar depois)
  function textosPadrao(tpl, dados) {
    const out = {};
    for (const cx of tpl.caixas || []) {
      out[cx.id] = cx.trechos ? cx.trechos.map(r => preencher(r.modelo, dados)) : preencher(cx.modelo, dados);
    }
    return out;
  }

  // ---------- layout de texto (mesmo modelo do Canva/CSS) ----------
  function measure(ctx, text, run, size, esp) {
    ctx.font = fontCss(run, size);
    try { ctx.letterSpacing = (esp * size) + "px"; } catch (e) {}
    return ctx.measureText(text);
  }

  function layoutBox(ctx, cx, valor) {
    // monta runs
    let runs;
    if (cx.trechos) {
      const vals = Array.isArray(valor) ? valor : [valor];
      runs = cx.trechos.map((r, i) => ({ ...cx, ...r, texto: vals[i] || "" }));
    } else {
      const txt = String(valor || "");
      if (cx.separador && cx.cor_separador) {
        runs = [];
        txt.split(cx.separador).forEach((p, i) => {
          if (i) runs.push({ ...cx, cor: cx.cor_separador, texto: cx.separador });
          runs.push({ ...cx, texto: p });
        });
      } else runs = [{ ...cx, texto: txt }];
    }
    if (cx.maiusculas) runs.forEach(r => r.texto = r.texto.toLocaleUpperCase("pt-BR"));
    // quebra em pedaços (palavras / espaços / quebras de linha)
    const pieces = [];
    for (const r of runs) {
      for (const tok of r.texto.split(/(\n| +)/)) {
        if (tok === "") continue;
        pieces.push({ run: r, t: tok });
      }
    }
    const esp = cx.espacamento || 0;
    const W = cx.largura;
    const lines = [[]]; let lw = 0;
    for (const p of pieces) {
      if (p.t === "\n") { lines.push([]); lw = 0; continue; }
      const size = p.run.tamanho;
      const w = measure(ctx, p.t, p.run, size, esp).width;
      const isSpace = /^ +$/.test(p.t);
      if (!isSpace && lw + w > W + 0.5 && lines[lines.length - 1].some(q => !/^ +$/.test(q.t))) {
        // tira espaço do fim da linha atual
        const cur = lines[lines.length - 1];
        while (cur.length && /^ +$/.test(cur[cur.length - 1].t)) cur.pop();
        lines.push([]); lw = 0;
      }
      if (isSpace && lines[lines.length - 1].length === 0 && lines.length > 1) continue;
      lines[lines.length - 1].push({ ...p, w });
      lw += w;
    }
    return { lines, esp };
  }

  // Caixas de uma linha (tudo menos comunicado/textos com quebra): se o texto não couber,
  // diminui a fonte até caber (mínimo 60%), como a equipe faz à mão no Canva.
  function umaLinha(cx, valor) {
    if (cx.multilinha != null) return !cx.multilinha;
    const txt = Array.isArray(valor) ? valor.join("") : String(valor || "");
    const mod = cx.modelo || (cx.trechos || []).map(r => r.modelo).join("");
    return !txt.includes("\n") && !/\{comunicado\}/.test(mod) && !cx.altura_max;
  }
  function escalar(cx, f) {
    const o = { ...cx, tamanho: cx.tamanho * f };
    if (cx.trechos) o.trechos = cx.trechos.map(r => ({ ...r, tamanho: r.tamanho * f }));
    return o;
  }
  function drawBox(ctx, cx0, valor) {
    let cx = cx0, lay = layoutBox(ctx, cx, valor);
    if (umaLinha(cx0, valor) && lay.lines.length > 1) {
      for (let f = 0.97; f >= 0.6; f -= 0.03) {
        cx = escalar(cx0, f); lay = layoutBox(ctx, cx, valor);
        if (lay.lines.length <= 1) break;
      }
    } else if (cx0.altura_max) {
      const alt = l => l.lines.length * cx.tamanho * (cx.entrelinha || 1.2);
      for (let f = 0.97; f >= 0.6 && alt(lay) > cx0.altura_max; f -= 0.03) {
        cx = escalar(cx0, f); lay = layoutBox(ctx, cx, valor);
      }
    }
    const { lines, esp } = lay;
    let y = cx.top;
    for (const line of lines) {
      const maxSize = Math.max(cx.tamanho, ...line.map(p => p.run.tamanho));
      const lh = maxSize * (cx.entrelinha || 1.2);
      // métricas da maior fonte da linha
      const big = line.reduce((a, p) => (p.run.tamanho > (a ? a.run.tamanho : 0) ? p : a), null) || { run: cx };
      const m = measure(ctx, "Hg", big.run, maxSize, esp);
      const asc = m.fontBoundingBoxAscent ?? maxSize * 0.9;
      const desc = m.fontBoundingBoxDescent ?? maxSize * 0.25;
      const base = y + (lh - (asc + desc)) / 2 + asc;
      // largura sem espaços no fim
      while (line.length && /^ +$/.test(line[line.length - 1].t)) line.pop();
      const total = line.reduce((s, p) => s + p.w, 0) - (line.length ? esp * line[line.length - 1].run.tamanho : 0);
      let x = cx.left;
      const al = cx.alinhamento;
      if (al === "center") x = cx.left + (cx.largura - total) / 2;
      else if (al === "end" || al === "right") x = cx.left + cx.largura - total;
      for (const p of line) {
        measure(ctx, p.t, p.run, p.run.tamanho, esp);
        ctx.fillStyle = p.run.cor || "#000";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.t, x, base);
        x += p.w;
      }
      y += lh;
    }
    try { ctx.letterSpacing = "0px"; } catch (e) {}
    return y - cx.top;
  }

  // ---------- foto ----------
  function areaFoto(tpl) {
    const r = tpl.render || {};
    if (r.clip) return { top: r.clip.top, left: r.clip.left, width: r.clip.width, height: r.clip.height };
    if (tpl.foto) return { ...tpl.foto };
    return { top: 0, left: 0, width: tpl.largura, height: tpl.altura };
  }
  // posição inicial: cobre a área da foto, centralizada
  function fotoPadrao(tpl, img) {
    const a = areaFoto(tpl);
    const s = Math.max(a.width / img.width, a.height / img.height);
    return { x: a.left + (a.width - img.width * s) / 2, y: a.top + (a.height - img.height * s) / 2, s };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r || 0);
    else ctx.rect(x, y, w, h);
  }
  function drawPhoto(ctx, tpl, foto) {
    if (!foto || !foto.img) return;
    const r = tpl.render || {};
    const pos = foto.pos || fotoPadrao(tpl, foto.img);
    ctx.save();
    if (r.clip) { roundRect(ctx, r.clip.left, r.clip.top, r.clip.width, r.clip.height, r.clip.raio || 0); ctx.clip(); }
    ctx.drawImage(foto.img, pos.x, pos.y, foto.img.width * pos.s, foto.img.height * pos.s);
    ctx.restore();
    if (r.borda && r.clip) {
      ctx.save(); ctx.lineWidth = r.borda.largura; ctx.strokeStyle = r.borda.cor;
      roundRect(ctx, r.clip.left, r.clip.top, r.clip.width, r.clip.height, r.clip.raio || 0); ctx.stroke(); ctx.restore();
    }
  }

  // ---------- arte completa ----------
  // opts: { tpl, camada: Image, fundo: Image|null, foto: {img,pos}|null, textos: {id: string|string[]}, canvas? }
  function renderArte(opts) {
    const { tpl } = opts;
    const cv = opts.canvas || document.createElement("canvas");
    cv.width = tpl.largura; cv.height = tpl.altura;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const r = tpl.render || {};
    if (r.fundo_cor) { ctx.fillStyle = r.fundo_cor; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (opts.fundo) ctx.drawImage(opts.fundo, 0, 0, cv.width, cv.height);
    if (!r.por_cima) drawPhoto(ctx, tpl, opts.foto);
    if (opts.camada) ctx.drawImage(opts.camada, 0, 0, cv.width, cv.height);
    if (r.por_cima) drawPhoto(ctx, tpl, opts.foto);
    const textos = opts.textos || {};
    for (const cx of tpl.caixas || []) {
      const v = textos[cx.id];
      if (v == null || (Array.isArray(v) ? v.every(x => !x) : v === "")) continue;
      drawBox(ctx, cx, v);
    }
    return cv;
  }

  // Foto solta do carrossel: corta no formato da arte (ex.: 1080x1350), centralizada ou com pos.
  function renderFotoSolta(img, largura, altura, pos) {
    const cv = document.createElement("canvas");
    cv.width = largura; cv.height = altura;
    const ctx = cv.getContext("2d");
    const s = pos?.s || Math.max(largura / img.width, altura / img.height);
    const x = pos?.x ?? (largura - img.width * s) / 2;
    const y = pos?.y ?? (altura - img.height * s) / 2;
    ctx.drawImage(img, x, y, img.width * s, img.height * s);
    return cv;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => res(i); i.onerror = rej; i.src = src;
    });
  }

  global.EsteiraRender = { loadFonts, ensureFonts, renderArte, renderFotoSolta, textosPadrao, preencher,
    fotoPadrao, areaFoto, loadImage, valorNum };
})(window);
