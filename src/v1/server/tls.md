# TLS Termination

`[tls]` makes Nitr serve HTTPS itself, using rustls. Handlers need no
changes. TLS is off by default and never turned on just because a
certificate file exists.

It needs the `tls` Cargo feature. The released `nitr` binary includes
it; a build without it refuses to start with `[tls] enabled = true` and
says how to rebuild. An embedding Rust app enables it itself; see
[Cargo features](../library/cargo-features).

> [!TIP] Behind a proxy or load balancer?
>
> If something in front already handles TLS, leave `[tls]` off. See
> [When not to use it](#when-not-to-use-it).

## Quick start

Create a self-signed certificate for local testing:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout key.pem -out cert.pem
chmod 600 key.pem
```

Point `[tls]` at it:

```toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"

[tls]
enabled = true
cert = "cert.pem"
key = "key.pem"
```

Check it, run it, and try it:

```sh
nitr check                        # a broken or mismatched pair fails here
nitr run

curl -k https://127.0.0.1:3000/   # -k: trust the self-signed cert
curl http://127.0.0.1:3000/       # refused: the port is HTTPS only
```

The startup log confirms it:

```text
TLS enabled: 1 certificate(s), minimum version 1.2, ALPN ["http/1.1"]
listening on https://127.0.0.1:3000 with 4 Lua state(s)
```

A real certificate works the same way; only the two files change. The
Nitr repository has a runnable `examples/tls`
(`cargo run --example tls --features tls`).

> [!DANGER] `enabled = true` converts the port; it does not add one
>
> The `listen` address then speaks only HTTPS. Plain HTTP requests are
> refused, never served, and nothing redirects them. Move every
> `http://` client and health check to `https://`, or run a
> [redirect instance](#redirecting-plaintext-to-https) on the old port.

## The `[tls]` section

```toml
[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"   # leaf first, then intermediates
key = "/etc/nitr/tls/privkey.pem"      # PKCS#8, PKCS#1 or SEC1
# min_version = "1.3"                  # "1.2" (default) or "1.3"
# handshake_ms = 10000                 # default: min(header_read_ms, 10000)
```

- **`cert`** must be the full chain: your certificate, then the
  intermediates. Without the intermediates, some clients cannot verify
  it even though your own browser does.
- **`key`** is the matching private key in any common PEM form
  (`BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY` or `BEGIN EC PRIVATE KEY`).
- **`min_version`** is `"1.2"` or `"1.3"`. Keep `"1.2"` for public sites;
  use `"1.3"` only when you control every client. TLS 1.0 and 1.1 are not
  supported.
- **`handshake_ms`** limits how long a client may take to finish the TLS
  handshake. The default works out to 10 seconds. `0` is a startup
  error, not "no limit".

The server speaks HTTP/1.1 only (no HTTP/2) and does not request client
certificates (no mTLS). Every key is described in
[Configuration → `[tls]`](./configuration/file#tls); the `NITR_TLS_*`
variables are in
[Environment variables](./configuration/env#tls-through-the-environment).

## Startup checks

Nitr loads and checks the certificate and key **before** opening the
port, so a bad pair stops startup instead of failing every connection.
`nitr check` runs the same checks:

| Mistake                            | Error (shortened)                                            |
| ---------------------------------- | ------------------------------------------------------------ |
| `cert` or `key` not set            | ``[tls] enabled = true requires `key` ...``                  |
| A path that is not a readable file | `[tls] cert points at ..., which is not a readable file`     |
| The certificate given as the key   | `the key file holds no private key block`                    |
| The key given as the certificate   | `the certificate file holds no CERTIFICATE block`            |
| Truncated or garbled PEM           | `the certificate PEM is malformed` (or `private key PEM`)    |
| A key that belongs to another cert | `the certificate and key were rejected: ... KeyMismatch`     |
| `min_version = "1.1"`              | ``unknown [tls] min_version `1.1`: expected "1.2" or "1.3"`` |

On Unix, a key file readable by group or others (for example mode
`644`) logs a warning but still starts. Set it to `0600` or `0400`.

## Certificate renewal

Nitr serves certificates; it does not obtain or renew them. Use certbot
or another ACME client, then reload:

```sh
nitr reload              # finds the server through `pidfile`
kill -HUP <pid>          # the same
systemctl reload myapp   # with ExecReload=/bin/kill -HUP $MAINPID
```

A reload re-reads the two files and switches to them **only if the new
pair is valid**; otherwise it keeps the current certificate and logs a
warning. Open connections keep their certificate, new ones get the new
one, and nothing is dropped.

A reload does not re-read `nitr.toml`, so changing `enabled`,
`min_version` or `handshake_ms` needs a restart. See
[Zero-downtime reload](./deployment/#zero-downtime-reload).

### An ACME deploy hook

Copy both files into place, then signal:

```sh
#!/bin/sh
# /etc/letsencrypt/renewal-hooks/deploy/50-nitr.sh
set -eu

install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/fullchain.pem" /etc/nitr/tls/fullchain.pem
install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/privkey.pem" /etc/nitr/tls/privkey.pem

systemctl reload myapp
```

You can also point `cert` and `key` straight at
`/etc/letsencrypt/live/...` if the service user can read the `archive/`
directory the links point to. Either way, the reload is required: new
files on disk change nothing in a running server.

## HSTS

There is no `[tls] hsts` setting. HSTS tells browsers to use HTTPS only,
and they remember it for `max-age` seconds, so choose that value
yourself and send the header with [`[headers]`](./configuration/file#headers):

```toml
[headers]
# 180 days. Start smaller (e.g. 86400) until you have survived a
# certificate renewal.
Strict-Transport-Security = "max-age=15552000"
```

`[headers]` adds it to every response, static files and Nitr's own
error answers included, which a [middleware](./middleware) would miss.

> [!WARNING] `includeSubDomains` and `preload` are hard to undo
>
> `includeSubDomains` forces HTTPS on every subdomain, including future
> ones. `preload` builds your domain into browsers. Removing the header
> later does not undo either until the published `max-age` runs out.

## Redirecting plaintext to HTTPS

Run a second, tiny Nitr instance on port 80 whose only job is to
redirect:

```lua
-- redirect.lua
local app = nitr.app()
local CANONICAL = "https://example.com"   -- never req.headers.host

local function to_https(req)
    local target = CANONICAL .. req.path
    if req.uri.query ~= "" then
        target = target .. "?" .. req.uri.query
    end
    return nitr.redirect(target, 301)
end

app:get("/", to_https)
app:get("/*", to_https)

return app
```

```toml
listen = "0.0.0.0:80"
handler_script = "redirect.lua"
workers = 1
```

It uses routes, not middleware, because middleware only runs for
matched routes; `/` plus `/*` match every path. The target host is
fixed in code because the `Host` header comes from the client:
building the redirect from it would let anyone send your visitors to
another site.

## Health probes stay plaintext

With `[health] bind` set, the separate probe port stays plain HTTP even
under `[tls]`, so probes keep working during certificate trouble. To
avoid a plaintext port, leave `bind` unset (probes then answer on the
main HTTPS listener) or set `[health] enabled = false`. See
[Deployment → Health probes](./deployment/#health-probes).

## Cookies follow `[tls]`

With the default `[cookies] secure = "auto"`, cookies Nitr sets get the
`Secure` attribute when `[tls] enabled = true`. Set `"always"` when a
proxy terminates TLS, or `"never"` for plain-HTTP development. See
[Cookies & Sessions](./cookies-sessions).

## `nitr build` leaves the key outside

`nitr build` never packs the certificate or key into the single-file
build, and does not rewrite their paths. A relative path resolves
against the working directory when the build runs, so use absolute
paths. See [Single-file builds](./deployment/single-file).

## When not to use it

If a load balancer, ingress or nginx/Caddy already terminates TLS, leave
`[tls]` off. Doing it twice adds a certificate to manage and gains
nothing. Use:

```toml
listen = "127.0.0.1:3000"       # only the proxy connects

[cookies]
secure = "always"               # cookies must still be Secure

[rate_limit]
trust_forwarded_for = true      # only behind a proxy that sets or appends X-Forwarded-For
```

`secure = "always"` matters: with `"auto"`, cookies would not be
`Secure`, because Nitr cannot see the proxy. The first cookie Nitr
builds without `Secure` logs a warning, once per process:

```text
a cookie was sent without the `Secure` attribute: [tls] enabled = false,
and [cookies] secure = "auto" follows it. ...
```

A service that sets no cookie never sees it. `NITR_COOKIES_SECURE=always`
sets the policy from the environment.

In this setup, HSTS is also the proxy's job. See
[Deployment](./deployment/#terminating-at-a-proxy-in-front).

## Production checklist

- [ ] `cert` is the full chain, tested from a machine that has not seen
      the intermediate.
- [ ] `key` is mode `0600` or `0400`, owned by the service user, and
      not inside a `nitr build` output or a pushed image.
- [ ] `nitr check` passes against the real configuration.
- [ ] Every `http://` client and monitor moved to `https://`, or a
      redirect instance runs on the old port.
- [ ] A renewal hook replaces both files and reloads, tested once.
- [ ] HSTS starts with a small `max-age`.
- [ ] No `Secure` cookie warning, at startup or in the log after the
      first cookie is set.
- [ ] Binding port 443 without running as root: socket activation,
      `CAP_NET_BIND_SERVICE`, or a high port behind a redirect. The
      [systemd unit](./deployment/systemd) drops all capabilities, so
      grant it back deliberately.
