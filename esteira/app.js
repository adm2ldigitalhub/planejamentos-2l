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
const STATUS = { novo: "Novo", revisado: "Revisado", salvo: "Salvo no Drive", concluido: "Concluído" };
// status antigos ("pronto", "erro") contam como novo; a ordem serve para ordenar a lista
const stDe = s => STATUS[s] ? s : "novo";
const ST_ORDEM = { novo: 0, revisado: 1, salvo: 2, concluido: 3 };
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
  const tabs = [["fila", "Posts"], ["lojas", "Templates"]];
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<a href="#${k}" class="${v === k ? "on" : ""}">${l}</a>`).join("");
}
let leaveHooks = [];
function route() {
  leaveHooks.forEach(f => { try { f(); } catch (e) {} }); leaveHooks = [];
  const [v, ...rest] = (location.hash.slice(1) || "fila").split("/");
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : null;
  renderTabs(v === "post" || v === "novo" || v === "comunicado" ? "fila" : v === "ajustar" ? "lojas" : v);
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

// ---------------- ARQUIVOS DE UM POST (usado no editor e no "baixar vários") ----------------
const fundoDe = t => t?.render?.fundo_camada ? S.tpls.find(x => x.loja === t.loja && x.arte === t.render.fundo_camada && x.variacao === t.variacao) || S.tpls.find(x => x.loja === t.loja && x.arte === t.render.fundo_camada) : null;
const ctaDe = loja => S.tpls.find(t => t.loja === loja && t.tipo === "cta" && t.liberado);
// campos de dados que aparecem na arte (o resto só ajuda a legenda)
function camposDaArte(tpl) {
  const s = new Set();
  for (const cx of tpl?.caixas || []) for (const md of [cx.modelo, ...(cx.trechos || []).map(r => r.modelo)])
    for (const [, k] of String(md || "").matchAll(/\{(\w+)\}/g)) s.add(k === "valor_cent" ? "valor" : k);
  return s;
}
const tituloPost = P => P.tipo === "comunicado" ? "COMUNICADO " + lojaLabel(P.loja) : (P.tipo === "vendido" ? "VENDIDO " : "") + nomeCarro({ ...(P.dados || {}), tipo: P.tipo });
function textosDoPost(tpl, P) {
  const auto = R.textosPadrao(tpl, { ...(P.dados || {}), tipo: P.tipo }), out = { ...auto };
  for (const [k, v] of Object.entries(P.textos || {})) if (v != null && k in auto) out[k] = v;
  return out;
}
async function capaDoPost(P, tpl, imgs) {
  await R.ensureFonts(tpl);
  const camada = await storageImg(tpl.camada_path);
  const ft = fundoDe(tpl), fundo = ft ? await storageImg(ft.camada_path) : null;
  const img = imgs[P.capa || 0];
  // post que ninguém abriu ainda: enquadra o veículo antes de montar
  let pos = P.foto_pos;
  if (!pos && img && (P.tipo === "anuncio" || P.tipo === "vendido")) pos = await enquadrarCarro(tpl, img).catch(() => null);
  return R.renderArte({ tpl, camada, fundo, foto: img && P.tipo !== "comunicado" ? { img, pos: pos || R.fotoPadrao(tpl, img) } : null, textos: textosDoPost(tpl, P) });
}
async function arquivosDoPost(P) {
  await fontsReady();
  const tpl = tplDo(P.loja, P.tipo, P.variacao);
  if (!tpl) throw new Error(`${lojaLabel(P.loja)} não tem template liberado para ${TIPOS[P.tipo]}.`);
  const imgs = await Promise.all((P.fotos || []).map(f => storageImg(f.path).catch(() => null)));
  const out = [], pad = n => String(n).padStart(2, "0");
  out.push({ nome: `${pad(1)} - capa.png`, blob: await canvasBlob(await capaDoPost(P, tpl, imgs)) });
  if (P.tipo === "anuncio" || P.tipo === "imovel") {
    let n = 2;
    const ordem = P.ordem ?? (P.fotos || []).map((_, i) => i).filter(i => i !== (P.capa || 0));
    for (const i of ordem) {
      const img = imgs[i]; if (!img) continue;
      const cv = R.renderFotoSolta(img, tpl.largura, tpl.altura, P.fotos_pos?.[i]);
      out.push({ nome: `${pad(n++)} - foto.jpg`, blob: await canvasBlob(cv, "image/jpeg", 0.92) });
    }
    const cta = ctaDe(P.loja);
    if (cta) {
      const im = await storageImg(cta.camada_path); const cv = document.createElement("canvas"); cv.width = cta.largura; cv.height = cta.altura;
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); out.push({ nome: `${pad(n++)} - cta.png`, blob: await canvasBlob(cv) });
    }
    const site = tplDo(P.loja, "site");
    if (site) {
      const img = imgs[P.capa || 0], camada = await storageImg(site.camada_path);
      const cv = R.renderArte({ tpl: site, camada, foto: img ? { img } : null, textos: R.textosPadrao(site, { ...(P.dados || {}), tipo: P.tipo }) });
      out.push({ nome: `site.png`, blob: await canvasBlob(cv) });
    }
  }
  if (P.legenda) out.push({ nome: "legenda.txt", blob: new Blob([P.legenda], { type: "text/plain;charset=utf-8" }) });
  return out;
}
// cria a pasta do mês/carro no Drive da loja e sobe os arquivos
async function salvarNoDrive(P, fs, onProg) {
  const loja = lojaObj(P.loja);
  if (!loja.drive_pasta_id) throw new Error(`Falta a pasta do Drive de ${lojaLabel(P.loja)} (aba Lojas).`);
  const hoje = new Date();
  const padrao = (P.tipo === "vendido" && loja.dados?.drive_padrao_vendido) || (P.tipo === "comunicado" && loja.dados?.drive_padrao_comunicado) || loja.drive_padrao || "{CARRO}";
  const nome = P.tipo === "comunicado" ? "COMUNICADO " + hoje.toLocaleDateString("pt-BR").replace(/\//g, "-") : tituloPost(P);
  const caminho = padrao.replace(/\{MES_NUM\}/g, String(hoje.getMonth() + 1).padStart(2, "0")).replace(/\{MES_NOME\}/g, MESES[hoje.getMonth()])
    .replace(/\{ANO\}/g, hoje.getFullYear()).replace(/\{CARRO\}/g, nome).replace(/\{TIPO\}/g, TIPOS[P.tipo].toUpperCase());
  const pasta = await fn("esteira-drive", { acao: "pasta", base: loja.drive_pasta_id, caminho });
  let n = 0;
  for (const f of fs) {
    await fn("esteira-drive", { acao: "arquivo", pasta: pasta.id, nome: f.nome, mime: f.blob.type || "application/octet-stream", base64: await blobB64(f.blob) });
    onProg && onProg(++n, fs.length);
  }
  ok(await sb.from("esteira_posts").update({ drive_url: pasta.url, status: "salvo" }).eq("id", P.id));
  return pasta.url;
}

// ---------------- POSTS (fila) ----------------
// ordem e filtro da lista ficam guardados nesta aba do navegador; o editor usa a mesma sequência no "próximo"
const memo = (k, v) => { try { if (v === undefined) return JSON.parse(sessionStorage.getItem("esteira-" + k)); sessionStorage.setItem("esteira-" + k, JSON.stringify(v)); } catch (e) { return null; } };
const ORDENS = {
  loja: p => norm(lojaLabel(p.loja)),
  post: p => norm((TIPOS[p.tipo] || "") + " " + tituloPost(p)),
  status: p => ST_ORDEM[stDe(p.status)],
  atualizado: p => p.updated_at || p.created_at,
};
function ordenarPosts(lista, ord) {
  const f = ORDENS[ord.k] || ORDENS.atualizado;
  return [...lista].sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * ord.dir || (b.created_at > a.created_at ? 1 : -1); });
}
async function viewFila(filtroLote) {
  const m = $("#main");
  const ord = memo("ordem") || { k: "atualizado", dir: -1 };
  // duas listas separadas: anúncios e vendidos (lotes de carros) e comunicados
  const aba = memo("aba") === "comunicados" ? "comunicados" : "anuncios", com = aba === "comunicados";
  const doGrupo = p => (p.tipo === "comunicado") === com;
  m.innerHTML = `<div class="row" style="margin-bottom:10px"><h1 class="grow" style="margin:0">Posts</h1><a class="btn primary" href="${com ? "#comunicado" : "#novo"}">${com ? "+ Novo comunicado" : "+ Novo lote"}</a></div>
    <nav class="subtabs"><button data-aba="anuncios" class="${com ? "" : "on"}">Anúncios e vendidos</button><button data-aba="comunicados" class="${com ? "on" : ""}">Comunicados</button></nav>
    <p class="sub">Clique no post para revisar; dentro dele dá para ir para o próximo. Ou marque vários para mudar o status, baixar ou salvar no Drive de uma vez.</p>
    <div class="row" style="margin-bottom:12px">
      <select id="fs" style="max-width:220px"><option value="">Em andamento (sem concluídos)</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">Só ${v.toLowerCase()}</option>`).join("")}<option value="*">Todos, com concluídos</option></select>
      <select id="fl" style="max-width:240px"><option value="">Todas as lojas</option>${[...S.lojas].sort((a, b) => lojaLabel(a.nome).localeCompare(lojaLabel(b.nome), "pt-BR")).map(l => `<option value="${esc(l.nome)}">${esc(lojaLabel(l.nome))}</option>`).join("")}</select>
      <input id="fq" placeholder="Buscar carro ou loja…" class="search">
      ${filtroLote ? `<span class="pill">só este lote <a href="#fila">×</a></span>` : ""}
    </div><div id="lista"><p class="muted">Carregando…</p></div><div id="selbar"></div>`;
  const f0 = memo("filtro") || {};
  $("#fs").value = f0.fs || ""; $("#fl").value = f0.fl || ""; $("#fq").value = f0.fq || "";
  if (com) $("#fq").placeholder = "Buscar loja ou texto…";
  $$("[data-aba]").forEach(b => b.onclick = () => { if (b.dataset.aba === aba) return; memo("aba", b.dataset.aba); memo("seq", null); viewFila(filtroLote); });
  let posts = [], vis = [];
  const marcados = new Set();
  async function carregar() {
    let q = sb.from("esteira_posts").select("*").order("created_at", { ascending: false }).limit(400);
    if (filtroLote) q = q.eq("lote_id", filtroLote);
    posts = ok(await q);
    for (const id of [...marcados]) if (!posts.some(p => p.id === id)) marcados.delete(id);
    desenhar();
  }
  async function mudarStatus(st, ids) {
    ok(await sb.from("esteira_posts").update({ status: st }).in("id", ids));
    posts.forEach(p => { if (ids.includes(p.id)) p.status = st; });
    if (st === "concluido") ids.forEach(id => marcados.delete(id));
    toast(`${ids.length} post(s): ${STATUS[st]}.`); desenhar();
  }
  function barra() {
    const n = marcados.size;
    $("#selbar").innerHTML = n ? `<div class="selbar"><b>${n} selecionado(s)</b><span class="grow"></span>
      <button class="btn small ghost" id="sLimpa">Limpar</button>
      <select id="sSt" style="width:auto"><option value="">Mudar status para…</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <button class="btn small" id="sZip">Baixar (.zip)</button><button class="btn small primary" id="sDrv">Salvar no Drive</button>
      <button class="btn small" id="sConc" title="Marca como concluído e tira da lista">Concluir ✓</button>
      <button class="btn small ghost" disabled title="Em breve: posta direto no Instagram de cada loja">Postar (em breve)</button>
      <span class="small muted" id="sProg" style="width:100%"></span></div>` : "";
    if (!n) return;
    $("#sLimpa").onclick = () => { marcados.clear(); desenhar(); };
    const sel = () => vis.filter(p => marcados.has(p.id)).concat(posts.filter(p => marcados.has(p.id) && !vis.includes(p)));
    const prog = t => { $("#sProg").textContent = t; };
    $("#sSt").onchange = async e => { const st = e.target.value; if (!st) return; try { await mudarStatus(st, [...marcados]); } catch (err) { erro(err); } };
    $("#sConc").onclick = async () => { try { await mudarStatus("concluido", [...marcados]); } catch (err) { erro(err); } };
    $("#sZip").onclick = async () => {
      const b = $("#sZip"); b.disabled = true;
      try {
        const z = new JSZip(), usados = new Set(); let i = 0, falhas = 0;
        for (const P of sel()) {
          prog(`Montando ${++i} de ${marcados.size}: ${tituloPost(P)}…`);
          try {
            let pasta = `${lojaLabel(P.loja)}/${tituloPost(P)}`; while (usados.has(pasta)) pasta += " (2)"; usados.add(pasta);
            for (const f of await arquivosDoPost(P)) z.file(`${pasta}/${f.nome}`, f.blob);
          } catch (e) { falhas++; console.error(e); }
        }
        prog("Compactando…");
        baixar(await z.generateAsync({ type: "blob" }), `posts ${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.zip`);
        prog(falhas ? `${falhas} post(s) não montaram (sem template?).` : "Baixado ✓");
      } catch (e) { erro(e); }
      b.disabled = false;
    };
    $("#sDrv").onclick = async () => {
      const b = $("#sDrv"); b.disabled = true; let i = 0, feitos = 0;
      for (const P of sel()) {
        prog(`Salvando ${++i} de ${marcados.size}: ${tituloPost(P)}…`);
        try { await salvarNoDrive(P, await arquivosDoPost(P)); feitos++; } catch (e) { toast(`${tituloPost(P)}: ${e.message}`, 6000); if (/não foi configurad/.test(e.message)) break; }
      }
      prog(`${feitos} de ${marcados.size} salvo(s) no Drive.`); b.disabled = false; await carregar();
    };
  }
  const seta = k => ord.k === k ? (ord.dir > 0 ? " ▲" : " ▼") : " ↕";
  function desenhar() {
    const fs = $("#fs").value, fl = $("#fl").value, fq = norm($("#fq").value);
    memo("filtro", { fs, fl, fq: $("#fq").value });
    vis = ordenarPosts(posts.filter(p => doGrupo(p) && (fs === "*" || (fs ? stDe(p.status) === fs : stDe(p.status) !== "concluido")) && (!fl || p.loja === fl)
      && (!fq || norm(tituloPost(p) + " " + lojaLabel(p.loja)).includes(fq))), ord);
    const ocultos = fs === "" ? posts.filter(p => doGrupo(p) && stDe(p.status) === "concluido").length : 0;
    if (!vis.length) {
      $("#lista").innerHTML = `<div class="empty"><strong>Nada por aqui</strong>${ocultos ? `${ocultos} concluído(s) escondido(s) (<a href="#" id="verConc">mostrar</a>). ` : ""}${com ? "Clique em <b>+ Novo comunicado</b> para escrever um." : "Clique em <b>+ Novo lote</b> e arraste os ZIPs do WhatsApp."}</div>`;
      $("#verConc") && ($("#verConc").onclick = e => { e.preventDefault(); $("#fs").value = "*"; desenhar(); });
      barra(); return;
    }
    const agora = Date.now(), todos = vis.every(p => marcados.has(p.id));
    const th = (k, l) => `<th><button class="ord" data-ord="${k}" title="Ordenar">${l}<span>${seta(k)}</span></button></th>`;
    $("#lista").innerHTML = `<table class="list"><thead><tr><th class="ck"><input type="checkbox" id="ckAll" ${todos ? "checked" : ""} title="Selecionar todos"></th><th></th>${th("loja", "Loja")}${th("post", "Post")}${th("status", "Status")}${th("atualizado", "Atualizado")}</tr></thead><tbody>${vis.map(p => {
      const lock = p.editando_por && p.editando_por !== S.email && agora - new Date(p.editando_em) < 180000, st = stDe(p.status);
      const titulo = p.tipo === "comunicado" ? (p.dados?.comunicado || "").slice(0, 60) : nomeCarro({ ...p.dados, tipo: p.tipo });
      return `<tr class="click" data-id="${p.id}"><td class="ck"><input type="checkbox" data-ck="${p.id}" ${marcados.has(p.id) ? "checked" : ""}></td>
        <td><img class="thumb" data-path="${esc(p.fotos?.[p.capa || 0]?.path || "")}" alt=""></td>
        <td>${esc(lojaLabel(p.loja))}</td><td><b>${esc(titulo)}</b><div class="small muted">${TIPOS[p.tipo] || p.tipo}${p.erro ? " · " + esc(p.erro) : ""}</div></td>
        <td><span class="pill ${st}">${STATUS[st]}</span>${lock ? ` <span class="pill lock">✎ ${esc(p.editando_por.split("@")[0])}</span>` : ""}</td>
        <td class="small muted">${fmtData(p.updated_at)}${p.atualizado_por ? "<br>" + esc(p.atualizado_por.split("@")[0]) : ""}</td></tr>`;
    }).join("")}</tbody></table>${ocultos ? `<p class="small muted" style="margin-top:8px">${ocultos} concluído(s) escondido(s). <a href="#" id="verConc">Mostrar</a></p>` : ""}`;
    $$("#lista tr.click").forEach(tr => tr.onclick = e => {
      if (e.target.closest(".ck")) return;
      memo("seq", vis.map(p => p.id)); location.hash = "post/" + tr.dataset.id;
    });
    $$("#lista [data-ck]").forEach(c => c.onchange = () => { c.checked ? marcados.add(c.dataset.ck) : marcados.delete(c.dataset.ck); $("#ckAll").checked = vis.every(p => marcados.has(p.id)); barra(); });
    $("#ckAll").onchange = e => { vis.forEach(p => e.target.checked ? marcados.add(p.id) : marcados.delete(p.id)); desenhar(); };
    $$("#lista [data-ord]").forEach(b => b.onclick = () => { const k = b.dataset.ord; if (ord.k === k) ord.dir *= -1; else { ord.k = k; ord.dir = k === "atualizado" ? -1 : 1; } memo("ordem", ord); desenhar(); });
    $("#verConc") && ($("#verConc").onclick = e => { e.preventDefault(); $("#fs").value = "*"; desenhar(); });
    $$("#lista img[data-path]").forEach(async img => { if (img.dataset.path) try { img.src = await fileUrl(img.dataset.path); } catch (e) {} });
    barra();
  }
  ["fs", "fl"].forEach(id => $("#" + id).onchange = desenhar); $("#fq").oninput = desenhar;
  await carregar();
  let t; const ch = sb.channel("fila-" + uuid()).on("postgres_changes", { event: "*", schema: "public", table: "esteira_posts" }, () => { clearTimeout(t); t = setTimeout(carregar, 600); }).subscribe();
  leaveHooks.push(() => sb.removeChannel(ch));
}

// ---------------- NOVO LOTE ----------------
const FOTOS_CARROSSEL = 8;   // capa + 8 fotos + CTA = 10 cards
// fotos que entram no post: a capa primeiro, depois as outras marcadas, na ordem do ZIP
const fotosEscolhidas = it => [it.capa, ...it.sel.filter(i => i !== it.capa)].filter(i => i != null);
function escolhaPadrao(it) {
  it.capa = it.fotos.length ? 0 : null;
  it.sel = it.tipo === "anuncio" || it.tipo === "imovel" ? it.fotos.map((_, i) => i).slice(0, FOTOS_CARROSSEL + 1) : it.fotos.length ? [0] : [];
}
async function viewNovo() {
  const lojas = S.lojas.filter(l => l.ativo !== false && (tplDo(l.nome, "anuncio") || tplDo(l.nome, "vendido") || tplDo(l.nome, "imovel")))
    .sort((a, b) => lojaLabel(a.nome).localeCompare(lojaLabel(b.nome), "pt-BR"));
  const m = $("#main");
  m.innerHTML = `<a href="#fila" class="muted small">← Posts</a><h1>Novo lote</h1>
    <p class="sub">Arraste os ZIPs do WhatsApp, um por carro. Fotos soltas também funcionam e viram um carro só.</p>
    <label class="drop" id="drop">Solte os ZIPs aqui ou <u>clique para escolher</u><input type="file" id="fi" multiple accept=".zip,image/*" hidden></label>
    <div id="rows" class="card hidden" style="padding:0;margin-top:14px"></div>
    <div class="row hidden" id="acts" style="margin-top:14px"><span class="grow muted small" id="resumo"></span><button class="btn primary" id="criar">Criar lote e enviar fotos</button></div>
    <div id="progbox" class="hidden card" style="margin-top:14px"><b id="progtxt">Enviando…</b><div class="prog"><i id="progbar"></i></div></div>`;
  const itens = [];
  const lojaOpts = sel => `<option value="">Escolha a loja…</option>` + lojas.map(l => `<option value="${esc(l.nome)}" ${l.nome === sel ? "selected" : ""}>${esc(lojaLabel(l.nome))}</option>`).join("");
  function adivinharLoja(texto) {
    const n = norm(texto);
    return (lojas.find(l => n.includes(norm(lojaLabel(l.nome)))) || lojas.find(l => n.includes(norm(l.nome)))
      || lojas.find(l => { const p = norm(lojaLabel(l.nome)).split(" ")[0]; return p.length > 2 && n.includes(p); }))?.nome || "";
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
          const it = { nome: f.name, fotos, loja: adivinharLoja(f.name + " " + chat.slice(0, 400)), tipo: /vendid/i.test(f.name + msg) ? "vendido" : "anuncio", mensagem: msg, aviso: heic ? "Tem fotos HEIC (iPhone) que o navegador não lê: mande em JPG." : "" };
          escolhaPadrao(it); itens.push(it);
        } catch (e) { toast("Não consegui abrir " + f.name); }
      } else if (/^image\//.test(f.type)) soltas.push(f);
    }
    if (soltas.length) { const it = { nome: "Fotos soltas", fotos: soltas, loja: "", tipo: "anuncio", mensagem: "" }; escolhaPadrao(it); itens.push(it); }
    desenhar();
  }
  const urlDe = (it, f) => (it._u = it._u || {})[f.name] || (it._u[f.name] = URL.createObjectURL(f));
  function desenhar() {
    $("#rows").classList.toggle("hidden", !itens.length); $("#acts").classList.toggle("hidden", !itens.length);
    $("#rows").innerHTML = itens.map((it, i) => {
      const tipos = it.loja ? tiposDaLoja(it.loja).filter(t => t !== "comunicado") : ["anuncio", "vendido"];
      const carrossel = it.tipo === "anuncio" || it.tipo === "imovel", esc_ = fotosEscolhidas(it);
      return `<div class="lote-item" data-i="${i}"><div class="lote-row">
      <div><div class="small muted">${esc(it.nome)}${it.aviso ? ` · <b style="color:var(--bad)">${esc(it.aviso)}</b>` : ""}</div>
        <textarea data-k="mensagem" placeholder="Cole aqui a mensagem do lojista (modelo, ano, km, valor…)">${esc(it.mensagem)}</textarea></div>
      <div><label class="f">Loja</label><select data-k="loja">${lojaOpts(it.loja)}</select></div>
      <div><label class="f">Tipo</label><select data-k="tipo">${tipos.map(t => `<option value="${t}" ${t === it.tipo ? "selected" : ""}>${TIPOS[t]}</option>`).join("")}</select></div>
      <button class="btn small ghost" data-rm="${i}" title="Tirar este item">×</button></div>
      ${it.fotos.length ? `<div class="pick-h">${carrossel
        ? `<b>${esc_.length} de ${it.fotos.length} fotos</b> vão para o carrossel (recomendado: capa + ${FOTOS_CARROSSEL}). Clique na foto para marcar ou desmarcar; “capa” escolhe a foto da arte. A CTA entra sozinha no fim. Só as marcadas são enviadas.`
        : `<b>Escolha a foto da arte</b> (“capa”). Só ela é enviada.`}</div>
      <div class="pick">${it.fotos.map((f, k) => { const on = esc_.includes(k), pos = esc_.indexOf(k);
        return `<div class="ft ${on ? "on" : ""} ${k === it.capa ? "capa" : ""}" data-f="${k}"><img src="${urlDe(it, f)}" alt="">${on ? `<span class="n">${pos + 1}</span>` : ""}<button class="cp" data-cp="${k}">${k === it.capa ? "capa" : "★"}</button></div>`; }).join("")}</div>` : ""}
      </div>`;
    }).join("");
    $$("#rows [data-k]").forEach(el => el.onchange = el.oninput = () => {
      const it = itens[el.closest("[data-i]").dataset.i]; it[el.dataset.k] = el.value;
      if (el.dataset.k === "tipo") escolhaPadrao(it);
      if (el.dataset.k !== "mensagem") desenhar();
    });
    $$("#rows [data-rm]").forEach(b => b.onclick = () => { itens.splice(+b.dataset.rm, 1); desenhar(); });
    $$("#rows .ft").forEach(el => el.onclick = e => {
      const it = itens[el.closest("[data-i]").dataset.i], k = +el.dataset.f, carrossel = it.tipo === "anuncio" || it.tipo === "imovel";
      if (e.target.closest("[data-cp]") || !carrossel) { it.capa = k; if (!it.sel.includes(k)) it.sel = carrossel ? [...it.sel, k] : [k]; if (!carrossel) it.sel = [k]; }
      else if (it.sel.includes(k)) { if (k === it.capa) return toast("Essa é a capa. Escolha outra capa antes de tirar."); it.sel = it.sel.filter(x => x !== k); }
      else it.sel = [...it.sel, k].sort((a, b) => a - b);
      desenhar();
    });
    const falta = itens.filter(i => !i.loja).length, fotos = itens.reduce((s, it) => s + fotosEscolhidas(it).length, 0);
    $("#resumo").textContent = `${itens.length} item(ns) · ${fotos} foto(s) para enviar` + (falta ? ` · ${falta} sem loja` : "");
  }
  const drop = $("#drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addArquivos([...e.dataTransfer.files]); };
  $("#fi").onchange = e => { addArquivos([...e.target.files]); e.target.value = ""; };
  $("#criar").onclick = async () => {
    if (itens.some(i => !i.loja)) return toast("Escolha a loja de todos os itens.");
    if (itens.some(i => !fotosEscolhidas(i).length && i.tipo !== "comunicado")) return toast("Tem item sem foto marcada.");
    $("#criar").disabled = true; $("#progbox").classList.remove("hidden");
    try {
      const lote = ok(await sb.from("esteira_lotes").insert({ nome: new Date().toLocaleString("pt-BR") }).select().single());
      const total = itens.reduce((s, it) => s + fotosEscolhidas(it).length, 0); let feito = 0;
      for (const it of itens) {
        const id = uuid(), fotos = [];
        for (const [k, idx] of fotosEscolhidas(it).entries()) {
          $("#progtxt").textContent = `Enviando fotos (${feito + 1}/${total})…`;
          const c = await comprimir(it.fotos[idx]);
          const path = `fotos/${id}/${String(k + 1).padStart(2, "0")}.jpg`;
          ok(await sb.storage.from("esteira").upload(path, c.blob, { contentType: "image/jpeg", upsert: true }));
          fotos.push({ path, w: c.w, h: c.h, nome: it.fotos[idx].name });
          feito++; $("#progbar").style.width = (100 * feito / total) + "%";
        }
        const dados = { ...parseMensagem(it.mensagem), tipo: it.tipo };
        ok(await sb.from("esteira_posts").insert({ id, lote_id: lote.id, loja: it.loja, tipo: it.tipo, mensagem: it.mensagem, fotos, dados, status: "novo",
          capa: 0, ordem: fotos.map((_, i) => i).filter(i => i !== 0) }));
      }
      // IA em segundo plano (se configurada): processa o lote
      $("#progtxt").textContent = "Lendo as mensagens com IA…";
      await processarLoteIA(lote.id, (n, t) => { $("#progtxt").textContent = `Lendo as mensagens com IA (${n}/${t})…`; $("#progbar").style.width = (100 * n / t) + "%"; });
      toast("Lote criado!"); memo("aba", "anuncios"); location.hash = "fila/" + lote.id;
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
  const upd = { dados, legenda: r.legenda || p.legenda || "", erro: null };
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
  if (P.ordem == null) P.ordem = (P.fotos || []).map((_, i) => i).filter(i => i !== (P.capa || 0));
  const vars = variacoes(P.loja, P.tipo);
  // anterior / próximo: a mesma ordem da lista de Posts (ou os em andamento, se abriu direto pelo link)
  memo("aba", comunicado ? "comunicados" : "anuncios");   // o "← Posts" volta para a lista certa
  let seq = memo("seq") || [];
  if (!seq.includes(id)) {
    const ps = ok(await sb.from("esteira_posts").select("id,status,loja,tipo,dados,created_at,updated_at").order("created_at", { ascending: false }).limit(400));
    seq = ordenarPosts(ps.filter(p => (p.tipo === "comunicado") === comunicado && (stDe(p.status) !== "concluido" || p.id === id)), memo("ordem") || { k: "atualizado", dir: -1 }).map(p => p.id);
    memo("seq", seq);
  }
  const pos = Math.max(0, seq.indexOf(id)), ant = seq[pos - 1], prox = seq[pos + 1];

  m.innerHTML = `<a href="#fila" class="muted small">← Posts</a>
    <div id="lockbar"></div>
    <div class="row" style="margin:6px 0 16px"><div class="grow"><h1 style="margin:0">${esc(lojaLabel(P.loja))}</h1><span class="muted small">${TIPOS[P.tipo]} · criado por ${esc((P.criado_por || "").split("@")[0])} ${fmtData(P.created_at)}</span></div>
      <select id="st" style="max-width:190px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${stDe(P.status) === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    ${!tpl ? `<div class="lockbar">Esta loja não tem template liberado para ${TIPOS[P.tipo]}.</div>` : ""}
    <div class="editor">
      <div class="stage">
        <canvas id="cv"></canvas>
        ${comunicado ? "" : `<div class="row small" style="margin-top:8px"><span class="muted">Zoom</span><input type="range" id="zoom" min="0.3" max="3" step="0.01" class="grow">
          ${imovel ? "" : `<button class="btn small ghost" id="enq" title="Acha o veículo na foto e enquadra inteiro, com folga dos lados">Enquadrar veículo</button>`}<button class="btn small ghost" id="cent">Centralizar</button></div>
          <div class="small muted">Arraste a foto para posicionar. Clique numa miniatura para trocar a foto da capa; o “×” tira a foto do carrossel; arraste para reordenar.</div>
          <div class="strip" id="strip"></div>`}
      </div>
      <div>
        ${vars.length > 1 ? `<div class="card" style="margin-bottom:12px"><label class="f">Variação do template</label><select id="var">${vars.map(v => `<option ${v === (P.variacao || "padrao") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>` : ""}
        <div class="card" style="margin-bottom:12px">
          <div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">${comunicado ? "Texto do comunicado" : "Dados"}</h2>
            </div>
          ${comunicado ? `<textarea id="com" rows="7">${esc(P.dados?.comunicado || "")}</textarea>` :
          `<details ${P.mensagem ? "" : "open"}><summary>Mensagem do lojista</summary><textarea id="msg" rows="4">${esc(P.mensagem || "")}</textarea>
             <div class="row" style="margin-top:6px"><button class="btn small ghost" id="reler">Ler a mensagem de novo</button><span class="small muted">Use se corrigir a mensagem: preenche os dados de novo.</span></div></details>
           <div id="campos">${(() => {
             const inp = ([k, l]) => `<div><label class="f">${l}</label><input data-c="${k}" value="${esc(P.dados?.[k] ?? "")}"></div>`;
             const usados = camposDaArte(tpl), naArte = tpl ? campos.filter(([k]) => usados.has(k)) : campos, outros = campos.filter(c => !naArte.includes(c));
             return `<div class="grid2">${naArte.map(inp).join("")}</div>${outros.length ? `<details style="margin-top:10px"><summary>Outros dados (não aparecem na arte, só ajudam a escrever a legenda)</summary><div class="grid2">${outros.map(inp).join("")}</div></details>` : ""}`;
           })()}</div>`}
        </div>
        <div class="card" style="margin-bottom:12px"><h2>Textos da capa</h2><p class="small muted" style="margin-top:-6px">Saem dos dados. Se mudar algum aqui, ele fica fixo (↺ volta ao automático).</p><div id="boxes"></div></div>
        ${comunicado ? "" : `<div class="card" style="margin-bottom:12px"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Legenda</h2>
          <button class="btn small ghost" id="leg">Gerar com IA</button></div><textarea id="legenda" rows="12">${esc(P.legenda || "")}</textarea></div>`}
      </div>
    </div>
    <div class="navbar">
      <button class="btn small ghost" id="nAnt" ${ant ? "" : "disabled"} title="Post anterior da lista">← Anterior</button>
      <span class="pos">${pos + 1} de ${seq.length}</span>
      <button class="btn small" id="bcapa">Baixar só a capa</button>
      ${comunicado || P.tipo === "vendido" ? "" : `<button class="btn small" id="bzip">Baixar carrossel (.zip)</button>`}
      <button class="btn small" id="bdrive">Salvar no Drive</button>
      ${P.drive_url ? `<a class="small" href="${esc(P.drive_url)}" target="_blank" rel="noopener">Pasta no Drive ↗</a>` : ""}
      <span class="small muted grow" id="savest"></span>
      <button class="btn small primary" id="nRev">${prox ? "Revisado ✓ e próximo →" : "Revisado ✓ e voltar à lista"}</button>
      <button class="btn small ghost" id="nProx" ${prox ? "" : "disabled"} title="Próximo post sem mudar o status">Próximo →</button>
      <div id="drvprog" class="hidden" style="width:100%"><div class="prog"><i></i></div></div>
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
    // a CTA da loja fecha o carrossel (entra sozinha no download)
    const cta = (P.tipo === "anuncio" || P.tipo === "imovel") && ctaDe(P.loja);
    if (cta) {
      const d = document.createElement("div"); d.className = "it cta"; d.title = "CTA da loja: entra sozinha no fim do carrossel";
      d.innerHTML = `<img alt="CTA"><span class="lb">CTA</span>`; st.appendChild(d);
      fileUrl(cta.camada_path).then(u => { d.querySelector("img").src = u; }).catch(() => {});
    }
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
    $("#enq") && ($("#enq").onclick = async () => {
      const img = fotoImgs[P.capa || 0]; if (!img) return;
      $("#enq").disabled = true; $("#enq").textContent = "Procurando o veículo…";
      try { const pos = await enquadrarCarro(tpl, img); if (pos) { P.foto_pos = pos; desenhar(); mudou(); } else toast("Não achei o veículo na foto. Ajuste à mão."); }
      catch (e) { erro(e); }
      $("#enq").disabled = false; $("#enq").textContent = "Enquadrar veículo";
    });
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
  // ler a mensagem de novo: com IA quando estiver ligada; sem ela, a leitura simples
  $("#reler") && ($("#reler").onclick = async () => {
    const b = $("#reler"), txt = b.textContent; b.disabled = true; b.textContent = "Lendo…";
    try { await salvar(); const upd = await processarPostIA({ ...P }); P.dados = upd.dados; P.legenda = P.legenda || upd.legenda; }
    catch (e) {
      if (!/não foi configurad/.test(e.message)) toast("IA: " + e.message, 5000);
      const d = parseMensagem(P.mensagem); P.dados = { ...(P.dados || {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
    }
    $$("#campos [data-c]").forEach(el => el.value = P.dados[el.dataset.c] ?? "");
    if ($("#legenda")) $("#legenda").value = P.legenda || "";
    desenharBoxes(); desenhar(); mudou(); b.disabled = false; b.textContent = txt;
  });
  $("#leg") && ($("#leg").onclick = async () => {
    const btn = $("#leg"), txt = btn.textContent; btn.disabled = true; btn.textContent = "Escrevendo…";
    try { await salvar(); const upd = await processarPostIA({ ...P }); P.legenda = upd.legenda; $("#legenda").value = P.legenda || ""; mudou(); }
    catch (e) { erro(e); }
    btn.disabled = false; btn.textContent = txt;
  });

  // saídas
  async function capaCanvas() { await desenhar(); const c = document.createElement("canvas"); c.width = E.canvas.width; c.height = E.canvas.height; c.getContext("2d").drawImage(E.canvas, 0, 0); return c; }
  async function arquivos() { await salvar(); return arquivosDoPost({ ...P, id }); }
  $("#bcapa").onclick = async () => { const c = await capaCanvas(); baixar(await canvasBlob(c), `${comunicado ? "COMUNICADO " + lojaLabel(P.loja) : nomeCarro(dadosAtuais())} - capa.png`); };
  $("#bzip") && ($("#bzip").onclick = async () => {
    try { const z = new JSZip(); for (const f of await arquivos()) z.file(f.nome, f.blob); baixar(await z.generateAsync({ type: "blob" }), nomeCarro(dadosAtuais()) + ".zip"); }
    catch (e) { erro(e); }
  });
  $("#bdrive").onclick = async () => {
    const b = $("#bdrive"); b.disabled = true; const bar = $("#drvprog"); bar.classList.remove("hidden");
    try {
      const url = await salvarNoDrive({ ...P, id }, await arquivos(), (n, t) => { bar.querySelector("i").style.width = (100 * n / t) + "%"; });
      P.drive_url = url; P.status = "salvo"; $("#st").value = "salvo";
      toast("Salvo no Drive ✓");
    } catch (e) { erro(e); }
    b.disabled = false; bar.classList.add("hidden");
  };

  // navegação entre posts
  const ir = pid => { flush(); location.hash = "post/" + pid; };
  $("#nAnt").onclick = () => ant && ir(ant);
  $("#nProx").onclick = () => prox && ir(prox);
  $("#nRev").onclick = async () => {
    if (E.travado) return toast("Outra pessoa está editando este post.");
    P.status = "revisado"; $("#st").value = "revisado"; await salvar();
    if (prox) ir(prox); else { toast("Esse era o último da lista."); location.hash = "fila"; }
  };

  lockUI(); desenharStrip(); desenharBoxes(); await desenhar();
  // primeira vez que abre: enquadra o veículo sozinho
  if (!P.foto_pos && !E.travado && (P.tipo === "anuncio" || P.tipo === "vendido") && fotoImgs[P.capa || 0] && tpl) {
    const pos = await enquadrarCarro(tpl, fotoImgs[P.capa || 0]).catch(() => null);
    if (pos && !P.foto_pos) { P.foto_pos = pos; desenhar(); mudou(); }
  }
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
  // a foto sempre cobre a área toda; dentro disso, o veículo inteiro ocupa no máximo 86% da largura
  // (7% de folga de cada lado) e 80% da altura, para nunca sair cortado
  const cover = Math.max(a.width / img.width, a.height / img.height);
  const s = Math.max(cover, Math.min(a.width * 0.86 / bw, a.height * 0.8 / bh));
  let x = a.left + a.width / 2 - (bx + bw / 2) * s, y = a.top + a.height * 0.55 - (by + bh / 2) * s;
  x = Math.min(a.left, Math.max(a.left + a.width - img.width * s, x));
  y = Math.min(a.top, Math.max(a.top + a.height - img.height * s, y));
  return { x, y, s };
}

// ---------------- COMUNICADOS ----------------
async function viewComunicado() {
  const lojas = lojasCom("comunicado");
  $("#main").innerHTML = `<a href="#fila" class="muted small">← Posts</a><h1>Novo comunicado</h1><p class="sub">Escreva o assunto uma vez, marque as lojas e a IA escreve um texto diferente para cada uma. Depois é só revisar em Posts <h1>Comunicados</h1><p class="sub">Escreva o assunto uma vez, marque as lojas e a IA escreve um texto diferente para cada uma. Depois é só revisar na fila.</p>gt; Comunicados.</p>
    <div class="card" style="margin-bottom:12px"><label class="f">Assunto</label><textarea id="ass" rows="4" placeholder="Ex.: sexta 20/11 feriado da Consciência Negra, loja fechada, volta sábado normal"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px" class="small"><input type="checkbox" id="mesmo"> Usar exatamente este texto em todas (sem IA)</label></div>
    <div class="card"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Lojas (${lojas.length}) <span class="small muted" id="nmarc"></span></h2>
        <input id="cq" class="search" placeholder="Buscar loja…"><button class="btn small ghost" id="todas">Marcar todas</button><button class="btn small ghost" id="nenhuma">Desmarcar</button></div>
      <div class="grid3">${[...lojas].sort((a, b) => lojaLabel(a.nome).localeCompare(lojaLabel(b.nome), "pt-BR")).map(l => `<label class="small" data-nm="${esc(norm(lojaLabel(l.nome)))}" style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${esc(l.nome)}" class="lj"> ${esc(lojaLabel(l.nome))}</label>`).join("")}</div></div>
    <div class="row" style="margin-top:14px"><span class="grow small muted" id="cst"></span><button class="btn primary" id="gerar">Criar comunicados</button></div>`;
  const conta = () => { const n = $$(".lj:checked").length; $("#nmarc").textContent = n ? `· ${n} marcada(s)` : ""; };
  const visiveis = () => $$(".lj").filter(c => c.closest("label").style.display !== "none");
  $("#cq").oninput = e => { const q = norm(e.target.value); $$("[data-nm]").forEach(l => l.style.display = !q || l.dataset.nm.includes(q) ? "flex" : "none"); };
  $("#todas").onclick = () => { visiveis().forEach(c => c.checked = true); conta(); };
  $("#nenhuma").onclick = () => { visiveis().forEach(c => c.checked = false); conta(); };
  $$(".lj").forEach(c => c.onchange = conta);
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
      ok(await sb.from("esteira_posts").insert(sel.map(n => ({ lote_id: lote.id, loja: n, tipo: "comunicado", status: "novo", mensagem: assunto, dados: { comunicado: textos[n] || assunto } }))));
      toast("Comunicados criados!"); memo("aba", "comunicados"); location.hash = "fila/" + lote.id;
    } catch (e) { erro(e); $("#gerar").disabled = false; }
  };
}

// ---------------- LOJAS E TEMPLATES ----------------
const ARTES = {
  anuncio: { nome: "Anúncio (capa do carro)", arte: "FEED" },
  vendido: { nome: "Vendido", arte: "VENDIDO FEED" },
  comunicado: { nome: "Comunicado", arte: "COMUNICADO FEED" },
  cta: { nome: "CTA (último card do carrossel)", arte: "CTA" },
  imovel: { nome: "Imóvel", arte: "IMOVEIS FEED" },
  site: { nome: "Site", arte: "SITE" },
};
const nomeArte = t => (ARTES[t.tipo]?.nome.split(" (")[0] || t.arte) + (t.variacao && t.variacao !== "padrao" ? ` · ${t.variacao}` : "");
// janela por cima da página (fecha no ×, no Esc ou clicando fora)
function abrirModal(html, onClose) {
  const w = document.createElement("div"); w.className = "modal";
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="fechar" aria-label="Fechar" title="Fechar">×</button>${html}</div>`;
  document.body.appendChild(w);
  const k = e => { if (e.key === "Escape") fechar(); };
  function fechar() { if (!w.isConnected) return; w.remove(); document.removeEventListener("keydown", k); onClose && onClose(); }
  document.addEventListener("keydown", k);
  w.onmousedown = e => { if (e.target === w) fechar(); };
  $(".fechar", w).onclick = fechar;
  leaveHooks.push(fechar);
  return { el: $(".sheet", w), fechar };
}
// clientes ativos primeiro, depois os outros
const clientesOrdenados = () => [...S.clients].sort((a, b) => ((a.status || "ativo") === "encerrado") - ((b.status || "ativo") === "encerrado") || a.name.localeCompare(b.name, "pt-BR"));

async function viewLojas() {
  const m = $("#main");
  const tpLoja = n => S.tpls.filter(t => t.loja === n && t.tipo !== "fundo");
  const lista = [...S.lojas].sort((a, b) => lojaLabel(a.nome).localeCompare(lojaLabel(b.nome), "pt-BR"));
  const semCli = lista.filter(l => !l.client_id).length;
  m.innerHTML = `<div class="row" style="margin-bottom:4px"><h1 class="grow" style="margin:0">Templates</h1>${S.admin ? `<button class="btn primary" id="novoTpl">+ Template</button>` : ""}</div>
    <p class="sub">Cada loja é um cliente do 2L Core com os templates dele. Clique na loja para ver o Drive, o modelo de legenda e as artes.${S.admin ? "" : " Só administradores alteram esta parte."}</p>
    ${semCli && S.admin ? `<div class="lockbar">${semCli} loja(s) sem cliente ligado. Abra a loja e escolha o cliente, ou <button class="btn small ghost" id="vinc">Ligar pelo nome</button></div>` : ""}
    <div class="row" style="margin-bottom:12px"><input id="lq" class="search" placeholder="Buscar loja…"></div>
    <div id="ll"></div>
    ${S.admin ? `<details style="margin-top:22px"><summary>Importar pacote de templates do computador (pasta esteira-2l)</summary><div class="card" style="margin-top:8px">
      <p class="small muted" style="margin-top:0">Só serve para atualizar os templates feitos pelo pacote do computador. Para cliente novo, use <b>+ Template</b>. Ajustes feitos aqui não são apagados.</p>
      <div class="row"><input type="file" id="pasta" webkitdirectory directory multiple style="max-width:420px"><button class="btn primary" id="imp">Importar</button></div>
      <div id="impbox" class="hidden"><div class="prog"><i id="impbar"></i></div><span class="small" id="imptxt"></span></div></div></details>` : ""}`;
  function desenhar() {
    const q = norm($("#lq").value);
    const vis = lista.filter(l => !q || norm(lojaLabel(l.nome) + " " + l.nome).includes(q));
    $("#ll").innerHTML = !S.lojas.length ? `<div class="empty"><strong>Nenhuma loja ainda</strong>Clique em + Template para cadastrar a primeira.</div>`
      : !vis.length ? `<div class="empty">Nenhuma loja com esse nome.</div>`
      : `<table class="list"><thead><tr><th>Loja</th><th>Artes</th><th>Drive</th><th>Legenda</th></tr></thead><tbody>${vis.map(l => {
        const ts = tpLoja(l.nome), lib = ts.filter(t => t.liberado);
        return `<tr class="click" data-ed="${esc(l.nome)}"><td><b>${esc(lojaLabel(l.nome))}</b>${!l.client_id ? ` <span class="pill erro">sem cliente</span>` : ""}${l.ativo === false ? ` <span class="pill">inativa</span>` : ""}</td>
          <td class="small">${esc([...new Set(lib.map(nomeArte))].join(", ")) || "—"}${lib.length < ts.length ? ` <span class="pill erro">${ts.length - lib.length} bloqueada(s)</span>` : ""}</td>
          <td>${l.drive_pasta_id ? "✓" : `<span class="muted">—</span>`}</td><td>${l.legenda_modelo ? "✓" : `<span class="muted">—</span>`}</td></tr>`;
      }).join("")}</tbody></table>`;
    $$("#ll [data-ed]").forEach(tr => tr.onclick = () => editarLoja(tr.dataset.ed));
  }
  $("#lq").oninput = desenhar; desenhar();
  if (S.admin) {
    $("#imp").onclick = () => importar($("#pasta").files).catch(erro);
    $("#vinc") && ($("#vinc").onclick = vincularClientes);
    $("#novoTpl").onclick = () => novoTemplate();
  }
}
function editarLoja(nome) {
  const l = lojaObj(nome), d = l.dados || {}, dis = S.admin ? "" : "disabled";
  const ts = S.tpls.filter(t => t.loja === nome && t.tipo !== "fundo").sort((a, b) => nomeArte(a).localeCompare(nomeArte(b)));
  const { el, fechar } = abrirModal(`<h2 style="margin-right:44px">${esc(lojaLabel(nome))}</h2>
    ${!l.client_id ? `<p class="small muted" style="margin-top:-6px">Nome no pacote de templates: ${esc(nome)}. Escolha abaixo qual cliente do 2L Core é esta loja.</p>` : ""}
    <div class="grid2" style="margin:8px 0 10px">
      <div><label class="f">Cliente do 2L Core</label><select id="e_cli" ${dis}><option value="">— escolha —</option>${clientesOrdenados().map(c => `<option value="${c.id}" ${c.id === l.client_id ? "selected" : ""}>${esc(c.name)}${c.status === "encerrado" ? " (encerrado)" : ""}</option>`).join("")}</select></div>
      <div><label class="f">Usar na esteira</label><select id="e_at" ${dis}><option value="1" ${l.ativo !== false ? "selected" : ""}>Sim</option><option value="0" ${l.ativo === false ? "selected" : ""}>Não</option></select></div>
      <div><label class="f">Pasta do Drive da loja (cole o link ou o código)</label><input id="e_drv" value="${esc(l.drive_pasta_id || "")}" ${dis} placeholder="https://drive.google.com/drive/folders/…"></div>
      <div><label class="f">Subpastas dos carros ({MES_NUM}, {MES_NOME}, {ANO}, {CARRO})</label><input id="e_pad" value="${esc(l.drive_padrao || "")}" ${dis}></div>
      <div><label class="f">Subpastas dos vendidos (vazio = igual aos carros)</label><input id="e_padv" value="${esc(d.drive_padrao_vendido || "")}" ${dis}></div>
      <div><label class="f">WhatsApp</label><input id="e_wpp" value="${esc(d.whatsapp || "")}" ${dis}></div>
      <div><label class="f">Endereço</label><input id="e_end" value="${esc(d.endereco || "")}" ${dis}></div>
      <div><label class="f">Site / Instagram</label><input id="e_site" value="${esc(d.site || "")}" ${dis}></div>
    </div>
    <label class="f">Modelo de legenda (cole uma legenda real da loja; a IA segue o formato)</label><textarea id="e_leg" rows="7" ${dis}>${esc(l.legenda_modelo || "")}</textarea>
    ${S.admin ? `<div class="row" style="margin:10px 0 4px"><button class="btn primary" id="e_save">Salvar loja</button></div>` : ""}
    <div class="sec-h"><h2 class="grow">Artes</h2>${S.admin ? `<button class="btn small" id="e_novo">+ Template</button>` : ""}</div>
    ${ts.length ? `<table class="list"><thead><tr><th>Arte</th><th>Status</th><th></th></tr></thead><tbody>${ts.map(t => `<tr>
      <td><b>${esc(nomeArte(t))}</b><div class="small muted">${t.largura}×${t.altura}</div></td>
      <td>${t.liberado ? `<span class="pill salvo">liberada</span>` : `<span class="pill erro" title="${esc(t.bloqueio || "")}">bloqueada</span><div class="small muted">${esc(t.bloqueio || "")}</div>`}${t.ajustado ? ` <span class="pill">ajustada</span>` : ""}</td>
      <td style="text-align:right">${t.caixas?.length || S.admin ? `<a class="btn small ghost" href="#ajustar/${t.id}" title="Posicionar os textos e a foto da arte">Ajustar textos</a> ` : ""}${S.admin ? `<button class="btn small ghost" data-lib="${t.id}">${t.liberado ? "Bloquear" : "Liberar"}</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Esta loja ainda não tem arte. Clique em + Template.</div>`}`);
  if (!S.admin) return;
  $("#e_save", el).onclick = async () => {
    try {
      const row = { client_id: $("#e_cli", el).value || null, drive_pasta_id: $("#e_drv", el).value.trim().replace(/^.*folders\//, "").replace(/[?#].*$/, ""),
        drive_padrao: $("#e_pad", el).value.trim(), legenda_modelo: $("#e_leg", el).value, ativo: $("#e_at", el).value === "1",
        dados: { ...d, endereco: $("#e_end", el).value, whatsapp: $("#e_wpp", el).value, site: $("#e_site", el).value, drive_padrao_vendido: $("#e_padv", el).value.trim() }, updated_at: new Date().toISOString() };
      ok(await sb.from("esteira_lojas").update(row).eq("nome", nome));
      Object.assign(l, row); toast("Loja salva ✓"); fechar(); viewLojas();
    } catch (e) { erro(e); }
  };
  $("#e_novo", el).onclick = () => { fechar(); novoTemplate(nome); };
  $$("[data-lib]", el).forEach(b => b.onclick = async () => {
    const t = S.tpls.find(x => x.id === b.dataset.lib);
    try { ok(await sb.from("esteira_templates").update({ liberado: !t.liberado }).eq("id", t.id)); t.liberado = !t.liberado; fechar(); editarLoja(nome); } catch (e) { erro(e); }
  });
}
async function vincularClientes() {
  const tira = s => norm(s).replace(/\b(VEICULOS|MULTIMARCAS|AUTOMOVEIS|MOTORS|MOTOS|AUTO|CAR)\b/g, "").replace(/\s+/g, " ").trim();
  const palavras = s => tira(s).split(" ").filter(w => w.length > 1);
  const clientes = clientesOrdenados();
  let n = 0;
  for (const l of S.lojas.filter(l => !l.client_id)) {
    const alvo = tira(l.nome), pa = palavras(l.nome);
    const c = clientes.find(c => tira(c.name) === alvo)
      || clientes.find(c => tira(c.name).startsWith(alvo) || alvo.startsWith(tira(c.name)) && tira(c.name).length > 3)
      || (pa.length && pa.join("").length > 3 ? clientes.find(c => { const pc = palavras(c.name); return pa.every(w => pc.includes(w)); }) : null);
    if (c) { ok(await sb.from("esteira_lojas").update({ client_id: c.id }).eq("nome", l.nome)); l.client_id = c.id; n++; }
  }
  toast(`${n} loja(s) ligada(s). Abra as que ficaram sem cliente e escolha à mão.`); viewLojas();
}

// ---- cadastrar template pelo site: PNG transparente + print de referência + fontes ----
const PESOS = [["thin", 100], ["hairline", 100], ["extralight", 200], ["ultralight", 200], ["light", 300], ["regular", 400], ["book", 400], ["normal", 400],
  ["medium", 500], ["semibold", 600], ["demibold", 600], ["extrabold", 800], ["ultrabold", 800], ["bold", 700], ["black", 900], ["heavy", 900]];
// "BigShouldersDisplay-SemiBoldItalic.ttf" -> { familia: "Big Shoulders Display", peso: 600, italico: true }
function lerFonte(nomeArquivo) {
  const base = nomeArquivo.replace(/\.(ttf|otf|woff2?)$/i, "").replace(/^fonnts\.com-/i, "");
  const [fam, ...resto] = base.split(/[-_]/);
  const estilo = resto.join("").toLowerCase();
  const peso = (PESOS.find(([k]) => estilo.replace("italic", "").includes(k)) || [, 400])[1];
  return { familia: fam.replace(/([a-z])([A-Z])/g, "$1 $2").trim(), peso, italico: /italic|oblique/.test(estilo) };
}
const familiasFonte = () => [...new Set(["Poppins", ...((S.cfg.fontes?.arquivos) || []).map(a => a.familia)])].sort((a, b) => a.localeCompare(b));
function caixaPadrao(i, w, fonte, campo, modelo, extra = {}) {
  return { id: "cx" + Date.now().toString(36) + i, campo, modelo, exemplo: "", top: 80 + i * 90, left: 60, largura: w - 120, alinhamento: "center",
    entrelinha: 1.2, espacamento: 0, maiusculas: true, fonte, peso: 700, italico: false, tamanho: 52, cor: "#ffffff", ...extra };
}
const CAMPOS_PRONTOS = [
  ["Marca e modelo", "{marca} {modelo}"], ["Versão", "{versao}"], ["Ano", "{ano}"], ["KM", "{km} km"], ["Ano e KM", "{ano} | {km} km"],
  ["Valor", "R$ {valor}"], ["Valor com centavos", "R$ {valor_cent}"], ["Motor e câmbio", "{motor} {cambio}"], ["Detalhe curto", "{detalhes}"],
  ["Texto do comunicado", "{comunicado}"], ["Texto fixo", "TEXTO"]];
function caixasIniciais(tipo, w, fonte) {
  if (tipo === "anuncio") return [caixaPadrao(0, w, fonte, "Marca e modelo", "{marca} {modelo}"), caixaPadrao(1, w, fonte, "Versão", "{versao}", { peso: 400, tamanho: 38 }), caixaPadrao(2, w, fonte, "Ano e KM", "{ano} | {km} km", { peso: 400, tamanho: 34 })];
  if (tipo === "vendido") return [caixaPadrao(0, w, fonte, "Marca e modelo", "{marca} {modelo}")];
  if (tipo === "comunicado") return [caixaPadrao(0, w, fonte, "Texto do comunicado", "{comunicado}", { maiusculas: false, peso: 500, tamanho: 40, multilinha: true, top: 400 })];
  if (tipo === "imovel") return [caixaPadrao(0, w, fonte, "Tipo e bairro", "{tipo_imovel} {bairro}"), caixaPadrao(1, w, fonte, "Valor", "R$ {valor}")];
  return [];
}
async function registrarFonte(a) {
  const face = new FontFace(a.familia, `url("${await fileUrl(a.arquivo)}")`, { weight: String(a.peso), style: a.italico ? "italic" : "normal" });
  await face.load(); document.fonts.add(face);
}
function novoTemplate(lojaNome) {
  const loja = lojaNome ? lojaObj(lojaNome) : null;
  const { el, fechar } = abrirModal(`<h2 style="margin-right:44px">Novo template</h2>
    <p class="sub" style="margin-top:-6px">Suba a arte do Canva sem os textos e sem a foto (PNG com fundo transparente), o print da arte pronta e as fontes. Depois você posiciona os textos por cima do print.</p>
    <div class="grid2">
      <div><label class="f">Cliente</label>${loja ? `<input value="${esc(lojaLabel(loja.nome))}" disabled>` : `<select id="t_cli"><option value="">— escolha —</option>${clientesOrdenados().filter(c => c.status !== "encerrado").map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>`}</div>
      <div><label class="f">Arte</label><select id="t_tipo">${Object.entries(ARTES).map(([k, a]) => `<option value="${k}">${a.nome}</option>`).join("")}</select></div>
      <div><label class="f">PNG da arte sem textos e sem foto (fundo transparente)</label><input type="file" id="t_png" accept="image/png"></div>
      <div><label class="f">Print da arte pronta (referência, opcional)</label><input type="file" id="t_ref" accept="image/*"></div>
      <div><label class="f">Fontes usadas (.ttf, .otf; opcional)</label><input type="file" id="t_fon" accept=".ttf,.otf,.woff,.woff2" multiple></div>
      <div><label class="f">Versão (só se a loja tiver mais de uma arte do mesmo tipo)</label><input id="t_var" value="padrao"></div>
    </div>
    <div id="t_fontes" style="margin-top:10px"></div>
    <div class="row" style="margin-top:14px"><span class="grow small muted" id="t_st"></span><button class="btn primary" id="t_ok">Criar e posicionar os textos</button></div>`);
  let fontes = [];
  $("#t_fon", el).onchange = e => {
    fontes = [...e.target.files].map(f => ({ f, ...lerFonte(f.name) }));
    $("#t_fontes", el).innerHTML = fontes.length ? `<label class="f">Confira o nome e o peso de cada fonte (igual ao Canva)</label>` + fontes.map((x, i) => `<div class="grid3" style="margin-bottom:6px">
      <input data-fi="${i}" data-k="familia" value="${esc(x.familia)}"><select data-fi="${i}" data-k="peso">${[100, 200, 300, 400, 500, 600, 700, 800, 900].map(p => `<option ${p === x.peso ? "selected" : ""}>${p}</option>`).join("")}</select>
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-fi="${i}" data-k="italico" ${x.italico ? "checked" : ""} style="width:auto"> itálico · <span class="muted">${esc(x.f.name)}</span></label></div>`).join("") : "";
    $$("[data-fi]", el).forEach(inp => inp.onchange = inp.oninput = () => { const x = fontes[+inp.dataset.fi]; x[inp.dataset.k] = inp.type === "checkbox" ? inp.checked : inp.dataset.k === "peso" ? +inp.value : inp.value.trim(); });
  };
  $("#t_ok", el).onclick = async () => {
    const tipo = $("#t_tipo", el).value, png = $("#t_png", el).files[0], ref = $("#t_ref", el).files[0], variacao = $("#t_var", el).value.trim() || "padrao";
    const cid = loja ? loja.client_id : $("#t_cli", el).value;
    if (!loja && !cid) return toast("Escolha o cliente.");
    if (!png) return toast("Suba o PNG da arte.");
    const b = $("#t_ok", el), st = t => { $("#t_st", el).textContent = t; }; b.disabled = true;
    try {
      // loja da esteira ligada ao cliente (cria se ainda não existe)
      let nomeLoja = loja?.nome || S.lojas.find(l => l.client_id === cid)?.nome;
      if (!nomeLoja) {
        nomeLoja = S.clients.find(c => c.id === cid).name;
        ok(await sb.from("esteira_lojas").upsert({ nome: nomeLoja, client_id: cid }, { onConflict: "nome" }));
      }
      const pasta = `camadas/${safeKey(nomeLoja)}`, sufixo = `${safeKey(ARTES[tipo].arte + " " + variacao).replace(/\s+/g, "_")}-${Date.now().toString(36)}`;
      st("Enviando o PNG…");
      const camada_path = `${pasta}/${sufixo}.png`;
      ok(await sb.storage.from("esteira").upload(camada_path, png, { upsert: true, contentType: "image/png" }));
      const im = await R.loadImage(URL.createObjectURL(png)), largura = im.naturalWidth, altura = im.naturalHeight;
      let ref_path = null;
      if (ref) { st("Enviando o print…"); ref_path = `refs/${safeKey(nomeLoja)}/${sufixo}.${(ref.name.split(".").pop() || "png").toLowerCase()}`; ok(await sb.storage.from("esteira").upload(ref_path, ref, { upsert: true, contentType: ref.type || "image/png" })); }
      if (fontes.length) {
        st("Enviando as fontes…");
        const man = S.cfg.fontes || { arquivos: [] }; man.arquivos = man.arquivos || [];
        for (const x of fontes) {
          const arquivo = `fontes/${safeKey(x.f.name)}`;
          ok(await sb.storage.from("esteira").upload(arquivo, x.f, { upsert: true, contentType: "font/" + (x.f.name.split(".").pop() || "ttf").toLowerCase() }));
          const a = { familia: x.familia, peso: x.peso, italico: !!x.italico, variavel: false, arquivo };
          man.arquivos = man.arquivos.filter(o => o.arquivo !== arquivo).concat(a);
          try { await registrarFonte(a); } catch (e) { console.warn(e); }
        }
        ok(await sb.from("esteira_config").update({ data: { ...S.cfg, fontes: man } }).eq("id", 1)); S.cfg.fontes = man;
      }
      st("Gravando o template…");
      const temFoto = ["anuncio", "vendido", "imovel", "site"].includes(tipo);
      const row = { loja: nomeLoja, arte: ARTES[tipo].arte, variacao, tipo, largura, altura, camada_path, foto: temFoto ? { top: 0, left: 0, width: largura, height: altura } : null,
        render: ref_path ? { ref_path } : {}, caixas: caixasIniciais(tipo, largura, fontes[0]?.familia || "Poppins"), liberado: true, bloqueio: null, ajustado: true, updated_at: new Date().toISOString() };
      const t = ok(await sb.from("esteira_templates").upsert(row, { onConflict: "loja,arte,variacao" }).select().single());
      await loadBase(); blobCache.delete(camada_path); imgCache.delete(camada_path);
      toast("Template criado. Agora posicione os textos e a área da foto.", 5000); fechar();
      location.hash = (tipo === "cta" ? "lojas" : "ajustar/" + t.id);
      if (tipo === "cta") viewLojas();
    } catch (e) { erro(e); b.disabled = false; st(""); }
  };
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

// ---------------- AJUSTAR TEXTOS DO TEMPLATE (com o print da arte pronta por cima) ----------------
async function viewAjustar(id) {
  const t0 = S.tpls.find(t => t.id === id); if (!t0) return viewLojas();
  const tpl = JSON.parse(JSON.stringify(t0)); tpl.caixas = tpl.caixas || [];
  await fontsReady();
  const exemplo = { marca: "VOLKSWAGEN", modelo: "SAVEIRO", versao: "ROBUST 1.6", ano: "2022/2023", km: "42000", valor: "66900", cambio: "Manual", motor: "1.6", combustivel: "Flex", detalhes: "Completo",
    comunicado: "Informamos aos nossos clientes que, nesta sexta-feira (20/11), nossa loja estará fechada. Retornamos no sábado.",
    tipo_imovel: "CASA", negocio: "Venda", bairro: "Gleba Palhano", cidade: "Londrina/PR", area: "190", quartos: "3", suites: "1", banheiros: "2", vagas: "2", destaque: "Pronto para morar", condominio: "Royal Park" };
  const textos = {};
  for (const cx of tpl.caixas) if (cx.exemplo && !cx.trechos) textos[cx.id] = String(cx.exemplo).replace(/\\n/g, "\n");
  let ref = null, sel = 0, opac = 0.5;
  $("#main").innerHTML = `<a href="#lojas" class="muted small">← Lojas</a><h1>Ajustar textos: ${esc(lojaLabel(tpl.loja))} · ${esc(nomeArte(tpl))}</h1>
    <p class="sub">Coloque o print da arte pronta por cima e arraste cada texto até ficar no lugar. Clique num texto da arte para escolher qual mexer. ${S.admin ? "" : "(só administrador salva)"}</p>
    <div class="editor"><div class="stage"><canvas id="cv"></canvas>
      <div class="row small" style="margin-top:8px"><label class="btn small ghost">${tpl.render?.ref_path ? "Trocar print" : "Print da arte por cima"}<input type="file" id="ref" accept="image/*" hidden></label>
      <span class="muted">Transparência do print</span><input type="range" id="op" min="0" max="1" step="0.05" value="0.5" class="grow"></div></div>
      <div>
        <div class="card" style="margin-bottom:12px"><div class="row" style="margin-bottom:8px"><label class="f grow" style="margin:0">Texto da arte</label>
          ${S.admin ? `<button class="btn small ghost" id="add">+ Texto</button><button class="btn small ghost" id="del">Tirar</button>` : ""}</div>
          <select id="cxs"></select>
          <div id="props" style="margin-top:10px"></div>
          <p class="small muted">Setas do teclado também movem o texto (Shift = 10px).</p></div>
        ${tpl.foto ? `<div class="card" style="margin-bottom:12px"><label class="f">Área da foto do carro (onde a foto aparece)</label><div class="grid2" id="fotoA"></div></div>` : ""}
        ${S.admin ? `<div class="row"><button class="btn primary" id="salvar">Salvar ajustes</button><button class="btn ghost" id="desf">Desfazer tudo</button></div>` : ""}</div></div>`;
  const cv = $("#cv");
  const camada = await storageImg(tpl.camada_path);
  if (tpl.render?.ref_path) try { ref = await storageImg(tpl.render.ref_path); } catch (e) {}
  const NUM = [["top", "Topo"], ["left", "Esquerda"], ["largura", "Largura"], ["tamanho", "Tamanho"], ["espacamento", "Espaçamento"], ["entrelinha", "Entrelinha"]];
  const caixaAt = () => tpl.caixas[sel];
  async function draw() {
    await R.ensureFonts(tpl);
    const tx = { ...R.textosPadrao(tpl, exemplo), ...textos };
    // área da foto em cinza para enxergar onde ela entra
    R.renderArte({ tpl, camada, foto: null, textos: tx, canvas: cv });
    const ctx = cv.getContext("2d");
    if (tpl.foto) { ctx.save(); ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#9a9a94"; ctx.fillRect(tpl.foto.left, tpl.foto.top, tpl.foto.width, tpl.foto.height); ctx.restore(); }
    if (ref) { ctx.globalAlpha = opac; ctx.drawImage(ref, 0, 0, cv.width, cv.height); ctx.globalAlpha = 1; }
    const c = caixaAt(); if (!c) return;
    ctx.strokeStyle = "#ff00aa"; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
    ctx.strokeRect(c.left, c.top, c.largura, c.tamanho * (c.entrelinha || 1.2)); ctx.setLineDash([]);
  }
  function lista() {
    $("#cxs").innerHTML = tpl.caixas.length ? tpl.caixas.map((c, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(c.campo || "Texto " + (i + 1))}</option>`).join("") : `<option>Nenhum texto. Clique em + Texto.</option>`;
  }
  function props() {
    const c = caixaAt();
    if (!c) { $("#props").innerHTML = ""; return; }
    const fams = familiasFonte(); if (!fams.includes(c.fonte)) fams.unshift(c.fonte);
    $("#props").innerHTML = `
      <div style="margin-bottom:8px"><label class="f">O que vai escrito (use os campos: {marca} {modelo} {versao} {ano} {km} {valor} {valor_cent} {motor} {cambio} {detalhes} {comunicado})</label>
        <input data-s="modelo" value="${esc(c.trechos ? c.trechos.map(r => r.modelo).join(" | ") : c.modelo || "")}" ${c.trechos ? "disabled title='Texto com estilos misturados: ajuste pelo pacote'" : ""}></div>
      <div class="grid3" style="margin-bottom:8px">
        <div><label class="f">Fonte</label><select data-s="fonte">${fams.map(f => `<option ${f === c.fonte ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div>
        <div><label class="f">Peso</label><select data-s="peso">${[100, 200, 300, 400, 500, 600, 700, 800, 900].map(p => `<option ${p === +c.peso ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div><label class="f">Cor</label><input type="color" data-s="cor" value="${esc(/^#[0-9a-f]{6}$/i.test(c.cor || "") ? c.cor : "#000000")}" style="height:38px;padding:2px"></div>
        <div><label class="f">Alinhamento</label><select data-s="alinhamento">${[["start", "Esquerda"], ["center", "Centro"], ["end", "Direita"]].map(([k, l]) => `<option value="${k}" ${(c.alinhamento || "start") === k || (k === "end" && c.alinhamento === "right") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label class="f">Maiúsculas</label><select data-s="maiusculas"><option value="1" ${c.maiusculas ? "selected" : ""}>Sim</option><option value="0" ${!c.maiusculas ? "selected" : ""}>Não</option></select></div>
        <div><label class="f">Itálico</label><select data-s="italico"><option value="0" ${!c.italico ? "selected" : ""}>Não</option><option value="1" ${c.italico ? "selected" : ""}>Sim</option></select></div>
      </div>
      <div class="grid3">${NUM.map(([k, l]) => `<div><label class="f">${l}</label><input type="number" step="${k === "entrelinha" || k === "espacamento" ? 0.01 : 1}" data-p="${k}" value="${Math.round((c[k] ?? 0) * 100) / 100}"></div>`).join("")}</div>
      <div style="margin-top:8px"><label class="f">Texto de teste (só para ver aqui)</label><input id="txt"></div>`;
    $$("#props [data-p]").forEach(el => el.oninput = () => { c[el.dataset.p] = parseFloat(el.value) || 0; if (el.dataset.p === "tamanho" && c.trechos) c.trechos.forEach(r => r.tamanho = c.tamanho); draw(); });
    $$("#props [data-s]").forEach(el => el.oninput = el.onchange = () => {
      const k = el.dataset.s, v = el.value;
      if (k === "modelo") { c.modelo = v; delete textos[c.id]; }
      else if (k === "maiusculas" || k === "italico") c[k] = v === "1";
      else if (k === "peso") c.peso = +v;
      else c[k] = v;
      if (c.trechos && ["fonte", "peso", "cor", "italico"].includes(k)) c.trechos.forEach(r => r[k] = c[k]);
      draw();
    });
    const v = { ...R.textosPadrao(tpl, exemplo), ...textos }[c.id];
    $("#txt").value = Array.isArray(v) ? v.join("|") : v || "";
    $("#txt").oninput = e => { textos[c.id] = c.trechos ? e.target.value.split("|") : e.target.value; draw(); };
  }
  function fotoProps() {
    if (!tpl.foto) return;
    $("#fotoA").innerHTML = [["top", "Topo"], ["left", "Esquerda"], ["width", "Largura"], ["height", "Altura"]].map(([k, l]) => `<div><label class="f">${l}</label><input type="number" data-fa="${k}" value="${Math.round(tpl.foto[k])}"></div>`).join("");
    $$("#fotoA [data-fa]").forEach(el => el.oninput = () => { tpl.foto[el.dataset.fa] = parseFloat(el.value) || 0; draw(); });
  }
  const tudo = () => { lista(); props(); draw(); };
  $("#cxs").onchange = e => { sel = +e.target.value; props(); draw(); };
  $("#op").oninput = e => { opac = +e.target.value; draw(); };
  $("#ref").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    ref = await R.loadImage(URL.createObjectURL(f)); draw();
    if (S.admin) try {   // guarda o print junto do template para a próxima vez
      const p = `refs/${safeKey(tpl.loja)}/${safeKey(tpl.arte + " " + tpl.variacao).replace(/\s+/g, "_")}-${Date.now().toString(36)}.${(f.name.split(".").pop() || "png").toLowerCase()}`;
      ok(await sb.storage.from("esteira").upload(p, f, { upsert: true, contentType: f.type || "image/png" })); tpl.render = { ...(tpl.render || {}), ref_path: p };
    } catch (err) { console.warn(err); }
  };
  if (S.admin) {
    $("#add").onclick = () => {
      const op = abrirModal(`<h2>Novo texto</h2><p class="sub">Escolha o que vai escrito. Depois é só arrastar para o lugar.</p>
        <div class="grid2">${CAMPOS_PRONTOS.map(([n, md], i) => `<button class="btn ghost" data-nc="${i}" style="justify-content:flex-start">${esc(n)} <span class="small muted">${esc(md)}</span></button>`).join("")}</div>`);
      $$("[data-nc]", op.el).forEach(b => b.onclick = () => {
        const [n, md] = CAMPOS_PRONTOS[+b.dataset.nc], base = caixaAt();
        tpl.caixas.push(caixaPadrao(tpl.caixas.length, tpl.largura, base?.fonte || familiasFonte()[0], n, md, base ? { cor: base.cor, fonte: base.fonte, top: Math.min(tpl.altura - 80, base.top + 90) } : {}));
        sel = tpl.caixas.length - 1; op.fechar(); tudo();
      });
    };
    $("#del").onclick = () => { if (!caixaAt() || !confirm(`Tirar o texto "${caixaAt().campo}" desta arte?`)) return; tpl.caixas.splice(sel, 1); sel = Math.max(0, sel - 1); tudo(); };
  }
  // arrastar o texto (ou escolher clicando nele)
  let drag = null;
  const ponto = e => { const r = cv.getBoundingClientRect(), k = cv.width / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
  const dentro = (c, p) => p.x >= c.left && p.x <= c.left + c.largura && p.y >= c.top - 10 && p.y <= c.top + c.tamanho * (c.entrelinha || 1.2) * 1.5;
  cv.onpointerdown = e => {
    const p = ponto(e);
    const hit = tpl.caixas.findIndex(c => dentro(c, p));
    if (hit >= 0 && hit !== sel) { sel = hit; lista(); props(); draw(); }
    const c = caixaAt(); if (!c || !dentro(c, p)) return;
    drag = { x: p.x, y: p.y, top: c.top, left: c.left }; cv.setPointerCapture(e.pointerId); cv.classList.add("drag");
  };
  cv.onpointermove = e => {
    if (!drag) return; const p = ponto(e), c = caixaAt();
    c.left = Math.round(drag.left + p.x - drag.x); c.top = Math.round(drag.top + p.y - drag.y); draw();
  };
  cv.onpointerup = cv.onpointercancel = () => { if (drag) { drag = null; cv.classList.remove("drag"); props(); } };
  const onKey = e => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !caixaAt()) return;
    e.preventDefault(); const c = caixaAt(), d = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") c.top -= d; if (e.key === "ArrowDown") c.top += d; if (e.key === "ArrowLeft") c.left -= d; if (e.key === "ArrowRight") c.left += d;
    props(); draw();
  };
  document.addEventListener("keydown", onKey); leaveHooks.push(() => document.removeEventListener("keydown", onKey));
  if (S.admin) {
    $("#salvar").onclick = async () => {
      try {
        const upd = { caixas: tpl.caixas, foto: tpl.foto, render: tpl.render || {}, ajustado: true, updated_at: new Date().toISOString() };
        ok(await sb.from("esteira_templates").update(upd).eq("id", id)); Object.assign(t0, upd); toast("Ajustes salvos ✓");
      } catch (e) { erro(e); }
    };
    $("#desf").onclick = () => viewAjustar(id);
  }
  fotoProps(); tudo();
}

boot();
