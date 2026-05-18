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

    // Bloqueia rotas só de admin para não-admins
    var profile = state.profile || {};
    var isAdmin = String(profile.perfil || "").toLowerCase() === "admin";
    var rotasAdminSomente = ["config", "vau"];
    if (!isAdmin && rotasAdminSomente.indexOf(route) >= 0) {
      location.hash = "#kanban";
      return;
    }

    // Aplica visibilidade dos links no menu conforme perfil
    document.querySelectorAll("#topbar-nav a").forEach(function (a) {
      var r = a.dataset.route;
      var soAdmin = rotasAdminSomente.indexOf(r) >= 0;
      a.style.display = (soAdmin && !isAdmin) ? "none" : "";
      a.classList.toggle("active", r === route);
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
  dashboard() { dashboardView.render(); },
  vau() { vauView.render(); },
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

      html += '<div class="config-row"><div class="field"><label>E-mail da empresa (rodapé do Material de Apoio)</label>' +
              '<input type="text" id="cfg-email-emp" value="' + escapeHtml(cfg.email_empresa || "") + '" placeholder="contato@impostoeobra.com.br" /></div></div>';

      html += '<div class="config-row"><div class="field"><label>Endereço da empresa (rodapé do Material de Apoio)</label>' +
              '<input type="text" id="cfg-end-emp" value="' + escapeHtml(cfg.endereco_empresa || "") + '" placeholder="Rua Pais Leme 215, Conj. 1713, Pinheiros-SP." /></div></div>';

      html += '<h4 style="margin-top:18px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);">Proposta Comercial (Google Doc)</h4>';
      html += '<div class="config-row"><div class="field"><label>ID do template (Google Doc da proposta)</label>' +
              '<input type="text" id="cfg-prop-tpl" value="' + escapeHtml(cfg.doc_proposta_template_id || "") + '" placeholder="ID do documento, ex.: 1AbC..." />' +
              '<small class="muted">URL do template: <code>docs.google.com/document/d/&lt;ID&gt;/edit</code> — copie só o ID.</small></div></div>';
      html += '<div class="config-row"><div class="field"><label>ID da pasta onde salvar as propostas geradas</label>' +
              '<input type="text" id="cfg-prop-pasta" value="' + escapeHtml(cfg.doc_proposta_pasta_id || "") + '" placeholder="ID da pasta no Drive" />' +
              '<small class="muted">URL da pasta: <code>drive.google.com/drive/folders/&lt;ID&gt;</code> — copie só o ID.</small></div></div>';

      html += '<h4 style="margin-top:18px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);">Contratos (Google Doc)</h4>';
      html += '<div class="config-row"><div class="field"><label>ID template — Obra em Andamento</label>' +
              '<input type="text" id="cfg-ct-and" value="' + escapeHtml(cfg.doc_contrato_andamento_id || "") + '" placeholder="ID do Google Doc do template"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>ID template — Obra Finalizada</label>' +
              '<input type="text" id="cfg-ct-fin" value="' + escapeHtml(cfg.doc_contrato_finalizada_id || "") + '"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>ID template — Prestação de Serviços</label>' +
              '<input type="text" id="cfg-ct-srv" value="' + escapeHtml(cfg.doc_contrato_servico_id || "") + '"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>ID da pasta onde salvar os contratos gerados</label>' +
              '<input type="text" id="cfg-ct-pasta" value="' + escapeHtml(cfg.doc_contrato_pasta_id || "") + '"/></div></div>';

      html += '<h4 style="margin-top:18px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);">Dados da CONTRATADA (Imposto & Obra)</h4>';
      html += '<div class="config-row"><div class="field"><label>Razão social</label>' +
              '<input type="text" id="cfg-co-razao" value="' + escapeHtml(cfg.contratada_razao || "") + '" placeholder="IMPOSTO & OBRA CONSULTORIA LTDA"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>CNPJ</label>' +
              '<input type="text" id="cfg-co-cnpj" value="' + escapeHtml(cfg.contratada_cnpj || "") + '"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>Endereço da sede</label>' +
              '<input type="text" id="cfg-co-end" value="' + escapeHtml(cfg.contratada_endereco || "") + '"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>Representante (sócio que assina)</label>' +
              '<input type="text" id="cfg-co-rep" value="' + escapeHtml(cfg.contratada_representante || "") + '"/></div></div>';
      html += '<div class="config-row"><div class="field"><label>Cidade sede (foro)</label>' +
              '<input type="text" id="cfg-co-cidade" value="' + escapeHtml(cfg.cidade_sede || "") + '" placeholder="Brasília/DF"/></div></div>';

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
          await api.call("config.set", { chave: "email_empresa",      valor: $("cfg-email-emp").value.trim() });
          await api.call("config.set", { chave: "endereco_empresa",   valor: $("cfg-end-emp").value.trim() });
          await api.call("config.set", { chave: "doc_proposta_template_id", valor: $("cfg-prop-tpl").value.trim() });
          await api.call("config.set", { chave: "doc_proposta_pasta_id",    valor: $("cfg-prop-pasta").value.trim() });
          await api.call("config.set", { chave: "doc_contrato_andamento_id", valor: $("cfg-ct-and").value.trim() });
          await api.call("config.set", { chave: "doc_contrato_finalizada_id", valor: $("cfg-ct-fin").value.trim() });
          await api.call("config.set", { chave: "doc_contrato_servico_id",   valor: $("cfg-ct-srv").value.trim() });
          await api.call("config.set", { chave: "doc_contrato_pasta_id",     valor: $("cfg-ct-pasta").value.trim() });
          await api.call("config.set", { chave: "contratada_razao",         valor: $("cfg-co-razao").value.trim() });
          await api.call("config.set", { chave: "contratada_cnpj",          valor: $("cfg-co-cnpj").value.trim() });
          await api.call("config.set", { chave: "contratada_endereco",      valor: $("cfg-co-end").value.trim() });
          await api.call("config.set", { chave: "contratada_representante", valor: $("cfg-co-rep").value.trim() });
          await api.call("config.set", { chave: "cidade_sede",              valor: $("cfg-co-cidade").value.trim() });
          state.serverConfig = await api.call("config.get");
          // refresh dos stores que usam config (etapas/produtos) e da view atual
          if (typeof leadsStore !== "undefined" && leadsStore.refresh) leadsStore.refresh(true);
          if (typeof clientesStore !== "undefined" && clientesStore.refresh) clientesStore.refresh(true);
          toast("Parâmetros salvos. Aplicados em todas as telas.", "success");
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

// Lista de produtos vinda da Config. Cada item: { value, label }
function produtosLista() {
  var s = state.serverConfig && state.serverConfig.produtos;
  var arr = s ? s.split(",").map(function (x) { return x.trim(); }).filter(Boolean)
              : ["obra_andamento","obra_finalizada"];
  return arr.map(function (v) {
    return { value: v, label: v.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }) };
  });
}

