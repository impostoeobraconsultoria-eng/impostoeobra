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
  clientes() {
    $("view").innerHTML = '<div class="placeholder">' +
      '<h2>Lista de Clientes</h2>' +
      '<p>Em construção — Entrega 4.</p>' +
      '<p class="muted">Cadastro completo dos clientes convertidos a partir de leads.</p>' +
      '</div>';
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
    if (convertBtn) convertBtn.onclick = async function () {
      if (!confirm("Converter este lead em cliente? Os campos básicos serão copiados.")) return;
      try {
        await api.call("leads.convertToClient", {
          id: l.id, nome: l.nome, ddd: l.ddd, telefone: l.whatsapp, email: l.email,
          end_uf: l.uf, obra_end_uf: l.uf
        });
        toast("Lead convertido em cliente.", "success");
        leadsStore.refresh(false);
        leadDetailView.render(l.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
    };

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

})();
