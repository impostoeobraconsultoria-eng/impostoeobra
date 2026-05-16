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
  kanban() {
    $("view").innerHTML = '<div class="placeholder">' +
      '<h2>Kanban do Funil de Vendas</h2>' +
      '<p>Em construção — Entrega 3.</p>' +
      '<p class="muted">Aqui vão aparecer os leads em colunas (Novo, Contato, Negociação, etc.) e você arrasta entre elas pra mover o status.</p>' +
      '</div>';
  },
  leads() {
    $("view").innerHTML = '<div class="placeholder">' +
      '<h2>Lista de Leads</h2>' +
      '<p>Em construção — Entrega 3.</p>' +
      '<p class="muted">Tabela com filtros (UF, produto, status), busca, paginação e botão de Novo Lead.</p>' +
      '</div>';
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

})();
