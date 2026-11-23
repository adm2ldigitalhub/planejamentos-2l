// Esteira de posts — 2L Digital Hub
// Página separada do sistema de planejamentos: mesmo login (Supabase) e mesmo config.js.
"use strict";
const CFG = window.APP_CONFIG || {};
const R = window.EsteiraRender;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const ok = ({ data, error }) => { if (error) throw error; return data; };
const S = { email: null, admin: false, lojas: [], tpls: [], cfg: {}, clients: [], fontsReady: false };
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const TIPOS = { anuncio: "Anúncio", vendido: "Vendido", comunicado: "Comunicado", imovel: "Imóvel" };
const STATUS = { novo: "Novo", pronto: "Pronto p/ revisar", revisado: "Revisado", salvo: "Salvo no Drive", erro: "Erro" };
const CAMPOS_CARRO = [["marca", "Marca"], ["modelo", "Modelo"], ["versao", "Versão"], ["ano", "Ano"], ["km", "KM"], ["valor", "Valor (R$)"],
  ["cambio", "Câmbio"], ["motor", "Motor"], ["combustivel", "Combustível"], ["detalhes", "Detalhe curto (capa)"]];
const CAMPOS_IMOVEL = [["tipo_imovel", "Tipo (CASA, APTO…)"], ["negocio", "Negócio (Venda/Locação)"], ["valor", "Valor (R$)"], ["bairro", "Bairro"], ["cidade", "Cidade"],
  ["condominio", "Condomínio"], ["area", "Área (m²)"], ["quartos", "Quartos"], ["suites", "Suítes"], ["banheiros", "Banheiros"], ["vagas", "Vagas"], ["destaque", "Destaque"]];

// ---------------- utilidades ----------------
function toast(msg, ms = 3200) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function erro(e) { console.error(e); toast("Erro: " + (e?.message || e), 6000); }
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const safeKey = p => p.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._\/-]+/g, "_");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const fmtData = d => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function baixar(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
const canvasBlob = (cv, type = "image/png", q) => new Promise(r => cv.toBlob(r, type, q));
const blobB64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(b); });

// arquivos do bucket (camadas, fontes, fotos) -> URL local
const blobCache = new Map(), imgCache = new Map();
function fileUrl(path) {
  if (!blobCache.has(path)) {
    const p = (async () => { const { data, error } = await sb.storage.from("esteira").download(path); if (error) throw error; return URL.createObjectURL(data); })();
    blobCache.set(path, p); p.catch(() => blobCache.delete(path));
  }
  return blobCache.get(path);
}
function storageImg(path) {
  if (!imgCache.has(path)) { const p = fileUrl(path).then(R.loadImage); imgCache.set(path, p); p.catch(() => imgCache.delete(path)); }
  return imgCache.get(path);
}
async function fontsReady() {
  if (S.fontsReady) return;
  if (!S.cfg.fontes) throw new Error("Os templates ainda não foram importados (aba Lojas).");
  await R.loadFonts(S.cfg.fontes, a => fileUrl(a));
  S.fontsReady = true;
}
// funções do Supabase (IA e Drive)
async function fn(nome, body) {
  const { data, error } = await sb.functions.invoke(nome, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.erro || j.error || msg; } catch (e) {}
    if (/not found|404|Failed to send/i.test(msg)) msg = (nome === "esteira-ia" ? "A IA" : "O Drive") + " ainda não foi configurado no Supabase (ver LEIA-ME da esteira).";
    throw new Error(msg);
  }
  return data;
}

// ---------------- dados base ----------------
async function loadBase() {
  const [lojas, tpls, cfg, clients] = await Promise.all([
    sb.from("esteira_lojas").select("*").order("nome"),
    sb.from("esteira_templates").select("*"),
    sb.from("esteira_config").select("data").eq("id", 1).maybeSingle(),
    sb.from("clients").select("id,name,status").order("name")
  ]);
  S.lojas = ok(lojas) || []; S.tpls = ok(tpls) || []; S.cfg = (ok(cfg) || {}).data || {}; S.clients = ok(clients) || [];
}
const lojaObj = nome => S.lojas.find(l => l.nome === nome) || { nome, dados: {} };
const lojaLabel = nome => { const l = lojaObj(nome); const c = S.clients.find(c => c.id === l.client_id); return c ? c.name : nome; };
function tplDo(loja, tipo, variacao = "padrao") {
  const tt = tipo === "anuncio" ? "anuncio" : tipo;
  const list = S.tpls.filter(t => t.loja === loja && t.tipo === tt && t.liberado);
  return list.find(t => t.variacao === variacao) || list.find(t => t.variacao === "padrao") || null;
}
const variacoes = (loja, tipo) => [...new Set(S.tpls.filter(t => t.loja === loja && t.tipo === tipo && t.liberado).map(t => t.variacao))];
const tiposDaLoja = loja => Object.keys(TIPOS).filter(t => tplDo(loja, t));
const lojasCom = tipo => S.lojas.filter(l => l.ativo !== false && tplDo(l.nome, tipo));

// ---------------- login / navegação ----------------
async function boot() {
  if (!CFG.SUPABASE_URL) { $("#main").innerHTML = `<div class="empty">Preencha o config.js do sistema primeiro.</div>`; return; }
  const { data } = await sb.auth.getSession();
  if (!data.session) return viewLogin();
  S.email = data.session.user.email;
  // permissões do 2L Core (Ajustes > Acessos): "esteira" para usar, "acessos" para configurar lojas e templates
  let perms = [];
  try { perms = ok(await sb.rpc("my_perms")) || []; } catch (e) { console.error(e); }
  S.admin = perms.includes("acessos");
  $("#who").textContent = S.email + (S.admin ? " · admin" : "");
  if (!perms.includes("esteira")) {
    $("#main").innerHTML = `<div class="empty"><strong>Seu login não tem acesso à esteira</strong>Peça para o administrador liberar em Ajustes &gt; Gerenciar acessos.</div>`;
    return;
  }
  try { await loadBase(); } catch (e) {
    $("#main").innerHTML = `<div class="empty"><strong>Banco da esteira não encontrado</strong>Rode o arquivo <b>esteira/esteira.sql</b> no Supabase (SQL Editor) e recarregue.<br><span class="small">${esc(e.message)}</span></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}
function viewLogin() {
  $("#tabs").innerHTML = "";
  $("#main").innerHTML = `<form class="login card" id="lf"><h1>Entrar</h1><p class="sub">Mesmo login do sistema de planejamentos.</p>
    <input id="le" type="email" placeholder="e-mail" required style="margin-bottom:8px"><input id="lp" type="password" placeholder="senha" required style="margin-bottom:12px">
    <button class="btn primary" style="width:100%">Entrar</button></form>`;
  $("#lf").onsubmit = async ev => {
    ev.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("#le").value, password: $("#lp").value });
    if (error) return toast("Login inválido");
    location.reload();
  };
}
function renderTabs(v) {
  const tabs = [["fila", "Fila"], ["novo", "Novo lote"], ["comunicado", "Comunicados"], ["lojas", "Lojas e templates"]];
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<a href="#${k}" class="${v === k ? "on" : ""}">${l}</a>`).join("");
}
let leaveHooks = [];
function route() {
  leaveHooks.forEach(f => { try { f(); } catch (e) {} }); leaveHooks = [];
  const [v, ...rest] = (location.hash.slice(1) || "fila").split("/");
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : null;
  renderTabs(v === "post" ? "fila" : v === "ajustar" ? "lojas" : v);
  window.scrollTo(0, 0);
  const views = { fila: viewFila, novo: viewNovo, post: viewPost, comunicado: viewComunicado, lojas: viewLojas, ajustar: viewAjustar };
  Promise.resolve((views[v] || viewFila)(arg)).catch(erro);
}

// ---------------- leitura simples da mensagem do lojista (sem IA) ----------------
const MARCAS = ["VOLKSWAGEN", "VW", "CHEVROLET", "GM", "FIAT", "FORD", "HONDA", "TOYOTA", "HYUNDAI", "RENAULT", "NISSAN", "JEEP", "PEUGEOT", "CITROEN", "CITROËN",
  "MITSUBISHI", "KIA", "BMW", "AUDI", "MERCEDES", "MERCEDES-BENZ", "YAMAHA", "CAOA CHERY", "CHERY", "BYD", "GWM", "RAM", "VOLVO", "LAND ROVER", "SUZUKI", "SUBARU",
  "DODGE", "PORSCHE", "MINI", "JAC", "LIFAN", "TROLLER", "KAWASAKI", "DAFRA", "SHINERAY", "HAOJUE", "TRIUMPH", "HARLEY-DAVIDSON", "BAJAJ"];
