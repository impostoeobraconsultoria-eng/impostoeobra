/* ============================================================
   CRM Imposto & Obra — App shell
   Versao Fase 1 - Entrega 2 (shell + login + Config)
   ============================================================ */
"use strict";

(function () {

// ============================================================
// CONFIG (persistido em localStorage)
// ============================================================
var STORAGE_KEY = "ieo-crm-config";

var DEFAULTS = {
  apps_script_url: "https://script.google.com/macros/s/AKfycbxb6nNYwS5V8w9VoTIfHuRUYMgwEOsAL49AfhIx8NWoTWTiJo6zBoSpn0bPEQVkCQ5zPQ/exec",
  google_client_id: "" // o usuario precisa criar e colar
};

function getCfg() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); }
  catch (_) { return Object.assign({}, DEFAULTS); }
}
function setCfg(patch) {
  var cur = getCfg();
  Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
}

// ============================================================
// ESTADO
// ============================================================
var state = {
  user: null,        // { email, name, picture, idToken }
  profile: null,     // perfil vindo do backend (perfil, ativo, ...)
  serverConfig: {},  // config.get do backend
  lastSyncAt: null,
  online: navigator.onLine,
};

// ============================================================
// HELPERS
// ============================================================
function $(id) { return document.getElementById(id); }
function el(tag, props, children) {
  var n = document.createElement(tag);
  if (props) Object.keys(props).forEach(function (k) {
    if (k === "class") n.className = props[k];
    else if (k === "style") n.style.cssText = props[k];
    else if (k.indexOf("on") === 0) n[k] = props[k];
    else n.setAttribute(k, props[k]);
  });
  if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
    if (c == null) return;
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  });
  return n;
}
function toast(msg, kind) {
  var t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (kind ? " " + kind : "");
  setTimeout(function () { t.className = "toast"; }, 3500);
}
function setLive(state2, txt) {
  $("live-badge").className = "live-badge" + (state2 === "off" ? " off" : state2 === "warning" ? " warning" : "");
  $("live-text").textContent = txt;
}
function nowTxt() {
  var d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(function (n) { return String(n).padStart(2, "0"); }).join(":");
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
  });
}

// ============================================================
// API WRAPPER
// ============================================================
var api = {
  async call(action, data) {
    var cfg = getCfg();
    if (!cfg.apps_script_url) throw new Error("URL do Apps Script nao configurada");
    var body = Object.assign({ action: action }, data || {});
    if (state.user && state.user.idToken) body.idToken = state.user.idToken;
    try {
      var resp = await fetch(cfg.apps_script_url, {
        method: "POST",
        // text/plain evita preflight CORS no Apps Script
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var json = await resp.json();
      if (!json.ok) {
        var e = new Error(json.error || "Erro");
        e.code = json.code || "INTERNAL";
        throw e;
      }
      state.lastSyncAt = new Date();
      setLive("on", "ao vivo · " + nowTxt());
      return json.data;
    } catch (err) {
      setLive("off", "falha · " + (err.message || err));
      throw err;
    }
  }
};

// ============================================================
// AUTENTICACAO (Google Identity Services)
// ============================================================
var auth = {
  ready: false,

  init() {
    var cfg = getCfg();
    if (!cfg.google_client_id) {
      this.showLoginConfigPrompt("Google OAuth Client ID nao configurado. Clique em '⚙ Configuracao inicial'.");
      return;
    }
    // Aguarda o script GIS carregar
    var tryInit = function () {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        return setTimeout(tryInit, 100);
      }
      try {
        google.accounts.id.initialize({
          client_id: cfg.google_client_id,
          callback: auth.onCredential,
          auto_select: false,
          cancel_on_tap_outside: false,
        });
        google.accounts.id.renderButton($("g-signin-btn"), {
          type: "standard",
          theme: "filled_blue",
          size: "large",
          text: "signin_with",
          shape: "pill",
        });
        auth.ready = true;
      } catch (e) {
        auth.showLoginConfigPrompt("Erro inicializando login Google: " + (e.message || e));
      }
    };
    tryInit();
  },

  onCredential(response) {
    var idToken = response.credential;
    // Decode rapido pra mostrar o email durante a chamada (sem verificar)
    try {
      var payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      state.user = {
        email: payload.email,
        name: payload.name || payload.email,
        picture: payload.picture || "",
        idToken: idToken
      };
    } catch (_) {
      state.user = { email: "?", name: "?", idToken: idToken };
    }
    auth.completeLogin();
  },

  async completeLogin() {
    setLive("warning", "validando login...");
    try {
      var profile = await api.call("me");
      state.profile = profile;
      if (!profile || !profile.ativo || String(profile.ativo).toUpperCase() === "FALSE") {
        toast("Usuario inativo ou nao autorizado: " + (state.user.email), "error");
        return;
      }
      // Tudo OK — entra na app
      $("login-screen").classList.add("hidden");
      $("app-shell").classList.remove("hidden");
      $("user-email").textContent = state.user.email;
      auth.afterLogin();
    } catch (err) {
      if (err.code === "FORBIDDEN") {
        toast("Usuario " + state.user.email + " nao tem acesso. Peca pro admin cadastrar na aba Usuarios.", "error");
      } else {
        toast("Erro ao validar login: " + (err.message || err), "error");
      }
      setLive("off", "falha login");
    }
  },

  afterLogin() {
    // Carrega config do servidor
    api.call("config.get").then(function (cfg) { state.serverConfig = cfg || {}; }).catch(function(){});
    // Inicia router
    router.init();
  },

  logout() {
    state.user = null;
    state.profile = null;
    try { google.accounts.id.disableAutoSelect(); } catch (_) {}
    $("app-shell").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    setLive("off", "deslogado");
  },

  showLoginConfigPrompt(msg) {
    var help = $("login-help");
    if (msg) help.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg) + "</span>";
  }
};

