-- Fills the server-side include (SSI) commands of the CrowdSec ban and captcha pages for each answer, with the rules of
-- backend/lib/landing-pages/placeholders.js: echo of remote_addr, host, status, date_gmt and date_local (HTML-escaped)
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
    else
      return ""
    end
    if value == nil or value == "" then
      value = values.default or ""
    end
    return escape(value)
  end))
end

-- The bouncer's own ban.apply and captcha.apply (lib/plugins/crowdsec/ban.lua and captcha.lua at LCSB_VER), with the
-- page filled. Compare them with the new upstream files when LCSB_VER changes.
function M.wrap(ban, captcha)
  ban.apply = function(ret_code)
    local status = ret_code or ban.ret_code
    if ban.redirect_location ~= "" then
      ngx.redirect(ban.redirect_location)
      return
    end
    if ban.template_str ~= "" then
      ngx.header.content_type = "text/html"
      ngx.header.cache_control = "no-cache"
      ngx.status = status
      ngx.say(M.fill(ban.template_str, status))
      ngx.exit(status)
      return
    end
    ngx.exit(status)
  end
  captcha.apply = function()
    ngx.header.content_type = "text/html"
    ngx.header.cache_control = "no-cache"
    ngx.status = captcha.ret_code
    ngx.say(M.fill(captcha.Template, captcha.ret_code))
    ngx.exit(captcha.ret_code)
  end
end

return M