const MODELO_MARCA = {
  CHEVROLET: "ONIX PRISMA S10 CRUZE TRACKER SPIN COBALT CELTA CORSA MONTANA CAMARO EQUINOX TRAILBLAZER AGILE CLASSIC ASTRA VECTRA MERIVA ZAFIRA",
  VOLKSWAGEN: "GOL SAVEIRO POLO VIRTUS T-CROSS NIVUS AMAROK UP FOX VOYAGE JETTA GOLF TIGUAN TAOS CROSSFOX SPACEFOX PARATI KOMBI",
  FIAT: "PALIO UNO STRADA TORO MOBI ARGO CRONOS SIENA DOBLO DOBLÒ FIORINO PULSE FASTBACK IDEA PUNTO BRAVO WEEKEND GRAND",
  HYUNDAI: "HB20 HB20S CRETA TUCSON IX35 AZERA ELANTRA SANTA", HONDA: "CIVIC CITY FIT HR-V HRV WR-V CR-V CG BIZ CB XRE POP PCX TITAN FAN TWISTER BROS NXR",
  TOYOTA: "COROLLA HILUX ETIOS YARIS SW4 RAV4 PRIUS", FORD: "KA FIESTA FOCUS ECOSPORT RANGER FUSION EDGE TERRITORY MAVERICK",
  RENAULT: "SANDERO LOGAN DUSTER KWID OROCH CAPTUR CLIO MEGANE FLUENCE STEPWAY", JEEP: "COMPASS RENEGADE COMMANDER WRANGLER CHEROKEE",
  NISSAN: "KICKS VERSA FRONTIER MARCH SENTRA LIVINA TIIDA", PEUGEOT: "208 2008 3008 207 206 308 408 PARTNER", CITROEN: "C3 C4 AIRCROSS CACTUS",
  MITSUBISHI: "L200 PAJERO OUTLANDER ASX ECLIPSE LANCER", YAMAHA: "FAZER FACTOR XTZ LANDER CROSSER NMAX MT-03 MT-07 YBR NEO", KIA: "SPORTAGE CERATO SORENTO PICANTO SOUL STONIC",
};
function parseMensagem(msg) {
  const d = {}; if (!msg) return d;
  const txt = msg.replace(/\r/g, "");
  const linhas = txt.split("\n").map(l => l.trim()).filter(Boolean);
  const vm = txt.match(/R\$\s*([\d.]+(?:,\d{2})?)/i) || txt.match(/(?:valor|pre[cç]o|por)\s*:?\s*([\d]{2,3}(?:\.\d{3})+)/i);
  if (vm) d.valor = vm[1];
  const km = txt.match(/([\d][\d.]*)\s*(?:mil\s*)?km\b/i) || txt.match(/\bkm\s*:?\s*([\d.]+)/i);
  if (km) d.km = /mil\s*km/i.test(km[0]) ? String(parseInt(km[1]) * 1000) : km[1];
  const ano = txt.match(/\b((?:19[89]|20[0-4])\d)\s*\/\s*((?:19[89]|20[0-4])\d|\d{2})\b/) || txt.match(/\b((?:19[89]|20[0-4])\d)\b/);
  if (ano) d.ano = ano[2] ? `${ano[1]}/${ano[2].length === 2 ? ano[1].slice(0, 2) + ano[2] : ano[2]}` : ano[1];
  const cam = txt.match(/autom[aá]tic[oa]|manual|cvt|automatizad[oa]/i); if (cam) d.cambio = cam[0][0].toUpperCase() + cam[0].slice(1).toLowerCase();
  const comb = txt.match(/\b(flex|diesel|gasolina|el[eé]trico|h[ií]brido|gnv)\b/i); if (comb) d.combustivel = comb[1][0].toUpperCase() + comb[1].slice(1).toLowerCase();
  const mot = txt.match(/\b(\d\.\d)(\s*(?:turbo|tsi|tfsi|t))?\b/i); if (mot) d.motor = mot[0].trim().toUpperCase().replace(/\s+/g, " ");
  // título: primeira linha
  let t = (linhas[0] || "").toUpperCase().replace(/R\$.*$/, "").replace(/\b(19[89]\d|20[0-4]\d)(\s*\/\s*\d{2,4})?\b/g, "").replace(/\s{2,}/g, " ").trim();
  let marca = MARCAS.find(m => t.startsWith(m + " "));
  if (marca) t = t.slice(marca.length).trim();
  const palavras = t.split(" ").filter(Boolean);
  if (!marca && palavras[0]) marca = Object.keys(MODELO_MARCA).find(k => MODELO_MARCA[k].split(" ").includes(palavras[0]));
  if (marca) d.marca = marca === "VW" ? "VOLKSWAGEN" : marca === "GM" ? "CHEVROLET" : marca;
  if (palavras.length) { d.modelo = palavras[0]; d.versao = palavras.slice(1).join(" "); }
  // destaques para a legenda: linhas que não são título/valor/km
  d.destaques = linhas.slice(1).filter(l => !/R\$|^\d[\d.]*\s*km$/i.test(l) && l.length < 80);
  return d;
}
function nomeCarro(d) {
  if (d.tipo === "imovel") return [d.tipo_imovel, d.bairro].filter(Boolean).join(" ").toUpperCase() || "IMOVEL";
  return [d.marca, d.modelo, d.versao, (d.ano || "").split("/").pop()].filter(Boolean).join(" ").toUpperCase().replace(/[\\/:*?"<>|]+/g, "-").trim() || "CARRO";
}
// conversa exportada do WhatsApp (_chat.txt): só o texto das mensagens
function textoDoChat(chat) {
  return chat.replace(/\r/g, "").split("\n").map(l => l
    .replace(/^‎?\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?/, "")
    .replace(/^[^:]{1,40}:\s/, "")).filter(l => l && !/<anexado|anexado:|\.(jpe?g|png|webp|heic|mp4|opus)\b|omitid|mensagens e chamadas|criptografia/i.test(l)).join("\n").trim();
}
// foto -> JPEG até 1600px (economiza espaço no Supabase)
async function comprimir(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const out = await canvasBlob(cv, "image/jpeg", 0.86);
  return { blob: out, w: cv.width, h: cv.height };
}

// ---------------- FILA ----------------
async function viewFila(filtroLote) {
  const m = $("#main");
  m.innerHTML = `<h1>Fila</h1><p class="sub">Carros, vendidos e comunicados em andamento. Clique para revisar.</p>
    <div class="row" style="margin-bottom:12px">
      <select id="fs" style="max-width:200px"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <select id="fl" style="max-width:240px"><option value="">Todas as lojas</option>${S.lojas.map(l => `<option value="${esc(l.nome)}">${esc(lojaLabel(l.nome))}</option>`).join("")}</select>
      <input id="fq" placeholder="Buscar carro…" style="max-width:240px">
      ${filtroLote ? `<span class="pill">só este lote <a href="#fila">×</a></span>` : ""}
      <span class="grow"></span><a class="btn primary" href="#novo">+ Novo lote</a>
    </div><div id="lista"><p class="muted">Carregando…</p></div>`;
  let posts = [];
  async function carregar() {
    let q = sb.from("esteira_posts").select("id,lote_id,loja,tipo,status,dados,fotos,capa,editando_por,editando_em,updated_at,atualizado_por,created_at,erro").order("created_at", { ascending: false }).limit(300);
    if (filtroLote) q = q.eq("lote_id", filtroLote);
    posts = ok(await q); desenhar();
  }
  function desenhar() {
    const fs = $("#fs").value, fl = $("#fl").value, fq = norm($("#fq").value);
    const vis = posts.filter(p => (!fs || p.status === fs) && (!fl || p.loja === fl) && (!fq || norm(nomeCarro(p.dados || {}) + " " + p.loja).includes(fq)));
    if (!vis.length) { $("#lista").innerHTML = `<div class="empty"><strong>Nada por aqui</strong>Crie um lote com os ZIPs do WhatsApp em “Novo lote”.</div>`; return; }
    const agora = Date.now();
    $("#lista").innerHTML = `<table class="list"><thead><tr><th></th><th>Loja</th><th>Post</th><th>Status</th><th>Atualizado</th></tr></thead><tbody>${vis.map(p => {
      const lock = p.editando_por && p.editando_por !== S.email && agora - new Date(p.editando_em) < 180000;
      const titulo = p.tipo === "comunicado" ? (p.dados?.comunicado || "").slice(0, 60) : nomeCarro({ ...p.dados, tipo: p.tipo });
      return `<tr class="click" data-id="${p.id}"><td><img class="thumb" data-path="${esc(p.fotos?.[p.capa || 0]?.path || "")}" alt=""></td>
        <td>${esc(lojaLabel(p.loja))}</td><td><b>${esc(titulo)}</b><div class="small muted">${TIPOS[p.tipo] || p.tipo}${p.erro ? " · " + esc(p.erro) : ""}</div></td>
        <td><span class="pill ${p.status}">${STATUS[p.status] || p.status}</span>${lock ? ` <span class="pill lock">✎ ${esc(p.editando_por.split("@")[0])}</span>` : ""}</td>
        <td class="small muted">${fmtData(p.updated_at)}${p.atualizado_por ? "<br>" + esc(p.atualizado_por.split("@")[0]) : ""}</td></tr>`;
    }).join("")}</tbody></table>`;
    $$("#lista tr.click").forEach(tr => tr.onclick = () => location.hash = "post/" + tr.dataset.id);
    $$("#lista img[data-path]").forEach(async img => { if (img.dataset.path) try { img.src = await fileUrl(img.dataset.path); } catch (e) {} });
  }
  ["fs", "fl"].forEach(id => $("#" + id).onchange = desenhar); $("#fq").oninput = desenhar;
  await carregar();
  let t; const ch = sb.channel("fila-" + uuid()).on("postgres_changes", { event: "*", schema: "public", table: "esteira_posts" }, () => { clearTimeout(t); t = setTimeout(carregar, 600); }).subscribe();
  leaveHooks.push(() => sb.removeChannel(ch));
}

// ---------------- NOVO LOTE ----------------
async function viewNovo() {
  const lojas = S.lojas.filter(l => l.ativo !== false && (tplDo(l.nome, "anuncio") || tplDo(l.nome, "vendido") || tplDo(l.nome, "imovel")));
  const m = $("#main");
  m.innerHTML = `<h1>Novo lote</h1><p class="sub">Arraste os ZIPs do WhatsApp (um por carro). Pode arrastar fotos soltas também: viram um carro só.</p>
    <label class="drop" id="drop">Solte os ZIPs aqui ou <u>clique para escolher</u><input type="file" id="fi" multiple accept=".zip,image/*" hidden></label>
    <div id="rows" class="card hidden" style="padding:0;margin-top:14px"></div>
    <div class="row hidden" id="acts" style="margin-top:14px"><span class="grow muted small" id="resumo"></span><button class="btn primary" id="criar">Criar lote e enviar fotos</button></div>
    <div id="progbox" class="hidden card" style="margin-top:14px"><b id="progtxt">Enviando…</b><div class="prog"><i id="progbar"></i></div></div>`;
  const itens = [];
  const lojaOpts = sel => `<option value="">Escolha a loja…</option>` + lojas.map(l => `<option value="${esc(l.nome)}" ${l.nome === sel ? "selected" : ""}>${esc(lojaLabel(l.nome))}</option>`).join("");
  function adivinharLoja(texto) {
    const n = norm(texto);
    return (lojas.find(l => n.includes(norm(l.nome))) || lojas.find(l => { const p = norm(lojaLabel(l.nome)).split(" ")[0]; return p.length > 2 && n.includes(p); }))?.nome || "";
  }
  async function addArquivos(files) {
    const soltas = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          const zip = await JSZip.loadAsync(f);
          const fotos = [], ents = Object.values(zip.files).filter(e => !e.dir).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          let chat = "";
          for (const e of ents) {
            if (/\.(jpe?g|png|webp)$/i.test(e.name)) fotos.push(new File([await e.async("blob")], e.name.split("/").pop(), { type: "image/jpeg" }));
            else if (/\.txt$/i.test(e.name)) chat += await e.async("string") + "\n";
          }
          const heic = ents.some(e => /\.heic$/i.test(e.name));
          const msg = chat ? textoDoChat(chat) : "";
          itens.push({ nome: f.name, fotos, loja: adivinharLoja(f.name + " " + chat.slice(0, 400)), tipo: /vendid/i.test(f.name + msg) ? "vendido" : "anuncio", mensagem: msg, aviso: heic ? "Tem fotos HEIC (iPhone) que o navegador não lê: mande em JPG." : "" });
        } catch (e) { toast("Não consegui abrir " + f.name); }
      } else if (/^image\//.test(f.type)) soltas.push(f);
    }
    if (soltas.length) itens.push({ nome: "Fotos soltas", fotos: soltas, loja: "", tipo: "anuncio", mensagem: "" });
    desenhar();
  }
  function desenhar() {
    $("#rows").classList.toggle("hidden", !itens.length); $("#acts").classList.toggle("hidden", !itens.length);
    $("#rows").innerHTML = itens.map((it, i) => {
      const tipos = it.loja ? tiposDaLoja(it.loja).filter(t => t !== "comunicado") : ["anuncio", "vendido"];
      return `<div class="lote-row" data-i="${i}">
      <div class="ph" data-ph="${i}"></div>
      <div><div class="small muted">${esc(it.nome)} · ${it.fotos.length} foto(s)${it.aviso ? ` · <b style="color:var(--bad)">${esc(it.aviso)}</b>` : ""}</div>
        <textarea data-k="mensagem" placeholder="Cole aqui a mensagem do lojista (modelo, ano, km, valor…)">${esc(it.mensagem)}</textarea></div>
      <div><label class="f">Loja</label><select data-k="loja">${lojaOpts(it.loja)}</select></div>
      <div><label class="f">Tipo</label><select data-k="tipo">${tipos.map(t => `<option value="${t}" ${t === it.tipo ? "selected" : ""}>${TIPOS[t]}</option>`).join("")}</select></div>
      <button class="btn small ghost" data-rm="${i}" title="Tirar">×</button></div>`;
    }).join("");
    itens.forEach((it, i) => {
      const box = $(`[data-ph="${i}"]`);
      it.fotos.slice(0, 4).forEach(f => { const im = document.createElement("img"); im.src = it._u?.[f.name] || (it._u = it._u || {}, it._u[f.name] = URL.createObjectURL(f)); box.appendChild(im); });
    });
    $$("#rows [data-k]").forEach(el => el.onchange = el.oninput = () => {
      const it = itens[el.closest("[data-i]").dataset.i]; it[el.dataset.k] = el.value;
      if (el.dataset.k === "loja") desenhar();
    });
    $$("#rows [data-rm]").forEach(b => b.onclick = () => { itens.splice(+b.dataset.rm, 1); desenhar(); });
    const falta = itens.filter(i => !i.loja).length;
    $("#resumo").textContent = `${itens.length} item(ns)` + (falta ? ` · ${falta} sem loja` : "");
  }
  const drop = $("#drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addArquivos([...e.dataTransfer.files]); };
  $("#fi").onchange = e => { addArquivos([...e.target.files]); e.target.value = ""; };
  $("#criar").onclick = async () => {
    if (itens.some(i => !i.loja)) return toast("Escolha a loja de todos os itens.");
    if (itens.some(i => !i.fotos.length && i.tipo !== "comunicado")) return toast("Tem item sem foto.");
    $("#criar").disabled = true; $("#progbox").classList.remove("hidden");
    try {
      const lote = ok(await sb.from("esteira_lotes").insert({ nome: new Date().toLocaleString("pt-BR") }).select().single());
      const total = itens.reduce((s, i) => s + i.fotos.length, 0); let feito = 0;
      for (const it of itens) {
        const id = uuid(), fotos = [];
        for (let k = 0; k < it.fotos.length; k++) {
          $("#progtxt").textContent = `Enviando fotos (${feito + 1}/${total})…`;
          const c = await comprimir(it.fotos[k]);
          const path = `fotos/${id}/${String(k + 1).padStart(2, "0")}.jpg`;
          ok(await sb.storage.from("esteira").upload(path, c.blob, { contentType: "image/jpeg", upsert: true }));
          fotos.push({ path, w: c.w, h: c.h, nome: it.fotos[k].name });
          feito++; $("#progbar").style.width = (100 * feito / total) + "%";
        }
        const dados = { ...parseMensagem(it.mensagem), tipo: it.tipo };
        ok(await sb.from("esteira_posts").insert({ id, lote_id: lote.id, loja: it.loja, tipo: it.tipo, mensagem: it.mensagem, fotos, dados, status: "novo",
          ordem: fotos.map((_, i) => i).filter(i => i !== 0) }));
      }
      // IA em segundo plano (se configurada): processa o lote
      $("#progtxt").textContent = "Lendo as mensagens com IA…";
      await processarLoteIA(lote.id, (n, t) => { $("#progtxt").textContent = `Lendo as mensagens com IA (${n}/${t})…`; $("#progbar").style.width = (100 * n / t) + "%"; });
      toast("Lote criado!"); location.hash = "fila/" + lote.id;
    } catch (e) { erro(e); $("#criar").disabled = false; }
  };
}

// IA: extrai dados e escreve a legenda. Sem IA configurada, fica o que a leitura simples achou.
async function processarLoteIA(loteId, onProg) {
  const posts = ok(await sb.from("esteira_posts").select("*").eq("lote_id", loteId));
  let n = 0;
  for (const p of posts) {
    n++; onProg && onProg(n, posts.length);
    try { await processarPostIA(p); }
    catch (e) {
      if (/não foi configurad/.test(e.message)) { toast("IA ainda não configurada: dados lidos sem IA. Confira cada carro."); break; }
      await sb.from("esteira_posts").update({ erro: "IA: " + e.message }).eq("id", p.id);
    }
  }
}
async function processarPostIA(p) {
  const loja = lojaObj(p.loja);
  const r = await fn("esteira-ia", { acao: p.tipo === "vendido" ? "vendido" : p.tipo === "imovel" ? "imovel" : "anuncio",
    mensagem: p.mensagem, loja: { nome: lojaLabel(p.loja), legenda_modelo: loja.legenda_modelo || "", dados: loja.dados || {} } });
  const dados = { ...p.dados, ...(r.dados || {}), tipo: p.tipo };
  const upd = { dados, legenda: r.legenda || p.legenda || "", status: "pronto", erro: null };
  ok(await sb.from("esteira_posts").update(upd).eq("id", p.id));
  return upd;
}

// ---------------- EDITOR DO POST ----------------
async function viewPost(id) {
  const m = $("#main");
  m.innerHTML = `<p class="muted">Abrindo…</p>`;
  let P = ok(await sb.from("esteira_posts").select("*").eq("id", id).single());
  await fontsReady();
  const E = { fotos: [], salvarT: null, canvas: null, travado: false };
  // trava para uma pessoa por vez
  async function pegar(forcar) {
    const r = ok(await sb.rpc("esteira_pegar", { pid: id, forcar: !!forcar }));
    E.travado = !r.ok; E.travadoPor = r.por; return r.ok;
  }
  await pegar(false);
  const hb = setInterval(() => { if (!E.travado) sb.rpc("esteira_pegar", { pid: id, forcar: false }); }, 60000);
  leaveHooks.push(() => { clearInterval(hb); if (!E.travado) sb.rpc("esteira_soltar", { pid: id }); flush(); });

  const imovel = P.tipo === "imovel", comunicado = P.tipo === "comunicado";
  const campos = imovel ? CAMPOS_IMOVEL : CAMPOS_CARRO;
  let tpl = tplDo(P.loja, P.tipo, P.variacao);
  const fundoDe = t => t?.render?.fundo_camada ? S.tpls.find(x => x.loja === t.loja && x.arte === t.render.fundo_camada && x.variacao === t.variacao) || S.tpls.find(x => x.loja === t.loja && x.arte === t.render.fundo_camada) : null;
  if (P.ordem == null) P.ordem = (P.fotos || []).map((_, i) => i).filter(i => i !== (P.capa || 0));
  const vars = variacoes(P.loja, P.tipo);

  m.innerHTML = `<a href="#fila" class="muted small">← Fila</a>
    <div id="lockbar"></div>
    <div class="row" style="margin:6px 0 16px"><div class="grow"><h1 style="margin:0">${esc(lojaLabel(P.loja))}</h1><span class="muted small">${TIPOS[P.tipo]} · criado por ${esc((P.criado_por || "").split("@")[0])} ${fmtData(P.created_at)}</span></div>
      <select id="st" style="max-width:190px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${P.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    ${!tpl ? `<div class="lockbar">Esta loja não tem template liberado para ${TIPOS[P.tipo]}.</div>` : ""}
    <div class="editor">
      <div class="stage">
        <canvas id="cv"></canvas>
        ${comunicado ? "" : `<div class="row small" style="margin-top:8px"><span class="muted">Zoom</span><input type="range" id="zoom" min="0.3" max="3" step="0.01" class="grow">
          <button class="btn small ghost" id="enq" title="Detecta o carro e enquadra">Enquadrar carro</button><button class="btn small ghost" id="cent">Centralizar</button></div>
          <div class="small muted">Arraste a foto para posicionar. Clique numa miniatura para trocar a foto da capa; o “×” tira a foto do carrossel; arraste para reordenar.</div>
          <div class="strip" id="strip"></div>`}
      </div>
      <div>
        ${vars.length > 1 ? `<div class="card" style="margin-bottom:12px"><label class="f">Variação do template</label><select id="var">${vars.map(v => `<option ${v === (P.variacao || "padrao") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>` : ""}
        <div class="card" style="margin-bottom:12px">
          <div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">${comunicado ? "Texto do comunicado" : "Dados"}</h2>
            ${comunicado ? "" : `<button class="btn small ghost" id="ia">Ler mensagem com IA</button>`}</div>
          ${comunicado ? `<textarea id="com" rows="7">${esc(P.dados?.comunicado || "")}</textarea>` :
          `<details ${P.mensagem ? "" : "open"}><summary>Mensagem do lojista</summary><textarea id="msg" rows="4">${esc(P.mensagem || "")}</textarea>
             <button class="btn small ghost" id="reler" style="margin-top:6px">Ler de novo (sem IA)</button></details>
           <div class="grid2" id="campos">${campos.map(([k, l]) => `<div><label class="f">${l}</label><input data-c="${k}" value="${esc(P.dados?.[k] ?? "")}"></div>`).join("")}</div>`}
        </div>
        <div class="card" style="margin-bottom:12px"><h2>Textos da capa</h2><p class="small muted" style="margin-top:-6px">Saem dos dados. Se mudar algum aqui, ele fica fixo (↺ volta ao automático).</p><div id="boxes"></div></div>
        ${comunicado ? "" : `<div class="card" style="margin-bottom:12px"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Legenda</h2>
          <button class="btn small ghost" id="leg">Gerar com IA</button></div><textarea id="legenda" rows="12">${esc(P.legenda || "")}</textarea></div>`}
        <div class="card"><div class="row">
          <button class="btn" id="bcapa">Baixar só a capa</button>
          ${comunicado || P.tipo === "vendido" ? "" : `<button class="btn" id="bzip">Baixar carrossel (.zip)</button>`}
          <button class="btn primary" id="bdrive">Salvar no Drive</button>
          <span class="small muted grow" id="savest"></span></div>
          ${P.drive_url ? `<p class="small" style="margin:8px 0 0"><a href="${esc(P.drive_url)}" target="_blank" rel="noopener">Abrir pasta no Drive ↗</a></p>` : ""}
          <div id="drvprog" class="hidden"><div class="prog"><i></i></div></div></div>
      </div>
    </div>`;
  E.canvas = $("#cv");

  function lockUI() {
    $("#lockbar").innerHTML = E.travado ? `<div class="lockbar">✎ <b>${esc(E.travadoPor || "Outra pessoa")}</b> está editando este post agora. Você está vendo sem poder salvar.
      <button class="btn small" id="assumir" style="margin-left:8px">Assumir mesmo assim</button></div>` : "";
    if (E.travado) $("#assumir").onclick = async () => { await pegar(true); lockUI(); };
    $$("#main input, #main textarea, #main select").forEach(el => { if (!el.closest("#lockbar")) el.disabled = E.travado; });
  }

  // fotos
  const fotoImgs = await Promise.all((P.fotos || []).map(f => storageImg(f.path).catch(() => null)));
  const dadosAtuais = () => ({ ...(P.dados || {}), tipo: P.tipo });
  function textosFinais() {
    if (!tpl) return {};
    const auto = R.textosPadrao(tpl, dadosAtuais());
    const out = { ...auto };
    for (const [k, v] of Object.entries(P.textos || {})) if (v != null && k in auto) out[k] = v;
    return out;
  }
  async function desenhar() {
    if (!tpl) return;
    await R.ensureFonts(tpl);
    const camada = await storageImg(tpl.camada_path);
    const ft = fundoDe(tpl); const fundo = ft ? await storageImg(ft.camada_path) : null;
    const img = fotoImgs[P.capa || 0];
    if (img && !P.foto_pos) P.foto_pos = R.fotoPadrao(tpl, img);
    R.renderArte({ tpl, camada, fundo, foto: img && !comunicado ? { img, pos: P.foto_pos } : null, textos: textosFinais(), canvas: E.canvas });
    if ($("#zoom") && P.foto_pos) $("#zoom").value = P.foto_pos.s / R.fotoPadrao(tpl, img || { width: 1, height: 1 }).s;
  }
  function desenharBoxes() {
    if (!tpl) { $("#boxes").innerHTML = ""; return; }
    const auto = R.textosPadrao(tpl, dadosAtuais()), fin = textosFinais();
    $("#boxes").innerHTML = tpl.caixas.map(cx => {
      const editado = P.textos && P.textos[cx.id] != null;
      if (cx.trechos) return cx.trechos.map((r, i) => `<div class="box-txt ${editado ? "edit" : ""}"><div><label class="f">${esc(cx.campo)} · ${esc(r.nome)}</label>
        <input data-box="${cx.id}" data-run="${i}" value="${esc((fin[cx.id] || [])[i] || "")}"></div>${i === 0 ? `<button class="auto" data-reset="${cx.id}" title="Voltar ao automático">↺</button>` : "<span></span>"}</div>`).join("");
      const multi = /\{comunicado\}/.test(cx.modelo || "");
      return `<div class="box-txt ${editado ? "edit" : ""}"><div><label class="f">${esc(cx.campo)}</label>${multi && !comunicado ? `<textarea data-box="${cx.id}" rows="3">${esc(fin[cx.id])}</textarea>` : multi ? `<div class="small muted">(vem do texto do comunicado acima)</div>` : `<input data-box="${cx.id}" value="${esc(fin[cx.id])}">`}</div>
        <button class="auto" data-reset="${cx.id}" title="Voltar ao automático: ${esc(auto[cx.id])}">↺</button></div>`;
    }).join("");
    $$("#boxes [data-box]").forEach(el => el.oninput = () => {
      P.textos = P.textos || {};
      const cx = tpl.caixas.find(c => c.id === el.dataset.box);
      if (cx.trechos) { const arr = [...(textosFinais()[cx.id] || [])]; arr[+el.dataset.run] = el.value; P.textos[cx.id] = arr; }
      else P.textos[cx.id] = el.value;
      el.closest(".box-txt").classList.add("edit"); mudou();
    });
    $$("#boxes [data-reset]").forEach(b => b.onclick = () => { if (P.textos) delete P.textos[b.dataset.reset]; desenharBoxes(); mudou(); });
    if (E.travado) lockUI();
  }
  function desenharStrip() {
    const st = $("#strip"); if (!st) return;
    st.innerHTML = (P.fotos || []).map((f, i) => `<div class="it ${i === (P.capa || 0) ? "capa" : ""} ${i !== (P.capa || 0) && !P.ordem.includes(i) ? "off" : ""}" draggable="true" data-i="${i}">
      <img data-p="${esc(f.path)}" alt="foto ${i + 1}"><button class="x" data-x="${i}" title="Tirar/colocar no carrossel">${P.ordem.includes(i) ? "×" : "+"}</button></div>`).join("");
    // ordem visual: capa primeiro, depois a ordem do carrossel, depois as tiradas
    const seq = [P.capa || 0, ...P.ordem.filter(i => i !== (P.capa || 0)), ...(P.fotos || []).map((_, i) => i).filter(i => i !== (P.capa || 0) && !P.ordem.includes(i))];
    seq.forEach(i => st.appendChild(st.querySelector(`[data-i="${i}"]`)));
    $$("#strip img").forEach(async im => im.src = await fileUrl(im.dataset.p));
    $$("#strip .it").forEach(it => {
      it.querySelector("img").onclick = () => {
        const i = +it.dataset.i; if (i === (P.capa || 0)) return;
        const antiga = P.capa || 0; P.capa = i; P.ordem = P.ordem.filter(x => x !== i); if (!P.ordem.includes(antiga)) P.ordem.unshift(antiga);
        P.foto_pos = null; desenharStrip(); desenhar(); mudou();
      };
      it.ondragstart = e => e.dataTransfer.setData("text/plain", it.dataset.i);
      it.ondragover = e => e.preventDefault();
      it.ondrop = e => {
        e.preventDefault(); const de = +e.dataTransfer.getData("text/plain"), para = +it.dataset.i;
        if (de === para || de === (P.capa || 0) || para === (P.capa || 0)) return;
        const o = P.ordem.filter(x => x !== de); const pos = o.indexOf(para); o.splice(pos < 0 ? o.length : pos, 0, de); P.ordem = o;
        desenharStrip(); mudou();
      };
    });
    $$("#strip [data-x]").forEach(b => b.onclick = e => {
      e.stopPropagation(); const i = +b.dataset.x; if (i === (P.capa || 0)) return;
      P.ordem = P.ordem.includes(i) ? P.ordem.filter(x => x !== i) : [...P.ordem, i]; desenharStrip(); mudou();
    });
  }

  // arrastar/zoom da foto
  if (!comunicado && tpl) {
    const cv = E.canvas; let drag = null;
    const k = () => cv.width / cv.getBoundingClientRect().width;
    cv.onpointerdown = e => { if (E.travado || !P.foto_pos) return; drag = { x: e.clientX, y: e.clientY, p: { ...P.foto_pos } }; cv.setPointerCapture(e.pointerId); cv.classList.add("drag"); };
    cv.onpointermove = e => { if (!drag) return; P.foto_pos = { ...drag.p, x: drag.p.x + (e.clientX - drag.x) * k(), y: drag.p.y + (e.clientY - drag.y) * k() }; desenhar(); };
    cv.onpointerup = cv.onpointercancel = () => { if (drag) { drag = null; cv.classList.remove("drag"); mudou(); } };
    const zoomPara = (ns, cxp, cyp) => {
      const p = P.foto_pos; if (!p) return;
      P.foto_pos = { s: ns, x: cxp - (cxp - p.x) * ns / p.s, y: cyp - (cyp - p.y) * ns / p.s }; desenhar(); mudou();
    };
    cv.onwheel = e => {
      if (E.travado || !P.foto_pos) return; e.preventDefault();
      const r = cv.getBoundingClientRect(); const px = (e.clientX - r.left) * k(), py = (e.clientY - r.top) * k();
      zoomPara(P.foto_pos.s * (e.deltaY < 0 ? 1.04 : 1 / 1.04), px, py);
    };
    $("#zoom").oninput = e => {
      const img = fotoImgs[P.capa || 0]; if (!img) return;
      const base = R.fotoPadrao(tpl, img).s; const a = R.areaFoto(tpl);
      zoomPara(base * +e.target.value, a.left + a.width / 2, a.top + a.height / 2);
    };
    $("#cent").onclick = () => { const img = fotoImgs[P.capa || 0]; if (img) { P.foto_pos = R.fotoPadrao(tpl, img); desenhar(); mudou(); } };
    $("#enq").onclick = async () => {
      const img = fotoImgs[P.capa || 0]; if (!img) return;
      $("#enq").disabled = true; $("#enq").textContent = "Procurando o carro…";
      try { const pos = await enquadrarCarro(tpl, img); if (pos) { P.foto_pos = pos; desenhar(); mudou(); } else toast("Não achei o carro na foto. Ajuste à mão."); }
      catch (e) { erro(e); }
      $("#enq").disabled = false; $("#enq").textContent = "Enquadrar carro";
    };
  }

  // salvar (automático)
  function mudou() {
    if (E.travado) return;
    $("#savest").textContent = "alterado…";
    clearTimeout(E.salvarT); E.salvarT = setTimeout(salvar, 1200);
  }
  async function salvar() {
    clearTimeout(E.salvarT); E.salvarT = null;
    if (E.travado) return;
    try {
      const row = { dados: P.dados, textos: P.textos || {}, legenda: P.legenda || "", capa: P.capa || 0, foto_pos: P.foto_pos, ordem: P.ordem,
        status: P.status, variacao: P.variacao || "padrao", mensagem: P.mensagem || "" };
      const r = ok(await sb.from("esteira_posts").update(row).eq("id", id).select("updated_at").single());
      P.updated_at = r.updated_at; $("#savest").textContent = "salvo ✓";
    } catch (e) { $("#savest").textContent = "não salvou"; erro(e); }
  }
  function flush() { if (E.salvarT) salvar(); }

  // eventos do formulário
  $$("#campos [data-c]").forEach(el => el.oninput = () => { P.dados = { ...(P.dados || {}), [el.dataset.c]: el.value }; desenharBoxes(); desenhar(); mudou(); });
  $("#com") && ($("#com").oninput = e => { P.dados = { ...(P.dados || {}), comunicado: e.target.value }; desenhar(); mudou(); });
  $("#msg") && ($("#msg").oninput = e => { P.mensagem = e.target.value; mudou(); });
  $("#legenda") && ($("#legenda").oninput = e => { P.legenda = e.target.value; mudou(); });
  $("#st").onchange = e => { P.status = e.target.value; mudou(); };
  $("#var") && ($("#var").onchange = e => { P.variacao = e.target.value; tpl = tplDo(P.loja, P.tipo, P.variacao); P.foto_pos = null; desenharBoxes(); desenhar(); mudou(); });
  $("#reler") && ($("#reler").onclick = () => {
    const d = parseMensagem(P.mensagem); P.dados = { ...(P.dados || {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
    $$("#campos [data-c]").forEach(el => el.value = P.dados[el.dataset.c] ?? ""); desenharBoxes(); desenhar(); mudou();
  });
  async function rodarIA(soLegenda) {
    const btn = soLegenda ? $("#leg") : $("#ia"); const txt = btn.textContent; btn.disabled = true; btn.textContent = "Pensando…";
    try {
      await salvar();
      const upd = await processarPostIA({ ...P });
      if (soLegenda) { P.legenda = upd.legenda; } else { P.dados = upd.dados; P.legenda = P.legenda || upd.legenda; }
      P.status = P.status === "novo" ? "pronto" : P.status;
      $$("#campos [data-c]").forEach(el => el.value = P.dados[el.dataset.c] ?? "");
      if ($("#legenda")) $("#legenda").value = P.legenda || ""; $("#st").value = P.status;
      desenharBoxes(); desenhar(); mudou();
    } catch (e) { erro(e); }
    btn.disabled = false; btn.textContent = txt;
  }
  $("#ia") && ($("#ia").onclick = () => rodarIA(false));
  $("#leg") && ($("#leg").onclick = () => rodarIA(true));

  // saídas
  async function capaCanvas() { await desenhar(); const c = document.createElement("canvas"); c.width = E.canvas.width; c.height = E.canvas.height; c.getContext("2d").drawImage(E.canvas, 0, 0); return c; }
  async function arquivos() {
    const out = [], pad = n => String(n).padStart(2, "0");
    out.push({ nome: `${pad(1)} - capa.png`, blob: await canvasBlob(await capaCanvas()) });
    if (P.tipo === "anuncio" || P.tipo === "imovel") {
      let n = 2;
      for (const i of P.ordem) {
        const img = fotoImgs[i]; if (!img) continue;
        const cv = R.renderFotoSolta(img, tpl.largura, tpl.altura, P.fotos_pos?.[i]);
        out.push({ nome: `${pad(n++)} - foto.jpg`, blob: await canvasBlob(cv, "image/jpeg", 0.92) });
      }
      const cta = S.tpls.find(t => t.loja === P.loja && t.tipo === "cta" && t.liberado);
      if (cta) {
        const im = await storageImg(cta.camada_path); const cv = document.createElement("canvas"); cv.width = cta.largura; cv.height = cta.altura;
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); out.push({ nome: `${pad(n++)} - cta.png`, blob: await canvasBlob(cv) });
      }
      const site = tplDo(P.loja, "site");
      if (site) {
        const img = fotoImgs[P.capa || 0]; const camada = await storageImg(site.camada_path);
        const cv = R.renderArte({ tpl: site, camada, foto: img ? { img } : null, textos: R.textosPadrao(site, dadosAtuais()) });
        out.push({ nome: `site.png`, blob: await canvasBlob(cv) });
      }
    }
    if (P.legenda) out.push({ nome: "legenda.txt", blob: new Blob([P.legenda], { type: "text/plain;charset=utf-8" }) });
    return out;
  }
  $("#bcapa").onclick = async () => { const c = await capaCanvas(); baixar(await canvasBlob(c), `${comunicado ? "COMUNICADO " + lojaLabel(P.loja) : nomeCarro(dadosAtuais())} - capa.png`); };
  $("#bzip") && ($("#bzip").onclick = async () => {
    const z = new JSZip(); for (const f of await arquivos()) z.file(f.nome, f.blob);
    baixar(await z.generateAsync({ type: "blob" }), nomeCarro(dadosAtuais()) + ".zip");
  });
  $("#bdrive").onclick = async () => {
    const loja = lojaObj(P.loja);
    if (!loja.drive_pasta_id) return toast("Falta configurar a pasta do Drive desta loja (aba Lojas e templates).");
    const b = $("#bdrive"); b.disabled = true; const bar = $("#drvprog"); bar.classList.remove("hidden");
    try {
      await salvar();
      const fs = await arquivos();
      const hoje = new Date();
      const padrao = (P.tipo === "vendido" && loja.dados?.drive_padrao_vendido) || (comunicado && loja.dados?.drive_padrao_comunicado) || loja.drive_padrao || "{CARRO}";
      const nome = comunicado ? "COMUNICADO " + hoje.toLocaleDateString("pt-BR").replace(/\//g, "-") : (P.tipo === "vendido" ? "VENDIDO " : "") + nomeCarro(dadosAtuais());
      const caminho = padrao.replace(/\{MES_NUM\}/g, String(hoje.getMonth() + 1).padStart(2, "0")).replace(/\{MES_NOME\}/g, MESES[hoje.getMonth()])
        .replace(/\{ANO\}/g, hoje.getFullYear()).replace(/\{CARRO\}/g, nome).replace(/\{TIPO\}/g, TIPOS[P.tipo].toUpperCase());
      const pasta = await fn("esteira-drive", { acao: "pasta", base: loja.drive_pasta_id, caminho });
      let n = 0;
      for (const f of fs) {
        await fn("esteira-drive", { acao: "arquivo", pasta: pasta.id, nome: f.nome, mime: f.blob.type || "application/octet-stream", base64: await blobB64(f.blob) });
        bar.querySelector("i").style.width = (100 * ++n / fs.length) + "%";
      }
      P.drive_url = pasta.url; P.status = "salvo"; $("#st").value = "salvo";
      ok(await sb.from("esteira_posts").update({ drive_url: pasta.url, status: "salvo" }).eq("id", id));
      toast("Salvo no Drive ✓");
    } catch (e) { erro(e); }
    b.disabled = false; bar.classList.add("hidden");
  };

  lockUI(); desenharStrip(); desenharBoxes(); await desenhar();
}

// detecção do carro (modelo gratuito que roda no navegador)
let cocoP = null;
function carregarScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function enquadrarCarro(tpl, img) {
  if (!cocoP) cocoP = (async () => {
    await carregarScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
    await carregarScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
    return window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  })();
  const model = await cocoP;
  const preds = (await model.detect(img)).filter(p => ["car", "truck", "motorcycle", "bus"].includes(p.class));
  if (!preds.length) return null;
  const [bx, by, bw, bh] = preds.sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3])[0].bbox;
  const a = R.areaFoto(tpl);
  const cover = Math.max(a.width / img.width, a.height / img.height);
  const s = Math.max(cover, Math.min(a.width * 0.92 / bw, a.height * 0.75 / bh));
  let x = a.left + a.width / 2 - (bx + bw / 2) * s, y = a.top + a.height * 0.56 - (by + bh / 2) * s;
  x = Math.min(a.left, Math.max(a.left + a.width - img.width * s, x));
  y = Math.min(a.top, Math.max(a.top + a.height - img.height * s, y));
  return { x, y, s };
}

// ---------------- COMUNICADOS ----------------
async function viewComunicado() {
  const lojas = lojasCom("comunicado");
  $("#main").innerHTML = `<h1>Comunicados</h1><p class="sub">Escreva o assunto uma vez, marque as lojas e a IA escreve um texto diferente para cada uma. Depois é só revisar na fila.</p>
    <div class="card" style="margin-bottom:12px"><label class="f">Assunto</label><textarea id="ass" rows="4" placeholder="Ex.: sexta 20/11 feriado da Consciência Negra, loja fechada, volta sábado normal"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px" class="small"><input type="checkbox" id="mesmo"> Usar exatamente este texto em todas (sem IA)</label></div>
    <div class="card"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Lojas (${lojas.length})</h2><button class="btn small ghost" id="todas">Marcar todas</button></div>
      <div class="grid3">${lojas.map(l => `<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${esc(l.nome)}" class="lj"> ${esc(lojaLabel(l.nome))}</label>`).join("")}</div></div>
    <div class="row" style="margin-top:14px"><span class="grow small muted" id="cst"></span><button class="btn primary" id="gerar">Criar comunicados</button></div>`;
  $("#todas").onclick = () => $$(".lj").forEach(c => c.checked = true);
  $("#gerar").onclick = async () => {
    const assunto = $("#ass").value.trim(), sel = $$(".lj:checked").map(c => c.value);
    if (!assunto || !sel.length) return toast("Escreva o assunto e marque as lojas.");
    $("#gerar").disabled = true;
    try {
      let textos = {};
      if (!$("#mesmo").checked) {
        $("#cst").textContent = "A IA está escrevendo os textos…";
        try {
          const r = await fn("esteira-ia", { acao: "comunicado", assunto, lojas: sel.map(n => ({ id: n, nome: lojaLabel(n), dados: lojaObj(n).dados || {} })) });
          textos = r.textos || {};
        } catch (e) { toast(e.message + " Usei o mesmo texto para todas.", 6000); }
      }
      const lote = ok(await sb.from("esteira_lotes").insert({ nome: "Comunicado: " + assunto.slice(0, 40) }).select().single());
      ok(await sb.from("esteira_posts").insert(sel.map(n => ({ lote_id: lote.id, loja: n, tipo: "comunicado", status: "pronto", mensagem: assunto, dados: { comunicado: textos[n] || assunto } }))));
      toast("Comunicados criados!"); location.hash = "fila/" + lote.id;
    } catch (e) { erro(e); $("#gerar").disabled = false; }
  };
}

// ---------------- LOJAS E TEMPLATES ----------------
async function viewLojas() {
  const m = $("#main");
  const tpLoja = n => S.tpls.filter(t => t.loja === n);
  m.innerHTML = `<h1>Lojas e templates</h1><p class="sub">${S.admin ? "Configure cada loja (cliente do sistema, pasta do Drive, legenda) e importe os templates." : "Só administradores alteram esta parte."}</p>
    ${S.admin ? `<div class="card" style="margin-bottom:14px"><h2>Importar templates</h2>
      <p class="small muted" style="margin-top:-4px">Escolha a pasta <b>esteira-2l</b> do computador (tem as pastas camadas, fontes e build). Os ajustes feitos aqui na plataforma não são apagados.</p>
      <div class="row"><input type="file" id="pasta" webkitdirectory directory multiple style="max-width:420px"><button class="btn primary" id="imp">Importar</button>
      <button class="btn ghost" id="vinc" title="Liga cada loja ao cliente de mesmo nome no cadastro">Vincular clientes pelo nome</button></div>
      <div id="impbox" class="hidden"><div class="prog"><i id="impbar"></i></div><span class="small" id="imptxt"></span></div></div>` : ""}
    ${!S.lojas.length ? `<div class="empty"><strong>Nenhuma loja ainda</strong>Importe os templates acima.</div>` :
    `<table class="list"><thead><tr><th>Loja</th><th>Cliente no sistema</th><th>Templates</th><th>Drive</th><th></th></tr></thead><tbody>${S.lojas.map(l => {
      const ts = tpLoja(l.nome), lib = ts.filter(t => t.liberado && t.tipo !== "fundo").length, tot = ts.filter(t => t.tipo !== "fundo").length;
      const c = S.clients.find(c => c.id === l.client_id);
      return `<tr><td><b>${esc(l.nome)}</b></td><td>${c ? esc(c.name) : `<span class="muted">—</span>`}</td>
        <td>${lib}/${tot} liberados${lib < tot ? ` <span class="pill erro">${tot - lib} bloqueado(s)</span>` : ""}</td>
        <td>${l.drive_pasta_id ? "✓" : `<span class="muted">—</span>`}</td><td><button class="btn small ghost" data-ed="${esc(l.nome)}">Abrir</button></td></tr>
        <tr class="hidden" data-edrow="${esc(l.nome)}"><td colspan="5"></td></tr>`;
    }).join("")}</tbody></table>`}`;
  if (S.admin) {
    $("#imp").onclick = () => importar($("#pasta").files).catch(erro);
    $("#vinc").onclick = vincularClientes;
  }
  $$("[data-ed]").forEach(b => b.onclick = () => {
    const nome = b.dataset.ed, tr = $(`[data-edrow="${CSS.escape(nome)}"]`);
    if (!tr.classList.contains("hidden")) { tr.classList.add("hidden"); return; }
    tr.classList.remove("hidden"); editarLoja(nome, tr.firstElementChild);
  });
}
function editarLoja(nome, el) {
  const l = lojaObj(nome), d = l.dados || {}, dis = S.admin ? "" : "disabled";
  const ts = S.tpls.filter(t => t.loja === nome).sort((a, b) => a.arte.localeCompare(b.arte));
  el.innerHTML = `<div class="grid2" style="padding:6px 0">
    <div><label class="f">Cliente no sistema</label><select id="e_cli" ${dis}><option value="">—</option>${S.clients.map(c => `<option value="${c.id}" ${c.id === l.client_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <div><label class="f">ID da pasta base no Drive (o código no fim do link da pasta)</label><input id="e_drv" value="${esc(l.drive_pasta_id || "")}" ${dis}></div>
    <div><label class="f">Subpastas dos carros ({MES_NUM}, {MES_NOME}, {ANO}, {CARRO})</label><input id="e_pad" value="${esc(l.drive_padrao || "")}" ${dis}></div>
    <div><label class="f">Subpastas dos vendidos (vazio = igual aos carros)</label><input id="e_padv" value="${esc(d.drive_padrao_vendido || "")}" ${dis}></div>
    <div><label class="f">Endereço</label><input id="e_end" value="${esc(d.endereco || "")}" ${dis}></div>
    <div><label class="f">WhatsApp</label><input id="e_wpp" value="${esc(d.whatsapp || "")}" ${dis}></div>
    <div><label class="f">Site / Instagram</label><input id="e_site" value="${esc(d.site || "")}" ${dis}></div>
    <div><label class="f">Ativa</label><select id="e_at" ${dis}><option value="1" ${l.ativo !== false ? "selected" : ""}>Sim</option><option value="0" ${l.ativo === false ? "selected" : ""}>Não</option></select></div>
  </div>
  <label class="f">Modelo de legenda (cole uma legenda real da loja; a IA segue o formato)</label><textarea id="e_leg" rows="8" ${dis}>${esc(l.legenda_modelo || "")}</textarea>
  ${S.admin ? `<div class="row" style="margin:8px 0 14px"><button class="btn primary small" id="e_save">Salvar loja</button></div>` : ""}
  <table class="list" style="margin-bottom:8px"><thead><tr><th>Arte</th><th>Variação</th><th>Tamanho</th><th>Status</th><th></th></tr></thead><tbody>${ts.map(t => `<tr>
    <td>${esc(t.arte)}</td><td>${esc(t.variacao)}</td><td class="small">${t.largura}×${t.altura}</td>
    <td>${t.liberado ? `<span class="pill salvo">liberado</span>` : `<span class="pill erro" title="${esc(t.bloqueio || "")}">bloqueado</span><div class="small muted">${esc(t.bloqueio || "")}</div>`}${t.ajustado ? ` <span class="pill">ajustado</span>` : ""}</td>
    <td>${S.admin ? `<button class="btn small ghost" data-lib="${t.id}">${t.liberado ? "Bloquear" : "Liberar"}</button> ` : ""}${t.caixas?.length ? `<a class="btn small ghost" href="#ajustar/${t.id}">Ajustar</a>` : ""}</td></tr>`).join("")}</tbody></table>`;
  if (!S.admin) return;
  $("#e_save", el).onclick = async () => {
    try {
      const row = { client_id: $("#e_cli", el).value || null, drive_pasta_id: $("#e_drv", el).value.trim().replace(/^.*folders\//, "").replace(/[?#].*$/, ""),
        drive_padrao: $("#e_pad", el).value.trim(), legenda_modelo: $("#e_leg", el).value, ativo: $("#e_at", el).value === "1",
        dados: { ...d, endereco: $("#e_end", el).value, whatsapp: $("#e_wpp", el).value, site: $("#e_site", el).value, drive_padrao_vendido: $("#e_padv", el).value.trim() }, updated_at: new Date().toISOString() };
      ok(await sb.from("esteira_lojas").update(row).eq("nome", nome));
      Object.assign(l, row); toast("Loja salva ✓");
    } catch (e) { erro(e); }
  };
  $$("[data-lib]", el).forEach(b => b.onclick = async () => {
    const t = S.tpls.find(x => x.id === b.dataset.lib);
    try { ok(await sb.from("esteira_templates").update({ liberado: !t.liberado }).eq("id", t.id)); t.liberado = !t.liberado; editarLoja(nome, el); } catch (e) { erro(e); }
  });
}
async function vincularClientes() {
  const tira = s => norm(s).replace(/\b(VEICULOS|MULTIMARCAS|AUTOMOVEIS|MOTORS|MOTOS|AUTO|CAR)\b/g, "").replace(/\s+/g, " ").trim();
  let n = 0;
  for (const l of S.lojas.filter(l => !l.client_id)) {
    const alvo = tira(l.nome);
    const c = S.clients.find(c => tira(c.name) === alvo) || S.clients.find(c => tira(c.name).startsWith(alvo) || alvo.startsWith(tira(c.name)) && tira(c.name).length > 3);
    if (c) { ok(await sb.from("esteira_lojas").update({ client_id: c.id }).eq("nome", l.nome)); l.client_id = c.id; n++; }
  }
  toast(`${n} loja(s) vinculada(s). Confira as que ficaram sem cliente.`); viewLojas();
}
async function importar(files) {
  if (!files || !files.length) return toast("Escolha a pasta esteira-2l.");
  const map = new Map();
  for (const f of files) map.set(f.webkitRelativePath.split("/").slice(1).join("/"), f);
  const tj = map.get("build/templates.json"), fj = map.get("build/fontes.json");
  if (!tj || !fj) return toast("Essa pasta não tem build/templates.json. Escolha a pasta esteira-2l.");
  const T = JSON.parse(await tj.text()), F = JSON.parse(await fj.text());
  const ups = new Map(), faltam = [];
  for (const a of F.arquivos) { const k = safeKey(a.arquivo); ups.set(k, a.arquivo); a.arquivo = k; }
  for (const c of T.clientes) for (const t of c.artes) { const k = safeKey(t.camada); ups.set(k, t.camada); t.camada_key = k; }
  $("#impbox").classList.remove("hidden");
  let n = 0;
  for (const [key, src] of ups) {
    const f = map.get(src); n++;
    $("#imptxt").textContent = `Enviando ${n}/${ups.size}: ${src}`; $("#impbar").style.width = (100 * n / ups.size) + "%";
    if (!f) { faltam.push(src); continue; }
    const type = /\.png$/i.test(src) ? "image/png" : /\.otf$/i.test(src) ? "font/otf" : "font/ttf";
    const { error } = await sb.storage.from("esteira").upload(key, f, { upsert: true, contentType: type });
    if (error) throw new Error(src + ": " + error.message);
  }
  $("#imptxt").textContent = "Gravando templates…";
  ok(await sb.from("esteira_lojas").upsert(T.clientes.map(c => ({ nome: c.nome })), { onConflict: "nome", ignoreDuplicates: true }));
  const exist = ok(await sb.from("esteira_templates").select("loja,arte,variacao,ajustado"));
  const ajust = new Set(exist.filter(e => e.ajustado).map(e => `${e.loja}|${e.arte}|${e.variacao}`));
  const rows = [];
  for (const c of T.clientes) for (const t of c.artes) {
    const row = { loja: c.nome, arte: t.arte, variacao: t.variacao || "padrao", tipo: t.tipo, largura: t.largura, altura: t.altura, camada_path: t.camada_key,
      foto: t.foto, render: t.render || {}, liberado: t.liberado && !faltam.includes(t.camada), bloqueio: faltam.includes(t.camada) ? "PNG não encontrado na importação" : t.bloqueio || null,
      updated_at: new Date().toISOString() };
    if (!ajust.has(`${c.nome}|${t.arte}|${row.variacao}`)) row.caixas = t.caixas;
    rows.push(row);
  }
  // linhas com e sem "caixas" separadas (upsert exige as mesmas colunas)
  const com = rows.filter(r => r.caixas), sem = rows.filter(r => !r.caixas);
  if (com.length) ok(await sb.from("esteira_templates").upsert(com, { onConflict: "loja,arte,variacao" }));
  if (sem.length) ok(await sb.from("esteira_templates").upsert(sem, { onConflict: "loja,arte,variacao" }));
  ok(await sb.from("esteira_config").update({ data: { ...S.cfg, fontes: F, importado_em: new Date().toISOString() } }).eq("id", 1));
  await loadBase(); S.fontsReady = false; blobCache.clear(); imgCache.clear();
  toast(`Importado: ${rows.length} templates${faltam.length ? `, ${faltam.length} arquivo(s) faltando` : ""}.`, 6000);
  viewLojas();
}

// ---------------- AJUSTAR TEMPLATE (calibrar com a arte do Canva por cima) ----------------
async function viewAjustar(id) {
  const t0 = S.tpls.find(t => t.id === id); if (!t0) return viewLojas();
  const tpl = JSON.parse(JSON.stringify(t0));
  await fontsReady();
  const exemplo = { marca: "VOLKSWAGEN", modelo: "SAVEIRO", versao: "ROBUST 1.6", ano: "2022/2023", km: "42000", valor: "66900", cambio: "Manual", motor: "1.6", combustivel: "Flex", detalhes: "Completo",
    comunicado: "Informamos aos nossos clientes que, nesta sexta-feira (20/11), nossa loja estará fechada. Retornamos no sábado.",
    tipo_imovel: "CASA", negocio: "Venda", bairro: "Gleba Palhano", cidade: "Londrina/PR", area: "190", quartos: "3", suites: "1", banheiros: "2", vagas: "2", destaque: "Pronto para morar", condominio: "Royal Park" };
  const textos = {};
  for (const cx of tpl.caixas) if (cx.exemplo && !cx.trechos) textos[cx.id] = String(cx.exemplo).replace(/\\n/g, "\n");
  let ref = null, sel = 0, opac = 0.5;
  $("#main").innerHTML = `<a href="#lojas" class="muted small">← Lojas</a><h1>Ajustar: ${esc(tpl.loja)} — ${esc(tpl.arte)}</h1>
    <p class="sub">Para deixar idêntico ao Canva: baixe a arte do Canva preenchida (PNG) e coloque por cima. Mova os textos até coincidirem. ${S.admin ? "" : "(só admin salva)"}</p>
    <div class="editor"><div class="stage"><canvas id="cv"></canvas>
      <div class="row small" style="margin-top:8px"><label class="btn small ghost">Arte do Canva por cima<input type="file" id="ref" accept="image/*" hidden></label>
      <span class="muted">Transparência</span><input type="range" id="op" min="0" max="1" step="0.05" value="0.5" class="grow"></div></div>
      <div><div class="card" style="margin-bottom:12px"><label class="f">Caixa de texto</label><select id="cxs">${tpl.caixas.map((c, i) => `<option value="${i}">${esc(c.campo)}</option>`).join("")}</select>
        <div class="grid3" style="margin-top:10px" id="props"></div>
        <p class="small muted">Setas do teclado movem a caixa selecionada (Shift = 10px).</p></div>
        <div class="card" style="margin-bottom:12px"><label class="f">Texto de teste desta caixa</label><input id="txt"></div>
        ${S.admin ? `<div class="row"><button class="btn primary" id="salvar">Salvar ajustes</button><button class="btn ghost" id="desf">Desfazer tudo</button></div>` : ""}</div></div>`;
  const cv = $("#cv");
  const camada = await storageImg(tpl.camada_path);
  const PROPS = [["top", "Topo"], ["left", "Esquerda"], ["largura", "Largura"], ["tamanho", "Tamanho"], ["espacamento", "Espaçamento"], ["entrelinha", "Entrelinha"]];
  async function draw() {
    await R.ensureFonts(tpl);
    const tx = { ...R.textosPadrao(tpl, exemplo), ...textos };
    R.renderArte({ tpl, camada, foto: null, textos: tx, canvas: cv });
    const ctx = cv.getContext("2d");
    if (ref) { ctx.globalAlpha = opac; ctx.drawImage(ref, 0, 0, cv.width, cv.height); ctx.globalAlpha = 1; }
    const c = tpl.caixas[sel]; ctx.strokeStyle = "#ff00aa"; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.strokeRect(c.left, c.top, c.largura, c.tamanho * (c.entrelinha || 1.2)); ctx.setLineDash([]);
  }
  function props() {
    const c = tpl.caixas[sel];
    $("#props").innerHTML = PROPS.map(([k, l]) => `<div><label class="f">${l}</label><input type="number" step="${k === "entrelinha" || k === "espacamento" ? 0.01 : 0.5}" data-p="${k}" value="${c[k] ?? 0}"></div>`).join("");
    $$("#props [data-p]").forEach(el => el.oninput = () => { c[el.dataset.p] = parseFloat(el.value) || 0; if (el.dataset.p === "tamanho" && c.trechos) c.trechos.forEach(r => r.tamanho = c.tamanho); draw(); });
    const v = { ...R.textosPadrao(tpl, exemplo), ...textos }[c.id];
    $("#txt").value = Array.isArray(v) ? v.join("|") : v || "";
  }
  $("#cxs").onchange = e => { sel = +e.target.value; props(); draw(); };
  $("#txt").oninput = e => { const c = tpl.caixas[sel]; textos[c.id] = c.trechos ? e.target.value.split("|") : e.target.value; draw(); };
  $("#op").oninput = e => { opac = +e.target.value; draw(); };
  $("#ref").onchange = async e => { const f = e.target.files[0]; if (f) { ref = await R.loadImage(URL.createObjectURL(f)); draw(); } };
  const onKey = e => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    e.preventDefault(); const c = tpl.caixas[sel], d = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") c.top -= d; if (e.key === "ArrowDown") c.top += d; if (e.key === "ArrowLeft") c.left -= d; if (e.key === "ArrowRight") c.left += d;
    props(); draw();
  };
  document.addEventListener("keydown", onKey); leaveHooks.push(() => document.removeEventListener("keydown", onKey));
  if (S.admin) {
    $("#salvar").onclick = async () => {
      try { ok(await sb.from("esteira_templates").update({ caixas: tpl.caixas, ajustado: true, updated_at: new Date().toISOString() }).eq("id", id)); t0.caixas = tpl.caixas; t0.ajustado = true; toast("Ajustes salvos ✓"); }
      catch (e) { erro(e); }
    };
    $("#desf").onclick = () => viewAjustar(id);
  }
  props(); draw();
}

boot();