// ============================================================
// ROUTER (hash-based)
// ============================================================
var router = {
  init() {
    window.addEventListener("hashchange", router.handle);
    router.handle();
  },
  handle() {
    var hash = (location.hash || "#kanban").replace(/^#/, "");
    var route = hash.split("/")[0] || "kanban";
    // Highlight do nav
    document.querySelectorAll("#topbar-nav a").forEach(function (a) {
      a.classList.toggle("active", a.dataset.route === route);
    });
    var fn = views[route] || views.notfound;
    fn();
  },
  go(route) { location.hash = "#" + route; }
};

// ============================================================
// VIEWS
// ============================================================
var views = {
  kanban() { kanbanView.render(); },
  leads() { leadsView.render(); },
  lead() {
    var id = (location.hash || "").split("/")[1];
    leadDetailView.render(id);
  },
  clientes() { clientesView.render(); },
  cliente() {
    var id = (location.hash || "").split("/")[1];
    clienteDetailView.render(id);
  },
  config() {
    views._configRender();
  },

  // === CONFIG (funcional nesta entrega) ===
  _configRender() {
    var profile = state.profile || {};
    var cfg = state.serverConfig || {};
    var localCfg = getCfg();
    var isAdmin = String(profile.perfil).toLowerCase() === "admin";

    var html = '<div class="config-view">';

    // Identidade
    html += '<div class="config-section">';
    html += '<h3>Sua conta</h3>';
    html += '<p class="section-desc">Informações da sessão atual.</p>';
    html += '<div><strong>E-mail:</strong> ' + escapeHtml(state.user.email) + '</div>';
    html += '<div><strong>Nome:</strong> ' + escapeHtml(profile.nome || state.user.name) + '</div>';
    html += '<div><strong>Perfil:</strong> <span class="badge ' + escapeHtml(profile.perfil || "") + '">' + escapeHtml(profile.perfil || "—") + '</span></div>';
    html += '</div>';

    // Conexao
    html += '<div class="config-section">';
    html += '<h3>Conexão com o backend</h3>';
    html += '<p class="section-desc">URL do Apps Script Web App. Para alterar, salve, recarregue (F5) e faça login novamente.</p>';
    html += '<div class="config-row"><div class="field"><label>URL do Apps Script</label>' +
            '<input type="text" id="cfg-srv-url" value="' + escapeHtml(localCfg.apps_script_url) + '" /></div></div>';
    html += '<div class="config-row"><div class="field"><label>Google OAuth Client ID</label>' +
            '<input type="text" id="cfg-srv-clientid" value="' + escapeHtml(localCfg.google_client_id) + '" /></div></div>';
    html += '<div><button class="btn" id="btn-save-local-cfg">Salvar conexão</button>';
    html += ' <button class="btn ghost" id="btn-test-conn">Testar conexão</button></div>';
    html += '<div id="conn-status" style="margin-top:10px"></div>';
    html += '</div>';

    // Parametros (admin)
    if (isAdmin) {
      html += '<div class="config-section">';
      html += '<h3>Parâmetros do CRM</h3>';
      html += '<p class="section-desc">Configurações compartilhadas (salvas na aba Config da planilha).</p>';

      html += '<div class="config-row"><div class="field"><label>WhatsApp da empresa (E.164, ex: 5561993982653)</label>' +
              '<input type="text" id="cfg-whats" value="' + escapeHtml(cfg.whatsapp_empresa || "") + '" /></div></div>';

      html += '<div class="config-row"><div class="field"><label>Mensagem padrão de WhatsApp</label>' +
              '<textarea id="cfg-msg-whats">' + escapeHtml(cfg.msg_whatsapp_padrao || "") + '</textarea>' +
              '<small class="muted">Variáveis: <code>{nome}</code>, <code>{uf}</code>, <code>{produto}</code></small></div></div>';

      html += '<div class="config-row"><div class="field"><label>Etapas do Funil (separadas por vírgula)</label>' +
              '<input type="text" id="cfg-etapas" value="' + escapeHtml(cfg.etapas_funil || "") + '" /></div></div>';

      html += '<div class="config-row"><div class="field"><label>Produtos ativos (separados por vírgula)</label>' +
              '<input type="text" id="cfg-produtos" value="' + escapeHtml(cfg.produtos || "") + '" /></div></div>';

      html += '<div><button class="btn" id="btn-save-server-cfg">Salvar parâmetros</button></div>';
      html += '</div>';

      // Usuarios
      html += '<div class="config-section">';
      html += '<h3>Usuários do CRM</h3>';
      html += '<p class="section-desc">Quem pode entrar. Cadastre por e-mail Google.</p>';
      html += '<div id="users-table-wrap"><em>Carregando usuários...</em></div>';
      html += '<div class="config-row" style="margin-top:14px;">' +
              '<div class="field"><label>E-mail</label><input type="text" id="new-user-email" placeholder="email@gmail.com"/></div>' +
              '<div class="field"><label>Nome</label><input type="text" id="new-user-nome" placeholder="Nome do consultor"/></div>' +
              '<div class="field" style="max-width:140px;"><label>Perfil</label>' +
                '<select id="new-user-perfil" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;">' +
                  '<option value="consultor">consultor</option>' +
                  '<option value="admin">admin</option>' +
                  '<option value="operacional">operacional</option>' +
                '</select></div>' +
              '<button class="btn" id="btn-add-user">+ Adicionar</button></div>';
      html += '</div>';
    }

    html += '</div>'; // .config-view
    $("view").innerHTML = html;

    // Listeners
    $("btn-save-local-cfg").onclick = function () {
      setCfg({
        apps_script_url: $("cfg-srv-url").value.trim(),
        google_client_id: $("cfg-srv-clientid").value.trim(),
      });
      toast("Conexão salva. Recarregue a página (F5) para aplicar.", "success");
    };
    $("btn-test-conn").onclick = async function () {
      var st = $("conn-status");
      st.innerHTML = '<span class="config-status warning">Testando...</span>';
      try {
        var me = await api.call("me");
        st.innerHTML = '<span class="config-status ok">✓ Conectado. Perfil: ' + escapeHtml(me.perfil || "—") + '</span>';
      } catch (e) {
        st.innerHTML = '<span class="config-status err">✗ ' + escapeHtml(e.message || e) + '</span>';
      }
    };

    if (isAdmin) {
      $("btn-save-server-cfg").onclick = async function () {
        try {
          await api.call("config.set", { chave: "whatsapp_empresa",   valor: $("cfg-whats").value.trim() });
          await api.call("config.set", { chave: "msg_whatsapp_padrao",valor: $("cfg-msg-whats").value });
          await api.call("config.set", { chave: "etapas_funil",       valor: $("cfg-etapas").value.trim() });
          await api.call("config.set", { chave: "produtos",           valor: $("cfg-produtos").value.trim() });
          state.serverConfig = await api.call("config.get");
          toast("Parâmetros salvos.", "success");
        } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      };

      // Carrega lista de usuarios
      api.call("usuarios.list").then(function (users) {
        var wrap = $("users-table-wrap");
        if (!users || !users.length) { wrap.innerHTML = "<em>Nenhum usuário cadastrado.</em>"; return; }
        var h = '<table class="users-table"><thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th></th></tr></thead><tbody>';
        users.forEach(function (u) {
          var ativo = String(u.ativo).toUpperCase() !== "FALSE";
          h += '<tr>' +
            '<td>' + escapeHtml(u.email) + '</td>' +
            '<td>' + escapeHtml(u.nome) + '</td>' +
            '<td><span class="badge ' + escapeHtml(u.perfil) + '">' + escapeHtml(u.perfil) + '</span></td>' +
            '<td>' + (ativo ? '<span class="badge consultor">ativo</span>' : '<span class="badge inativo">inativo</span>') + '</td>' +
            '<td>' + escapeHtml(u.ultimo_acesso || "—") + '</td>' +
            '<td>' + (ativo
              ? '<button class="btn btn-sm ghost" data-toggle-user="' + escapeHtml(u.email) + '" data-ativo="false">Desativar</button>'
              : '<button class="btn btn-sm" data-toggle-user="' + escapeHtml(u.email) + '" data-ativo="true">Ativar</button>') + '</td>' +
            '</tr>';
        });
        h += '</tbody></table>';
        wrap.innerHTML = h;
        wrap.querySelectorAll("[data-toggle-user]").forEach(function (btn) {
          btn.onclick = async function () {
            try {
              await api.call("usuarios.update", { email: btn.dataset.toggleUser, ativo: btn.dataset.ativo });
              toast("Usuário atualizado.", "success");
              views._configRender();
            } catch (e) { toast("Erro: " + (e.message || e), "error"); }
          };
        });
      }).catch(function (e) {
        $("users-table-wrap").innerHTML = '<span class="config-status err">' + escapeHtml(e.message || e) + '</span>';
      });

      $("btn-add-user").onclick = async function () {
        var email = $("new-user-email").value.trim();
        var nome = $("new-user-nome").value.trim();
        var perfil = $("new-user-perfil").value;
        if (!email) { toast("E-mail obrigatório", "error"); return; }
        try {
          await api.call("usuarios.add", { email: email, nome: nome, perfil: perfil });
          toast("Usuário adicionado.", "success");
          $("new-user-email").value = "";
          $("new-user-nome").value = "";
          views._configRender();
        } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      };
    }
  },

  notfound() {
    $("view").innerHTML = '<div class="placeholder"><h2>Rota não encontrada</h2></div>';
  }
};

// ============================================================
// BOOTSTRAP
// ============================================================
function init() {
  $("initial-loader").classList.add("hidden");
  $("login-screen").classList.remove("hidden");

  // Botoes de logout, config inicial
  $("btn-logout").onclick = function () { auth.logout(); };
  $("btn-show-config").onclick = function () {
    $("config-fields").classList.toggle("hidden");
    var cfg = getCfg();
    $("cfg-apps-script-url").value = cfg.apps_script_url || "";
    $("cfg-google-client-id").value = cfg.google_client_id || "";
  };
  $("btn-save-config").onclick = function () {
    setCfg({
      apps_script_url: $("cfg-apps-script-url").value.trim(),
      google_client_id: $("cfg-google-client-id").value.trim(),
    });
    toast("Configuração salva. Recarregando...", "success");
    setTimeout(function () { location.reload(); }, 600);
  };

  // Inicia Google Sign-In
  auth.init();
}

document.addEventListener("DOMContentLoaded", init);

// ============================================================
// ENTREGA 3 — Leads (Kanban, Lista, Detalhe, WhatsApp)
// ============================================================
var leadsStore = {
  data: [],
  lastIds: {},
  pollHandle: null,

  refresh: async function (silent) {
    try {
      var leads = await api.call("leads.list");
      var oldIds = leadsStore.lastIds;
      leads.forEach(function (l) { l._isNew = !oldIds[l.id] && Object.keys(oldIds).length > 0; });
      leadsStore.data = leads;
      leadsStore.lastIds = {};
      leads.forEach(function (l) { leadsStore.lastIds[l.id] = true; });
      var route = (location.hash || "#kanban").replace(/^#/, "").split("/")[0];
      if (!silent && (route === "kanban" || route === "leads")) {
        if (route === "kanban") kanbanView.render();
        else leadsView.render();
      }
    } catch (e) {
      console.error("refresh leads", e);
    }
  },

  startPolling: function () {
    if (leadsStore.pollHandle) clearInterval(leadsStore.pollHandle);
    leadsStore.pollHandle = setInterval(function () { leadsStore.refresh(true); }, 15000);
    window.addEventListener("focus", function () { leadsStore.refresh(true); });
  }
};

function etapasFunil() {
  var s = state.serverConfig && state.serverConfig.etapas_funil;
  if (!s) return ["Novo Lead","Contato iniciado","Em negociacao","Proposta enviada","Aguardando resposta","Fechado — ganho","Fechado — perdido","Sem retorno"];
  return s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
}

function whatsappUrl(lead) {
  var cfg = state.serverConfig || {};
  var ddd = String(lead.ddd || "").replace(/\D/g, "");
  var whats = String(lead.whatsapp || "").replace(/\D/g, "");
  if (!ddd || !whats) return "";
  var num = "55" + ddd + whats;
  var tpl = cfg.msg_whatsapp_padrao || "";
  var nome = (lead.nome || "").split(" ")[0];
  var msg = tpl.split("{nome}").join(nome).split("{uf}").join(lead.uf || "").split("{produto}").join(lead.produto || "");
  return "https://wa.me/" + num + (msg ? "?text=" + encodeURIComponent(msg) : "");
}

function fmtBRLshort(v) {
  v = parseFloat(v) || 0;
  if (v >= 1000) return "R$ " + (v / 1000).toFixed(1).replace(".", ",") + "k";
  return "R$ " + v.toFixed(0);
}

var UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

// ============================================================
// KANBAN
// ============================================================
var kanbanView = {
  filtros: { busca: "", uf: "", produto: "" },

  render: function () {
    var etapas = etapasFunil();
    var f = kanbanView.filtros;
    var html = '<div class="kanban-toolbar">' +
      '<input type="text" id="kb-busca" placeholder="🔎 Buscar nome, UF..." value="' + escapeHtml(f.busca) + '"/>' +
      '<select id="kb-uf"><option value="">Todas UF</option>' +
        UFS.map(function (u) { return '<option' + (u === f.uf ? ' selected' : '') + '>' + u + '</option>'; }).join("") +
      '</select>' +
      '<select id="kb-prod"><option value="">Todos produtos</option>' +
        '<option value="obra_andamento"' + (f.produto === "obra_andamento" ? ' selected' : '') + '>Obra em andamento</option>' +
        '<option value="obra_finalizada"' + (f.produto === "obra_finalizada" ? ' selected' : '') + '>Obra finalizada</option>' +
      '</select>' +
      '<button class="btn" id="kb-novo">+ Novo Lead</button>' +
      '<button class="btn ghost" id="kb-refresh">↻</button>' +
      '</div>';

    html += '<div class="kanban-board" id="kanban-board">';
    var leads = kanbanView.filtrar(leadsStore.data);
    etapas.forEach(function (etapa) {
      var leadsCol = leads.filter(function (l) { return l.status === etapa; });
      html += '<div class="kanban-col" data-etapa="' + escapeHtml(etapa) + '">' +
        '<div class="kanban-col-header"><span>' + escapeHtml(etapa) + '</span><span class="kanban-col-count">' + leadsCol.length + '</span></div>' +
        '<div class="kanban-cards" data-etapa="' + escapeHtml(etapa) + '">' +
          leadsCol.map(kanbanView.renderCard).join("") +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    $("view").innerHTML = html;

    $("kb-busca").oninput = function (e) { kanbanView.filtros.busca = e.target.value; kanbanView.render(); };
    $("kb-uf").onchange = function (e) { kanbanView.filtros.uf = e.target.value; kanbanView.render(); };
    $("kb-prod").onchange = function (e) { kanbanView.filtros.produto = e.target.value; kanbanView.render(); };
    $("kb-novo").onclick = function () { modalLead.open(); };
    $("kb-refresh").onclick = function () { leadsStore.refresh(false); };

    document.querySelectorAll(".kanban-card").forEach(function (c) {
      c.onclick = function (e) {
        if (e.target.closest("a") || e.target.closest("button")) return;
        router.go("lead/" + c.dataset.id);
      };
    });

    if (window.Sortable) {
      document.querySelectorAll(".kanban-cards").forEach(function (col) {
        Sortable.create(col, {
          group: "kanban", animation: 150,
          ghostClass: "sortable-ghost", chosenClass: "sortable-chosen",
          onAdd: function (evt) {
            var id = evt.item.dataset.id;
            var novoStatus = evt.to.dataset.etapa;
            kanbanView.mudarStatus(id, novoStatus);
          }
        });
      });
    }
  },

  renderCard: function (l) {
    var tel = String(l.whatsapp || "");
    var telTxt = (l.ddd && tel) ? "(" + l.ddd + ") " + tel.substring(0, tel.length - 4) + "-" + tel.slice(-4) : "";
    var produto = (l.produto || "").replace("_", " ");
    var waUrl = whatsappUrl(l);
    return '<div class="kanban-card' + (l._isNew ? " is-new" : "") + '" data-id="' + escapeHtml(l.id) + '">' +
      '<div class="kanban-card-name">' + escapeHtml(l.nome || "(sem nome)") + '</div>' +
      '<div class="kanban-card-meta">' +
        '<span>📍 ' + escapeHtml(l.uf || "?") + '</span>' +
        (l.valor_potencial ? '<span class="valor">💰 ' + fmtBRLshort(l.valor_potencial) + '</span>' : '') +
      '</div>' +
      (produto ? '<div class="kanban-card-meta" style="margin-top:4px"><span>🏗 ' + escapeHtml(produto) + '</span></div>' : '') +
      '<div class="kanban-card-actions">' +
        (waUrl ? '<a class="whats" href="' + waUrl + '" target="_blank" rel="noopener" onclick="event.stopPropagation();">📱 ' + escapeHtml(telTxt) + '</a>' : '<span style="flex:1;color:var(--muted);font-size:11px;text-align:center;padding:4px;">sem telefone</span>') +
      '</div>' +
    '</div>';
  },

  filtrar: function (leads) {
    var f = kanbanView.filtros;
    return leads.filter(function (l) {
      if (f.uf && l.uf !== f.uf) return false;
      if (f.produto && l.produto !== f.produto) return false;
      if (f.busca) {
        var q = f.busca.toLowerCase();
        var hay = ((l.nome || "") + " " + (l.uf || "") + " " + (l.cidade || "") + " " + (l.email || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  },

  mudarStatus: async function (id, novoStatus) {
    try {
      var lead = leadsStore.data.find(function (l) { return l.id === id; });
      if (!lead || lead.status === novoStatus) return;
      lead.status = novoStatus;
      await api.call("leads.changeStatus", { id: id, novoStatus: novoStatus });
      toast("Status atualizado.", "success");
      leadsStore.refresh(true);
    } catch (e) {
      toast("Erro ao atualizar: " + (e.message || e), "error");
      leadsStore.refresh(false);
    }
  }
};

// ============================================================
// LISTA DE LEADS
// ============================================================
var leadsView = {
  filtros: { busca: "", uf: "", produto: "", status: "" },

  render: function () {
    var etapas = etapasFunil();
    var f = leadsView.filtros;
    var html = '<div class="leads-toolbar">' +
      '<input type="text" id="lst-busca" placeholder="🔎 Buscar..." value="' + escapeHtml(f.busca) + '"/>' +
      '<select id="lst-uf"><option value="">Todas UF</option>' +
        UFS.map(function (u) { return '<option' + (u === f.uf ? ' selected' : '') + '>' + u + '</option>'; }).join("") +
      '</select>' +
      '<select id="lst-status"><option value="">Todos status</option>' +
        etapas.map(function (e) { return '<option' + (e === f.status ? ' selected' : '') + '>' + escapeHtml(e) + '</option>'; }).join("") +
      '</select>' +
      '<button class="btn" id="lst-novo">+ Novo Lead</button>' +
      '</div>';

    var leads = leadsView.filtrar(leadsStore.data);
    html += '<div class="leads-table-wrap"><table class="leads-table">' +
      '<thead><tr><th>Nome</th><th>Telefone</th><th>UF</th><th>Produto</th><th>Status</th><th>Responsável</th><th>Data</th></tr></thead><tbody>';
    if (leads.length === 0) {
      html += '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">Nenhum lead encontrado.</td></tr>';
    } else {
      leads.forEach(function (l) {
        var data = String(l.data_hora || "").substring(0, 16);
        var tel = (l.ddd && l.whatsapp) ? "(" + l.ddd + ") " + l.whatsapp : "—";
        html += '<tr data-id="' + escapeHtml(l.id) + '">' +
          '<td><strong>' + escapeHtml(l.nome || "(sem nome)") + '</strong></td>' +
          '<td>' + escapeHtml(tel) + '</td>' +
          '<td>' + escapeHtml(l.uf || "") + '</td>' +
          '<td>' + escapeHtml((l.produto || "").replace("_", " ")) + '</td>' +
          '<td><span class="status-pill">' + escapeHtml(l.status || "") + '</span></td>' +
          '<td>' + escapeHtml(l.responsavel || "—") + '</td>' +
          '<td>' + escapeHtml(data) + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    $("view").innerHTML = html;

    $("lst-busca").oninput = function (e) { leadsView.filtros.busca = e.target.value; leadsView.render(); };
    $("lst-uf").onchange = function (e) { leadsView.filtros.uf = e.target.value; leadsView.render(); };
    $("lst-status").onchange = function (e) { leadsView.filtros.status = e.target.value; leadsView.render(); };
    $("lst-novo").onclick = function () { modalLead.open(); };
    document.querySelectorAll(".leads-table tr[data-id]").forEach(function (tr) {
      tr.onclick = function () { router.go("lead/" + tr.dataset.id); };
    });
  },

  filtrar: function (leads) {
    var f = leadsView.filtros;
    return leads.filter(function (l) {
      if (f.uf && l.uf !== f.uf) return false;
      if (f.status && l.status !== f.status) return false;
      if (f.busca) {
        var q = f.busca.toLowerCase();
        var hay = ((l.nome || "") + " " + (l.uf || "") + " " + (l.cidade || "") + " " + (l.email || "") + " " + (l.whatsapp || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
};

// ============================================================
// DETALHE DO LEAD
// ============================================================
var leadDetailView = {
  current: null,
  atividades: [],

  render: async function (id) {
    if (!id) { router.go("kanban"); return; }
    $("view").innerHTML = '<div class="placeholder">Carregando...</div>';
    try {
      var resp = await api.call("leads.get", { id: id });
      leadDetailView.current = resp.lead;
      leadDetailView.atividades = resp.atividades || [];
      leadDetailView.draw();
    } catch (e) {
      $("view").innerHTML = '<div class="placeholder"><h2>Erro</h2><p>' + escapeHtml(e.message || e) + '</p></div>';
    }
  },

  draw: function () {
    var l = leadDetailView.current;
    var etapas = etapasFunil();
    var waUrl = whatsappUrl(l);
    var html = '<div class="lead-detail">';

    html += '<div class="lead-detail-header"><div>';
    html += '<a href="#kanban" style="color:var(--muted);font-size:12px;">← Voltar</a>';
    html += '<h2>' + escapeHtml(l.nome || "(sem nome)") + '</h2>';
    html += '<div class="lead-meta">📍 ' + escapeHtml(l.uf || "?") + (l.cidade ? " · " + escapeHtml(l.cidade) : "") +
            ' · 📱 ' + escapeHtml(l.ddd ? "(" + l.ddd + ") " + l.whatsapp : "sem telefone") +
            (l.email ? ' · ✉️ ' + escapeHtml(l.email) : '') + '</div>';
    html += '<div style="margin-top:8px;font-size:12px;color:var(--muted);">Origem: <strong>' + escapeHtml(l.origem || "—") + '</strong></div>';
    html += '</div><div class="lead-detail-actions">';
    if (waUrl) html += '<a class="btn success" href="' + waUrl + '" target="_blank" rel="noopener">📱 WhatsApp</a>';
    if (!l.cliente_id) html += '<button class="btn" id="lead-convert">Converter em Cliente</button>';
    else html += '<span class="muted" style="padding:8px;">→ Cliente #' + escapeHtml(l.cliente_id) + '</span>';
    html += '<button class="btn ghost" id="lead-save">💾 Salvar</button>';
    html += '</div></div>';

    html += '<div class="lead-detail-grid"><div>';

    html += '<div class="detail-card"><h3>Dados do Lead</h3>';
    html += '<div class="field-row"><div><label>Nome</label><input type="text" id="f-nome" value="' + escapeHtml(l.nome) + '"/></div>' +
            '<div><label>E-mail</label><input type="text" id="f-email" value="' + escapeHtml(l.email) + '"/></div></div>';
    html += '<div class="field-row"><div><label>DDD</label><input type="text" id="f-ddd" maxlength="2" value="' + escapeHtml(l.ddd) + '"/></div>' +
            '<div><label>WhatsApp</label><input type="text" id="f-whats" value="' + escapeHtml(l.whatsapp) + '"/></div></div>';
    html += '<div class="field-row"><div><label>UF</label><input type="text" id="f-uf" maxlength="2" value="' + escapeHtml(l.uf) + '"/></div>' +
            '<div><label>Cidade</label><input type="text" id="f-cidade" value="' + escapeHtml(l.cidade) + '"/></div></div>';
    html += '<div class="field-row"><div><label>Status</label><select id="f-status">' +
            etapas.map(function (e) { return '<option' + (e === l.status ? ' selected' : '') + '>' + escapeHtml(e) + '</option>'; }).join("") +
            '</select></div>' +
            '<div><label>Produto</label><select id="f-produto">' +
            '<option value="">—</option>' +
            '<option value="obra_andamento"' + (l.produto === "obra_andamento" ? " selected" : "") + '>Obra em andamento</option>' +
            '<option value="obra_finalizada"' + (l.produto === "obra_finalizada" ? " selected" : "") + '>Obra finalizada</option>' +
            '</select></div></div>';
    html += '<div class="field-row"><div><label>Valor potencial (R$)</label><input type="number" step="0.01" id="f-valor" value="' + escapeHtml(l.valor_potencial) + '"/></div>' +
            '<div><label>Responsável</label><input type="text" id="f-resp" value="' + escapeHtml(l.responsavel) + '"/></div></div>';
    html += '<div class="field-row single"><div><label>Observações</label><textarea id="f-obs">' + escapeHtml(l.observacoes || "") + '</textarea></div></div>';
    html += '</div>';

    if (l.inss_direto || l.inss_reduzido) {
      html += '<div class="detail-card"><h3>Resultado da calculadora</h3>';
      var inssDir = parseFloat(l.inss_direto) || 0;
      var inssRed = parseFloat(l.inss_reduzido) || 0;
      var econ = parseFloat(l.economia) || 0;
      html += '<div class="field-row">' +
              '<div><label>Imposto direto</label><div><strong>R$ ' + inssDir.toLocaleString("pt-BR",{minimumFractionDigits:2}) + '</strong></div></div>' +
              '<div><label>Imposto reduzido</label><div><strong style="color:var(--success)">R$ ' + inssRed.toLocaleString("pt-BR",{minimumFractionDigits:2}) + '</strong></div></div></div>';
      if (econ) {
        var econPct = inssDir > 0 ? Math.round((econ / inssDir) * 100) : 0;
        html += '<div class="field-row single"><div><label>Economia estimada</label><strong>R$ ' + econ.toLocaleString("pt-BR",{minimumFractionDigits:2}) + ' (' + econPct + '%)</strong></div></div>';
      }
      html += '</div>';
    }

    html += '</div><div><div class="detail-card"><h3>Timeline</h3>';
    if (!leadDetailView.atividades.length) {
      html += '<p class="muted" style="font-size:13px;">Sem atividades.</p>';
    } else {
      html += '<ul class="timeline">' + leadDetailView.atividades.map(function (a) {
        return '<li class="timeline-item">' +
          '<div><strong>' + escapeHtml(a.tipo || "evento") + '</strong></div>' +
          '<div>' + escapeHtml(a.descricao || "") + '</div>' +
          '<div class="ts">' + escapeHtml(String(a.data_hora || "").substring(0,16)) + ' <span class="author">' + escapeHtml(a.autor || "") + '</span></div>' +
        '</li>';
      }).join("") + '</ul>';
    }
    html += '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">';
    html += '<label style="font-size:12px;font-weight:600">Adicionar nota</label>';
    html += '<textarea id="nova-nota" placeholder="Anotação livre..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;margin-top:4px;min-height:60px;"></textarea>';
    html += '<button class="btn btn-sm" id="btn-add-nota" style="margin-top:6px;">Adicionar</button>';
    html += '</div></div></div></div>';
    $("view").innerHTML = html;

    var saveBtn = $("lead-save");
    saveBtn.onclick = async function () {
      saveBtn.disabled = true;
      try {
        await api.call("leads.update", {
          id: l.id,
          nome: $("f-nome").value.trim(),
          ddd: $("f-ddd").value.replace(/\D/g, ""),
          whatsapp: $("f-whats").value.replace(/\D/g, ""),
          email: $("f-email").value.trim(),
          uf: $("f-uf").value.trim().toUpperCase(),
          cidade: $("f-cidade").value.trim(),
          status: $("f-status").value,
          produto: $("f-produto").value,
          valor_potencial: parseFloat($("f-valor").value) || 0,
          responsavel: $("f-resp").value.trim(),
          observacoes: $("f-obs").value,
        });
        toast("Lead salvo.", "success");
        leadsStore.refresh(true);
        leadDetailView.render(l.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      saveBtn.disabled = false;
    };

    var convertBtn = $("lead-convert");
    if (convertBtn) convertBtn.onclick = function () { conversionWizard.open(l); };

    $("btn-add-nota").onclick = async function () {
      var nota = $("nova-nota").value.trim();
      if (!nota) return;
      try {
        await api.call("atividades.create", { ref_tipo: "lead", ref_id: l.id, tipo: "nota", descricao: nota });
        toast("Nota adicionada.", "success");
        leadDetailView.render(l.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
    };
  }
};

// ============================================================
// MODAL NOVO LEAD
// ============================================================
var modalLead = {
  open: function () {
    var html = '<div class="modal-backdrop" id="modal-bg"><div class="modal-content">';
    html += '<h3>+ Novo Lead manual</h3>';
    html += '<div class="field-row"><div><label>Nome *</label><input type="text" id="m-nome"/></div>' +
            '<div><label>E-mail</label><input type="text" id="m-email"/></div></div>';
    html += '<div class="field-row"><div><label>DDD</label><input type="text" id="m-ddd" maxlength="2"/></div>' +
            '<div><label>WhatsApp</label><input type="text" id="m-whats"/></div></div>';
    html += '<div class="field-row"><div><label>UF</label><input type="text" id="m-uf" maxlength="2"/></div>' +
            '<div><label>Cidade</label><input type="text" id="m-cidade"/></div></div>';
    html += '<div class="field-row"><div><label>Produto</label><select id="m-produto">' +
            '<option value="">—</option><option value="obra_andamento">Obra em andamento</option><option value="obra_finalizada">Obra finalizada</option>' +
            '</select></div>' +
            '<div><label>Valor potencial (R$)</label><input type="number" step="0.01" id="m-valor"/></div></div>';
    html += '<div class="field-row single"><div><label>Observações</label><textarea id="m-obs"></textarea></div></div>';
    html += '<div class="modal-actions">' +
            '<button class="btn ghost" id="m-cancel">Cancelar</button>' +
            '<button class="btn" id="m-save">Criar Lead</button></div>';
    html += '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    $("m-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    $("m-save").onclick = async function () {
      var nome = $("m-nome").value.trim();
      if (!nome) { toast("Nome é obrigatório", "error"); return; }
      try {
        await api.call("leads.create", {
          nome: nome,
          ddd: $("m-ddd").value.replace(/\D/g, ""),
          whatsapp: $("m-whats").value.replace(/\D/g, ""),
          email: $("m-email").value.trim(),
          uf: $("m-uf").value.trim().toUpperCase(),
          cidade: $("m-cidade").value.trim(),
          produto: $("m-produto").value,
          valor_potencial: parseFloat($("m-valor").value) || 0,
          observacoes: $("m-obs").value,
          origem: "manual"
        });
        toast("Lead criado.", "success");
        document.getElementById("modal-bg").remove();
        leadsStore.refresh(false);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
    };
  }
};

// Hook no afterLogin: inicia polling e carrega leads
var _origAfterLogin = auth.afterLogin;
auth.afterLogin = function () {
  _origAfterLogin();
  setTimeout(function () { leadsStore.refresh(false); leadsStore.startPolling(); }, 600);
};


// ============================================================
// ENTREGA 4A — Clientes (Lista, Detalhe, Wizard de conversao)
// ============================================================

var clientesStore = {
  data: [],
  pollHandle: null,

  refresh: async function (silent) {
    try {
      clientesStore.data = await api.call("clientes.list") || [];
      var route = (location.hash || "#kanban").replace(/^#/, "").split("/")[0];
      if (!silent && route === "clientes") clientesView.render();
    } catch (e) { console.error("refresh clientes", e); }
  },
  startPolling: function () {
    if (clientesStore.pollHandle) clearInterval(clientesStore.pollHandle);
    clientesStore.pollHandle = setInterval(function () { clientesStore.refresh(true); }, 30000);
  }
};

// === LISTA DE CLIENTES ===
var clientesView = {
  filtros: { busca: "", uf: "" },

  render: function () {
    var f = clientesView.filtros;
    var html = '<div class="leads-toolbar">' +
      '<input type="text" id="cl-busca" placeholder="🔎 Buscar nome, CPF, e-mail..." value="' + escapeHtml(f.busca) + '"/>' +
      '<select id="cl-uf"><option value="">Todas UF</option>' +
        UFS.map(function (u) { return '<option' + (u === f.uf ? ' selected' : '') + '>' + u + '</option>'; }).join("") +
      '</select>' +
      '<button class="btn ghost" id="cl-refresh">↻ Atualizar</button>' +
      '</div>';

    if (!clientesStore.data.length) {
      html += '<div class="placeholder"><h2>Nenhum cliente ainda</h2>' +
              '<p class="muted">Para criar um cliente, abra um lead e clique em <strong>Converter em Cliente</strong>.</p></div>';
      $("view").innerHTML = html;
      $("cl-busca").oninput = function (e) { clientesView.filtros.busca = e.target.value; clientesView.render(); };
      $("cl-uf").onchange = function (e) { clientesView.filtros.uf = e.target.value; clientesView.render(); };
      $("cl-refresh").onclick = function () { clientesStore.refresh(false); };
      return;
    }

    var clientes = clientesView.filtrar(clientesStore.data);
    html += '<div class="leads-table-wrap"><table class="leads-table">' +
      '<thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th><th>UF Obra</th><th>Tipo Obra</th><th>Criado em</th></tr></thead><tbody>';
    if (!clientes.length) {
      html += '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--muted)">Nenhum cliente corresponde ao filtro.</td></tr>';
    } else {
      clientes.forEach(function (c) {
        var doc = c.cpf || c.cnpj || "—";
        var tel = (c.ddd && c.telefone) ? "(" + c.ddd + ") " + c.telefone : "—";
        var data = String(c.criado_em || "").substring(0, 16);
        html += '<tr data-id="' + escapeHtml(c.id) + '">' +
          '<td><strong>' + escapeHtml(c.nome || "(sem nome)") + '</strong></td>' +
          '<td>' + escapeHtml(doc) + '</td>' +
          '<td>' + escapeHtml(tel) + '</td>' +
          '<td>' + escapeHtml(c.obra_end_uf || c.end_uf || "") + '</td>' +
          '<td>' + escapeHtml(c.obra_tipo || "") + '</td>' +
          '<td>' + escapeHtml(data) + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    $("view").innerHTML = html;

    $("cl-busca").oninput = function (e) { clientesView.filtros.busca = e.target.value; clientesView.render(); };
    $("cl-uf").onchange = function (e) { clientesView.filtros.uf = e.target.value; clientesView.render(); };
    $("cl-refresh").onclick = function () { clientesStore.refresh(false); };
    document.querySelectorAll(".leads-table tr[data-id]").forEach(function (tr) {
      tr.onclick = function () { router.go("cliente/" + tr.dataset.id); };
    });
  },

  filtrar: function (clientes) {
    var f = clientesView.filtros;
    return clientes.filter(function (c) {
      if (f.uf && c.obra_end_uf !== f.uf && c.end_uf !== f.uf) return false;
      if (f.busca) {
        var q = f.busca.toLowerCase();
        var hay = ((c.nome || "") + " " + (c.cpf || "") + " " + (c.cnpj || "") + " " + (c.email || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
};

// === DETALHE DO CLIENTE (cadastro completo) ===
var clienteDetailView = {
  current: null,
  atividades: [],

  render: async function (id) {
    if (!id) { router.go("clientes"); return; }
    $("view").innerHTML = '<div class="placeholder">Carregando...</div>';
    try {
      var resp = await api.call("clientes.get", { id: id });
      clienteDetailView.current = resp.cliente;
      clienteDetailView.atividades = resp.atividades || [];
      clienteDetailView.draw();
    } catch (e) {
      $("view").innerHTML = '<div class="placeholder"><h2>Erro</h2><p>' + escapeHtml(e.message || e) + '</p></div>';
    }
  },

  draw: function () {
    var c = clienteDetailView.current;
    var html = '<div class="cliente-detail">';

    // Header
    html += '<div class="lead-detail-header"><div>';
    html += '<a href="#clientes" style="color:var(--muted);font-size:12px;">← Voltar para Clientes</a>';
    html += '<h2>' + escapeHtml(c.nome || "(sem nome)") + '</h2>';
    var doc = c.cpf ? "CPF " + c.cpf : (c.cnpj ? "CNPJ " + c.cnpj : "");
    html += '<div class="lead-meta">' + escapeHtml(doc) +
            (c.ddd && c.telefone ? ' · 📱 (' + c.ddd + ') ' + c.telefone : '') +
            (c.email ? ' · ✉️ ' + escapeHtml(c.email) : '') + '</div>';
    if (c.lead_id_origem) html += '<div style="margin-top:6px;font-size:12px"><a href="#lead/' + escapeHtml(c.lead_id_origem) + '" style="color:var(--primary)">↩ Ver lead de origem</a></div>';
    html += '</div><div class="lead-detail-actions">';
    html += '<button class="btn" id="cli-save">💾 Salvar tudo</button>';
    html += '</div></div>';

    // Pessoais
    html += '<div class="cliente-section"><h3>Dados Pessoais</h3>';
    html += '<div class="field-3">' +
      '<div><label>Nome completo</label><input type="text" id="cf-nome" value="' + escapeHtml(c.nome) + '"/></div>' +
      '<div><label>CPF</label><input type="text" id="cf-cpf" value="' + escapeHtml(c.cpf) + '"/></div>' +
      '<div><label>CNPJ</label><input type="text" id="cf-cnpj" value="' + escapeHtml(c.cnpj) + '"/></div></div>';
    html += '<div class="field-3">' +
      '<div><label>RG</label><input type="text" id="cf-rg" value="' + escapeHtml(c.rg) + '"/></div>' +
      '<div><label>Data nascimento</label><input type="text" id="cf-nasc" placeholder="DD/MM/AAAA" value="' + escapeHtml(c.data_nascimento) + '"/></div>' +
      '<div><label>Estado civil</label><input type="text" id="cf-civil" value="' + escapeHtml(c.estado_civil) + '"/></div></div>';
    html += '<div class="field-3">' +
      '<div><label>Profissão</label><input type="text" id="cf-prof" value="' + escapeHtml(c.profissao) + '"/></div>' +
      '<div><label>DDD</label><input type="text" id="cf-ddd" maxlength="2" value="' + escapeHtml(c.ddd) + '"/></div>' +
      '<div><label>Telefone</label><input type="text" id="cf-tel" value="' + escapeHtml(c.telefone) + '"/></div></div>';
    html += '<div class="field-3"><div><label>E-mail</label><input type="text" id="cf-email" value="' + escapeHtml(c.email) + '"/></div><div></div><div></div></div>';
    html += '</div>';

    // Endereço residencial
    html += '<div class="cliente-section"><h3>Endereço Residencial</h3>';
    html += '<div class="field-3">' +
      '<div style="grid-column:span 2;"><label>Logradouro</label><input type="text" id="cf-endlog" value="' + escapeHtml(c.end_logradouro) + '"/></div>' +
      '<div><label>Bairro</label><input type="text" id="cf-endbai" value="' + escapeHtml(c.end_bairro) + '"/></div></div>';
    html += '<div class="field-3">' +
      '<div><label>Cidade</label><input type="text" id="cf-endcid" value="' + escapeHtml(c.end_cidade) + '"/></div>' +
      '<div><label>UF</label><input type="text" id="cf-enduf" maxlength="2" value="' + escapeHtml(c.end_uf) + '"/></div>' +
      '<div><label>CEP</label><input type="text" id="cf-endcep" value="' + escapeHtml(c.end_cep) + '"/></div></div>';
    html += '</div>';

    // Endereço da Obra
    html += '<div class="cliente-section"><h3>Endereço da Obra</h3>';
    html += '<div class="field-3">' +
      '<div style="grid-column:span 2;"><label>Logradouro</label><input type="text" id="cf-oblog" value="' + escapeHtml(c.obra_end_logradouro) + '"/></div>' +
      '<div><label>Bairro</label><input type="text" id="cf-obbai" value="' + escapeHtml(c.obra_end_bairro) + '"/></div></div>';
    html += '<div class="field-3">' +
      '<div><label>Cidade</label><input type="text" id="cf-obcid" value="' + escapeHtml(c.obra_end_cidade) + '"/></div>' +
      '<div><label>UF</label><input type="text" id="cf-obuf" maxlength="2" value="' + escapeHtml(c.obra_end_uf) + '"/></div>' +
      '<div></div></div>';
    html += '<div class="field-3">' +
      '<div><label>Matrícula do imóvel</label><input type="text" id="cf-obmat" value="' + escapeHtml(c.obra_matricula) + '"/></div>' +
      '<div><label>IPTU (inscrição)</label><input type="text" id="cf-obiptu" value="' + escapeHtml(c.obra_iptu) + '"/></div>' +
      '<div><label>Tipo da obra</label><select id="cf-obtipo">' +
        '<option value="">—</option>' +
        ['Alvenaria','Mista','Madeira'].map(function (t) { return '<option' + (c.obra_tipo === t ? ' selected' : '') + '>' + t + '</option>'; }).join("") +
      '</select></div></div>';
    html += '<div class="field-3"><div style="grid-column:span 3;"><label>Descrição da obra</label><input type="text" id="cf-obdesc" value="' + escapeHtml(c.obra_descricao) + '"/></div></div>';
    html += '</div>';

    // Bancários
    html += '<div class="cliente-section"><h3>Dados Bancários</h3>';
    html += '<div class="field-4">' +
      '<div><label>Banco</label><input type="text" id="cf-banco" value="' + escapeHtml(c.banco) + '"/></div>' +
      '<div><label>Agência</label><input type="text" id="cf-ag" value="' + escapeHtml(c.agencia) + '"/></div>' +
      '<div><label>Conta</label><input type="text" id="cf-conta" value="' + escapeHtml(c.conta) + '"/></div>' +
      '<div><label>Tipo</label><select id="cf-tipoconta">' +
        '<option value="">—</option>' +
        '<option' + (c.tipo_conta === "corrente" ? ' selected' : '') + ' value="corrente">Corrente</option>' +
        '<option' + (c.tipo_conta === "poupanca" ? ' selected' : '') + ' value="poupanca">Poupança</option>' +
      '</select></div></div>';
    html += '<div class="field-3"><div style="grid-column:span 3;"><label>Chave PIX</label><input type="text" id="cf-pix" value="' + escapeHtml(c.pix) + '"/></div></div>';
    html += '</div>';

    // Observações
    html += '<div class="cliente-section"><h3>Observações para Contrato</h3>';
    html += '<textarea id="cf-obs" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;min-height:80px;">' + escapeHtml(c.obs_contrato || "") + '</textarea>';
    html += '</div>';

    // Timeline
    html += '<div class="cliente-section"><h3>Histórico</h3>';
    if (!clienteDetailView.atividades.length) {
      html += '<p class="muted" style="font-size:13px;">Sem atividades.</p>';
    } else {
      html += '<ul class="timeline">' + clienteDetailView.atividades.map(function (a) {
        return '<li class="timeline-item">' +
          '<div><strong>' + escapeHtml(a.tipo || "evento") + '</strong></div>' +
          '<div>' + escapeHtml(a.descricao || "") + '</div>' +
          '<div class="ts">' + escapeHtml(String(a.data_hora || "").substring(0,16)) + ' <span class="author">' + escapeHtml(a.autor || "") + '</span></div>' +
        '</li>';
      }).join("") + '</ul>';
    }
    html += '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">';
    html += '<label style="font-size:12px;font-weight:600">Adicionar nota</label>';
    html += '<textarea id="cli-nota" placeholder="Anotação..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;margin-top:4px;min-height:60px;"></textarea>';
    html += '<button class="btn btn-sm" id="cli-add-nota" style="margin-top:6px;">Adicionar</button>';
    html += '</div>';

    html += '</div>';
    $("view").innerHTML = html;

    var save = $("cli-save");
    save.onclick = async function () {
      save.disabled = true;
      try {
        await api.call("clientes.update", {
          id: c.id,
          nome: $("cf-nome").value.trim(),
          cpf: $("cf-cpf").value.trim(),
          cnpj: $("cf-cnpj").value.trim(),
          rg: $("cf-rg").value.trim(),
          data_nascimento: $("cf-nasc").value.trim(),
          estado_civil: $("cf-civil").value.trim(),
          profissao: $("cf-prof").value.trim(),
          ddd: $("cf-ddd").value.replace(/\D/g, ""),
          telefone: $("cf-tel").value.replace(/\D/g, ""),
          email: $("cf-email").value.trim(),
          end_logradouro: $("cf-endlog").value.trim(),
          end_bairro: $("cf-endbai").value.trim(),
          end_cidade: $("cf-endcid").value.trim(),
          end_uf: $("cf-enduf").value.trim().toUpperCase(),
          end_cep: $("cf-endcep").value.trim(),
          obra_end_logradouro: $("cf-oblog").value.trim(),
          obra_end_bairro: $("cf-obbai").value.trim(),
          obra_end_cidade: $("cf-obcid").value.trim(),
          obra_end_uf: $("cf-obuf").value.trim().toUpperCase(),
          obra_matricula: $("cf-obmat").value.trim(),
          obra_iptu: $("cf-obiptu").value.trim(),
          obra_tipo: $("cf-obtipo").value,
          obra_descricao: $("cf-obdesc").value.trim(),
          banco: $("cf-banco").value.trim(),
          agencia: $("cf-ag").value.trim(),
          conta: $("cf-conta").value.trim(),
          tipo_conta: $("cf-tipoconta").value,
          pix: $("cf-pix").value.trim(),
          obs_contrato: $("cf-obs").value,
        });
        toast("Cliente salvo.", "success");
        clientesStore.refresh(true);
        clienteDetailView.render(c.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      save.disabled = false;
    };

    $("cli-add-nota").onclick = async function () {
      var nota = $("cli-nota").value.trim();
      if (!nota) return;
      try {
        await api.call("atividades.create", { ref_tipo: "cliente", ref_id: c.id, tipo: "nota", descricao: nota });
        toast("Nota adicionada.", "success");
        clienteDetailView.render(c.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
    };
  }
};

// === WIZARD DE CONVERSÃO Lead → Cliente (3 passos) ===
var conversionWizard = {
  lead: null,
  data: {},
  step: 1,

  open: function (lead) {
    conversionWizard.lead = lead;
    conversionWizard.step = 1;
    conversionWizard.data = {
      // pré-preenchido pelo lead
      nome: lead.nome || "",
      ddd: lead.ddd || "",
      telefone: lead.whatsapp || "",
      email: lead.email || "",
      end_uf: lead.uf || "",
      obra_end_uf: lead.uf || "",
      obra_end_cidade: lead.cidade || "",
    };
    conversionWizard.draw();
  },

  collect: function () {
    var d = conversionWizard.data;
    if (conversionWizard.step === 1) {
      ["nome","cpf","cnpj","rg","data_nascimento","estado_civil","profissao","ddd","telefone","email"].forEach(function (k) {
        var el = $("wz-" + k); if (el) d[k] = (el.value || "").trim();
      });
    } else if (conversionWizard.step === 2) {
      ["end_logradouro","end_bairro","end_cidade","end_uf","end_cep",
       "obra_end_logradouro","obra_end_bairro","obra_end_cidade","obra_end_uf",
       "obra_matricula","obra_iptu","obra_tipo","obra_descricao"].forEach(function (k) {
        var el = $("wz-" + k); if (el) d[k] = (el.value || "").trim();
      });
    } else if (conversionWizard.step === 3) {
      ["banco","agencia","conta","tipo_conta","pix","obs_contrato"].forEach(function (k) {
        var el = $("wz-" + k); if (el) d[k] = (el.value || "").trim();
      });
    }
  },

  draw: function () {
    var d = conversionWizard.data;
    var step = conversionWizard.step;
    var existing = document.getElementById("modal-bg");
    if (existing) existing.remove();

    var stepsHtml = '<div class="wizard-steps">';
    ["Dados Pessoais","Endereços","Bancário"].forEach(function (label, i) {
      var n = i + 1;
      var cls = n === step ? "active" : (n < step ? "done" : "");
      stepsHtml += '<div class="wizard-step ' + cls + '">' + n + '. ' + label + '</div>';
    });
    stepsHtml += '</div>';

    var content = "";
    if (step === 1) {
      content += '<div class="field-3">' +
        '<div><label>Nome *</label><input type="text" id="wz-nome" value="' + escapeHtml(d.nome) + '"/></div>' +
        '<div><label>CPF</label><input type="text" id="wz-cpf" value="' + escapeHtml(d.cpf || "") + '"/></div>' +
        '<div><label>CNPJ</label><input type="text" id="wz-cnpj" value="' + escapeHtml(d.cnpj || "") + '"/></div></div>';
      content += '<div class="field-3">' +
        '<div><label>RG</label><input type="text" id="wz-rg" value="' + escapeHtml(d.rg || "") + '"/></div>' +
        '<div><label>Nascimento</label><input type="text" id="wz-data_nascimento" placeholder="DD/MM/AAAA" value="' + escapeHtml(d.data_nascimento || "") + '"/></div>' +
        '<div><label>Estado civil</label><input type="text" id="wz-estado_civil" value="' + escapeHtml(d.estado_civil || "") + '"/></div></div>';
      content += '<div class="field-3">' +
        '<div><label>Profissão</label><input type="text" id="wz-profissao" value="' + escapeHtml(d.profissao || "") + '"/></div>' +
        '<div><label>DDD</label><input type="text" id="wz-ddd" maxlength="2" value="' + escapeHtml(d.ddd) + '"/></div>' +
        '<div><label>Telefone</label><input type="text" id="wz-telefone" value="' + escapeHtml(d.telefone) + '"/></div></div>';
      content += '<div class="field-3"><div style="grid-column:span 3"><label>E-mail</label><input type="text" id="wz-email" value="' + escapeHtml(d.email) + '"/></div></div>';
    } else if (step === 2) {
      content += '<h4 style="margin:0 0 8px;font-size:13px;">Endereço Residencial</h4>';
      content += '<div class="field-3">' +
        '<div style="grid-column:span 2"><label>Logradouro</label><input type="text" id="wz-end_logradouro" value="' + escapeHtml(d.end_logradouro || "") + '"/></div>' +
        '<div><label>Bairro</label><input type="text" id="wz-end_bairro" value="' + escapeHtml(d.end_bairro || "") + '"/></div></div>';
      content += '<div class="field-3">' +
        '<div><label>Cidade</label><input type="text" id="wz-end_cidade" value="' + escapeHtml(d.end_cidade || "") + '"/></div>' +
        '<div><label>UF</label><input type="text" id="wz-end_uf" maxlength="2" value="' + escapeHtml(d.end_uf) + '"/></div>' +
        '<div><label>CEP</label><input type="text" id="wz-end_cep" value="' + escapeHtml(d.end_cep || "") + '"/></div></div>';

      content += '<h4 style="margin:14px 0 8px;font-size:13px;border-top:1px solid var(--border);padding-top:14px;">Endereço da Obra</h4>';
      content += '<div class="field-3">' +
        '<div style="grid-column:span 2"><label>Logradouro</label><input type="text" id="wz-obra_end_logradouro" value="' + escapeHtml(d.obra_end_logradouro || "") + '"/></div>' +
        '<div><label>Bairro</label><input type="text" id="wz-obra_end_bairro" value="' + escapeHtml(d.obra_end_bairro || "") + '"/></div></div>';
      content += '<div class="field-3">' +
        '<div><label>Cidade</label><input type="text" id="wz-obra_end_cidade" value="' + escapeHtml(d.obra_end_cidade) + '"/></div>' +
        '<div><label>UF</label><input type="text" id="wz-obra_end_uf" maxlength="2" value="' + escapeHtml(d.obra_end_uf) + '"/></div>' +
        '<div><label>Tipo</label><select id="wz-obra_tipo">' +
          '<option value="">—</option>' +
          ['Alvenaria','Mista','Madeira'].map(function (t) { return '<option' + (d.obra_tipo === t ? ' selected' : '') + '>' + t + '</option>'; }).join("") +
        '</select></div></div>';
      content += '<div class="field-3">' +
        '<div><label>Matrícula</label><input type="text" id="wz-obra_matricula" value="' + escapeHtml(d.obra_matricula || "") + '"/></div>' +
        '<div><label>IPTU</label><input type="text" id="wz-obra_iptu" value="' + escapeHtml(d.obra_iptu || "") + '"/></div>' +
        '<div><label>Descrição</label><input type="text" id="wz-obra_descricao" value="' + escapeHtml(d.obra_descricao || "") + '"/></div></div>';
    } else if (step === 3) {
      content += '<div class="field-4">' +
        '<div><label>Banco</label><input type="text" id="wz-banco" value="' + escapeHtml(d.banco || "") + '"/></div>' +
        '<div><label>Agência</label><input type="text" id="wz-agencia" value="' + escapeHtml(d.agencia || "") + '"/></div>' +
        '<div><label>Conta</label><input type="text" id="wz-conta" value="' + escapeHtml(d.conta || "") + '"/></div>' +
        '<div><label>Tipo</label><select id="wz-tipo_conta">' +
          '<option value="">—</option>' +
          '<option' + (d.tipo_conta === "corrente" ? ' selected' : '') + ' value="corrente">Corrente</option>' +
          '<option' + (d.tipo_conta === "poupanca" ? ' selected' : '') + ' value="poupanca">Poupança</option>' +
        '</select></div></div>';
      content += '<div class="field-3"><div style="grid-column:span 3"><label>Chave PIX</label><input type="text" id="wz-pix" value="' + escapeHtml(d.pix || "") + '"/></div></div>';
      content += '<div class="field-3"><div style="grid-column:span 3"><label>Observações para contrato</label>' +
                 '<textarea id="wz-obs_contrato" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;min-height:80px;">' + escapeHtml(d.obs_contrato || "") + '</textarea></div></div>';
    }

    var btnNext = step < 3 ? '<button class="btn" id="wz-next">Próximo →</button>' : '<button class="btn success" id="wz-finalize">✓ Criar Cliente</button>';
    var btnBack = step > 1 ? '<button class="btn ghost" id="wz-back">← Voltar</button>' : '<button class="btn ghost" id="wz-cancel">Cancelar</button>';

    var html = '<div class="modal-backdrop wizard-modal" id="modal-bg"><div class="modal-content">' +
      '<h3>Converter Lead em Cliente — passo ' + step + '/3</h3>' +
      stepsHtml + content +
      '<div class="wizard-actions">' + btnBack + btnNext + '</div>' +
      '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    if ($("wz-cancel")) $("wz-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    if ($("wz-back"))   $("wz-back").onclick   = function () { conversionWizard.collect(); conversionWizard.step--; conversionWizard.draw(); };
    if ($("wz-next"))   $("wz-next").onclick   = function () {
      conversionWizard.collect();
      if (conversionWizard.step === 1 && !conversionWizard.data.nome) { toast("Nome é obrigatório", "error"); return; }
      conversionWizard.step++;
      conversionWizard.draw();
    };
    if ($("wz-finalize")) $("wz-finalize").onclick = async function () {
      conversionWizard.collect();
      $("wz-finalize").disabled = true;
      try {
        var payload = Object.assign({ id: conversionWizard.lead.id }, conversionWizard.data);
        var resp = await api.call("leads.convertToClient", payload);
        toast("Cliente criado com sucesso!", "success");
        document.getElementById("modal-bg").remove();
        leadsStore.refresh(true);
        clientesStore.refresh(true);
        if (resp && resp.cliente && resp.cliente.id) router.go("cliente/" + resp.cliente.id);
        else router.go("clientes");
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
        $("wz-finalize").disabled = false;
      }
    };
  }
};

// Hook adicional no afterLogin: carregar clientes tambem
var _afterLoginPrev = auth.afterLogin;
auth.afterLogin = function () {
  _afterLoginPrev();
  setTimeout(function () { clientesStore.refresh(true); clientesStore.startPolling(); }, 800);
};

})();
