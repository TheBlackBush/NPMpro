-- Fills the server-side include (SSI) commands of the CrowdSec ban and captcha pages for each answer, with the rules of
-- backend/lib/landing-pages/placeholders.js: echo of remote_addr, host, status, date_gmt, date_local and npmpro_visit_time (HTML-escaped)
-- and config timefmt; other commands are dropped. nginx's own SSI cannot run on these pages: the bouncer answers from
-- the access phase of the visitor's location, where ssi would also parse the upstream's pages.
local M = {}

local DEFAULT_TIMEFMT = "%A, %d-%b-%Y %H:%M:%S %Z"
local ESCAPES = { ["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;", ['"'] = "&quot;", ["'"] = "&#39;" }

local function escape(text)
  return (string.gsub(text, "[&<>\"']", ESCAPES))
end

function M.fill(html, status)
  local timefmt = DEFAULT_TIMEFMT
  local now = ngx.time()
  return (string.gsub(html, "<!%-%-#%s*(%l+)(.-)%-%->", function(command, attributes)
    local values = {}
    for name, value in string.gmatch(attributes, '(%l+)="([^"]*)"') do
      values[name] = value
    end
    if command == "config" then
      if values.timefmt then
        timefmt = values.timefmt
      end
      return ""
    end
    if command ~= "echo" then
      return ""
    end
    local value
    if values.var == "remote_addr" then
      value = ngx.var.remote_addr
    elseif values.var == "host" then
      value = ngx.var.host
    elseif values.var == "status" then
      value = tostring(status)
    elseif values.var == "date_gmt" then
      value = os.date("!" .. timefmt, now)
    elseif values.var == "date_local" then
      value = os.date(timefmt, now)
    elseif values.var == "npmpro_visit_time" then
      value = ngx.var.npmpro_visit_time
    else
      return ""
    end
    if value == nil or value == "" then
      value = values.default or ""
    end
    return escape(value)
  end))
end

-- The page filled, or nil with the error logged: the caller then falls back to the bouncer's own answer.
local function filled(html, status)
  if type(html) ~= "string" then
    ngx.log(ngx.ERR, "[NPMpro pages] the page is not a string, using the bouncer's own answer")
    return nil
  end
  local ok, page = pcall(M.fill, html, status)
  if not ok then
    ngx.log(ngx.ERR, "[NPMpro pages] filling the page failed, using the bouncer's own answer: ", tostring(page))
    return nil
  end
  return page
end

-- On the admin UI (the admin server sets $npmpro_host_id to npmpro) every location sends a strict CSP that also reaches
-- the bouncer's answer and would block the page's styles and the captcha: the page is answered from an internal
-- location of conf.d/npmpro.conf instead, with the CSP of a landing page (and, for the captcha, of its provider)
local ADMIN_PAGES = { ban = "/.npmpro/crowdsec-ban", captcha = "/.npmpro/crowdsec-captcha" }
local modules = {}

local function on_admin_ui()
  return ngx.var.npmpro_host_id == "npmpro"
end

-- The page of the internal location: filled again here (the request is the same, so are the IP, host and time), with
-- the status the bouncer chose; the bare status when the page cannot be filled
function M.serve(kind)
  local status
  if kind == "ban" then
    status = tonumber(ngx.var.arg_status)
  else
    status = modules.captcha and modules.captcha.ret_code
  end
  if type(status) ~= "number" or status < 200 or status > 599 then
    status = 403
  end
  local source = kind == "ban" and modules.ban and modules.ban.template_str or modules.captcha and modules.captcha.Template
  local page = filled(source, status)
  if page == nil then
    return ngx.exit(status)
  end
  ngx.header.content_type = "text/html"
  ngx.status = status
  ngx.say(page)
  return ngx.exit(status)
end

-- The bouncer's own ban.apply and captcha.apply (lib/plugins/crowdsec/ban.lua and captcha.lua at LCSB_VER), with the
-- page filled. Compare them with the new upstream files when LCSB_VER changes (the Dockerfile checks their hashes).
-- When the fill fails, the original function answers with the unfilled page.
function M.wrap(ban, captcha)
  modules.ban, modules.captcha = ban, captcha
  local ban_apply, captcha_apply = ban.apply, captcha.apply
  ban.apply = function(ret_code)
    local status = ret_code or ban.ret_code
    if ban.redirect_location ~= "" or ban.template_str == "" then
      return ban_apply(ret_code)
    end
    if on_admin_ui() then
      return ngx.exec(ADMIN_PAGES.ban, { status = status })
    end
    local page = filled(ban.template_str, status)
    if page == nil then
      return ban_apply(ret_code)
    end
    ngx.header.content_type = "text/html"
    ngx.header.cache_control = "no-cache"
    ngx.status = status
    ngx.say(page)
    ngx.exit(status)
  end
  captcha.apply = function()
    if on_admin_ui() then
      return ngx.exec(ADMIN_PAGES.captcha)
    end
    local page = filled(captcha.Template, captcha.ret_code)
    if page == nil then
      return captcha_apply()
    end
    ngx.header.content_type = "text/html"
    ngx.header.cache_control = "no-cache"
    ngx.status = captcha.ret_code
    ngx.say(page)
    ngx.exit(captcha.ret_code)
  end
  ngx.log(ngx.INFO, "[NPMpro pages] the ban and captcha pages are filled")
end

return M