function optsProdutos(selecionado) {
  return produtosLista().map(function (p) {
    return '<option value="' + escapeHtml(p.value) + '"' + (selecionado === p.value ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
  }).join("");
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
// FUNDAMENTAÇÃO NORMATIVA (M3) — Onda 4
// ============================================================
function fmtBRL2(v) {
  var n = parseFloat(v) || 0;
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildFundamentacao(l) {
  var vau = parseFloat(l.vau) || 0;
  var co  = parseFloat(l.co)  || 0;
  var rmt = parseFloat(l.rmt) || 0;
  var cmo = parseFloat(l.cmo_pct) || 0;
  var cat = parseFloat(l.pct_categoria) || 0;
  var fs  = parseFloat(l.fator_social_pct) || 0;
  var aliq = parseFloat(l.aliquota_pct) || 0;
  var red = parseFloat(l.reducao_pre_fab_pct) || 0;
  var area = parseFloat(l.area_total) || parseFloat(l.a_construcao) || 0;
  var direto = parseFloat(l.inss_direto) || 0;
  var reduzido = parseFloat(l.inss_reduzido) || 0;
  var econ = parseFloat(l.economia) || (direto - reduzido);
  var econPct = direto > 0 ? Math.round((econ / direto) * 100) : 0;

  var rows = [
    {
      titulo: "VAU — Valor Aferido Unitário",
      valor: fmtBRL2(vau) + " /m²",
      formula: "Publicado anualmente pela Receita Federal por UF e destinação.",
      base: "Anexo I da IN RFB nº 2.021/2021 (atualizado em " + (l._vauPeriodo || "maio/2026") + ")."
    },
    {
      titulo: "CO — Custo da Obra",
      valor: fmtBRL2(co),
      formula: "CO = VAU × área total → " + fmtBRL2(vau) + " × " + (area ? area.toLocaleString("pt-BR") + " m²" : "—") + " = " + fmtBRL2(co) + ".",
      base: "Art. 12 da IN RFB nº 2.021/2021."
    },
    {
      titulo: "RMT — Remuneração da Mão de Obra",
      valor: fmtBRL2(rmt),
      formula: "RMT = CO × CMO% → " + fmtBRL2(co) + " × " + cmo.toFixed(2) + "% = " + fmtBRL2(rmt) + ".",
      base: "Art. 15 e Anexo III da IN RFB nº 2.021/2021."
    },
    {
      titulo: "CMO — Coeficiente de Mão de Obra",
      valor: cmo.toFixed(2) + "%",
      formula: "Definido pelo tipo construtivo: " + (l.tipo || "—") + (l.concreto === "Sim" ? " com concreto pré-fabricado" : "") + ".",
      base: "Anexo III da IN RFB nº 2.021/2021."
    },
    {
      titulo: "Categoria — Redução pela destinação",
      valor: cat.toFixed(2) + "%",
      formula: "Destinação: " + (l.dest || "—") + ". Reduz a base de cálculo conforme tipo de uso.",
      base: "Anexo IV da IN RFB nº 2.021/2021."
    },
    {
      titulo: "Fator Social",
      valor: fs.toFixed(2) + "%",
      formula: "Aplicado a obras de menor porte e cunho social. Reduz adicional da contribuição.",
      base: "Anexo VII da IN RFB nº 2.021/2021."
    },
    {
      titulo: "Alíquota previdenciária total",
      valor: aliq.toFixed(2) + "%",
      formula: "Soma de contribuição patronal, segurados (empregados, contribuintes individuais) e GILRAT.",
      base: "Art. 22 da Lei nº 8.212/91 c/c arts. 200 e seguintes do Decreto nº 3.048/99."
    }
  ];
  if (red > 0) {
    rows.push({
      titulo: "Redução adicional — Pré-fabricados",
      valor: red.toFixed(2) + "%",
      formula: "Obra com uso de concreto usinado/pré-fabricado tem redução adicional na base de cálculo.",
      base: "Art. 18 da IN RFB nº 2.021/2021."
    });
  }

  var html = '<div class="fund-grid" style="display:grid;gap:10px;">';
  rows.forEach(function (r) {
    html += '<div class="fund-row" style="border-left:3px solid var(--primary);padding:8px 12px;background:#f8fafc;border-radius:6px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">' +
              '<strong style="font-size:13px;">' + escapeHtml(r.titulo) + '</strong>' +
              '<span style="font-size:14px;font-weight:700;color:var(--primary);">' + escapeHtml(r.valor) + '</span>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:4px;">' + escapeHtml(r.formula) + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px;font-style:italic;">📜 ' + escapeHtml(r.base) + '</div>' +
            '</div>';
  });
  html += '</div>';

  html += '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center;">' +
          '<div style="padding:10px;background:#fee2e2;border-radius:6px;"><div style="font-size:11px;color:var(--muted);">SEM redução</div><div style="font-size:15px;font-weight:800;color:#b91c1c;">' + fmtBRL2(direto) + '</div></div>' +
          '<div style="padding:10px;background:#dcfce7;border-radius:6px;"><div style="font-size:11px;color:var(--muted);">COM redução legal</div><div style="font-size:15px;font-weight:800;color:#166534;">' + fmtBRL2(reduzido) + '</div></div>' +
          '<div style="padding:10px;background:#fef3c7;border-radius:6px;"><div style="font-size:11px;color:var(--muted);">Economia (' + econPct + '%)</div><div style="font-size:15px;font-weight:800;color:#92400e;">' + fmtBRL2(econ) + '</div></div>' +
          '</div>';
  return html;
}

function fundamentacaoTexto(l) {
  var area = parseFloat(l.area_total) || parseFloat(l.a_construcao) || 0;
  var vau = parseFloat(l.vau) || 0;
  var co = parseFloat(l.co) || 0;
  var rmt = parseFloat(l.rmt) || 0;
  var direto = parseFloat(l.inss_direto) || 0;
  var reduzido = parseFloat(l.inss_reduzido) || 0;
  var econ = parseFloat(l.economia) || (direto - reduzido);
  var econPct = direto > 0 ? Math.round((econ / direto) * 100) : 0;

  return "*Fundamentação do cálculo do INSS da sua obra*\n\n" +
    "Olá " + (l.nome || "").split(" ")[0] + "! Segue a base técnica do cálculo que enviei:\n\n" +
    "📐 *Área total:* " + (area ? area.toLocaleString("pt-BR") + " m²" : "—") + "\n" +
    "🏗️ *Tipo de obra:* " + (l.tipo || "—") + (l.concreto === "Sim" ? " (com pré-fab)" : "") + "\n" +
    "🏠 *Destinação:* " + (l.dest || "—") + "\n\n" +
    "*Como foi calculado* (IN RFB nº 2.021/2021):\n" +
    "1. VAU (Valor Aferido Unitário) " + fmtBRL2(vau) + "/m² (Anexo I)\n" +
    "2. CO (Custo da Obra) = VAU × área = " + fmtBRL2(co) + " (art. 12)\n" +
    "3. RMT (Remuneração Mão de Obra) = CO × CMO% = " + fmtBRL2(rmt) + " (art. 15 + Anexo III)\n" +
    "4. Aplicação da Categoria, Fator Social e Alíquota previdenciária\n\n" +
    "*Resultado:*\n" +
    "❌ Imposto SEM redução: *" + fmtBRL2(direto) + "*\n" +
    "✅ Imposto COM redução legal: *" + fmtBRL2(reduzido) + "*\n" +
    "💰 Economia: *" + fmtBRL2(econ) + "* (" + econPct + "%)\n\n" +
    "Toda a redução é prevista em lei e aplicada dentro das normas da Receita Federal — sem nenhum tipo de sonegação.\n\n" +
    "_Imposto & Obra Consultoria_";
}

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
      '<select id="kb-prod"><option value="">Todos produtos</option>' + optsProdutos(f.produto) + '</select>' +
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
    html += '<button class="btn" id="lead-material">📄 Material de Apoio</button>';
    html += '<button class="btn" id="lead-proposta">📑 Proposta Comercial</button>';
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
            '<option value="">—</option>' + optsProdutos(l.produto) +
            '</select></div></div>';
    html += '<div class="field-row"><div><label>Valor potencial (R$)</label><input type="number" step="0.01" id="f-valor" value="' + escapeHtml(l.valor_potencial) + '"/></div>' +
            '<div><label>Responsável</label><input type="text" id="f-resp" value="' + escapeHtml(l.responsavel) + '"/></div></div>';
    html += '<div class="field-row single"><div><label>Observações</label><textarea id="f-obs">' + escapeHtml(l.observacoes || "") + '</textarea></div></div>';
    html += '</div>';

    // === Dados da Obra (editáveis) ===
    html += '<div class="detail-card"><h3>Dados da Obra (do simulador)</h3>';
    html += '<div class="field-row">' +
            '<div><label>Responsável (PF/PJ)</label><select id="f-resp2"><option value="">—</option>' +
              ['Pessoa Física','Pessoa Jurídica'].map(function (x) { return '<option' + (l.resp === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div>' +
            '<div><label>Destinação</label><select id="f-dest"><option value="">—</option>' +
              ['Residencial Unifamiliar','Residencial Multifamiliar','Casa Popular','Comercial Salas/Lojas','Conj. Hab. Popular','Galpão Ind.','Edifício de Garagens']
                .map(function (x) { return '<option' + (l.dest === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div></div>';
    html += '<div class="field-row">' +
            '<div><label>Tipo de obra</label><select id="f-tipo"><option value="">—</option>' +
              ['Alvenaria','Mista','Madeira'].map(function (x) { return '<option' + (l.tipo === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div>' +
            '<div><label>Categoria</label><select id="f-categoria"><option value="">—</option>' +
              ['Obra Nova','Acréscimo','Reforma','Demolição'].map(function (x) { return '<option' + (l.categoria === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div></div>';
    html += '<div class="field-row">' +
            '<div><label>Concreto usinado / pré-fabricado</label><select id="f-concreto"><option value="">—</option>' +
              ['Sim','Não'].map(function (x) { return '<option' + (l.concreto === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div>' +
            '<div></div></div>';
    html += '<div class="field-row">' +
            '<div><label>Área construção (m²)</label><input type="number" step="0.01" id="f-aconstr" value="' + escapeHtml(l.a_construcao || 0) + '"/></div>' +
            '<div><label>Área reforma (m²)</label><input type="number" step="0.01" id="f-aref" value="' + escapeHtml(l.a_reforma || 0) + '"/></div></div>';
    html += '<div class="field-row">' +
            '<div><label>Área demolição (m²)</label><input type="number" step="0.01" id="f-ademo" value="' + escapeHtml(l.a_demolicao || 0) + '"/></div>' +
            '<div><label>Piscina coberta (m²)</label><input type="number" step="0.01" id="f-apcob" value="' + escapeHtml(l.a_pcoberta || 0) + '"/></div></div>';
    html += '<div class="field-row">' +
            '<div><label>Piscina descoberta (m²)</label><input type="number" step="0.01" id="f-apdesc" value="' + escapeHtml(l.a_pdescoberta || 0) + '"/></div>' +
            '<div><label>Área total (m²)</label><input type="number" step="0.01" id="f-atot" value="' + escapeHtml(l.area_total || 0) + '" readonly style="background:#f1f5f9;"/></div></div>';
    html += '</div>';

    // === Cálculos do Simulador (somente leitura, mas editáveis pra admins ajustarem) ===
    if (l.inss_direto || l.inss_reduzido || l.vau) {
      html += '<div class="detail-card"><h3>Cálculos do Simulador</h3>';
      var inssDir = parseFloat(l.inss_direto) || 0;
      var inssRed = parseFloat(l.inss_reduzido) || 0;
      var econ = parseFloat(l.economia) || 0;
      html += '<div class="field-row">' +
              '<div><label>VAU (R$/m²)</label><input type="number" step="0.01" id="f-vau" value="' + escapeHtml(l.vau || 0) + '"/></div>' +
              '<div><label>Custo da Obra — CO (R$)</label><input type="number" step="0.01" id="f-co" value="' + escapeHtml(l.co || 0) + '"/></div></div>';
      html += '<div class="field-row">' +
              '<div><label>RMT (R$)</label><input type="number" step="0.01" id="f-rmt" value="' + escapeHtml(l.rmt || 0) + '"/></div>' +
              '<div><label>CMO (%)</label><input type="number" step="0.01" id="f-cmo" value="' + escapeHtml(l.cmo_pct || 0) + '"/></div></div>';
      html += '<div class="field-row">' +
              '<div><label>% Categoria</label><input type="number" step="0.01" id="f-pctcat" value="' + escapeHtml(l.pct_categoria || 0) + '"/></div>' +
              '<div><label>Fator Social (%)</label><input type="number" step="0.01" id="f-fs" value="' + escapeHtml(l.fator_social_pct || "") + '"/></div></div>';
      html += '<div class="field-row">' +
              '<div><label>Alíquota total (%)</label><input type="number" step="0.001" id="f-aliq" value="' + escapeHtml(l.aliquota_pct || 0) + '"/></div>' +
              '<div><label>Redução pré-fab (%)</label><input type="number" step="0.01" id="f-redpf" value="' + escapeHtml(l.reducao_pre_fab_pct || 0) + '"/></div></div>';
      html += '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">';
      html += '<div class="field-row">' +
              '<div><label>Imposto direto (R$)</label><input type="number" step="0.01" id="f-inssdir" value="' + escapeHtml(l.inss_direto || 0) + '"/></div>' +
              '<div><label>Imposto reduzido (R$)</label><input type="number" step="0.01" id="f-inssred" value="' + escapeHtml(l.inss_reduzido || 0) + '"/></div></div>';
      var econPct = inssDir > 0 ? Math.round((econ / inssDir) * 100) : 0;
      html += '<div class="field-row single"><div><label>Economia (R$)</label><input type="number" step="0.01" id="f-econ" value="' + escapeHtml(l.economia || 0) + '"/> <small class="muted">' + econPct + '% de economia</small></div></div>';
      html += '</div>';

      // === Fundamentação Normativa (M3) ===
      html += '<div class="detail-card"><h3>🔍 Fundamentação do cálculo</h3>';
      html += '<p class="muted" style="font-size:12px;margin:-6px 0 12px;">Base normativa de cada componente — texto pronto pra explicar ao cliente.</p>';
      html += buildFundamentacao(l);
      html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn btn-sm" id="lead-copy-fund">📋 Copiar texto</button>' +
              '<button class="btn btn-sm ghost" id="lead-wa-fund">📱 Enviar por WhatsApp</button>' +
              '</div>';
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
        var payload = {
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
        };
        // Dados da Obra (se a seção foi renderizada)
        if ($("f-resp2"))     payload.resp = $("f-resp2").value;
        if ($("f-dest"))      payload.dest = $("f-dest").value;
        if ($("f-tipo"))      payload.tipo = $("f-tipo").value;
        if ($("f-categoria")) payload.categoria = $("f-categoria").value;
        if ($("f-concreto"))  payload.concreto = $("f-concreto").value;
        if ($("f-aconstr"))   payload.a_construcao = parseFloat($("f-aconstr").value) || 0;
        if ($("f-aref"))      payload.a_reforma = parseFloat($("f-aref").value) || 0;
        if ($("f-ademo"))     payload.a_demolicao = parseFloat($("f-ademo").value) || 0;
        if ($("f-apcob"))     payload.a_pcoberta = parseFloat($("f-apcob").value) || 0;
        if ($("f-apdesc"))    payload.a_pdescoberta = parseFloat($("f-apdesc").value) || 0;
        if ($("f-atot"))      payload.area_total = parseFloat($("f-atot").value) || 0;
        // Cálculos (se a seção foi renderizada)
        if ($("f-vau"))     payload.vau = parseFloat($("f-vau").value) || 0;
        if ($("f-co"))      payload.co = parseFloat($("f-co").value) || 0;
        if ($("f-rmt"))     payload.rmt = parseFloat($("f-rmt").value) || 0;
        if ($("f-cmo"))     payload.cmo_pct = parseFloat($("f-cmo").value) || 0;
        if ($("f-pctcat"))  payload.pct_categoria = parseFloat($("f-pctcat").value) || 0;
        if ($("f-fs") && $("f-fs").value !== "") payload.fator_social_pct = parseFloat($("f-fs").value);
        if ($("f-aliq"))    payload.aliquota_pct = parseFloat($("f-aliq").value) || 0;
        if ($("f-redpf"))   payload.reducao_pre_fab_pct = parseFloat($("f-redpf").value) || 0;
        if ($("f-inssdir")) payload.inss_direto = parseFloat($("f-inssdir").value) || 0;
        if ($("f-inssred")) payload.inss_reduzido = parseFloat($("f-inssred").value) || 0;
        if ($("f-econ"))    payload.economia = parseFloat($("f-econ").value) || 0;
        await api.call("leads.update", payload);
        toast("Lead salvo.", "success");
        leadsStore.refresh(true);
        leadDetailView.render(l.id);
      } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      saveBtn.disabled = false;
    };

    var convertBtn = $("lead-convert");
    if (convertBtn) convertBtn.onclick = function () { conversionWizard.open(l); };

    var matBtn = $("lead-material");
    if (matBtn) matBtn.onclick = function () { modalMaterial.open(l); };

    var propBtn = $("lead-proposta");
    if (propBtn) propBtn.onclick = function () { modalProposta.open({ tipo: "lead", obj: l }); };

    var copyFund = $("lead-copy-fund");
    if (copyFund) copyFund.onclick = function () {
      var txt = fundamentacaoTexto(l);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          toast("Texto copiado para a área de transferência.", "success");
        }, function () {
          toast("Não consegui copiar. Selecione manualmente.", "error");
        });
      } else {
        toast("Clipboard API não disponível. Use um navegador mais recente.", "error");
      }
    };
    var waFund = $("lead-wa-fund");
    if (waFund) waFund.onclick = function () {
      var ddd = String(l.ddd || "").replace(/\D/g, "");
      var num = String(l.whatsapp || "").replace(/\D/g, "");
      if (!ddd || !num) { toast("Lead sem telefone.", "error"); return; }
      var txt = fundamentacaoTexto(l);
      window.open("https://wa.me/55" + ddd + num + "?text=" + encodeURIComponent(txt), "_blank", "noopener");
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
            '<option value="">—</option>' + optsProdutos("") +
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

// ============================================================
// MODAL MATERIAL DE APOIO (PDF infográfico)
// ============================================================
var modalMaterial = {
  open: function (lead) {
    if (!lead) return;
    var inssDir = parseFloat(lead.inss_direto) || 0;
    var inssRed = parseFloat(lead.inss_reduzido) || 0;
    var econ    = parseFloat(lead.economia)     || (inssDir - inssRed);
    var pisc    = (parseFloat(lead.a_pcoberta) || 0) + (parseFloat(lead.a_pdescoberta) || 0);

    var html = '<div class="modal-backdrop" id="modal-bg"><div class="modal-content" style="max-width:520px;">';
    html += '<h3>📄 Gerar Material de Apoio</h3>';
    html += '<p class="muted" style="font-size:13px;margin:-4px 0 10px;">Confirme os dados antes de gerar o PDF.</p>';

    html += '<div class="field-row">' +
            '<div><label>Cliente</label><input type="text" id="mat-nome" value="' + escapeHtml(lead.nome || "") + '"/></div>' +
            '<div><label>Área constr. (m²)</label><input type="number" step="0.01" id="mat-area" value="' + (parseFloat(lead.a_construcao) || 0) + '"/></div></div>';

    html += '<div class="field-row">' +
            '<div><label>Imposto direto (R$)</label><input type="number" step="0.01" id="mat-cheio" value="' + inssDir.toFixed(2) + '"/></div>' +
            '<div><label>Imposto reduzido (R$)</label><input type="number" step="0.01" id="mat-red" value="' + inssRed.toFixed(2) + '"/></div></div>';

    html += '<div class="field-row">' +
            '<div><label>Multas (R$)</label><input type="number" step="0.01" id="mat-mult" value="0"/></div>' +
            '<div><label>Parcelas</label><input type="number" step="1" min="1" max="12" id="mat-parc" value="1"/></div></div>';

    html += '<div class="field-row single"><div><label>Área de piscina (m²) — em branco oculta a linha</label><input type="number" step="0.01" id="mat-pisc" value="' + (pisc > 0 ? pisc : "") + '"/></div></div>';

    html += '<div class="modal-actions">' +
            '<button class="btn ghost" id="mat-cancel">Cancelar</button>' +
            '<button class="btn" id="mat-go">Gerar PDF</button></div>';
    html += '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    $("mat-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    $("mat-go").onclick = function () {
      try {
        var nome  = $("mat-nome").value.trim() || "Cliente";
        var area  = parseFloat($("mat-area").value) || 0;
        var cheio = parseFloat($("mat-cheio").value) || 0;
        var red   = parseFloat($("mat-red").value)   || 0;
        var mult  = parseFloat($("mat-mult").value)  || 0;
        var parc  = parseInt($("mat-parc").value, 10) || 1;
        var piscI = $("mat-pisc").value;
        var pisc  = piscI === "" || piscI == null ? 0 : (parseFloat(piscI) || 0);

        var total = red + mult;
        var econ  = cheio > 0 ? Math.round(((cheio - red) / cheio) * 100) : 0;

        var dest = String(lead.dest || "");
        if (dest.indexOf("Residencial") === 0) dest = "Residencial";
        else if (dest.indexOf("Comercial") === 0) dest = "Comercial";
        else if (dest.indexOf("Galp") === 0) dest = "Galpão Industrial";

        var fmtBRL = function (v) { return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        var fmtArea = function (v) { return (Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })) + "m²"; };

        var cfg = state.serverConfig || {};
        var emailEmp = cfg.email_empresa || "contato@impostoeobra.com.br";
        var whatEmp  = cfg.whatsapp_empresa ? formatWhatsappE164(cfg.whatsapp_empresa) : "+55 (61) 9 9398-2653";
        var endEmp   = cfg.endereco_empresa || "Rua Pais Leme 215, Conj. 1713, Pinheiros-SP.";

        var dados = {
          responsavel:      lead.resp || "—",
          destinacao:       dest || "—",
          tipo_obra:        lead.tipo || "—",
          concreto:         lead.concreto || "—",
          area_constr:      fmtArea(area),
          area_piscina:     pisc > 0 ? fmtArea(pisc) : "0m²",
          imposto_cheio:    fmtBRL(cheio),
          imposto_reduzido: fmtBRL(red),
          multas:           fmtBRL(mult),
          total:            fmtBRL(total),
          parcelas:         parc > 1
                              ? "parcelamento em até " + parc + "x de " + fmtBRL(total / parc)
                              : "pagamento à vista",
          economia_pct:     econ + "%",
          email:            emailEmp,
          whatsapp_contato: whatEmp,
          endereco:         endEmp
        };

        var json = JSON.stringify(dados);
        var b64;
        try { b64 = btoa(unescape(encodeURIComponent(json))); }
        catch (_) { b64 = encodeURIComponent(json); }

        var url = "./material-apoio.html#data=" + b64;
        window.open(url, "_blank", "noopener");

        // registra atividade na timeline
        try {
          api.call("atividades.create", {
            ref_tipo: "lead", ref_id: lead.id,
            tipo: "material_apoio",
            descricao: "Material de Apoio gerado para " + nome + " (econ. " + econ + "%, total " + fmtBRL(total) + ")"
          });
        } catch (_) {}

        document.getElementById("modal-bg").remove();
        toast("Material de Apoio aberto em nova aba.", "success");
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
      }
    };
  }
};

// ============================================================
// MODAL PROPOSTA COMERCIAL (Google Doc gerado via Apps Script)
// ============================================================
var modalProposta = {
  open: function (ctx) {
    // ctx = { tipo: "lead"|"cliente", obj: { ...campos } }
    if (!ctx || !ctx.obj) return;
    var o = ctx.obj;

    var nomeDef    = o.nome || "";
    var cpfDef     = o.cpf_cnpj || o.cpf || o.cnpj || "";
    var endDef     = o.endereco_obra || o.endereco || ((o.cidade || "") + (o.uf ? "/" + o.uf : ""));
    var tipoDef    = o.dest || o.tipo || "";
    var areaDef    = o.area_total || o.a_construcao || "";
    var situDef    = o.produto === "obra_andamento" ? "Em andamento"
                    : o.produto === "obra_finalizada" ? "Concluída" : "";

    var html = '<div class="modal-backdrop" id="modal-bg"><div class="modal-content" style="max-width:620px;">';
    html += '<h3>📑 Gerar Proposta Comercial</h3>';
    html += '<p class="muted" style="font-size:13px;margin:-4px 0 10px;">Revise os dados — vão direto para a Proposta. O documento é criado no Drive da empresa em <code>doc_proposta_pasta_id</code>.</p>';

    html += '<div class="field-row"><div><label>Nome do cliente *</label><input type="text" id="p-nome" value="' + escapeHtml(nomeDef) + '"/></div>' +
            '<div><label>CPF / CNPJ</label><input type="text" id="p-cpf" value="' + escapeHtml(cpfDef) + '"/></div></div>';
    html += '<div class="field-row single"><div><label>Endereço da obra</label><input type="text" id="p-end" value="' + escapeHtml(endDef) + '"/></div></div>';
    html += '<div class="field-row"><div><label>Tipo de construção</label><input type="text" id="p-tipo" value="' + escapeHtml(tipoDef) + '" placeholder="Residencial / Comercial / ..."/></div>' +
            '<div><label>Área construída (m²)</label><input type="text" id="p-area" value="' + escapeHtml(areaDef) + '"/></div></div>';
    html += '<div class="field-row"><div><label>Situação da obra</label><select id="p-situ">' +
            ['Em andamento','Concluída','Regularização antiga'].map(function (x) { return '<option' + (situDef === x ? ' selected' : '') + '>' + x + '</option>'; }).join("") +
            '</select></div>' +
            '<div><label>Data da proposta</label><input type="text" id="p-data" value="' + (new Date()).toLocaleDateString("pt-BR") + '"/></div></div>';
    html += '<hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">';
    html += '<div class="field-row"><div><label>Valor — Obra Concluída</label><input type="text" id="p-vconc" value="Sob consulta"/></div>' +
            '<div><label>Valor — Obra em Andamento</label><input type="text" id="p-vand" value="R$ 260,00/mês"/></div></div>';

    html += '<div class="modal-actions">' +
            '<button class="btn ghost" id="p-cancel">Cancelar</button>' +
            '<button class="btn" id="p-go">Gerar no Drive</button></div>';
    html += '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    $("p-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    $("p-go").onclick = async function () {
      var nome = $("p-nome").value.trim();
      if (!nome) { toast("Nome do cliente é obrigatório.", "error"); return; }
      $("p-go").disabled = true;
      try {
        var payload = {
          params: {
            nome_cliente:        nome,
            cpf_cnpj:            $("p-cpf").value.trim(),
            endereco_obra:       $("p-end").value.trim(),
            tipo_construcao:     $("p-tipo").value.trim(),
            area_construida:     $("p-area").value.trim(),
            situacao_obra:       $("p-situ").value,
            data_proposta:       $("p-data").value.trim(),
            valor_obra_concluida: $("p-vconc").value.trim(),
            valor_obra_andamento: $("p-vand").value.trim()
          }
        };
        if (ctx.tipo === "lead") payload.lead_id = o.id;
        else payload.cliente_id = o.id;

        var r = await api.call("propostas.gerar", payload);
        document.getElementById("modal-bg").remove();
        toast("Proposta gerada no Drive.", "success");
        window.open(r.url, "_blank", "noopener");

        // refresh da view atual pra timeline puxar a nova atividade
        if (ctx.tipo === "lead" && leadDetailView && leadDetailView.current && leadDetailView.current.id === o.id) {
          leadDetailView.render(o.id);
        }
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
        $("p-go").disabled = false;
      }
    };
  }
};

// ============================================================
// MODAL CONTRATO — DOC (gera Google Doc do contrato existente)
// ============================================================
var modalContratoDoc = {
  open: function (contrato, cliente) {
    if (!contrato || !cliente) return;
    var produto = String(contrato.produto || "").toLowerCase();
    var modalidade = produto.indexOf("andamento") >= 0 ? "Obra em Andamento" :
                     produto.indexOf("finaliz") >= 0 || produto.indexOf("concluid") >= 0 ? "Obra Finalizada" :
                     "Prestação de Serviços";

    var valorTotal = parseFloat(contrato.valor_total) || 0;
    var parc = parseInt(contrato.parcelas, 10) || 1;
    var enderecoObra = [cliente.obra_end_logradouro, cliente.obra_end_bairro,
                        cliente.obra_end_cidade, cliente.obra_end_uf].filter(Boolean).join(", ") || "—";
    var docCli = cliente.cpf || cliente.cnpj || "—";

    var html = '<div class="modal-backdrop" id="modal-bg"><div class="modal-content" style="max-width:680px;">';
    html += '<h3>📝 Gerar Documento do Contrato</h3>';
    html += '<p class="muted" style="font-size:13px;margin:-4px 0 10px;">Modalidade detectada: <strong>' + escapeHtml(modalidade) + '</strong>. Revise antes de gerar.</p>';

    html += '<div class="field-row">' +
            '<div><label>Número do contrato</label><input type="text" id="cd-numero" value="' + escapeHtml(contrato.numero || contrato.id) + '" readonly style="background:#f1f5f9;"/></div>' +
            '<div><label>Data de assinatura</label><input type="text" id="cd-data" value="' + escapeHtml(String(contrato.data_assinatura || "").substring(0,10) || (new Date()).toLocaleDateString("pt-BR")) + '" placeholder="DD/MM/AAAA"/></div></div>';

    html += '<div class="field-row">' +
            '<div><label>Contratante (nome)</label><input type="text" id="cd-cnome" value="' + escapeHtml(cliente.nome || "") + '"/></div>' +
            '<div><label>CPF / CNPJ</label><input type="text" id="cd-cdoc" value="' + escapeHtml(docCli) + '"/></div></div>';

    html += '<div class="field-row single"><div><label>Endereço residencial do contratante</label><input type="text" id="cd-cend" value="' + escapeHtml([cliente.end_logradouro, cliente.end_bairro, cliente.end_cidade, cliente.end_uf, cliente.end_cep].filter(Boolean).join(", ")) + '"/></div></div>';

    html += '<div class="field-row single"><div><label>Endereço da obra</label><input type="text" id="cd-oend" value="' + escapeHtml(enderecoObra) + '"/></div></div>';

    html += '<div class="field-row">' +
            '<div><label>Área da obra (m²)</label><input type="text" id="cd-oarea" value="' + escapeHtml(cliente.obra_area || "") + '"/></div>' +
            '<div><label>Matrícula</label><input type="text" id="cd-omat" value="' + escapeHtml(cliente.obra_matricula || "") + '"/></div></div>';

    html += '<hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">';

    html += '<div class="field-row">' +
            '<div><label>Valor total (R$)</label><input type="number" step="0.01" id="cd-vtot" value="' + valorTotal.toFixed(2) + '"/></div>' +
            '<div><label>Valor por extenso</label><input type="text" id="cd-vext" placeholder="ex.: três mil e cem reais"/></div></div>';

    html += '<div class="field-row">' +
            '<div><label>Parcelas</label><input type="number" step="1" min="1" id="cd-parc" value="' + parc + '"/></div>' +
            '<div><label>Forma de pagamento</label><input type="text" id="cd-forma" value="' + escapeHtml(contrato.forma_pagamento || "PIX / Boleto / Cartão") + '"/></div></div>';

    if (modalidade === "Obra em Andamento") {
      html += '<div class="field-row"><div><label>Dia de vencimento mensal</label><input type="number" min="1" max="28" id="cd-dia" value="10"/></div><div></div></div>';
    }
    if (modalidade === "Prestação de Serviços") {
      html += '<div class="field-row single"><div><label>Escopo customizado do serviço</label><textarea id="cd-escopo" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;min-height:60px;">' + escapeHtml(contrato.observacoes || "") + '</textarea></div></div>';
    }

    html += '<div class="modal-actions">' +
            '<button class="btn ghost" id="cd-cancel">Cancelar</button>' +
            '<button class="btn" id="cd-go">Gerar no Drive</button></div>';
    html += '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    $("cd-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    $("cd-go").onclick = async function () {
      $("cd-go").disabled = true;
      try {
        var params = {
          contratante_nome:    $("cd-cnome").value.trim(),
          contratante_cpf_cnpj:$("cd-cdoc").value.trim(),
          contratante_endereco:$("cd-cend").value.trim(),
          obra_endereco:       $("cd-oend").value.trim(),
          obra_area:           $("cd-oarea").value.trim(),
          obra_matricula:      $("cd-omat").value.trim(),
          data_assinatura:     $("cd-data").value.trim(),
          valor_total:         "R$ " + (parseFloat($("cd-vtot").value)||0).toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2}),
          valor_extenso:       $("cd-vext").value.trim() || "(valor por extenso)",
          parcelas:            $("cd-parc").value.trim(),
          forma_pagamento:     $("cd-forma").value.trim()
        };
        if ($("cd-dia"))   params.dia_vencimento = $("cd-dia").value.trim();
        if ($("cd-escopo")) params.escopo_servico = $("cd-escopo").value.trim();

        var r = await api.call("contratos.gerarDoc", { contrato_id: contrato.id, params: params });
        document.getElementById("modal-bg").remove();
        toast("Contrato gerado no Drive.", "success");
        window.open(r.url, "_blank", "noopener");
        // refresh do cliente pra timeline puxar a atividade
        if (typeof clienteDetailView !== "undefined" && clienteDetailView.current && clienteDetailView.current.id === cliente.id) {
          clienteDetailView.render(cliente.id);
        }
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
        $("cd-go").disabled = false;
      }
    };
  }
};

// helper compartilhado: formata "55619..." -> "+55 (61) 9 ..."
function formatWhatsappE164(raw) {
  var s = String(raw || "").replace(/\D/g, "");
  if (s.length < 12) return raw;
  var cc = s.substring(0, 2);
  var ddd = s.substring(2, 4);
  var rest = s.substring(4);
  var first = rest.substring(0, rest.length - 8);
  var mid = rest.substring(rest.length - 8, rest.length - 4);
  var last = rest.substring(rest.length - 4);
  return "+" + cc + " (" + ddd + ") " + first + " " + mid + "-" + last;
}

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
      clienteDetailView.contratos = resp.contratos || [];
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
    html += '<button class="btn" id="cli-proposta">📑 Proposta Comercial</button>';
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

    // === CONTRATOS ===
    html += '<div class="cliente-section">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
    html += '<h3 style="margin:0;border:none;padding:0;">Contratos (' + clienteDetailView.contratos.length + ')</h3>';
    html += '<button class="btn btn-sm" id="cli-novo-contrato">+ Novo Contrato</button>';
    html += '</div>';
    if (!clienteDetailView.contratos.length) {
      html += '<p class="muted" style="font-size:13px;">Nenhum contrato cadastrado.</p>';
    } else {
      html += '<table class="users-table"><thead><tr>' +
              '<th>Número</th><th>Produto</th><th>Status</th><th>Valor</th><th>Pago</th><th>Parcelas</th><th>Assinatura</th><th></th></tr></thead><tbody>';
      clienteDetailView.contratos.forEach(function (ct) {
        var vt = parseFloat(ct.valor_total) || 0;
        var vp = parseFloat(ct.valor_pago) || 0;
        html += '<tr>' +
          '<td><strong>' + escapeHtml(ct.numero) + '</strong></td>' +
          '<td>' + escapeHtml((ct.produto || "").replace("_", " ")) + '</td>' +
          '<td><span class="badge ' + (ct.status === "concluido" ? "consultor" : (ct.status === "cancelado" ? "inativo" : "admin")) + '">' + escapeHtml(ct.status || "—") + '</span></td>' +
          '<td>R$ ' + vt.toLocaleString("pt-BR", {minimumFractionDigits:2}) + '</td>' +
          '<td>R$ ' + vp.toLocaleString("pt-BR", {minimumFractionDigits:2}) + '</td>' +
          '<td>' + escapeHtml(ct.parcelas || 1) + 'x</td>' +
          '<td>' + escapeHtml(String(ct.data_assinatura || "").substring(0,10)) + '</td>' +
          '<td>' +
            '<button class="btn btn-sm" data-doc-contrato="' + escapeHtml(ct.id) + '" style="margin-right:4px;">📝 Gerar doc</button>' +
            '<button class="btn btn-sm ghost" data-edit-contrato="' + escapeHtml(ct.id) + '">Editar</button>' +
          '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }
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

    var clipBtn = $("cli-proposta");
    if (clipBtn) clipBtn.onclick = function () { modalProposta.open({ tipo: "cliente", obj: c }); };

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

    // Contratos: novo + editar
    var btnNovoCtr = $("cli-novo-contrato");
    if (btnNovoCtr) btnNovoCtr.onclick = function () { modalContrato.open(null, c.id); };
    document.querySelectorAll("[data-edit-contrato]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.dataset.editContrato;
        var ct = clienteDetailView.contratos.find(function (x) { return x.id === id; });
        if (ct) modalContrato.open(ct, c.id);
      };
    });
    document.querySelectorAll("[data-doc-contrato]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.dataset.docContrato;
        var ct = clienteDetailView.contratos.find(function (x) { return x.id === id; });
        if (ct) modalContratoDoc.open(ct, c);
      };
    });
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

// ============================================================
// ENTREGA 4B — Modal de Contrato (criar / editar)
// ============================================================
var modalContrato = {
  open: function (contrato, clienteId) {
    var isEdit = !!contrato;
    var c = contrato || {
      cliente_id: clienteId,
      numero: "",
      produto: "obra_andamento",
      status: "rascunho",
      valor_total: 0,
      valor_pago: 0,
      forma_pagamento: "À vista",
      parcelas: 1,
      data_assinatura: "",
      data_inicio: "",
      data_conclusao: "",
      observacoes: ""
    };

    var html = '<div class="modal-backdrop" id="modal-bg"><div class="modal-content" style="max-width:680px;">';
    html += '<h3>' + (isEdit ? '✏️ Editar Contrato ' + escapeHtml(c.numero) : '+ Novo Contrato') + '</h3>';

    html += '<div class="field-3">' +
      '<div><label>Número</label><input type="text" id="mc-numero" value="' + escapeHtml(c.numero) + '" placeholder="auto"/></div>' +
      '<div><label>Produto</label><select id="mc-produto">' + optsProdutos(c.produto) + '</select></div>' +
      '<div><label>Status</label><select id="mc-status">' +
        ['rascunho','assinado','em_execucao','concluido','cancelado'].map(function (s) {
          return '<option' + (c.status === s ? " selected" : "") + ' value="' + s + '">' + s + '</option>';
        }).join("") +
      '</select></div></div>';

    html += '<div class="field-4">' +
      '<div><label>Valor total (R$)</label><input type="number" step="0.01" id="mc-vt" value="' + (parseFloat(c.valor_total) || 0) + '"/></div>' +
      '<div><label>Valor pago (R$)</label><input type="number" step="0.01" id="mc-vp" value="' + (parseFloat(c.valor_pago) || 0) + '"/></div>' +
      '<div><label>Parcelas</label><input type="number" min="1" id="mc-parc" value="' + (parseInt(c.parcelas, 10) || 1) + '"/></div>' +
      '<div><label>Forma de pagto</label><input type="text" id="mc-forma" value="' + escapeHtml(c.forma_pagamento) + '"/></div></div>';

    html += '<div class="field-3">' +
      '<div><label>Data assinatura</label><input type="text" id="mc-da" placeholder="DD/MM/AAAA" value="' + escapeHtml(c.data_assinatura) + '"/></div>' +
      '<div><label>Data início</label><input type="text" id="mc-di" placeholder="DD/MM/AAAA" value="' + escapeHtml(c.data_inicio) + '"/></div>' +
      '<div><label>Data conclusão</label><input type="text" id="mc-dc" placeholder="DD/MM/AAAA" value="' + escapeHtml(c.data_conclusao) + '"/></div></div>';

    html += '<div class="field-3"><div style="grid-column:span 3"><label>Observações</label>' +
            '<textarea id="mc-obs" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;min-height:60px;">' + escapeHtml(c.observacoes) + '</textarea></div></div>';

    html += '<div class="modal-actions">';
    if (isEdit) html += '<button class="btn ghost" id="mc-delete" style="margin-right:auto;color:#b91c1c;">Excluir</button>';
    html += '<button class="btn ghost" id="mc-cancel">Cancelar</button>';
    html += '<button class="btn" id="mc-save">' + (isEdit ? '💾 Salvar' : 'Criar Contrato') + '</button>';
    html += '</div>';
    html += '</div></div>';
    document.body.insertAdjacentHTML("beforeend", html);

    $("mc-cancel").onclick = function () { document.getElementById("modal-bg").remove(); };
    $("mc-save").onclick = async function () {
      $("mc-save").disabled = true;
      try {
        var payload = {
          cliente_id:       clienteId,
          numero:           $("mc-numero").value.trim(),
          produto:          $("mc-produto").value,
          status:           $("mc-status").value,
          valor_total:      parseFloat($("mc-vt").value) || 0,
          valor_pago:       parseFloat($("mc-vp").value) || 0,
          parcelas:         parseInt($("mc-parc").value, 10) || 1,
          forma_pagamento:  $("mc-forma").value,
          data_assinatura:  $("mc-da").value.trim(),
          data_inicio:      $("mc-di").value.trim(),
          data_conclusao:   $("mc-dc").value.trim(),
          observacoes:      $("mc-obs").value
        };
        if (isEdit) {
          payload.id = c.id;
          await api.call("contratos.update", payload);
          toast("Contrato atualizado.", "success");
        } else {
          await api.call("contratos.create", payload);
          toast("Contrato criado.", "success");
        }
        document.getElementById("modal-bg").remove();
        if (typeof clienteDetailView !== "undefined" && clienteDetailView.current) {
          clienteDetailView.render(clienteDetailView.current.id);
        }
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
        $("mc-save").disabled = false;
      }
    };

    if (isEdit) {
      $("mc-delete").onclick = async function () {
        if (!confirm("Excluir contrato " + (c.numero || c.id) + "?")) return;
        try {
          await api.call("contratos.delete", { id: c.id });
          toast("Contrato excluído.", "success");
          document.getElementById("modal-bg").remove();
          if (clienteDetailView && clienteDetailView.current) clienteDetailView.render(clienteDetailView.current.id);
        } catch (e) { toast("Erro: " + (e.message || e), "error"); }
      };
    }
  }
};


// ============================================================
// VAU — Tabela oficial (admin) — Onda 4 (M4)
// ============================================================
var vauView = {
  data: [],
  vigencia: "",

  render: async function () {
    $("view").innerHTML = '<div class="placeholder">Carregando tabela VAU...</div>';
    try {
      var rows = await api.call("vau.list");
      vauView.data = rows || [];
      var firstVig = vauView.data[0] && vauView.data[0].vigencia;
      vauView.vigencia = firstVig || "—";
      vauView.draw();
    } catch (e) {
      $("view").innerHTML = '<div class="placeholder"><h2>Erro</h2><p>' + escapeHtml(e.message || e) + '</p></div>';
    }
  },

  draw: function () {
    var profile = state.profile || {};
    var isAdmin = String(profile.perfil || "").toLowerCase() === "admin";

    var html = '<div class="config-view">';
    html += '<h2 style="margin:0 0 6px;">Tabela VAU — Valor Aferido Unitário</h2>';
    html += '<p class="muted" style="font-size:13px;margin:0 0 14px;">' +
            'Valores oficiais publicados pela Receita Federal (R$/m² por UF e destinação). ' +
            (isAdmin ? 'Admins podem editar; mudanças propagam para a calculadora pública em até 30 minutos.' : 'Somente leitura.') +
            '</p>';

    html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">';
    html += '<label style="font-size:12px;font-weight:600;">Vigência:</label>';
    html += '<input type="text" id="vau-vigencia" value="' + escapeHtml(vauView.vigencia) + '" placeholder="ex.: Maio/2026" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13px;width:160px;"' + (isAdmin ? '' : ' disabled') + '>';
    if (isAdmin) html += '<button class="btn btn-sm" id="vau-save-vigencia">Aplicar vigência a todas as UFs</button>';
    html += '</div>';

    html += '<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:#fff;">';
    html += '<table class="users-table" style="min-width:980px;"><thead><tr>' +
            '<th>UF</th>' +
            '<th>Casa Popular</th>' +
            '<th>Comercial</th>' +
            '<th>Conj. Popular</th>' +
            '<th>Galpão Ind.</th>' +
            '<th>Res. Multi</th>' +
            '<th>Res. Uni</th>' +
            '<th>Garagens</th>' +
            (isAdmin ? '<th></th>' : '') +
            '</tr></thead><tbody>';

    var ufsSorted = vauView.data.slice().sort(function (a, b) { return String(a.uf).localeCompare(String(b.uf)); });
    ufsSorted.forEach(function (r) {
      var uf = String(r.uf || "").toUpperCase();
      html += '<tr>';
      html += '<td><strong>' + escapeHtml(uf) + '</strong></td>';
      ["casa_popular","comercial","conj_pop","galpao","res_multi","res_uni","garagens"].forEach(function (c) {
        var v = parseFloat(r[c]) || 0;
        html += '<td><input type="number" step="0.01" min="0" data-vau-uf="' + uf + '" data-vau-col="' + c + '" value="' + v.toFixed(2) + '" style="width:90px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font:inherit;font-size:12px;text-align:right;"' + (isAdmin ? '' : ' disabled') + '></td>';
      });
      if (isAdmin) html += '<td><button class="btn btn-sm ghost" data-vau-save="' + uf + '">💾</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<p class="muted" style="font-size:12px;margin-top:14px;">' +
            'A calculadora pública (impostoeobra.com.br) busca esta tabela via endpoint <code>vau.public</code> com cache de 30 minutos. ' +
            'Para forçar atualização imediata, basta dar reload duro (Ctrl+Shift+R) na página da calculadora.' +
            '</p>';
    html += '</div>';
    $("view").innerHTML = html;

    if (!isAdmin) return;

    document.querySelectorAll("[data-vau-save]").forEach(function (btn) {
      btn.onclick = async function () {
        var uf = btn.dataset.vauSave;
        var patch = { uf: uf };
        document.querySelectorAll('[data-vau-uf="' + uf + '"]').forEach(function (inp) {
          patch[inp.dataset.vauCol] = parseFloat(inp.value) || 0;
        });
        patch.vigencia = $("vau-vigencia").value.trim() || vauView.vigencia;
        btn.disabled = true;
        try {
          await api.call("vau.set", patch);
          toast("UF " + uf + " salva.", "success");
        } catch (e) {
          toast("Erro: " + (e.message || e), "error");
        }
        btn.disabled = false;
      };
    });

    var vigBtn = $("vau-save-vigencia");
    if (vigBtn) vigBtn.onclick = async function () {
      var vig = $("vau-vigencia").value.trim();
      if (!vig) { toast("Informe a vigência.", "error"); return; }
      vigBtn.disabled = true;
      try {
        for (var i = 0; i < vauView.data.length; i++) {
          var uf = String(vauView.data[i].uf || "").toUpperCase();
          await api.call("vau.set", { uf: uf, vigencia: vig });
        }
        toast("Vigência aplicada a todas as UFs.", "success");
        vauView.render();
      } catch (e) {
        toast("Erro: " + (e.message || e), "error");
        vigBtn.disabled = false;
      }
    };
  }
};


// ============================================================
// ENTREGA 5 — DASHBOARD GERENCIAL
// ============================================================
var dashboardView = {
  filtros: { periodo: "30d" },
  charts: {},

  render: function () {
    var f = dashboardView.filtros;
    var hoje = new Date();
    var de = "";
    if (f.periodo === "30d") { var d30 = new Date(); d30.setDate(d30.getDate() - 30); de = d30.toISOString().substring(0, 10); }
    else if (f.periodo === "90d") { var d90 = new Date(); d90.setDate(d90.getDate() - 90); de = d90.toISOString().substring(0, 10); }
    else if (f.periodo === "ano") { de = hoje.getFullYear() + "-01-01"; }

    var html = '<div class="dash-toolbar">' +
      '<label style="font-size:12px;font-weight:600">Período:</label>' +
      '<select id="dash-periodo">' +
        '<option value="30d"' + (f.periodo === "30d" ? " selected" : "") + '>Últimos 30 dias</option>' +
        '<option value="90d"' + (f.periodo === "90d" ? " selected" : "") + '>Últimos 90 dias</option>' +
        '<option value="ano"' + (f.periodo === "ano" ? " selected" : "") + '>Este ano</option>' +
        '<option value="tudo"' + (f.periodo === "tudo" ? " selected" : "") + '>Tudo</option>' +
      '</select>' +
      '<button class="btn ghost" id="dash-refresh">↻ Atualizar</button>' +
      '<span class="muted" id="dash-status" style="font-size:12px;">Carregando...</span>' +
      '</div>';
    html += '<div id="dash-content"></div>';
    $("view").innerHTML = html;

    $("dash-periodo").onchange = function (e) { dashboardView.filtros.periodo = e.target.value; dashboardView.render(); };
    $("dash-refresh").onclick = function () { dashboardView.render(); };
    dashboardView.carregar(de);
  },

  carregar: async function (de) {
    try {
      var d = await api.call("dashboard.kpis", { de: de });
      var fmtBRLcompact = function (v) {
        var n = parseFloat(v) || 0;
        if (n >= 1000000) return "R$ " + (n / 1000000).toFixed(1).replace(".", ",") + "M";
        if (n >= 1000)    return "R$ " + (n / 1000).toFixed(1).replace(".", ",") + "k";
        return "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
      };
      var c = d.cards || {};
      var aReceber = (parseFloat(c.total_vendido) || 0) - (parseFloat(c.total_pago) || 0);

      var cardsHtml = '<div class="kpi-grid">' +
        '<div class="kpi-card"><div class="lbl">Leads</div><div class="val">' + (c.total_leads || 0) + '</div></div>' +
        '<div class="kpi-card"><div class="lbl">Propostas Enviadas</div><div class="val">' + (c.propostas || 0) + '</div></div>' +
        '<div class="kpi-card success"><div class="lbl">Fechados Ganhos</div><div class="val">' + (c.ganhos || 0) + '</div><div class="sub">' + (c.taxa_conversao || 0) + '% conversão</div></div>' +
        '<div class="kpi-card danger"><div class="lbl">Perdidos / Sem retorno</div><div class="val">' + (c.perdidos || 0) + '</div></div>' +
        '<div class="kpi-card primary"><div class="lbl">Ticket Médio</div><div class="val">' + fmtBRLcompact(c.ticket_medio) + '</div></div>' +
        '<div class="kpi-card primary"><div class="lbl">Total Vendido</div><div class="val">' + fmtBRLcompact(c.total_vendido) + '</div><div class="sub">' + (c.contratos_ativos || 0) + ' contratos</div></div>' +
        '<div class="kpi-card success"><div class="lbl">Total Pago</div><div class="val">' + fmtBRLcompact(c.total_pago) + '</div></div>' +
        '<div class="kpi-card warning"><div class="lbl">A Receber</div><div class="val">' + fmtBRLcompact(aReceber) + '</div></div>' +
        '</div>';

      var chartsHtml = '<div class="chart-grid">' +
        '<div class="chart-card"><h3>Funil Comercial</h3><canvas id="ch-funil"></canvas></div>' +
        '<div class="chart-card"><h3>Leads por Mês</h3><canvas id="ch-mes"></canvas></div>' +
        '<div class="chart-card"><h3>Por Estado (UF)</h3><canvas id="ch-uf"></canvas></div>' +
        '<div class="chart-card"><h3>Por Produto</h3><canvas id="ch-prod"></canvas></div>' +
        '<div class="chart-card"><h3>Origem dos Leads</h3><canvas id="ch-orig"></canvas></div>' +
        '<div class="chart-card"><h3>Conversão por Mês</h3><canvas id="ch-conv"></canvas></div>' +
        '</div>';

      $("dash-content").innerHTML = cardsHtml + chartsHtml;
      $("dash-status").textContent = "Atualizado " + new Date().toLocaleTimeString("pt-BR").substring(0, 5);

      Object.keys(dashboardView.charts).forEach(function (k) { try { dashboardView.charts[k].destroy(); } catch (_) {} });
      dashboardView.charts = {};
      if (typeof Chart === "undefined") { console.warn("Chart.js não carregado"); return; }

      var COMMON = { responsive: true, maintainAspectRatio: false };
      var fnl = d.funil || [];
      dashboardView.charts.funil = new Chart($("ch-funil"), {
        type: "bar",
        data: { labels: fnl.map(function (x) { return x.status; }),
                datasets: [{ label: "Leads", data: fnl.map(function (x) { return x.count; }), backgroundColor: "#0071E3" }] },
        options: Object.assign({}, COMMON, { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } })
      });
      var pm = d.por_mes || {};
      var meses = Object.keys(pm).sort();
      dashboardView.charts.mes = new Chart($("ch-mes"), {
        type: "line",
        data: { labels: meses, datasets: [{ label: "Leads", data: meses.map(function (m) { return pm[m].leads; }),
                       borderColor: "#0071E3", backgroundColor: "rgba(0,113,227,.12)", tension: 0.3, fill: true }] },
        options: Object.assign({}, COMMON, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
      });
      var uf = d.por_uf || {};
      var ufKeys = Object.keys(uf).sort(function (a, b) { return uf[b] - uf[a]; }).slice(0, 12);
      dashboardView.charts.uf = new Chart($("ch-uf"), {
        type: "bar",
        data: { labels: ufKeys, datasets: [{ label: "Leads", data: ufKeys.map(function (k) { return uf[k]; }), backgroundColor: "#006AE0" }] },
        options: Object.assign({}, COMMON, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
      });
      var pp = d.por_produto || {};
      var ppK = Object.keys(pp);
      dashboardView.charts.prod = new Chart($("ch-prod"), {
        type: "doughnut",
        data: { labels: ppK, datasets: [{ data: ppK.map(function (k) { return pp[k]; }),
                       backgroundColor: ["#0071E3", "#FFD439", "#16a34a", "#ef4444", "#a855f7", "#06b6d4"] }] },
        options: Object.assign({}, COMMON, { plugins: { legend: { position: "bottom" } } })
      });
      var po = d.por_origem || {};
      var poK = Object.keys(po);
      dashboardView.charts.orig = new Chart($("ch-orig"), {
        type: "doughnut",
        data: { labels: poK, datasets: [{ data: poK.map(function (k) { return po[k]; }),
                       backgroundColor: ["#0071E3", "#FFD439", "#64748b", "#16a34a", "#ef4444"] }] },
        options: Object.assign({}, COMMON, { plugins: { legend: { position: "bottom" } } })
      });
      dashboardView.charts.conv = new Chart($("ch-conv"), {
        type: "bar",
        data: { labels: meses, datasets: [
                  { label: "Leads",  data: meses.map(function (m) { return pm[m].leads;  }), backgroundColor: "#0071E3" },
                  { label: "Ganhos", data: meses.map(function (m) { return pm[m].ganhos; }), backgroundColor: "#16a34a" }
                ] },
        options: Object.assign({}, COMMON, { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
      });
    } catch (e) {
      $("dash-status").textContent = "Erro: " + (e.message || e);
      console.error(e);
    }
  }
};

})();
